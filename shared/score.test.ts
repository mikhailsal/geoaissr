import { expect, test } from 'bun:test';
import {
  WORLD_DIAGONAL_KM,
  calculateRoundScore,
  computeHumanVsAiMatch,
  computeHumanVsAiRound,
  haversineDistanceKm,
  rankStandings,
} from './score.ts';
import { finalGuessInputSchema, parseGuessInput, personalityTextSchema } from './bot-tools.ts';

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

// protects=strict final schema and tolerant ingress bounds; fails_when=invalid coordinates or empty summaries pass, or text exceeds its limit; no_claim=does not test model compliance
test('strict final schema and tolerant ingress retain coordinate and text bounds', () => {
  const structured = { summary: 'France', finding: 'Road signs', lat: 55, lng: 190 };
  expect(finalGuessInputSchema.safeParse({ ...structured, lat: 91 }).success).toBe(false);
  expect(finalGuessInputSchema.safeParse({ ...structured, summary: '   ' }).success).toBe(false);
  expect(finalGuessInputSchema.safeParse({ ...structured, conclusion: 'old' }).success).toBe(false);
  const norm = parseGuessInput({
    lat: 55,
    lng: 190,
    summary: 'x'.repeat(700),
    quip: 'q'.repeat(200),
  });
  expect(norm?.lng).toBe(-170);
  expect(norm?.summary).toHaveLength(600);
  expect(norm?.quip).toHaveLength(120);
  expect(parseGuessInput({ lat: 91, lng: 0, summary: 'x' })).toBeUndefined();
  expect(parseGuessInput({ lat: 10, lng: 0, summary: '   ' })?.explanation).toBe('');
});

test('personalityTextSchema rejects newlines and >200 chars', () => {
  expect(personalityTextSchema.safeParse('hello\nworld').success).toBe(false);
  expect(personalityTextSchema.safeParse('a'.repeat(201)).success).toBe(false);
  expect(personalityTextSchema.safeParse('Говори как профессор географии').success).toBe(true);
});
