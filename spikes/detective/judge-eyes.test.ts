import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { buildEyesJudgePrompt, summarizeEyesJudgement } from './judge-eyes.ts';
import { buildEyesBatches, eyesItems, renderEyesItem } from './judge-eyes-extract.ts';
import { SAMPLE } from './test-helpers.ts';

const ROUND = {
  spotId: 'spot-a',
  executionId: 'e1',
  infraError: null,
  asks: [
    {
      index: 1,
      items: [
        {
          kind: 'choice',
          question: 'Какие крыши?',
          options: ['черепица', 'плоские'],
          status: 'answered',
          value: '2',
        },
        {
          kind: 'choice',
          question: 'Столбы?',
          options: ['бетон', 'дерево'],
          status: 'answered',
          value: 'none_of_these',
        },
        { kind: 'text', question: 'все надписи', status: 'abstained', value: 'unreadable' },
        { kind: 'text', question: 'номер дома', status: 'timeout', value: null },
        { kind: 'feature', feature: 'script', status: 'answered', value: 'latin' },
      ],
    },
  ],
};

function withRounds<T>(rows: unknown[], fn: (file: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eyes-judge-'));
  try {
    const file = path.join(dir, 'rounds.jsonl');
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n'));
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the eyes judge reads answered and abstained choice and text items, not features or timeouts', () => {
  const items = withRounds([ROUND, { ...ROUND, executionId: 'bad', infraError: 'x' }], eyesItems);
  expect(items.map((i) => `${i.kind}:${i.value}`)).toEqual([
    'choice:2',
    'choice:none_of_these',
    'text:unreadable',
  ]);
  expect(renderEyesItem(items[0] ?? ({} as never))).toBe(
    '[choice] Question: «Какие крыши?». Options: 1) черепица; 2) плоские. Answer: 2) плоские',
  );
  expect(renderEyesItem(items[2] ?? ({} as never))).toContain('Answer: unreadable');
});

test('eyes verdicts are tallied by group and bar 3 counts options and none-of-these', () => {
  const items = withRounds([ROUND], eyesItems);
  const batches = buildEyesBatches(items, 1);
  const batch = batches[0];
  if (!batch) throw new Error('no batch');
  const paths: [string, string, string, string] = ['/f/a.jpg', '/f/b.jpg', '/f/c.jpg', '/f/d.jpg'];
  const prompt = buildEyesJudgePrompt({ ...SAMPLE, imagePaths: paths }, batch);
  expect(prompt).toContain('photo 1: /f/a.jpg');
  expect(prompt).not.toContain('e1');
  const verdicts = [...batch.key].map(([n, item]) => ({
    n,
    verdict: item.value === '2' ? ('correct' as const) : ('wrong' as const),
  }));
  const summary = summarizeEyesJudgement(batches, new Map([['spot-a', verdicts]]));
  expect(summary.choiceAnswered.correct).toBe(1);
  expect(summary.choiceAnswered.wrong).toBe(1);
  expect(summary.choiceAnswered.correctRate).toBe(0.5);
  expect(summary.choiceAnswered.barPassed).toBe(false);
  expect(summary.groups.textAbstained?.wrong).toBe(1);
});

const REPORT_ROUND = {
  spotId: 'spot-a',
  executionId: 'e2',
  infraError: null,
  reportRound: {
    report: {
      tSec: 21,
      lines: [
        { section: 'texts', text: '«LAWSON» — вывеска на здании', frame: 1 },
        { section: 'texts', text: 'надпись на табличке, не разобрать', frame: 2 },
        { section: 'road', text: 'серый асфальт без разметки', frame: 1 },
      ],
      maskedWords: [],
      unknownFrames: 0,
    },
  },
  asks: [
    {
      index: 1,
      items: [
        {
          kind: 'describe',
          question: 'номера машин',
          status: 'answered',
          value: 'жёлтые',
          confidence: 'unsure',
        },
        { kind: 'describe', question: 'люди', status: 'abstained', value: 'not_visible' },
        { kind: 'text', question: 'табличка', status: 'answered', value: 'ローソン' },
      ],
    },
  ],
};

test('spike 3: report lines and free descriptions are judged, and bars 3 and 4 are tallied', () => {
  const items = withRounds([REPORT_ROUND], eyesItems);
  expect(items.map((i) => `${i.kind}:${i.askIndex}`)).toEqual([
    'report:0',
    'report:0',
    'report:0',
    'describe:1',
    'describe:1',
    'text:1',
  ]);
  expect(renderEyesItem(items[0] ?? ({} as never))).toBe(
    '[scene note] «LAWSON» — вывеска на здании',
  );
  expect(renderEyesItem(items[3] ?? ({} as never))).toBe(
    '[description] Request: «номера машин». Answer: жёлтые',
  );
  expect(renderEyesItem(items[4] ?? ({} as never))).toContain('Answer: not visible');
  const batches = buildEyesBatches(items, 1);
  const batch = batches[0];
  if (!batch) throw new Error('no batch');
  const paths: [string, string, string, string] = ['/f/a.jpg', '/f/b.jpg', '/f/c.jpg', '/f/d.jpg'];
  const prompt = buildEyesJudgePrompt({ ...SAMPLE, imagePaths: paths }, batch);
  expect(prompt).toContain('[scene note] items');
  expect(prompt).toContain('[description] items');
  // Every item is judged correct except the copied text of the report.
  const verdicts = [...batch.key].map(([n, item]) => ({
    n,
    verdict: item.value.includes('LAWSON') ? ('wrong' as const) : ('correct' as const),
  }));
  const summary = summarizeEyesJudgement(batches, new Map([['spot-a', verdicts]]));
  expect(summary.groups.reportCopiedText?.wrong).toBe(1);
  expect(summary.groups.reportLine?.correct).toBe(2);
  expect(summary.statements.judged).toBe(5);
  expect(summary.statements.correctRate).toBe(0.8);
  expect(summary.statements.barPassed).toBe(true);
  expect(summary.copiedTexts.judged).toBe(2);
  expect(summary.copiedTexts.barPassed).toBe(false);
  expect(summary.groups.describeAbstained?.correct).toBe(1);
  expect(summary.answersByConfidence.unsure.judged).toBe(1);
  expect(summary.answersByConfidence.sure.judged).toBe(0);
});

test('the spike 2 prompt has no statement rules when a batch holds only choices and texts', () => {
  const batch = buildEyesBatches(withRounds([ROUND], eyesItems), 1)[0];
  if (!batch) throw new Error('no batch');
  const paths: [string, string, string, string] = ['/f/a.jpg', '/f/b.jpg', '/f/c.jpg', '/f/d.jpg'];
  expect(buildEyesJudgePrompt({ ...SAMPLE, imagePaths: paths }, batch)).not.toContain('scene note');
});
