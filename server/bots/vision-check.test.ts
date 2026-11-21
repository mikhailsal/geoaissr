import { expect, spyOn, test } from 'bun:test';
import * as crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import { getHarnessAdapter } from './adapters/index.ts';
import { createBotToolApiServer } from './api.ts';
import sharp from 'sharp';
import { IMAGE_SIZES } from '../../shared/bot-tools.ts';
import { renderVisionDigitsImage, runVisionCheck } from './vision-check.ts';

// Widest and narrowest digit strings the check can draw (randomInt(1000, 9999)).
const SAMPLE_DIGITS = ['1000', '8888', '9999'] as const;

test('the vision check image has the slot image size, so it tests what real rounds send', async () => {
  for (const size of IMAGE_SIZES) {
    for (const digits of SAMPLE_DIGITS) {
      const meta = await sharp(await renderVisionDigitsImage(digits, size)).metadata();
      expect({ size, digits, width: meta.width, height: meta.height }).toEqual({
        size,
        digits,
        width: size,
        height: size,
      });
    }
  }
});

test('the vision check digits are visible at every slot image size', async () => {
  for (const size of IMAGE_SIZES) {
    const stats = await sharp(await renderVisionDigitsImage('9999', size)).stats();
    // A blank canvas has no pixel variation; drawn digits give the red channel a wide spread.
    expect({ size, spread: (stats.channels[0]?.stdev ?? 0) > 10 }).toEqual({ size, spread: true });
  }
});

// protects=vision conclusion and legacy code recognition; fails_when=wrong digits pass or structured conclusion is ignored; why_new=image tests alone do not exercise tool ingress; seam=none; no_claim=controlled executable does not establish model vision.
test('vision check accepts the matching summary, rejects wrong digits', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-vision-tool-'));
  const api = createBotToolApiServer();
  const random = spyOn(
    crypto as unknown as { randomInt: (min: number, max: number) => number },
    'randomInt',
  ).mockReturnValue(1234);
  const adapter = getHarnessAdapter('claude');
  let args: Record<string, unknown> = {};
  const launch = spyOn(adapter, 'buildLaunchSpec').mockImplementation((opts) => ({
    cwd: opts.workDir,
    deliveryMode: 'mcp',
    cmd: [
      process.execPath,
      '-e',
      `
      const r = await fetch(${JSON.stringify(opts.apiUrl)} + '/tool/final_guess', {
        method:'POST', headers:{authorization:'Bearer '+${JSON.stringify(opts.botToken)},'content-type':'application/json'},
        body:${JSON.stringify(JSON.stringify(args))}
      });
      if (!r.ok || (await r.json()).isError) process.exit(1);
    `,
    ],
  }));
  const slot = {
    id: 'bot',
    harness: 'claude',
    model: 'test',
    effort: 'low',
    imageSize: 256,
  } as BotSlotConfig;
  try {
    for (const [body, expected] of [
      [{ lat: 0, lng: 0, summary: '1234' }, true],
      [{ lat: 0, lng: 0, summary: '9999' }, false],
    ] as const) {
      args = body;
      const result = await runVisionCheck({
        runDir: dir,
        childrenFile: path.join(dir, 'children.json'),
        fakeMode: false,
        api,
        slot,
      });
      expect(result.passed).toBe(expected);
    }
  } finally {
    launch.mockRestore();
    random.mockRestore();
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
