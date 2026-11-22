import { expect, test } from 'bun:test';
import { leakComparison } from './compare.ts';
import { buildBatches, maskRoleWords, type FindingItem } from './judge-extract.ts';
import { buildJudgePrompt, parseJudgeReply } from './judge.ts';
import { judgeSettings } from './judge-call.ts';
import { newcombeDiff, summarizeJudgement, verdictFromClaims } from './judge-stats.ts';

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
  expect(maskRoleWords('В отчёте вывеска латиницей, по отчету асфальт')).toBe(
    'В […] вывеска латиницей, по […] асфальт',
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

test('rubric v2 derives the verdict from the claim marks and counts wrong claims', () => {
  const ok = { text: 'жёлтая линия', mark: 'ok' as const };
  const unclear = { text: 'столбы деревянные', mark: 'unclear' as const };
  expect(verdictFromClaims([])).toBe('no_visual_claim');
  expect(verdictFromClaims([ok, unclear])).toBe('supported');
  expect(verdictFromClaims([unclear])).toBe('unclear');
  expect(verdictFromClaims([ok, { text: 'пустыня', mark: 'absent' }])).toBe('unsupported');
  expect(verdictFromClaims([ok, { text: 'надписей нет', mark: 'contradicted' }])).toBe(
    'unsupported',
  );

  const reply =
    'Here: {"findings":[{"n":1,"claims":[{"text":"a","mark":"ok"},{"text":"b","mark":"absent"}],"rule_ok":null},' +
    '{"n":2,"claims":[{"text":"c","mark":"unclear"}],"rule_ok":true,"reason":"dark"}]}';
  const parsed = parseJudgeReply(reply, 'v2');
  expect(parsed.map((f) => f.verdict)).toEqual(['unsupported', 'unclear']);
  expect(parsed[1]?.reason).toBe('dark');

  const batches = buildBatches(ITEMS.slice(0, 1), 7);
  const s = summarizeJudgement(batches, new Map([['s1', parsed.slice(0, 1)]]));
  expect(s.detective.claims).toEqual({ ok: 1, contradicted: 0, absent: 1, unclear: 0 });
  expect(s.detective.claimErrorRate).toBe(0.5);
});

test('the v1 prompt keeps its verdict rule and the v2 prompt asks for claim marks', () => {
  const batch = buildBatches(ITEMS, 7)[0];
  if (!batch) throw new Error('no batch');
  const sample = {
    id: 's1',
    countryNameRu: 'Тест',
    lat: 0,
    lng: 0,
    imagePaths: ['./a.jpg', './b.jpg', './c.jpg', './d.jpg'] as [string, string, string, string],
  };
  const v1 = buildJudgePrompt(sample, batch);
  expect(v1).toContain('"unsupported" if at least one visual claim is contradicted by the photos');
  expect(v1).not.toContain('"unclear"');
  const v2 = buildJudgePrompt(sample, batch, 'v2');
  expect(v2).toContain('"unclear" if the photos are too small, dark or blurred');
  expect(v2).toContain('"claims":[{"text":"...","mark":"ok"}]');
  expect(
    parseJudgeReply('{"findings":[{"n":1,"verdict":"supported","rule_ok":null}]}', 'v1'),
  ).toEqual([{ n: 1, verdict: 'supported', rule_ok: null }]);
});

test('judge settings default to the earlier spikes and take a model and a seed', () => {
  expect(judgeSettings([], 20261121)).toEqual({ model: 'claude-sonnet-5-5', seed: 20261121 });
  expect(judgeSettings(['--judge-model', 'claude-opus-5-5', '--seed', '20261123'], 1)).toEqual({
    model: 'claude-opus-5-5',
    seed: 20261123,
  });
  expect(() => judgeSettings(['--seed', 'x'], 1)).toThrow('bad --seed');
});

test('rubric v3 tags each claim seen or not_seen; only a wrong seen claim makes a finding unsupported', () => {
  const reply =
    '{"findings":[{"n":1,"claims":[{"text":"a","kind":"seen","mark":"ok"},{"text":"номер не читается","kind":"not_seen","mark":"contradicted"}],"rule_ok":null},' +
    '{"n":2,"claims":[{"text":"пальмы","kind":"seen","mark":"absent"}],"rule_ok":null}]}';
  const parsed = parseJudgeReply(reply, 'v3');
  expect(parsed.map((f) => f.verdict)).toEqual(['supported', 'unsupported']);
  expect(() => parseJudgeReply(reply.replaceAll('"kind":"seen",', ''), 'v3')).toThrow();

  const batches = buildBatches(ITEMS.slice(0, 2), 7);
  const batch = batches[0];
  if (!batch) throw new Error('no batch');
  const verdicts = parsed.map((f, i) => ({ ...f, n: [...batch.key.keys()][i] ?? 0 }));
  const s = summarizeJudgement(batches, new Map([[batch.spotId, verdicts]]));
  const all = [s.detective, s.single];
  expect(all.reduce((n, a) => n + a.seenClaims.ok + a.seenClaims.absent, 0)).toBe(2);
  expect(all.reduce((n, a) => n + a.notSeenClaims.contradicted, 0)).toBe(1);
  expect(all.map((a) => a.seenClaimErrorRate).sort()).toEqual([0, 1]);
  // Rubric v2 would fail both findings: the first one on its wrong not_seen claim.
  expect(all.reduce((n, a) => n + a.v2Unsupported, 0)).toBe(2);
  expect(all.reduce((n, a) => n + a.unsupported, 0)).toBe(1);

  const sample = {
    id: 's1',
    countryNameRu: 'Тест',
    lat: 0,
    lng: 0,
    imagePaths: ['./a.jpg', './b.jpg', './c.jpg', './d.jpg'] as [string, string, string, string],
  };
  const v3 = buildJudgePrompt(sample, batch, 'v3');
  expect(v3).toContain('"not_seen" if it states that something is absent');
  expect(v3).toContain('a frame number above 4: that is not a visual claim');
  expect(buildJudgePrompt(sample, batch, 'v2')).not.toContain('not_seen');
});
