import { randomInt } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import { joinUnder } from '../paths.ts';
import { spawnManaged } from '../proc/spawn.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { buildSanitizedChildEnv } from './adapters/shared.ts';
import type { BotToolApiServer } from './api.ts';
import { buildVisionCheckPrompt } from './prompt.ts';
import { createBotToolQueue } from './queue.ts';

async function renderVisionDigitsImage(digits: string): Promise<Buffer> {
  const fontLat = path.resolve(
    import.meta.dir,
    '../../node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
  );
  const txt = await sharp({
    text: {
      text: `<span foreground="#FFD23F" size="56000">${digits}</span>`,
      fontfile: fontLat,
      rgba: true,
      dpi: 150,
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 27, g: 30, b: 35, alpha: 1 } },
  })
    .composite([{ input: txt, left: 80, top: 140 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function buildVisionQueue(digits: string, visionState: { sawDigits: boolean }) {
  return createBotToolQueue({
    moveLimit: 0,
    moveEnabled: false,
    handlers: {
      waitObserveRelease: () => Promise.resolve(),
      executeObserve: async () => {
        const buf = await renderVisionDigitsImage(digits);
        return {
          text: 'Тестовое изображение с 4-значным кодом.',
          images: [{ name: 'vision.jpg', base64: buf.toString('base64'), mimeType: 'image/jpeg' }],
        };
      },
      executeLook: () => Promise.resolve({ text: 'Недоступно в проверке зрения', isError: true }),
      executeMove: () => Promise.resolve({ text: 'Недоступно в проверке зрения', isError: true }),
      onGuess: (g) => {
        if (g.explanation.includes(digits)) visionState.sawDigits = true;
      },
      onTurnsChanged: () => undefined,
      getRemainingTimeSec: () => 45,
    },
  });
}

async function waitForVisionExitOrAbort(
  procExited: Promise<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  let abortListener: (() => void) | undefined;
  let resolveWait: () => void = () => undefined;
  const waitDone = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const timer = setTimeout(() => {
    resolveWait();
  }, 60_000);
  try {
    if (signal) {
      abortListener = () => {
        resolveWait();
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
    await Promise.race([procExited, waitDone]);
  } finally {
    clearTimeout(timer);
    if (abortListener && signal) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export async function runVisionCheck(opts: {
  runDir: string;
  childrenFile: string;
  fakeMode: boolean;
  api: BotToolApiServer;
  slot: BotSlotConfig;
  signal?: AbortSignal;
}): Promise<{ passed: boolean; elapsedMs: number; message: string }> {
  const t0 = Date.now();
  const digits = String(randomInt(1000, 9999));
  if (opts.fakeMode) {
    return { passed: true, elapsedMs: 15, message: `Код ${digits} распознан (fake)` };
  }
  if (opts.signal?.aborted) {
    return { passed: false, elapsedMs: 0, message: 'Проверка зрения отменена' };
  }
  const workDir = joinUnder(opts.runDir, `vision-${opts.slot.id}-${t0}`);
  const visionState = { sawDigits: false };
  const adapter = getHarnessAdapter(opts.slot.harness);
  const q = buildVisionQueue(digits, visionState);
  const token = opts.api.registerBot(q);
  // Everything after registerBot sits in the try so a failed spawn still releases token and dir.
  try {
    mkdirSync(workDir, { recursive: true });
    const spec = adapter.buildLaunchSpec({
      workDir,
      model: opts.slot.model,
      effort: opts.slot.effort,
      prompt: buildVisionCheckPrompt(adapter.deliveryMode, opts.slot.imageSize),
      apiUrl: opts.api.baseUrl,
      botToken: token,
      moveEnabled: false,
    });
    const proc = spawnManaged({
      cmd: spec.cmd,
      cwd: spec.cwd,
      env: buildSanitizedChildEnv(),
      stdinText: spec.stdinText,
      kind: 'bot-vision',
      childrenFile: opts.childrenFile,
    });
    await waitForVisionExitOrAbort(proc.exited, opts.signal);
    await proc.stop(500);
    return {
      passed: visionState.sawDigits,
      elapsedMs: Date.now() - t0,
      message: visionState.sawDigits
        ? `Зрение подтверждено (${digits})`
        : opts.signal?.aborted
          ? 'Проверка зрения отменена'
          : `Харнесс не считал код ${digits}`,
    };
  } finally {
    q.abort('vision_check_done');
    opts.api.unregisterBot(token);
    rmSync(workDir, { recursive: true, force: true });
  }
}
