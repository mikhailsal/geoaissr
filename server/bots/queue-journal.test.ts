import { expect, test } from 'bun:test';
import { correctionText } from './queue-journal.ts';
import { createBotToolQueue, type BotSessionHandlers, type FindingRecord } from './queue.ts';

interface Seen {
  guesses: Array<{ lat: number; lng: number; finalized: boolean; summary?: string }>;
  findings: FindingRecord[];
  looks: number;
  observes: number;
}

type LookResult = Awaited<ReturnType<BotSessionHandlers['executeLook']>>;

function createQueue(
  seen: Seen,
  look: () => LookResult | Promise<LookResult> = () => ({ text: 'look' }),
  requireCompleteReasoning = true,
  onCorrection?: (info: { tool: string; missing: readonly string[]; code: string }) => void,
) {
  const handlers: BotSessionHandlers = {
    waitObserveRelease: () => Promise.resolve(),
    executeObserve: () => {
      seen.observes += 1;
      return Promise.resolve({ text: 'frames' });
    },
    executeLook: () => {
      seen.looks += 1;
      return Promise.resolve(look());
    },
    executeMove: () => Promise.resolve({ text: 'move' }),
    onGuess: (g, finalized) =>
      seen.guesses.push({ lat: g.lat, lng: g.lng, finalized, summary: g.summary }),
    onFinding: (record) => seen.findings.push(record),
    onTurnsChanged: () => undefined,
    getRemainingTimeSec: () => 40,
  };
  const queue = createBotToolQueue({
    moveLimit: 4,
    moveEnabled: true,
    requireCompleteReasoning,
    onCorrection,
    handlers,
  });
  return { queue, seen };
}

function setup(
  requireCompleteReasoning = true,
  onCorrection?: (info: { tool: string; missing: readonly string[]; code: string }) => void,
) {
  const seen: Seen = { guesses: [], findings: [], looks: 0, observes: 0 };
  return createQueue(seen, undefined, requireCompleteReasoning, onCorrection);
}

const POINT = { lat: 10, lng: 20 };
const FULL = { heading: 90, hypothesis: 'знак', finding: 'Кириллица', current_guess: POINT };

test('the first call after observe attaches its finding and point to the observe step', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const res = await queue.dispatch('look', FULL);
  expect(res.isError).toBeUndefined();
  expect(seen.findings).toEqual([
    { turn: 0, finding: 'Кириллица', findingState: 'recorded', currentGuess: POINT },
  ]);
  expect(seen.guesses).toMatchObject([{ ...POINT, finalized: false }]);
});

test('the next call attaches its finding to the previous paid step', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  await queue.dispatch('look', FULL);
  await queue.dispatch('move', { ...FULL, finding: 'Дорога слева', shifts: [] });
  expect(seen.findings.at(-1)).toMatchObject({ turn: 1, finding: 'Дорога слева' });
});

test('shifts travel with the finding', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const shift = { version: 'Польша', effect: 'excluded' as const, because: 'Кириллица' };
  await queue.dispatch('look', { ...FULL, shifts: [shift] });
  expect(seen.findings[0]?.shifts).toEqual([shift]);
});

test('a missing finding is bounced once without charging, then accepted and marked', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const args = { heading: 90, hypothesis: 'знак', current_guess: POINT };
  const bounced = await queue.dispatch('look', args);
  expect(bounced.isError).toBe(true);
  expect(bounced.text).toContain('finding');
  expect(queue.getTurnsUsed()).toBe(0);
  expect(seen.looks).toBe(0);
  expect(seen.findings).toEqual([]);
  expect(seen.guesses).toEqual([]);
  const accepted = await queue.dispatch('look', { ...args, finding: '   ' });
  expect(accepted.isError).toBeUndefined();
  expect(queue.getTurnsUsed()).toBe(1);
  expect(seen.findings.at(-1)).toMatchObject({ turn: 0, findingState: 'missing' });
});

test('a missing current_guess is bounced once and the previous checkpoint is kept', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  await queue.dispatch('look', FULL);
  const args = { heading: 0, hypothesis: 'ещё', finding: 'Вывод' };
  const bounced = await queue.dispatch('look', args);
  expect(bounced.isError).toBe(true);
  expect(bounced.text).toContain('current_guess');
  expect((await queue.dispatch('look', args)).isError).toBeUndefined();
  expect(seen.guesses).toHaveLength(1);
  expect(seen.findings.at(-1)).toMatchObject({
    turn: 1,
    findingState: 'recorded',
    pointMissing: true,
  });
});

test('the correction allowance is per call: the next call is checked afresh', async () => {
  const { queue } = setup();
  await queue.dispatch('observe', {});
  await queue.dispatch('look', { heading: 1, hypothesis: 'a', current_guess: POINT });
  await queue.dispatch('look', FULL);
  const next = await queue.dispatch('look', { heading: 2, hypothesis: 'b', current_guess: POINT });
  expect(next.isError).toBe(true);
});

test('an incomplete final saves a checkpoint, asks once, then closes as final', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const partial = await queue.dispatch('final_guess', { lat: 3, lng: 4, finding: 'Вывод' });
  expect(partial.isError).toBe(true);
  expect(partial.text).toContain('summary');
  expect(seen.guesses).toMatchObject([{ lat: 3, lng: 4, finalized: false }]);
  const again = await queue.dispatch('final_guess', { lat: 3, lng: 4, finding: 'Вывод' });
  expect(again.isError).toBeUndefined();
  expect(seen.guesses.at(-1)?.finalized).toBe(true);
});

test('a complete final stores the summary and attaches the last finding', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  await queue.dispatch('look', FULL);
  const res = await queue.dispatch('final_guess', {
    lat: 3,
    lng: 4,
    finding: 'Последний кадр',
    summary: 'Я выбрал север.',
  });
  expect(res.isError).toBeUndefined();
  expect(seen.guesses.at(-1)).toMatchObject({ finalized: true, summary: 'Я выбрал север.' });
  expect(seen.findings.at(-1)).toMatchObject({ turn: 1, finding: 'Последний кадр' });
});

test('draft_guess and submit_guess are unknown tools', async () => {
  const { queue } = setup();
  for (const name of ['draft_guess', 'submit_guess']) {
    const res = await queue.dispatch(name, { lat: 1, lng: 2, summary: 'x' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Неизвестный инструмент');
  }
});

test('without the completeness switch nothing is bounced', async () => {
  const { queue, seen } = setup(false);
  await queue.dispatch('observe', {});
  expect((await queue.dispatch('look', { heading: 0 })).isError).toBeUndefined();
  expect(seen.findings.at(-1)).toMatchObject({ turn: 0, findingState: 'missing' });
});

test('the correction template names the tool, field, retry bound and the stable code', () => {
  for (const tool of ['look', 'move']) {
    const text = correctionText(tool, ['finding']);
    expect(text).toContain(`Вызов ${tool} отклонён`);
    expect(text).toContain('finding (что показал предыдущий кадр)');
    expect(text).toContain('ход не списан');
    expect(text).toContain('«вывод не записан»');
    expect(text.endsWith('[GEO_BOT_JOURNAL_FIELD_MISSING]')).toBe(true);
  }
  const final = correctionText('final_guess', ['summary', 'finding']);
  expect(final).toContain('Догадка ещё не записана окончательной');
  expect(final).toContain('Исправление одно на шаг');
  expect(final).toContain('summary');
  expect(final.endsWith('[GEO_BOT_JOURNAL_FIELD_MISSING]')).toBe(true);
  expect(correctionText('look', ['current_guess'])).toContain('новая точка не записана');
});

test('each bounce is reported once with tool, missing fields and the code', async () => {
  const seen: unknown[] = [];
  const { queue } = setup(true, (info) => seen.push(info));
  await queue.dispatch('observe', {});
  await queue.dispatch('look', { heading: 0 });
  await queue.dispatch('look', { heading: 0 });
  expect(seen).toEqual([
    {
      tool: 'look',
      missing: ['finding', 'current_guess'],
      code: 'GEO_BOT_JOURNAL_FIELD_MISSING',
    },
  ]);
});

test('a bounce lists all missing fields and the retry may supply only one of them', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const bounced = await queue.dispatch('look', { heading: 0 });
  expect(bounced.text).toContain('finding');
  expect(bounced.text).toContain('current_guess');
  const retry = await queue.dispatch('look', { heading: 0, finding: 'Знак' });
  expect(retry.isError).toBeUndefined();
  expect(seen.findings).toMatchObject([
    { turn: 0, findingState: 'recorded', finding: 'Знак', pointMissing: true },
  ]);
  expect(seen.guesses).toEqual([]);
});

test('the allowance belongs to the pending step, so changed camera arguments do not reset it', async () => {
  const { queue, seen } = setup();
  await queue.dispatch('observe', {});
  const first = await queue.dispatch('look', { heading: 10, hypothesis: 'a' });
  expect(first.isError).toBe(true);
  const retry = await queue.dispatch('move', { heading: 200, hypothesis: 'b' });
  expect(retry.isError).toBeUndefined();
  expect(seen.findings).toMatchObject([{ turn: 0, findingState: 'missing', pointMissing: true }]);
});

test('a frame-fetch failure after acceptance keeps the journal write and never duplicates it', async () => {
  const seen: Seen = { guesses: [], findings: [], looks: 0, observes: 0 };
  let fail = true;
  const { queue } = createQueue(seen, () => {
    if (!fail) return { text: 'look' };
    fail = false;
    return { text: 'нет кадра', isError: true };
  });
  await queue.dispatch('observe', {});
  const failed = await queue.dispatch('look', FULL);
  expect(failed.isError).toBe(true);
  expect(queue.getTurnsUsed()).toBe(0);
  expect(seen.findings).toHaveLength(1);
  expect(seen.guesses).toHaveLength(1);
  const retry = await queue.dispatch('look', FULL);
  expect(retry.isError).toBeUndefined();
  expect(seen.findings).toHaveLength(1);
  expect(seen.guesses).toHaveLength(1);
});

test('a repeated observe returns the frames and writes nothing new', async () => {
  const { queue, seen } = setup();
  const first = await queue.dispatch('observe', {});
  const again = await queue.dispatch('observe', {});
  expect(again.text).toBe(first.text);
  expect(seen.observes).toBe(1);
  expect(seen.findings).toEqual([]);
});

test('a camera call that finishes after the abort emits nothing and charges no turn', async () => {
  const seen: Seen = { guesses: [], findings: [], looks: 0, observes: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { queue } = createQueue(seen, async () => {
    await gate;
    return { text: 'late' };
  });
  await queue.dispatch('observe', {});
  const inFlight = queue.dispatch('look', FULL);
  await Bun.sleep(5);
  queue.abort('time');
  const before = [seen.findings.length, seen.guesses.length];
  release();
  const res = await inFlight;
  expect(res.isError).toBe(true);
  expect(queue.getTurnsUsed()).toBe(0);
  expect([seen.findings.length, seen.guesses.length]).toEqual(before);
  await queue.dispatch('look', { ...FULL, finding: 'после конца' });
  expect([seen.findings.length, seen.guesses.length]).toEqual(before);
});

test('a look enqueued before the pending frame arrived records only its point', async () => {
  const seen: Seen = { guesses: [], findings: [], looks: 0, observes: 0 };
  const { queue } = createQueue(seen, async () => {
    await Bun.sleep(5);
    return { text: 'look' };
  });
  await queue.dispatch('observe', {});
  const other = { lat: 5, lng: 6 };
  const first = queue.dispatch('look', FULL);
  const second = queue.dispatch('look', { heading: 1, finding: 'слепой', current_guess: other });
  const results = await Promise.all([first, second]);
  expect(results.map((r) => r.isError)).toEqual([undefined, undefined]);
  expect(seen.findings).toHaveLength(2);
  expect(seen.findings[0]).toMatchObject({ turn: 0, findingState: 'recorded' });
  expect(seen.findings[1]).toEqual({ turn: 1, findingState: 'missing' });
  expect(seen.guesses.map((g) => [g.lat, g.lng])).toEqual([
    [10, 20],
    [5, 6],
  ]);
});
