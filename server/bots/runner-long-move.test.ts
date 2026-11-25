import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createBotImageService } from '../images/bot-image-service.ts';
import { createFakeLocationService } from '../location.ts';
import { createQuotaManager } from '../storage/quota.ts';
import { createBotRunner } from './runner.ts';

const SLOT: BotSlotConfig = {
  id: 'b1',
  name: 'b1',
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

/** A bot process that makes one long move through the tool API and saves the reply. */
function longMoveScript(apiUrl: string, botToken: string, replyFile: string): string {
  return `
    const headers = {authorization:'Bearer '+${JSON.stringify(botToken)},'content-type':'application/json'};
    const call = (name, body) => fetch(${JSON.stringify(apiUrl)} + '/tool/' + name, {method:'POST', headers, body:JSON.stringify(body)}).then((r) => r.json());
    const reply = await call('move', {heading:90,distance_m:800,hypothesis:'Еду к перекрёстку',current_guess:{lat:1,lng:2}});
    await Bun.write(${JSON.stringify(replyFile)}, JSON.stringify(reply));
    await call('final_guess', {lat:1,lng:2,finding:'Test clue',summary:'Test'});
  `;
}

// Value: protects=distance_m survives the whole tool path: the bot API, the queue, the move handler, the reply and the journal thumb; fails_when=any layer drops the distance, charges more than one turn, or answers a long move with the short-step text; seam=fake road and fake images; no_claim=how a real road is walked (road-walk.test.ts).
test('a long move through the bot API costs one turn and reports its distance', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-runner-long-move-'));
  const replyFile = path.join(dir, 'reply.json');
  const events: EngineEvent[] = [];
  const locationService = createFakeLocationService();
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
    locationService,
    dispatch: (event) => events.push(event),
    buildCustomLaunchSpec: ({ workDir, apiUrl, botToken }) => ({
      cwd: workDir,
      cmd: [process.execPath, '-e', longMoveScript(apiUrl, botToken, replyFile)],
    }),
  });
  try {
    const target = await locationService.prepareRoundLocation({
      map: 'standard',
      region: 'world',
      excludeCountryIds: [],
    });
    runner.startRoundBots({
      matchId: 'm1',
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: true,
      bots: [SLOT],
    });
    runner.releaseObserve('m1', 1, 1);
    const deadline = Date.now() + 5000;
    while (!events.some((event) => event.type === 'bot_finished') && Date.now() < deadline)
      await Bun.sleep(10);
    expect(events.find((event) => event.type === 'bot_finished')).toMatchObject({ aborted: false });
    const thumbs = events
      .filter((event) => event.type === 'bot_thumb_added')
      .map((event) => event.thumb);
    expect(thumbs).toMatchObject([
      { action: 'move', turn: 1, params: { heading: 90, step: 1, distanceM: 800 } },
    ]);
    const reply = JSON.parse(readFileSync(replyFile, 'utf8')) as {
      text: string;
      isError?: boolean;
    };
    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain('Дальний ход: пройдено около 800 м');
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
