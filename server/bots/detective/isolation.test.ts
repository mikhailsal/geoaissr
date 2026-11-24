// Value: protects=a brain on agy whose file guard never wrote a record is flagged once, at its first call; fails_when=the check is skipped, repeats, fires for another harness, or an empty audit counts as proof; why_new=isolation.ts is new and untested; seam=none; no_claim=that the real agy hook writes the audit (fake audit files).
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../../shared/storage-schemas.ts';
import type { EngineEvent } from '../../engine/types.ts';
import { agyToolAuditPath } from '../adapters/agy.ts';
import { agyGuardRan, createIsolationCheck } from './isolation.ts';
import type { DetectiveRun } from './run.ts';

function slot(harness: 'claude' | 'agy'): BotSlotConfig {
  return {
    id: 's',
    name: 'n',
    color: 'p-4',
    harness,
    model: 'm',
    effort: 'low',
    moveLimit: 4,
    imageSize: 400,
    budgetSec: 120,
    playStyle: 'detective',
    personalityPreset: 'neutral',
    personalityText: '',
    difficultyPreset: 'amateur',
    enabled: true,
  };
}

function runOf(workDir: string, harness: 'claude' | 'agy', events: EngineEvent[]): DetectiveRun {
  const ctx = { fakeMode: false, dispatch: (e: EngineEvent) => events.push(e) };
  const params = { matchId: 'm1', gen: 1, roundNumber: 1, slot: slot(harness) };
  return { ctx, params, handle: { workDir } } as unknown as DetectiveRun;
}

function brainAudit(workDir: string, content: string | null): void {
  const file = agyToolAuditPath(path.join(workDir, 'brain'));
  mkdirSync(path.dirname(file), { recursive: true });
  if (content !== null) writeFileSync(file, content);
}

test('the isolation check flags a brain whose agy guard wrote nothing, once', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-isolation-'));
  try {
    const brain = path.join(dir, 'brain');
    expect(agyGuardRan(brain)).toBe(false);
    brainAudit(dir, '');
    expect(agyGuardRan(brain)).toBe(false);

    const events: EngineEvent[] = [];
    expect(createIsolationCheck(runOf(dir, 'claude', events))).toBeUndefined();
    const check = createIsolationCheck(runOf(dir, 'agy', events));
    check?.();
    check?.();
    expect(events.map((e) => e.type)).toEqual(['bot_isolation_unconfirmed']);

    brainAudit(dir, '{"tool":"geo"}\n');
    expect(agyGuardRan(brain)).toBe(true);
    const ok: EngineEvent[] = [];
    createIsolationCheck(runOf(dir, 'agy', ok))?.();
    expect(ok).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
