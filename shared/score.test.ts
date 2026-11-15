import { expect, test } from 'bun:test';
import {
  WORLD_DIAGONAL_KM,
  calculateRoundScore,
  computeHumanVsAiMatch,
  computeHumanVsAiRound,
  haversineDistanceKm,
  rankStandings,
} from './score.ts';
import {
  normalizeSubmitGuessInput,
  parseGuessInput,
  personalityTextSchema,
  submitGuessInputSchema,
} from './bot-tools.ts';

test('calculateRoundScore awards 5000 under 25m and decays exponentially', () => {
  expect(calculateRoundScore(0, WORLD_DIAGONAL_KM)).toBe(5000);
  expect(calculateRoundScore(0.024, WORLD_DIAGONAL_KM)).toBe(5000);
  const at1000 = calculateRoundScore(1000, WORLD_DIAGONAL_KM);
  expect(at1000).toBe(Math.round(5000 * Math.exp((-10 * 1000) / WORLD_DIAGONAL_KM)));
});

test('haversineDistanceKm computes great-circle distance across antimeridian', () => {
  const d = haversineDistanceKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 });
  expect(d).toBeGreaterThan(100);
  expect(d).toBeLessThan(120);
});

test('rankStandings breaks ties by answeredRounds then distance and shares exact ties', () => {
  const ranked = rankStandings([
    { id: 'c', totalScore: 5000, answeredRounds: 1, totalAnsweredDistanceKm: 10 },
    { id: 'a', totalScore: 5000, answeredRounds: 2, totalAnsweredDistanceKm: 50 },
    { id: 'b', totalScore: 5000, answeredRounds: 2, totalAnsweredDistanceKm: 50 },
    { id: 'd', totalScore: 5000, answeredRounds: 2, totalAnsweredDistanceKm: 80 },
  ]);
  expect(ranked.map((r) => [r.rank, r.item.id])).toEqual([
    [1, 'a'],
    [1, 'b'],
    [3, 'd'],
    [4, 'c'],
  ]);
});

test('computeHumanVsAiRound excludes spectators and counts unanswered as 0', () => {
  const r = computeHumanVsAiRound([
    { isAi: false, playedRound: true, score: 4000 },
    { isAi: false, playedRound: true, score: 0 },
    { isAi: false, playedRound: false, score: 0 },
    { isAi: true, playedRound: true, score: 3000 },
    { isAi: true, playedRound: true, score: 0 },
  ]);
  expect(r.humansMean).toBe(2000);
  expect(r.aiMean).toBe(1500);
});

test('computeHumanVsAiMatch hides when one side is absent and sums round means', () => {
  const hidden = computeHumanVsAiMatch(
    [[{ isAi: false, playedRound: true, score: 4000 }]],
    true,
    false,
  );
  expect(hidden.visible).toBe(false);

  const visible = computeHumanVsAiMatch(
    [
      [
        { isAi: false, playedRound: true, score: 4000 },
        { isAi: true, playedRound: true, score: 3000 },
      ],
      [
        { isAi: false, playedRound: true, score: 2000 },
        { isAi: true, playedRound: true, score: 4000 },
      ],
    ],
    true,
    true,
  );
  expect(visible.visible).toBe(true);
  expect(visible.humansTotal).toBe(6000);
  expect(visible.aiTotal).toBe(7000);
});

// protects=strict advertised reasoning and tolerant legacy bounds; fails_when=invalid coordinates or empty conclusions pass, or legacy text exceeds its limit; no_claim=does not test model compliance
test('strict final schema and tolerant legacy ingress retain coordinate and text bounds', () => {
  const structured = {
    facts: 'Road signs',
    rejected_guesses: [{ guess: 'Belgium', reason: 'Wrong signs' }],
    conclusion: 'France',
    lat: 55,
    lng: 190,
  };
  expect(submitGuessInputSchema.safeParse({ ...structured, lat: 91 }).success).toBe(false);
  expect(submitGuessInputSchema.safeParse({ ...structured, conclusion: '   ' }).success).toBe(
    false,
  );
  expect(submitGuessInputSchema.safeParse({ ...structured, explanation: 'legacy' }).success).toBe(
    false,
  );
  const strict = normalizeSubmitGuessInput(submitGuessInputSchema.parse(structured));
  expect(strict.lng).toBe(-170);
  expect(strict.conclusion).toBe('France');
  const norm = parseGuessInput({
    lat: 55,
    lng: 190,
    explanation: 'x'.repeat(700),
    quip: 'q'.repeat(200),
  });
  expect(norm?.lng).toBe(-170);
  expect(norm?.explanation).toHaveLength(600);
  expect(norm?.quip).toHaveLength(120);
  expect(parseGuessInput({ lat: 91, lng: 0, explanation: 'legacy' })).toBeUndefined();
  expect(parseGuessInput({ lat: 10, lng: 0, explanation: '   ' })?.explanation).toBe('');
});

test('personalityTextSchema rejects newlines and >200 chars', () => {
  expect(personalityTextSchema.safeParse('hello\nworld').success).toBe(false);
  expect(personalityTextSchema.safeParse('a'.repeat(201)).success).toBe(false);
  expect(personalityTextSchema.safeParse('Говори как профессор географии').success).toBe(true);
});
