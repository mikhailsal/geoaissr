import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agreementByGroup,
  agreementOf,
  claimKind,
  loadEyesRun,
  loadFindingRun,
  poolFindings,
  splitClaimsByKeyword,
} from './judge-agree.ts';

function writeRun(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'judge-agree-'));
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(value));
  }
  return dir;
}

const KEY = [
  { spotId: 's1', n: 1, arm: 'detective', executionId: 'a' },
  { spotId: 's1', n: 2, arm: 'single', executionId: 'b' },
  { spotId: 's1', n: 3, arm: 'detective', executionId: 'a' },
];

function findingRun(order: number[], verdicts: string[]): string {
  // `order[i]` is the judge number given to key row i in this run's shuffle.
  const texts = ['пальмы', 'жёлтая линия', 'пальмы'];
  return writeRun({
    'blind-key.json': KEY.map((k, i) => ({ ...k, n: order[i] })),
    'blind-sheet.json': KEY.map((k, i) => ({ spotId: k.spotId, n: order[i], text: texts[i] })),
    'verdicts.json': {
      s1: { verdicts: order.map((n, i) => ({ n, verdict: verdicts[i], rule_ok: null })) },
    },
  });
}

test('finding runs are matched by content, whatever number the shuffle gave them', () => {
  const a = findingRun([1, 2, 3], ['supported', 'unsupported', 'unsupported']);
  const b = findingRun([3, 1, 2], ['supported', 'supported', 'unsupported']);
  try {
    const ra = loadFindingRun(a);
    const rb = loadFindingRun(b);
    expect(new Set(ra.map((i) => i.id)).size).toBe(3);
    const agree = agreementOf(ra, rb, 'unsupported');
    expect(agree.common).toBe(3);
    expect(agree.same).toBe(2);
    expect(agree.flagged).toEqual({ first: 2, second: 1, both: 1 });
    expect(agree.matrix['unsupported->supported']).toBe(1);
    // The same agreement inside each arm: the two runs differ on the single-agent finding only.
    const byArm = agreementByGroup(ra, rb, 'unsupported').byGroup;
    expect(byArm['detective']?.same).toBe(2);
    expect(byArm['single']?.flagged).toEqual({ first: 1, second: 0, both: 0 });
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('pooled shares sum the runs and the interval counts each finding once', () => {
  const a = findingRun([1, 2, 3], ['unsupported', 'supported', 'unsupported']);
  const b = findingRun([1, 2, 3], ['supported', 'supported', 'unsupported']);
  try {
    const pooled = poolFindings([loadFindingRun(a), loadFindingRun(b)]);
    expect(pooled.detective.unsupported).toBe(3);
    expect(pooled.detective.judged).toBe(4);
    expect(pooled.detective.unsupportedRate).toBe(0.75);
    expect(pooled.single.unsupportedRate).toBe(0);
    expect(pooled.detectiveMinusSingle?.diff).toBe(0.75);
    // These runs carry no claim marks (rubric v1), so there is nothing to split.
    expect(pooled.detective.claimsByKeywordHeuristic).toBeNull();
    const once = poolFindings([loadFindingRun(a)]);
    // Two runs of two findings must not look like four independent findings.
    expect(pooled.detectiveMinusSingle?.low).toBeLessThan(once.detectiveMinusSingle?.diff ?? 0);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('eyes runs are matched by round, ask and question; missing verdicts are skipped', () => {
  const key = [
    {
      n: 1,
      spotId: 's1',
      executionId: 'a',
      askIndex: 1,
      kind: 'choice',
      question: 'Сторона?',
      status: 'answered',
    },
    {
      n: 2,
      spotId: 's1',
      executionId: 'a',
      askIndex: 1,
      kind: 'text',
      question: 'вывеска',
      status: 'abstained',
    },
  ];
  const a = writeRun({
    'eyes-key.json': key,
    'eyes-verdicts.json': {
      s1: {
        verdicts: [
          { n: 1, verdict: 'wrong' },
          { n: 2, verdict: 'correct' },
        ],
      },
    },
  });
  const b = writeRun({
    'eyes-key.json': [
      { ...key[1], n: 1 },
      { ...key[0], n: 2 },
    ],
    'eyes-verdicts.json': { s1: { verdicts: [{ n: 2, verdict: 'wrong' }] } },
  });
  try {
    const agree = agreementOf(loadEyesRun(a), loadEyesRun(b), 'wrong');
    expect(agree.common).toBe(1);
    expect(agree.agreement).toBe(1);
    expect(agree.flagged.both).toBe(1);
    expect(loadEyesRun(a).map((i) => i.group)).toEqual(['choice:answered', 'text:abstained']);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('the keyword split tells claims of absence and claims that name a frame from the rest', () => {
  for (const text of [
    'No inscriptions or signs visible',
    "The car's plate can't be read",
    'Надписей и табличек не видно',
    'Кириллицы на кадрах нет',
    'unclear lettering on the shop sign',
  ]) {
    expect(claimKind(text)).toBe('not_seen');
  }
  for (const text of ['Look 70°E: same architecture', 'жёлтый знак на втором кадре']) {
    expect(claimKind(text)).toBe('frame');
  }
  // A word that only contains «нет», "not" or "look" is an ordinary claim.
  for (const text of ['нетронутый лес', 'a knot of wires on the pole', 'outlook tower', 'NEPALO']) {
    expect(claimKind(text)).toBe('seen');
  }
});

test('pooled shares carry the keyword split of each arm', () => {
  const claims = [
    [{ text: 'пальмы', mark: 'absent' }],
    [{ text: 'номер не читается', mark: 'contradicted' }],
    [{ text: 'пальмы', mark: 'ok' }],
  ];
  const run = (): string =>
    writeRun({
      'blind-key.json': KEY,
      'blind-sheet.json': KEY.map((k) => ({ spotId: k.spotId, n: k.n, text: `вывод ${k.n}` })),
      'verdicts.json': {
        s1: {
          verdicts: KEY.map((k, i) => ({
            n: k.n,
            verdict: i === 2 ? 'supported' : 'unsupported',
            rule_ok: null,
            claims: claims[i],
          })),
        },
      },
    });
  const a = run();
  const b = run();
  try {
    const pooled = poolFindings([loadFindingRun(a), loadFindingRun(b)]);
    const detective = pooled.detective.claimsByKeywordHeuristic;
    expect(detective?.seen).toEqual({ ok: 2, wrong: 2, unclear: 0, errorRate: 0.5 });
    expect(detective?.findingsWithWrongSeenClaim).toBe(2);
    const single = pooled.single.claimsByKeywordHeuristic;
    expect(single?.not_seen).toEqual({ ok: 0, wrong: 2, unclear: 0, errorRate: 1 });
    expect(single?.seen.errorRate).toBeNull();
    expect(single?.findingsWithWrongSeenClaim).toBe(0);
    expect(single?.findingsWrongOnlyByNotSeenOrFrame).toBe(2);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('the split counts marks per kind and what an unsupported finding rests on', () => {
  const finding = (claims: Array<[string, 'ok' | 'contradicted' | 'absent' | 'unclear']>) => ({
    n: 1,
    verdict: 'supported' as const,
    rule_ok: null,
    claims: claims.map(([text, mark]) => ({ text, mark })),
  });
  const split = splitClaimsByKeyword([
    finding([
      ['жёлтая осевая', 'ok'],
      ['пальмы', 'absent'],
      ['номер не читается', 'contradicted'],
    ]),
    finding([
      ['номер не читается', 'contradicted'],
      ['кадр 5 показал то же', 'absent'],
      ['черепица', 'unclear'],
    ]),
    finding([['вывески нет', 'ok']]),
    undefined,
  ]);
  expect(split?.seen).toEqual({ ok: 1, wrong: 1, unclear: 1, errorRate: 0.5 });
  expect(split?.not_seen).toEqual({ ok: 1, wrong: 2, unclear: 0, errorRate: 0.667 });
  expect(split?.frame).toEqual({ ok: 0, wrong: 1, unclear: 0, errorRate: 1 });
  expect(split?.findingsWithWrongSeenClaim).toBe(1);
  expect(split?.findingsWrongOnlyByNotSeenOrFrame).toBe(1);
  // Runs without claim marks (rubric v1) have no split.
  expect(splitClaimsByKeyword([{ n: 1, verdict: 'unsupported', rule_ok: null }])).toBeNull();
});
