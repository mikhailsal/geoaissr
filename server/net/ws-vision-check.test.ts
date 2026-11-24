// Value: protects=a vision check of a Detective counts for its eyes: a change of the brain mid-check keeps the result and stores the eyes' model and effort, a change of the eyes drops it; fails_when=the live slot is compared by the brain's fields or the stored check carries the brain's model; why_new=ws-security only edits the effort of an Intuit bot; seam=none; no_claim=a real check run (runVisionCheck is a stub; shell and runner are hand-built fakes).
import { expect, test } from 'bun:test';
import type { ServerMessage } from '../../shared/protocol.ts';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { BotRunner } from '../bots/runner.ts';
import type { RoomShell } from '../engine/shell.ts';
import { handleVisionCheckMsg } from './ws-actions.ts';

type VisionResult = Extract<ServerMessage, { type: 'vision_check_result' }>;

const DETECTIVE: BotSlotConfig = {
  id: 'bot-1',
  name: 'Сыщик',
  color: 'p-4',
  harness: 'claude',
  model: 'brain-model',
  effort: 'high',
  moveLimit: 4,
  imageSize: 400,
  budgetSec: 120,
  playStyle: 'detective',
  eyes: { harness: 'codex', model: 'eyes-model' },
  personalityPreset: 'neutral',
  personalityText: '',
  difficultyPreset: 'amateur',
  enabled: true,
};

/** Runs one check; `edit` changes the slot while the check is in flight. */
async function checkWhileEditing(edit: Partial<BotSlotConfig>): Promise<{
  tested: BotSlotConfig[];
  stored: unknown[];
  result: VisionResult | undefined;
}> {
  let slot = DETECTIVE;
  const tested: BotSlotConfig[] = [];
  const stored: unknown[] = [];
  let result: VisionResult | undefined;
  const shell = {
    getState: () => ({
      phase: 'LOBBY',
      players: { host: { isHost: true } },
      settings: { bots: [slot] },
    }),
    dispatch: (e: unknown) => void stored.push(e),
  } as unknown as RoomShell;
  const botRunner = {
    runVisionCheck: (s: BotSlotConfig) => {
      tested.push(s);
      slot = { ...slot, ...edit };
      return Promise.resolve({ passed: true, elapsedMs: 5, message: 'OK' });
    },
  } as unknown as BotRunner;
  handleVisionCheckMsg({
    shell,
    botRunner,
    inflightVisionChecks: new Set(),
    playerId: 'host',
    msg: { type: 'check_bot_vision', seq: 1, botId: 'bot-1' },
    sendAck: () => undefined,
    onVisionResult: (m) => {
      result = m;
    },
  });
  const deadline = Date.now() + 2_000;
  while (!result && Date.now() < deadline) await Bun.sleep(5);
  return { tested, stored, result };
}

test('a vision check of a Detective follows its eyes: a brain edit keeps it, an eyes edit drops it', async () => {
  const { tested, stored, result } = await checkWhileEditing({ effort: 'low', model: 'other' });
  expect(tested[0]).toMatchObject({ playStyle: 'detective', eyes: DETECTIVE.eyes });
  expect(result).toMatchObject({ passed: true, message: 'OK' });
  expect(stored).toHaveLength(1);
  // The stored check names the process that was tested: the eyes at their own effort.
  expect(stored[0]).toMatchObject({
    type: 'update_bot_vision_check',
    check: { passed: true, model: 'eyes-model', effort: 'low' },
  });

  for (const eyes of [
    { harness: 'codex', model: 'eyes-model-2' },
    { harness: 'agy', model: 'eyes-model' },
  ] as const) {
    const { stored, result } = await checkWhileEditing({ eyes });
    expect(result).toMatchObject({ passed: false });
    expect(result?.message).toContain('изменились');
    expect(stored).toEqual([]);
  }
});
