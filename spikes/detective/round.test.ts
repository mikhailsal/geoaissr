import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import { loadDataset } from '../../scripts/eval-bots/manifest.ts';
import { loadCatalog } from './catalog.ts';
import { summarizeDetective, type DetectiveRunConfig } from './metrics.ts';
import { runDetectiveRound, type DetectiveSettings } from './round.ts';

const root = mkdtempSync(path.join(tmpdir(), 'geo-detective-test-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const SETTINGS: DetectiveSettings = {
  arm: 'detective',
  budgetSec: 90,
  moveLimit: 4,
  imageSize: 640,
  brainModel: 'claude-haiku-5-5',
  eyesModel: 'claude-haiku-5-5',
  effort: 'low',
  brainEffort: 'low',
  protocol: 'catalog',
  requireZoom: false,
  dry: true,
};

function config(planned: number): DetectiveRunConfig {
  return {
    label: null,
    arm: 'detective',
    model: 'claude-haiku-5-5',
    eyesModel: 'claude-haiku-5-5',
    protocol: 'catalog',
    requireZoom: false,
    effort: 'low',
    brainEffort: 'low',
    budgetSec: 90,
    moveLimit: 4,
    imageSize: 640,
    concurrency: 1,
    repeats: 1,
    spots: planned,
    spotIds: [],
    plannedRounds: planned,
    dry: true,
    gitCommit: 'test',
    date: '2026-11-21',
    promptHash: 'p',
    toolSchemaHash: 't',
    datasetHash: null,
    interrupted: false,
  };
}

test('a dry round runs both fake roles end to end through the session', async () => {
  const sample = loadDataset(null)[0];
  if (!sample) throw new Error('no built-in sample');
  const record = await runDetectiveRound({
    root,
    runName: 'test',
    settings: SETTINGS,
    sample,
    repeat: 1,
    catalog: loadCatalog(),
    signal: new AbortController().signal,
  });
  expect(record?.hasFinalGuess).toBe(true);
  expect(record?.exchanges).toBe(2);
  expect(record?.asks[1]?.findingState).toBe('recorded');
  expect(record?.eyesLooks).toBe(1);
  expect(record?.pinSource).toBe('final');
  const summary = summarizeDetective(config(1), record ? [record] : []);
  expect(summary.complete).toBe(true);
  expect(summary.finishRate.rate).toBe(1);
  expect(summary.exchangesMedian).toBe(2);
});

test('a dry labels-arm round needs no eyes', async () => {
  const sample = loadDataset(null)[0];
  if (!sample) throw new Error('no built-in sample');
  const record = await runDetectiveRound({
    root,
    runName: 'test',
    settings: { ...SETTINGS, arm: 'labels' },
    sample,
    repeat: 2,
    catalog: loadCatalog(),
    signal: new AbortController().signal,
  });
  expect(record?.hasFinalGuess).toBe(true);
  expect(record?.toolCalls.eyes).toBe(0);
});

test('a dry choice round with the zoom rule runs end to end and reports accuracy bands', async () => {
  const sample = loadDataset(null)[0];
  if (!sample) throw new Error('no built-in sample');
  const record = await runDetectiveRound({
    root,
    runName: 'test',
    settings: { ...SETTINGS, protocol: 'choice', requireZoom: true },
    sample,
    repeat: 3,
    catalog: loadCatalog(),
    signal: new AbortController().signal,
  });
  expect(record?.hasFinalGuess).toBe(true);
  expect(record?.protocol).toBe('choice');
  expect(record?.exchanges).toBe(2);
  expect(record?.zoomRefusals).toBe(0);
  const summary = summarizeDetective(
    { ...config(1), protocol: 'choice', requireZoom: true },
    record ? [record] : [],
  );
  expect(summary.questionMix.choice).toBe(2);
  expect(summary.choices.answered).toBe(2);
  expect(summary.accuracy.within750Km.hits).toBe(1);
  expect(summary.accuracy.scoreMedian).toBeGreaterThan(4500);
});

test('a dry report round files the scene report, briefs the brain and keeps the confidence', async () => {
  const sample = loadDataset(null)[0];
  if (!sample) throw new Error('no built-in sample');
  const record = await runDetectiveRound({
    root,
    runName: 'test',
    settings: { ...SETTINGS, protocol: 'report', requireZoom: true, moveLimit: 8 },
    sample,
    repeat: 4,
    catalog: loadCatalog(),
    signal: new AbortController().signal,
  });
  expect(record?.hasFinalGuess).toBe(true);
  expect(record?.protocol).toBe('report');
  expect(record?.exchanges).toBe(2);
  expect(record?.reportRound?.report?.lines.length).toBeGreaterThanOrEqual(2);
  expect(record?.reportRound?.briefingAtSec).not.toBeNull();
  // The fake eyes zoom once before the report; later zooms are not counted here.
  expect(record?.reportRound?.looksBeforeReport).toBe(1);
  expect(record?.asks.map((a) => a.findingState)).toEqual(['recorded', 'recorded']);
  expect(record?.asks[1]?.control).toBe(true);
  expect(record?.final?.confidence).toBe('country');
  expect(record?.final?.clue).toContain('Вывеска');
  const summary = summarizeDetective(
    { ...config(1), protocol: 'report', requireZoom: true, moveLimit: 8 },
    record ? [record] : [],
  );
  expect(summary.questionMix.describe).toBe(2);
  expect(summary.accuracy.beyond2000Km.hits).toBe(0);
  const stats = summary.reportProtocol;
  expect(stats?.report.filed.rate).toBe(1);
  expect(stats?.control.asked.hits).toBe(1);
  expect(stats?.byConfidence.country?.rounds).toBe(1);
  expect(stats?.bars.bar1Finish.passed).toBe(true);
  expect(stats?.bars.bar2Dialogue.passed).toBe(true);
  expect(stats?.bars.bar6Accuracy.passed).toBe(true);
});
