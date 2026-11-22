import { expect, test } from 'bun:test';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import { addFindingToJournal, addThumbToJournal } from '../engine/journal.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotImageService } from '../images/bot-image-service.ts';
import { runFakeBotSequence } from './fake-bot.ts';

const view = { label: 'v', thumbUrl: '/t.jpg', fullUrl: '/f.jpg', jpeg: Buffer.alloc(0) };
const imageService = {
  getObserveViews: () => Promise.resolve([view, view, view, view]),
  getLookView: () => Promise.resolve(view),
  getMoveView: () => Promise.resolve(view),
} as unknown as BotImageService;
const target = {
  lat: 48,
  lng: 2,
  panoId: 'p',
  countryNameRu: 'Франция',
  fakeSceneIndex: 0,
} as RoundTarget;
const slot = { id: 'b1', harness: 'claude', imageSize: 256, personalityPreset: 'neutral' };

async function runFake(): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  await runFakeBotSequence({
    ids: { matchId: 'm', gen: 1, roundNumber: 1, slotId: 'b1' },
    isStopped: () => false,
    slot: slot as unknown as BotSlotConfig,
    target,
    imageService,
    observePromise: Promise.resolve(),
    dispatch: (e) => events.push(e),
    stepDelayMs: 0,
  });
  return events;
}

test('the fake bot produces a complete journal with every shift effect and a moving point', async () => {
  const events = await runFake();
  let journal: ReturnType<typeof addThumbToJournal> = [];
  for (const e of events) {
    if (e.type === 'bot_thumb_added') journal = addThumbToJournal(journal, e.thumb, 0);
    if (e.type === 'bot_finding') journal = addFindingToJournal(journal, e);
  }
  expect(journal.map((s) => s.kind)).toEqual(['observe', 'look', 'move']);
  expect(journal.every((s) => s.findingState === 'recorded' && s.finding)).toBe(true);
  expect(journal.slice(1).every((s) => s.reason)).toBe(true);
  const effects = journal.flatMap((s) => s.shifts?.map((x) => x.effect) ?? []).sort();
  expect(effects).toEqual(['excluded', 'stronger', 'weaker']);
  expect(journal[1]?.movedKm).toBeGreaterThan(0);
  const final = events.find((e) => e.type === 'bot_guess_recorded' && e.finalized !== false);
  expect(final?.type === 'bot_guess_recorded' && final.guess.summary).toBeTruthy();
});
