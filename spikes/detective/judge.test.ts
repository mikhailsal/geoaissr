import { expect, test } from 'bun:test';
import { leakComparison } from './compare.ts';
import { buildBatches, maskRoleWords, type FindingItem } from './judge-extract.ts';
import { newcombeDiff, summarizeJudgement } from './judge-stats.ts';

const ITEMS: FindingItem[] = [
  { spotId: 's1', arm: 'detective', executionId: 'a', text: 'Глаза ответили: левостороннее.' },
  { spotId: 's1', arm: 'single', executionId: 'b', text: 'На кадре 2 жёлтая линия.' },
  { spotId: 's1', arm: 'single', executionId: 'c', text: 'Знаков нет.' },
  { spotId: 's2', arm: 'detective', executionId: 'd', text: 'Мозг: красная почва.' },
];

test('role words and frame numbers are masked for the blind judge', () => {
  expect(maskRoleWords('Глаза ответили: левостороннее.')).toBe('[…] […]: левостороннее.');
  expect(maskRoleWords('На кадре 2 жёлтая линия; запрос к напарнику')).toBe(
    'На […] жёлтая линия; […] к […]',
  );
});

test('batches group by spot, number the items and shuffle reproducibly by seed', () => {
  const a = buildBatches(ITEMS, 7);
  const b = buildBatches(ITEMS, 7);
  expect(a.map((x) => x.spotId)).toEqual(['s1', 's2']);
  expect(a[0]?.items.map((i) => i.text)).toEqual(b[0]?.items.map((i) => i.text) ?? []);
  expect(a[0]?.items.map((i) => i.n)).toEqual([1, 2, 3]);
  expect(JSON.stringify(a[0]?.items)).not.toContain('detective');
});

test('the Newcombe interval matches the published example', () => {
  // Newcombe (1998), example (a): 56/70 vs 48/80 -> 0.2000 (0.0524, 0.3339).
  expect(newcombeDiff(56, 70, 48, 80)).toEqual({ diff: 0.2, low: 0.052, high: 0.334 });
  expect(newcombeDiff(1, 0, 1, 1)).toBeNull();
});

test('verdicts map back to arms; an interval touching 0 reads as no difference', () => {
  const batches = buildBatches(ITEMS, 7);
  const verdicts = new Map(
    batches.map((b) => [
      b.spotId,
      [...b.key].map(([n, item]) => ({
        n,
        verdict: item.arm === 'single' ? ('unsupported' as const) : ('supported' as const),
        rule_ok: null,
      })),
    ]),
  );
  const s = summarizeJudgement(batches, verdicts);
  expect(s.single.unsupported).toBe(2);
  expect(s.detective.supported).toBe(2);
  expect(s.reading).toBe('detective at least 10 points lower');
  const none = summarizeJudgement(batches, new Map());
  expect(none.single.missingVerdicts).toBe(2);
  expect(none.reading).toBe('no data');
});

test('the leak comparison pairs spot medians and scores a missing pin as the worst case', () => {
  const det = [
    { spotId: 'a', errorKm: 10, infraError: null },
    { spotId: 'a', errorKm: 30, infraError: null },
    { spotId: 'a', errorKm: 20, infraError: null },
    { spotId: 'b', errorKm: null, infraError: null },
    { spotId: 'c', errorKm: 1, infraError: 'boom' },
  ];
  const lab = [
    { spotId: 'a', errorKm: 50, infraError: null },
    { spotId: 'b', errorKm: 5, infraError: null },
    { spotId: 'c', errorKm: 1, infraError: null },
  ];
  const cmp = leakComparison(det, lab);
  expect(cmp.spots).toBe(2);
  expect(cmp.detectiveCloser).toBe(1);
  expect(cmp.labelsCloser).toBe(1);
  expect(cmp.pairs[0]).toEqual({ spotId: 'a', detectiveKm: 20, labelsKm: 50 });
});
