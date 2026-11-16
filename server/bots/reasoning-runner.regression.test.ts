import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EngineEvent } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createBotImageService } from '../images/bot-image-service.ts';
import { createFakeLocationService } from '../location.ts';
import { createQuotaManager } from '../storage/quota.ts';
import { createBotRunner } from './runner.ts';

// Found by /qa on 2026-11-16
// Report: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// Value: protects=real game runner requires complete final; fails_when=partial final closes session; why_new=queue-only tests do not prove runner wiring; seam=none; no_claim=live model compliance.
test('runner checkpoints incomplete final then accepts complete correction', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-reasoning-'));
  const events: EngineEvent[] = [];
  const location = createFakeLocationService();
  const runner = createBotRunner({
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'children.json'),
    fakeMode: true,
    imageService: createBotImageService({
      serverKey: null,
      fakeMode: true,
      quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
      thumbStore: createThumbStore(),
    }),
    locationService: location,
    dispatch: (event) => events.push(event),
    buildCustomLaunchSpec: ({ workDir, apiUrl, botToken }) => ({
      cwd: workDir,
      cmd: [
        process.execPath,
        '-e',
        `
      const base = ${JSON.stringify(apiUrl)}, token = ${JSON.stringify(botToken)};
      async function call(body) {
        const r = await fetch(base + '/tool/final_guess', {method:'POST', headers:{authorization:'Bearer '+token,'content-type':'application/json'}, body:JSON.stringify(body)});
        return await r.json();
      }
      if (!(await call({lat:1,lng:2,facts:'clue'})).isError) process.exit(2);
      if ((await call({lat:1,lng:2,facts:'clue',conclusion:'region',rejected_guesses:[]})).isError) process.exit(3);
    `,
      ],
    }),
  });
  try {
    const target = await location.prepareRoundLocation({ region: 'world', excludeCountryIds: [] });
    runner.startRoundBots({
      matchId: 'm1',
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: true,
      bots: [
        {
          id: 'b1',
          name: 'Bot',
          color: 'p-3',
          enabled: true,
          harness: 'claude',
          model: 'haiku',
          effort: 'low',
          moveLimit: 1,
          imageSize: 256,
          budgetSec: 60,
          difficultyPreset: 'amateur',
          personalityPreset: 'neutral',
          personalityText: '',
        },
      ],
    });
    runner.releaseObserve('m1', 1, 1);
    const deadline = Date.now() + 5000;
    while (!events.some((e) => e.type === 'bot_finished') && Date.now() < deadline)
      await Bun.sleep(10);
    const guesses = events.filter((e) => e.type === 'bot_guess_recorded');
    expect(guesses.map((e) => e.finalized)).toEqual([false, true]);
    expect(events.find((e) => e.type === 'bot_finished')).toMatchObject({ aborted: false });
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
