// Value: protects=Detective tool contracts: role tool lists, ask/answer limits, lenient final extras; fails_when=a tool leaks to the wrong role, a limit or the question-form rule is loosened; why_new=no test imports shared/detective-tools; seam=none; no_claim=model behavior (schemas only, no CLI)
import { expect, test } from 'bun:test';
import {
  MAX_REQUESTS,
  detectiveAnswerSchema,
  detectiveAskSchema,
  eyesMoveSchema,
  getDetectiveToolNames,
  hasQuestionForm,
  isAbstain,
  parseFinalExtras,
} from './detective-tools.ts';

const ASK = {
  hypothesis: 'Япония или Корея',
  finding: 'Вывески на кандзи',
  current_guess: { lat: 35.6, lng: 139.7 },
  requests: [{ kind: 'describe', topic: 'номера машин' }],
};

test('the brain never gets camera tools and the eyes never get ask or final_guess', () => {
  expect(getDetectiveToolNames('brain')).toEqual(['briefing', 'ask', 'final_guess']);
  const eyes = getDetectiveToolNames('eyes');
  expect(eyes).toEqual(['observe', 'look', 'move', 'report', 'next_request', 'answer']);
  expect(getDetectiveToolNames('eyes', false)).not.toContain('move');
});

test('an ask takes 1 to 5 requests of known kinds and refuses extra keys', () => {
  expect(detectiveAskSchema.safeParse(ASK).success).toBe(true);
  expect(detectiveAskSchema.safeParse({ ...ASK, requests: [] }).success).toBe(false);
  const six = Array.from({ length: MAX_REQUESTS + 1 }, () => ASK.requests[0]);
  expect(detectiveAskSchema.safeParse({ ...ASK, requests: six }).success).toBe(false);
  expect(
    detectiveAskSchema.safeParse({ ...ASK, requests: [{ kind: 'zoom', topic: 'знак' }] }).success,
  ).toBe(false);
  expect(detectiveAskSchema.safeParse({ ...ASK, extra: 1 }).success).toBe(false);
  const drive = { kind: 'drive', heading: 90, distance_m: 200, topic: 'указатели у перекрёстка' };
  expect(detectiveAskSchema.safeParse({ ...ASK, requests: [drive] }).success).toBe(true);
  expect(
    detectiveAskSchema.safeParse({ ...ASK, requests: [{ ...drive, distance_m: 0 }] }).success,
  ).toBe(false);
});

test('an answer needs a request id and at least one numbered, non-empty value', () => {
  const ok = {
    request_id: 'r1',
    answers: [{ n: 1, value: 'LAWSON', confidence: 'sure', frame: 2 }],
  };
  expect(detectiveAnswerSchema.safeParse(ok).success).toBe(true);
  expect(detectiveAnswerSchema.safeParse({ ...ok, answers: [] }).success).toBe(false);
  expect(detectiveAnswerSchema.safeParse({ ...ok, answers: [{ n: 0, value: 'x' }] }).success).toBe(
    false,
  );
  expect(
    detectiveAnswerSchema.safeParse({ ...ok, answers: [{ n: 1, value: '   ' }] }).success,
  ).toBe(false);
  expect(
    detectiveAnswerSchema.safeParse({ ...ok, answers: [{ n: 1, value: 'a', confidence: 'maybe' }] })
      .success,
  ).toBe(false);
});

test('a move needs a finite heading in range and an optional far-move distance', () => {
  expect(eyesMoveSchema.safeParse({ heading: 90 }).success).toBe(true);
  expect(eyesMoveSchema.safeParse({ heading: 361 }).success).toBe(false);
  expect(eyesMoveSchema.safeParse({ heading: Number.NaN }).success).toBe(false);
  expect(eyesMoveSchema.safeParse({ heading: 10, distance_m: 1e9 }).success).toBe(false);
});

test('a topic that is a question is refused: a mark or the particle as a word', () => {
  expect(hasQuestionForm('есть ли столбы')).toBe(true);
  expect(hasQuestionForm('Видно ли дорогу')).toBe(true);
  expect(hasQuestionForm('столбы?')).toBe(true);
  expect(hasQuestionForm('столбы и знаки')).toBe(false);
  // «ли» inside a word is not the particle.
  expect(hasQuestionForm('фонари и деревья, пилотки, лиственница')).toBe(false);
});

test('final extras are lenient: a bad value counts as missing, a long clue is cut', () => {
  expect(parseFinalExtras({ confidence: 'country', clue: ' LAWSON ' })).toEqual({
    confidence: 'country',
    clue: 'LAWSON',
  });
  expect(parseFinalExtras({ confidence: 'sure', clue: '' })).toEqual({
    confidence: null,
    clue: null,
  });
  expect(parseFinalExtras('junk')).toEqual({ confidence: null, clue: null });
  expect(parseFinalExtras({ clue: 'x'.repeat(500) }).clue).toHaveLength(300);
});

test('only the three abstain markers are abstentions', () => {
  expect(['not_visible', 'unreadable', 'no_road'].every(isAbstain)).toBe(true);
  expect(isAbstain('LAWSON')).toBe(false);
});
