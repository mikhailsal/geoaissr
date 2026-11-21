import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agreementOf, loadEyesRun, loadFindingRun, poolFindings } from './judge-agree.ts';

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
