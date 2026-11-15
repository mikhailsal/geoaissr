import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createBotImageService } from '../images/bot-image-service.ts';
import { createFakeLocationService } from '../location.ts';
import { createQuotaManager } from '../storage/quota.ts';
import { createBotRunner } from './runner.ts';

function makeSlot(id: string): BotSlotConfig {
  return {
    id,
    name: id,
    color: 'p-3',
    enabled: true,
    harness: 'claude',
    model: 'haiku',
    effort: 'low',
    moveLimit: 2,
    imageSize: 256,
    budgetSec: 60,
    difficultyPreset: 'amateur',
    personalityPreset: 'neutral',
    personalityText: '',
  };
}

async function withRunner(
  runDir: (dir: string) => string,
  fn: (runner: ReturnType<typeof createBotRunner>, events: EngineEvent[]) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-runner-'));
  const events: EngineEvent[] = [];
  const runner = createBotRunner({
    runDir: runDir(dir),
    childrenFile: path.join(dir, 'children.json'),
    fakeMode: true,
    fakeStepDelayMs: 5,
    imageService: createBotImageService({
      serverKey: null,
      fakeMode: true,
      quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
      thumbStore: createThumbStore(),
    }),
    locationService: createFakeLocationService(),
    dispatch: (e) => events.push(e),
  });
  try {
    await fn(runner, events);
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function roundParams() {
  const target = await createFakeLocationService().prepareRoundLocation({
    region: 'world',
    excludeCountryIds: [],
  });
  return { matchId: 'm1', gen: 1, roundNumber: 1, target, moveEnabled: true };
}

test('a bot whose work dir cannot be created fails alone; the other bots still get a verdict', async () => {
  await withRunner(
    (dir) => {
      const blocker = path.join(dir, 'run-is-a-file');
      writeFileSync(blocker, 'x');
      return blocker;
    },
    async (runner, events) => {
      runner.startRoundBots({ ...(await roundParams()), bots: [makeSlot('b1'), makeSlot('b2')] });
      const finished = events.filter(
        (e): e is Extract<EngineEvent, { type: 'bot_finished' }> => e.type === 'bot_finished',
      );
      expect(finished.map((e) => e.botId)).toEqual(['b1', 'b2']);
      expect(finished.every((e) => e.aborted)).toBe(true);
    },
  );
});

test('a closed runner launches no bots and no vision checks', async () => {
  await withRunner(
    (dir) => path.join(dir, 'run'),
    async (runner, events) => {
      await runner.close();
      runner.startRoundBots({ ...(await roundParams()), bots: [makeSlot('b1')] });
      await Bun.sleep(50);
      expect(events).toEqual([]);
      const vision = await runner.runVisionCheck(makeSlot('b1'));
      expect(vision.passed).toBe(false);
    },
  );
});

// protects=runner look/move metadata and real image request fov; fails_when=effective fov, normalized parameters or hypotheses are dropped; why_new=queue mocks do not exercise runner and image boundaries; seam=none; no_claim=mock fetch does not prove Google rendering.
test('runner records paid tool parameters and requests effective fov', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-runner-views-'));
  const events: EngineEvent[] = [];
  const urls: string[] = [];
  const sharp = (await import('sharp')).default;
  const image = await sharp({
    create: { width: 640, height: 640, channels: 3, background: 'grey' },
  })
    .jpeg()
    .toBuffer();
  const imageService = createBotImageService({
    serverKey: 'test',
    fakeMode: false,
    quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
    thumbStore: createThumbStore(),
    fetchImpl: (url) => {
      urls.push(url);
      return Promise.resolve(new Response(new Uint8Array(image)));
    },
  });
  const runner = createBotRunner({
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'children.json'),
    fakeMode: true,
    imageService,
    locationService: createFakeLocationService(),
    dispatch: (event) => events.push(event),
    buildCustomLaunchSpec: ({ workDir, apiUrl, botToken }) => ({
      cwd: workDir,
      cmd: [
        process.execPath,
        '-e',
        `
        const base = ${JSON.stringify(apiUrl)}, token = ${JSON.stringify(botToken)};
        async function call(name, body) {
          const response = await fetch(base + '/tool/' + name, {method:'POST', headers:{authorization:'Bearer '+token,'content-type':'application/json'}, body:JSON.stringify(body)});
          if ((await response.json()).isError) process.exit(1);
        }
        await call('look', {heading:359.6,pitch:4.6,zoom:3,hypothesis:'Проверяю знак'});
        await call('move', {heading:90.4,hypothesis:'Проверяю дорогу'});
        await call('final_guess', {lat:1,lng:2});
      `,
      ],
    }),
  });
  try {
    runner.startRoundBots({ ...(await roundParams()), bots: [makeSlot('b1')] });
    runner.releaseObserve('m1', 1, 1);
    const deadline = Date.now() + 5000;
    while (!events.some((event) => event.type === 'bot_finished') && Date.now() < deadline)
      await Bun.sleep(10);
    expect(events.find((event) => event.type === 'bot_finished')).toMatchObject({ aborted: false });
    const thumbs = events
      .filter((event) => event.type === 'bot_thumb_added')
      .map((event) => event.thumb);
    expect(thumbs).toMatchObject([
      {
        action: 'look',
        turn: 1,
        params: { heading: 0, pitch: 5, fov: 30 },
        hypothesis: 'Проверяю знак',
      },
      { action: 'move', turn: 2, params: { heading: 90, step: 1 }, hypothesis: 'Проверяю дорогу' },
    ]);
    const lookUrl = new URL(urls[0] ?? 'http://invalid');
    expect(lookUrl.searchParams.get('heading')).toBe('0');
    expect(lookUrl.searchParams.get('pitch')).toBe('5');
    expect(lookUrl.searchParams.get('fov')).toBe('30');
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
