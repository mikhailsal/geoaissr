import { expect, test } from 'bun:test';
import { EVAL_BOT_NAME, buildEvalPrompt, evalToolListJson } from './fingerprint.ts';
import { executionPaths, makeExecutionId } from './exec-id.ts';

test('execution ids are 10 hex chars, deterministic for fixed inputs and random otherwise', () => {
  const a = makeExecutionId('run', 'spot-1', 1, 'r');
  expect(a).toMatch(/^[0-9a-f]{10}$/);
  expect(makeExecutionId('run', 'spot-1', 1, 'r')).toBe(a);
  expect(makeExecutionId('run', 'spot-1', 2, 'r')).not.toBe(a);
  expect(makeExecutionId('run', 'spot-1', 1)).not.toBe(makeExecutionId('run', 'spot-1', 1));
});

test('nothing a bot can see (prompt, tools, paths, match id) names the spot or its country', () => {
  const spot = { id: 'poland-warsaw-01', country: 'Польша', label: 'Warsaw' };
  const id = makeExecutionId('baseline-v0.3.0', spot.id, 1);
  const paths = executionPaths('/tmp/geo-eval-1', id);
  const visible = [
    buildEvalPrompt({ harness: 'claude', moveLimit: 4, budgetSec: 60 }),
    buildEvalPrompt({ harness: 'codex', moveLimit: 4, budgetSec: 60 }),
    evalToolListJson(),
    paths.dir,
    paths.runDir,
    paths.childrenFile,
    paths.matchId,
  ].join('\n');
  for (const secret of [spot.id, 'poland', 'warsaw', spot.country, spot.label]) {
    expect(visible.toLowerCase()).not.toContain(secret.toLowerCase());
  }
  expect(paths.matchId).toContain(id);
  expect(paths.dir).toContain(id);
  expect(visible).toContain(EVAL_BOT_NAME);
});
