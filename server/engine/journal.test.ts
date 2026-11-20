import { expect, test } from 'bun:test';
import type { BotTurnThumbView } from '../../shared/protocol.ts';
import { matchRecordSchema } from '../../shared/storage-schemas.ts';
import { addFindingToJournal, addThumbToJournal, finalizeJournal } from './journal.ts';
import type { BotRoundState, EngineEvent } from './types.ts';

type FindingEvent = Extract<EngineEvent, { type: 'bot_finding' }>;

function thumb(turn: number, action: BotTurnThumbView['action']): BotTurnThumbView {
  return { turn, action, label: `t${turn}`, thumbUrl: `/t${turn}.jpg`, hypothesis: 'проверяю' };
}

function finding(turn: number, patch: Partial<FindingEvent> = {}): FindingEvent {
  return {
    type: 'bot_finding',
    matchId: 'm',
    gen: 1,
    roundNumber: 1,
    botId: 'b',
    turn,
    findingState: 'recorded',
    finding: 'вывод',
    ...patch,
  };
}

test('observe frames share one step and a look opens the next', () => {
  let journal = addThumbToJournal([], thumb(0, 'observe'), 5);
  journal = addThumbToJournal(journal, thumb(0, 'observe'), 6);
  journal = addThumbToJournal(journal, thumb(1, 'look'), 900);
  expect(journal.map((s) => [s.index, s.kind, s.frames.length, s.findingState])).toEqual([
    [0, 'observe', 2, 'pending'],
    [1, 'look', 1, 'pending'],
  ]);
  expect(journal[1]).toMatchObject({ reason: 'проверяю', atMs: 900 });
});

test('a finding lands on its step with the point and the distance from the previous point', () => {
  let journal = addThumbToJournal([], thumb(0, 'observe'), 0);
  journal = addThumbToJournal(journal, thumb(1, 'look'), 1);
  journal = addFindingToJournal(journal, finding(0, { currentGuess: { lat: 0, lng: 0 } }));
  journal = addFindingToJournal(journal, finding(1, { currentGuess: { lat: 0, lng: 1 } }));
  expect(journal[0]).toMatchObject({ finding: 'вывод', findingState: 'recorded' });
  expect(journal[0]?.movedKm).toBeUndefined();
  expect(journal[1]?.movedKm).toBeGreaterThan(100);
});

test('an accepted call without a point marks the step', () => {
  const journal = addThumbToJournal([], thumb(0, 'observe'), 0);
  const next = addFindingToJournal(
    journal,
    finding(0, { findingState: 'missing', finding: undefined, pointMissing: true }),
  );
  expect(next[0]).toMatchObject({ findingState: 'missing', pointMissing: true });
});

function botWith(journal: BotRoundState['journal'], guess: BotRoundState['guess']) {
  return { journal, guess, guessFinalized: guess !== null } as BotRoundState;
}

test('steps still pending at scoring become round-ended', () => {
  const journal = addThumbToJournal([], thumb(0, 'observe'), 0);
  const result = finalizeJournal(botWith(journal, null));
  expect(result?.steps[0]?.findingState).toBe('round-ended');
});

test('the final summary and last finding are exposed', () => {
  let journal = addThumbToJournal([], thumb(0, 'observe'), 0);
  journal = addFindingToJournal(journal, finding(0));
  const guess = { lat: 1, lng: 2, explanation: 'я', summary: 'я' };
  expect(finalizeJournal(botWith(journal, guess))).toMatchObject({
    summary: 'я',
    finalFinding: 'вывод',
  });
});

test('a bot without a journal yields no fake steps', () => {
  expect(finalizeJournal(botWith(undefined, null))).toBeUndefined();
});

// A record written before the journal existed: telemetry only, no journal-era fields.
const OLD_RECORD = {
  version: 1,
  matchId: 'old',
  startedAt: '2026-11-01T10:00:00.000Z',
  endedAt: '2026-11-01T10:10:00.000Z',
  region: 'world',
  plannedRounds: 1,
  playedRounds: 1,
  moveEnabled: true,
  participants: [],
  humanVsAi: { visible: false, humansTotal: 0, aiTotal: 0 },
  rounds: [
    {
      roundNumber: 1,
      targetLat: 1,
      targetLng: 2,
      countryNameRu: 'Россия',
      humanWaitMs: null,
      bots: [],
      facts: 'старое поле',
      conclusion: 'старый вывод',
      rejectedGuesses: [],
    },
  ],
};

test('an old persisted record with legacy reasoning fields and no journal still parses', () => {
  expect(matchRecordSchema.safeParse(OLD_RECORD).success).toBe(true);
});
