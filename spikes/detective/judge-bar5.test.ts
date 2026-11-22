import { expect, test } from 'bun:test';
import { seenClaimBar, type SeenItem } from './judge-bar5.ts';
import type { JudgedClaim } from './judge-stats.ts';

function item(spot: string, group: SeenItem['group'], claims: JudgedClaim[]): SeenItem {
  return {
    id: `${spot}|${group}|e1|text#1`,
    group,
    finding: { n: 1, verdict: 'supported', rule_ok: null, claims },
  };
}

const ok: JudgedClaim = { text: 'a', kind: 'seen', mark: 'ok' };
const wrong: JudgedClaim = { text: 'b', kind: 'seen', mark: 'absent' };
const missed: JudgedClaim = { text: 'c', kind: 'not_seen', mark: 'contradicted' };
const unclear: JudgedClaim = { text: 'd', kind: 'seen', mark: 'unclear' };

test('bar 5 compares the error of seen claims and leaves not_seen and unclear ones out', () => {
  const run: SeenItem[] = [
    item('s1', 'detective', [ok, ok, ok, wrong, missed, unclear]),
    item('s2', 'detective', [ok, ok, ok, ok]),
    item('s1', 'single', [ok, ok, ok, ok, missed]),
    item('s2', 'single', [ok, ok, ok, ok]),
  ];
  const bar = seenClaimBar([run, run], { resamples: 200 });
  expect(bar?.spots).toBe(2);
  expect(bar?.detectiveSeenError).toBe(0.125);
  expect(bar?.singleSeenError).toBe(0);
  expect(bar?.detectiveMinusSingle).toBe(0.125);
  expect(bar?.barPassed).toBe(false);
  expect(bar?.ci?.low).toBeGreaterThanOrEqual(0);
  expect(bar?.ci?.high).toBeLessThanOrEqual(0.25);
  // The same seed gives the same interval.
  expect(seenClaimBar([run, run], { resamples: 200 })?.ci).toEqual(bar?.ci ?? null);
});

test('bar 5 passes within five points and is null without claim kinds', () => {
  const close: SeenItem[] = [
    item('s1', 'detective', [...Array<JudgedClaim>(24).fill(ok), wrong]),
    item('s1', 'single', Array<JudgedClaim>(25).fill(ok)),
  ];
  expect(seenClaimBar([close])?.detectiveMinusSingle).toBe(0.04);
  expect(seenClaimBar([close])?.barPassed).toBe(true);
  const v2: SeenItem[] = [item('s1', 'detective', [{ text: 'a', mark: 'ok' }])];
  expect(seenClaimBar([v2])).toBeNull();
});
