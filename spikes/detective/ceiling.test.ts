import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ceilingReport, runDescribe, runGuess, type ReportRow } from './ceiling.ts';
import {
  buildCeilingBrainPrompt,
  buildDescriberPrompt,
  parseDescriberReply,
  parseGuessReply,
} from './ceiling-prompts.ts';
import { ceilingDecision, summarizeCeiling, type CeilingRow } from './ceiling-summary.ts';
import { REPORT_SECTIONS } from './report.ts';
import { SAMPLE } from './test-helpers.ts';

function row(spotId: string, repeat: number, errorKm: number, over: Partial<CeilingRow> = {}) {
  const base: CeilingRow = {
    spotId,
    repeat,
    describer: 'claude-haiku-5-5',
    brainModel: 'claude-sonnet-5-5',
    effort: 'medium',
    pin: { lat: 0, lng: 0 },
    confidence: 'country',
    clue: 'вывеска',
    errorKm,
    infraError: null,
    maskedWords: [],
    usage: null,
  };
  return { ...base, ...over };
}

test('the describer prompt names the frames, the rules and every section', () => {
  const sample = {
    ...SAMPLE,
    imagePaths: ['/d/a.jpg', '/d/b.jpg', '/d/c.jpg', '/d/d.jpg'] as [
      string,
      string,
      string,
      string,
    ],
  };
  const prompt = buildDescriberPrompt(sample);
  expect(prompt).toContain('- кадр 4: /d/d.jpg');
  expect(prompt).toContain('Не называй и не угадывай место');
  expect(prompt).toContain('объект с полями text и frame');
  for (const section of REPORT_SECTIONS) expect(prompt).toContain(`- ${section.id} — `);
  expect(prompt).not.toContain(SAMPLE.countryNameRu);
  const reply = 'Вот: {"sections":{"road":[{"text":"жёлтая осевая","frame":1}]}}';
  expect(parseDescriberReply(reply).sections.road).toEqual([{ text: 'жёлтая осевая', frame: 1 }]);
});

test('the brain prompt holds the report and no picture; its reply is checked', () => {
  const prompt = buildCeilingBrainPrompt({
    regionLabelRu: 'весь мир',
    regionDiagonalKm: 20015.4,
    reportText: 'Дорога:\n- жёлтая осевая (кадр 1)',
  });
  expect(prompt).toContain('диагональ региона около 20015 км');
  expect(prompt).toContain('Дорога:\n- жёлтая осевая (кадр 1)');
  expect(prompt).not.toContain('.jpg');
  expect(
    parseGuessReply('{"lat": 35.1, "lng": 139.2, "confidence": "region", "clue": "иероглифы"}'),
  ).toEqual({ lat: 35.1, lng: 139.2, confidence: 'region', clue: 'иероглифы' });
  expect(() =>
    parseGuessReply('{"lat": 135, "lng": 0, "confidence": "country", "clue": "x"}'),
  ).toThrow();
  expect(() =>
    parseGuessReply('{"lat": 1, "lng": 0, "confidence": "sure", "clue": "x"}'),
  ).toThrow();
});

test('the summary counts rounds by distance and by confidence', () => {
  const rows = [
    row('s1', 1, 10),
    row('s1', 2, 700),
    row('s2', 1, 751, { confidence: 'guess' }),
    row('s2', 2, 9000, { confidence: 'guess' }),
  ];
  const s = summarizeCeiling(rows);
  expect(s.rounds).toBe(4);
  expect(s.spots).toBe(2);
  expect(s.medianErrorKm).toBe(725.5);
  expect(s.within25.hits).toBe(1);
  expect(s.within750.hits).toBe(2);
  expect(s.beyond2000.hits).toBe(1);
  expect(s.byConfidence['guess']?.rounds).toBe(2);
  expect(s.byConfidence['guess']?.within750.hits).toBe(0);
  expect(s.byConfidence['region']?.rounds).toBe(0);
});

test('the Part B rules: better describer, stop, eyes model and brain effort', () => {
  const of84 = (hits: number) => ({ hits, total: 84 });
  // A tie goes to haiku; 50 of 84 is 59.5%, under the 60% stop rule.
  expect(ceilingDecision({ haiku: of84(50), sonnet: of84(50) }, null)).toMatchObject({
    betterDescriber: 'claude-haiku-5-5',
    stop: true,
    eyesModel: 'claude-haiku-5-5',
    brainEffort: null,
  });
  // 51 of 84 is 60.7%: no stop. Sonnet is better, but by less than 10 points: eyes stay haiku.
  expect(ceilingDecision({ haiku: of84(51), sonnet: of84(59) }, of84(55))).toMatchObject({
    betterDescriber: 'claude-sonnet-5-5',
    stop: false,
    eyesModel: 'claude-haiku-5-5',
    brainEffort: 'low',
  });
  // 9 rounds of 84 are 10.7 points: sonnet eyes; the low-effort brain is 10 points worse.
  expect(ceilingDecision({ haiku: of84(51), sonnet: of84(60) }, of84(51))).toMatchObject({
    eyesModel: 'claude-sonnet-5-5',
    brainEffort: 'medium',
  });
  expect(
    ceilingDecision({ haiku: { hits: 6, total: 10 }, sonnet: { hits: 7, total: 10 } }, null),
  ).toMatchObject({
    stop: false,
    eyesModel: 'claude-sonnet-5-5',
  });
});

test('a dry run goes from reports to rounds to the report, and resumes without repeats', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ceiling-'));
  const common = {
    datasetDir: 'docs/evals/dataset',
    effort: 'medium' as const,
    dry: true,
    concurrency: 2,
  };
  try {
    const describe = {
      ...common,
      model: 'claude-haiku-5-5',
      outDir: path.join(dir, 'h'),
      limit: 2,
    };
    expect(await runDescribe({ ...describe, resume: false })).toBe(0);
    expect(runDescribe({ ...describe, resume: false })).rejects.toThrow('pass --resume');
    expect(await runDescribe({ ...describe, resume: true })).toBe(0);
    const reportsFile = path.join(dir, 'h', 'reports.jsonl');
    const reports = readFileSync(reportsFile, 'utf8').trim().split('\n');
    expect(reports.length).toBe(2);
    const first = JSON.parse(reports[0] ?? '') as ReportRow;
    first.report.sections.unusual.push({ text: 'флаг Японии', frame: 1 });
    writeFileSync(reportsFile, `${JSON.stringify(first)}\n${reports[1] ?? ''}\n`);
    const guess = {
      ...common,
      reportsDir: path.join(dir, 'h'),
      outDir: path.join(dir, 'hm'),
      brainModel: 'claude-sonnet-5-5',
      passes: 3,
    };
    expect(await runGuess({ ...guess, resume: false })).toBe(0);
    expect(await runGuess({ ...guess, resume: true })).toBe(0);
    const rounds = readFileSync(path.join(dir, 'hm', 'rounds.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(rounds.length).toBe(6);
    writeFileSync(
      path.join(dir, 'base.jsonl'),
      `${JSON.stringify({ spotId: first.spotId, errorKm: 500, infraError: null })}\n`,
    );
    const report = ceilingReport({
      haikuDir: path.join(dir, 'hm'),
      sonnetDir: path.join(dir, 'hm'),
      lowDir: null,
      detectiveRounds: path.join(dir, 'base.jsonl'),
      singleRounds: path.join(dir, 'base.jsonl'),
    });
    expect(report.arms.haikuMedium.rounds).toBe(6);
    expect(report.arms.haikuMedium.within750.hits).toBe(6);
    expect(report.arms.haikuMedium.maskedWords).toEqual({ японии: 1 });
    expect(report.arms.haikuMedium.againstDetective2.aCloser).toBe(1);
    expect(report.decision).toMatchObject({ betterDescriber: 'claude-haiku-5-5', stop: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
