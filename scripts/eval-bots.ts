import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { HARNESS_IDS, type HarnessId } from '../shared/storage-schemas.ts';
import { haversineDistanceKm } from '../shared/score.ts';
import { getHarnessAdapter } from '../server/bots/adapters/index.ts';
import { createBotRunner } from '../server/bots/runner.ts';
import type { BotGuessData, EngineEvent, RoundTarget } from '../server/engine/types.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import {
  createBotImageService,
  type BotImageService,
  type RenderedBotImage,
} from '../server/images/bot-image-service.ts';
import {
  annotateStreetViewImage,
  createThumb,
  formatImageLabel,
  normalizeHeadingDeg,
} from '../server/images/label.ts';
import { createFakeLocationService } from '../server/location.ts';
import { createQuotaManager } from '../server/storage/quota.ts';

export const evalSampleSchema = z.object({
  id: z.string().trim().min(1),
  countryNameRu: z.string().trim().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  imagePaths: z
    .tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)])
    .optional(),
});

export const evalDatasetManifestSchema = z.array(evalSampleSchema).min(1);

export type EvalSampleItem = z.infer<typeof evalSampleSchema>;

export interface EvalArmMetrics {
  armName: string;
  runs: number;
  medianKm: number | null;
  iqrKm: number | null;
  distancesKm: number[];
}

export function computeMedianAndIqr(values: readonly number[]): {
  median: number | null;
  iqr: number | null;
} {
  if (values.length === 0) return { median: null, iqr: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number): number => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const lo = sorted[base] ?? 0;
    const hi = sorted[base + 1] ?? lo;
    return lo + rest * (hi - lo);
  };
  const q1 = quantile(0.25);
  const q2 = quantile(0.5);
  const q3 = quantile(0.75);
  return { median: Math.round(q2 * 10) / 10, iqr: Math.round((q3 - q1) * 10) / 10 };
}

/**
 * The guess the game would score for the bot. A repeated submit_guess overwrites the earlier one
 * and the reducer ignores a bot's events once it has finished, so this is the last guess recorded
 * before the first bot_finished.
 */
export function pickFinalGuess(events: readonly EngineEvent[]): BotGuessData | null {
  let final: BotGuessData | null = null;
  for (const event of events) {
    if (event.type === 'bot_finished') break;
    if (event.type === 'bot_guess_recorded') final = event.guess;
  }
  return final;
}

export function loadDataset(datasetDir: string | null): EvalSampleItem[] {
  if (datasetDir !== null) {
    const absDir = path.resolve(datasetDir);
    const manifestPath = path.join(absDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Не найден файл манифеста датасета: ${manifestPath}`);
    }
    const parsed = evalDatasetManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    return parsed.map((item) => {
      if (!item.imagePaths) return item;
      const resolved = item.imagePaths.map((p) => {
        const absImg = path.resolve(absDir, p);
        if (!existsSync(absImg)) {
          throw new Error(`Не найден файл изображения датасета (${item.id}): ${absImg}`);
        }
        return absImg;
      }) as [string, string, string, string];
      return { ...item, imagePaths: resolved };
    });
  }
  return [
    { id: 'sample-warsaw', countryNameRu: 'Польша', lat: 52.2297, lng: 21.0122 },
    { id: 'sample-tokyo', countryNameRu: 'Япония', lat: 35.6762, lng: 139.6503 },
    { id: 'sample-milan', countryNameRu: 'Италия', lat: 45.4642, lng: 9.19 },
  ];
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) {
    throw new Error(`Флаг ${flag} требует непустое значение`);
  }
  return val;
}

export function parseEvalArgs(argv: readonly string[]): {
  dry: boolean;
  harness: HarnessId;
  datasetDir: string | null;
  repeats: number;
  outPath: string | null;
} {
  const dry = argv.includes('--dry');
  const rawHarness = readFlagValue(argv, '--harness') ?? 'claude';
  if (!(HARNESS_IDS as readonly string[]).includes(rawHarness)) {
    throw new Error(`Неизвестный харнесс "${rawHarness}". Допустимо: ${HARNESS_IDS.join(', ')}`);
  }
  const harness = rawHarness as HarnessId;
  const datasetDir = readFlagValue(argv, '--dataset');
  const rawRepeats = readFlagValue(argv, '--repeats');
  let repeats = 3;
  if (rawRepeats !== null) {
    const parsed = Number(rawRepeats);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Флаг --repeats требует целое число >= 1, получено: ${rawRepeats}`);
    }
    repeats = parsed;
  }
  const outPath = readFlagValue(argv, '--out');
  return { dry, harness, datasetDir, repeats, outPath };
}

function makeEvalBotSlot(harness: HarnessId, personalityText: string) {
  const adapter = getHarnessAdapter(harness);
  return {
    id: 'eval-bot',
    name: 'EvalBot',
    color: 'p-4' as const,
    harness,
    model: adapter.defaultModel,
    effort: 'low' as const,
    moveLimit: 0,
    imageSize: 640 as const,
    budgetSec: 60,
    personalityPreset: 'neutral' as const,
    personalityText,
    difficultyPreset: 'custom' as const,
    enabled: true,
  };
}

async function renderDatasetFrame(
  raw: Buffer,
  thumbStore: ReturnType<typeof createThumbStore>,
  action: 'observe' | 'look',
  heading: number,
  size: 256 | 400 | 640,
): Promise<RenderedBotImage> {
  const parts = formatImageLabel(action, heading);
  const jpeg = await annotateStreetViewImage(raw, size, parts);
  const thumb = await createThumb(jpeg);
  const thumbId = thumbStore.put(thumb);
  return { jpeg, thumbId, thumbUrl: `/thumb/${thumbId}`, label: parts.fullText };
}

function createEvalDatasetImageService(
  imagePaths: readonly [string, string, string, string],
  thumbStore: ReturnType<typeof createThumbStore>,
): BotImageService {
  const rawBuffers = imagePaths.map((p) => readFileSync(p));
  const headings = [0, 90, 180, 270] as const;
  return {
    prepareStartViews: () => Promise.resolve(),
    async getObserveViews({ size }): Promise<RenderedBotImage[]> {
      return Promise.all(
        headings.map(async (heading, idx) => {
          const raw = rawBuffers[idx];
          if (!raw) throw new Error(`Missing raw image buffer at index ${idx}`);
          return renderDatasetFrame(raw, thumbStore, 'observe', heading, size);
        }),
      );
    },
    async getLookView({ heading, size }): Promise<RenderedBotImage> {
      const idx = Math.round(normalizeHeadingDeg(heading) / 90) % 4;
      const raw = rawBuffers[idx];
      if (!raw) throw new Error(`Missing raw image buffer at index ${idx}`);
      return renderDatasetFrame(raw, thumbStore, 'look', heading, size);
    },
    getMoveView: () => Promise.reject(new Error('Move отключён в eval-bots')),
    clearRound: () => undefined,
  };
}

async function runSingleEvalSample(opts: {
  root: string;
  harness: HarnessId;
  dry: boolean;
  sample: EvalSampleItem;
  personalityText: string;
}): Promise<number | null> {
  if (!opts.dry && !opts.sample.imagePaths) {
    throw new Error(
      `Образец "${opts.sample.id}" не содержит imagePaths: для live-оценки нужен --dataset с реальными 4 панорамными JPEG.`,
    );
  }
  const events: EngineEvent[] = [];
  const sub = path.join(opts.root, `${opts.sample.id}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(sub, { recursive: true });
  const loc = createFakeLocationService();
  const thumbStore = createThumbStore();
  const img = opts.sample.imagePaths
    ? createEvalDatasetImageService(opts.sample.imagePaths, thumbStore)
    : createBotImageService({
        serverKey: '',
        fakeMode: true,
        quotaManager: createQuotaManager(path.join(sub, 'quota.json')),
        thumbStore,
      });
  const runner = createBotRunner({
    runDir: path.join(sub, 'run'),
    childrenFile: path.join(sub, 'children.json'),
    fakeMode: opts.dry,
    fakeStepDelayMs: 10,
    imageService: img,
    locationService: loc,
    dispatch: (e) => events.push(e),
  });
  const target: RoundTarget = {
    panoId: `eval-${opts.sample.id}`,
    lat: opts.sample.lat,
    lng: opts.sample.lng,
    countryId: 'EVAL',
    countryNameRu: opts.sample.countryNameRu,
    region: 'world',
    fakeSceneIndex: 0,
  };
  await img.prepareStartViews(target);
  try {
    runner.startRoundBots({
      matchId: `eval-${opts.sample.id}`,
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: false,
      bots: [makeEvalBotSlot(opts.harness, opts.personalityText)],
    });
    runner.releaseObserve(`eval-${opts.sample.id}`, 1, 1);
    const deadline = Date.now() + 65_000;
    while (Date.now() < deadline && !events.some((e) => e.type === 'bot_finished')) {
      await Bun.sleep(25);
    }
    const guess = pickFinalGuess(events);
    if (!guess) return null;
    return haversineDistanceKm(
      { lat: opts.sample.lat, lng: opts.sample.lng },
      { lat: guess.lat, lng: guess.lng },
    );
  } finally {
    await runner.close();
    rmSync(sub, { recursive: true, force: true });
  }
}

async function runArm(opts: {
  armName: string;
  root: string;
  harness: HarnessId;
  dry: boolean;
  samples: readonly EvalSampleItem[];
  repeats: number;
  personalityText: string;
}): Promise<EvalArmMetrics> {
  const distancesKm: number[] = [];
  for (let rep = 0; rep < opts.repeats; rep += 1) {
    for (const sample of opts.samples) {
      const dist = await runSingleEvalSample({
        root: opts.root,
        harness: opts.harness,
        dry: opts.dry,
        sample,
        personalityText: opts.personalityText,
      });
      if (dist !== null) distancesKm.push(dist);
    }
  }
  const { median, iqr } = computeMedianAndIqr(distancesKm);
  return {
    armName: opts.armName,
    runs: distancesKm.length,
    medianKm: median,
    iqrKm: iqr,
    distancesKm,
  };
}

async function main(): Promise<void> {
  const args = parseEvalArgs(Bun.argv.slice(2));
  const samples = loadDataset(args.datasetDir);
  if (!args.dry && samples.some((s) => !s.imagePaths)) {
    throw new Error(
      'Для live-оценки (--dry не указан) передайте --dataset с manifest.json, где каждый образец содержит 4 пути imagePaths.',
    );
  }
  const root = path.join(tmpdir(), `geo-eval-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const armA = await runArm({
      armName: 'baseline',
      root,
      harness: args.harness,
      dry: args.dry,
      samples,
      repeats: args.repeats,
      personalityText: 'Сравнивай знаки, язык вывесок, солнце и климат.',
    });
    const armB = await runArm({
      armName: 'candidate',
      root,
      harness: args.harness,
      dry: args.dry,
      samples,
      repeats: args.repeats,
      personalityText:
        'Сначала определи полушарие, сторону движения, шрифт на знаках и архитектуру.',
    });
    const reportPath = args.outPath
      ? path.resolve(args.outPath)
      : path.resolve(
          process.cwd(),
          'docs',
          'evals',
          `latest-${args.harness}${args.dry ? '-dry' : ''}.json`,
        );
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      `${JSON.stringify({ harness: args.harness, dry: args.dry, samples: samples.length, repeats: args.repeats, baseline: armA, candidate: armB }, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `eval-bots (${args.harness}, ${args.dry ? 'dry' : 'live'}): baseline median=${armA.medianKm} km (IQR=${armA.iqrKm}), candidate median=${armB.medianKm} km (IQR=${armB.iqrKm})`,
    );
    console.log(`Отчёт сохранён: ${reportPath}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
