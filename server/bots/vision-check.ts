import { randomInt } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { BotImageSize } from '../../shared/bot-tools.ts';
import { visionSubject } from '../../shared/play-style.ts';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import { joinUnder } from '../paths.ts';
import { redactSecrets } from '../errors.ts';
import { formatStderrTail } from '../log.ts';
import { spawnManaged } from '../proc/spawn.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { buildSanitizedChildEnv } from './adapters/shared.ts';
import type { BotToolApiServer } from './api.ts';
import { buildVisionCheckPrompt } from './prompt.ts';
import { createBotToolQueue } from './queue.ts';

// The digits layout is tuned on a 400 px canvas. Other slot sizes scale it linearly, so the check
// sends the same image size (and the same relative text size) a real round would send.
const VISION_REFERENCE_SIZE = 400;

export async function renderVisionDigitsImage(digits: string, size: BotImageSize): Promise<Buffer> {
  const scale = size / VISION_REFERENCE_SIZE;
  const fontLat = path.resolve(
    import.meta.dir,
    '../../node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
  );
  const txt = await sharp({
    text: {
      text: `<span foreground="#FFD23F" size="56000">${digits}</span>`,
      fontfile: fontLat,
      rgba: true,
      dpi: Math.round(150 * scale),
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 27, g: 30, b: 35, alpha: 1 },
    },
  })
    .composite([{ input: txt, left: Math.round(80 * scale), top: Math.round(140 * scale) }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

function buildVisionQueue(digits: string, visionState: { sawDigits: boolean }, size: BotImageSize) {
  return createBotToolQueue({
    moveLimit: 0,
    moveEnabled: false,
    handlers: {
      waitObserveRelease: () => Promise.resolve(),
      executeObserve: async () => {
        const buf = await renderVisionDigitsImage(digits, size);
        return {
          text: 'Тестовое изображение с 4-значным кодом.',
          images: [{ name: 'vision.jpg', base64: buf.toString('base64'), mimeType: 'image/jpeg' }],
        };
      },
      executeLook: () => Promise.resolve({ text: 'Недоступно в проверке зрения', isError: true }),
      executeMove: () => Promise.resolve({ text: 'Недоступно в проверке зрения', isError: true }),
      onGuess: (g) => {
        if ([g.explanation, g.summary].some((text) => text?.includes(digits))) {
          visionState.sawDigits = true;
        }
      },
      onTurnsChanged: () => undefined,
      getRemainingTimeSec: () => 45,
    },
  });
}

/** Shows the host why a vision check failed: the CLI's last stderr line, with keys redacted. */
export function withCliError(message: string, stderr: string, botToken = ''): string {
  const last = formatStderrTail(stderr, 1)[0]?.trim();
  if (!last) return message;
  const clipped = last.length > 160 ? `${last.slice(0, 157)}...` : last;
  const keys = [
    process.env.GOOGLE_MAPS_BROWSER_KEY ?? '',
    process.env.GOOGLE_MAPS_SERVER_KEY ?? '',
    process.env.GOOGLE_API_KEY ?? '',
  ].filter(Boolean);
  return `${message}: ${redactSecrets(clipped, keys, botToken ? [botToken] : [])}`;
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
  // A Detective sees through its eyes: their harness, model and effort are what is checked.
  const subject = visionSubject(opts.slot);
  const adapter = getHarnessAdapter(subject.harness);
  const q = buildVisionQueue(digits, visionState, opts.slot.imageSize);
  const token = opts.api.registerBot(q);
  // Everything after registerBot sits in the try so a failed spawn still releases token and dir.
  try {
    mkdirSync(workDir, { recursive: true });
    const spec = adapter.buildLaunchSpec({
      workDir,
      model: subject.model,
      effort: subject.effort,
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
          : withCliError(`Харнесс не считал код ${digits}`, proc.getStderr(), token),
    };
  } finally {
    q.abort('vision_check_done');
    opts.api.unregisterBot(token);
    rmSync(workDir, { recursive: true, force: true });
  }
}
