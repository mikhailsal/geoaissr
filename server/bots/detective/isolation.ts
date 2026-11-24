import { existsSync, statSync } from 'node:fs';
import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { agyToolAuditPath } from '../adapters/agy.ts';
import { logAgyToolAttempts, logBotDiagnostic } from '../diagnostics.ts';
import { roleModels, roleWorkDir, runIds, type DetectiveRun } from './run.ts';

/**
 * The file guard of an agy process. agy may read files across the owner's home, so the game hands
 * it a PreToolUse hook that lets through only the game's tools and, for the eyes, files in their
 * own work directory (`server/bots/adapters/agy.ts`). The hook writes one audit line per attempt.
 * A brain whose calls reach the server while its audit stays empty ran without the hook: nothing
 * then proves it could not open the eyes' frames, and the round says so.
 */

/** The hook of the agy process in `workDir` has written at least one record. */
export function agyGuardRan(workDir: string): boolean {
  const audit = agyToolAuditPath(workDir);
  if (existsSync(`${audit}.truncated`)) return true;
  try {
    return statSync(audit).size > 0;
  } catch {
    return false;
  }
}

/**
 * Checks once, at the brain's first call, that its guard ran. The hook runs before agy executes
 * a tool, so the record of this very call is on disk by the time the call reaches the server.
 */
export function createIsolationCheck(run: DetectiveRun): (() => void) | undefined {
  const { ctx, params, handle } = run;
  if (params.slot.harness !== 'agy' || ctx.fakeMode) return undefined;
  let checked = false;
  return () => {
    if (checked) return;
    checked = true;
    if (agyGuardRan(roleWorkDir(handle.workDir, 'brain'))) return;
    logBotDiagnostic(ctx.logger, 'harness_monitor_error', {
      matchId: params.matchId,
      gen: params.gen,
      roundNumber: params.roundNumber,
      slotId: params.slot.id,
      harness: 'agy',
      role: 'brain',
      phase: 'tool-audit',
      isolationUnconfirmed: true,
    });
    ctx.dispatch({ type: 'bot_isolation_unconfirmed', ...runIds(run) });
  };
}

/** Copies the audit of each agy role into the log before the work directory is removed. */
export function attachAgyAudits(run: DetectiveRun): void {
  const { params, handle } = run;
  const models = roleModels(params.slot);
  const agyRoles = (['brain', 'eyes'] as const).filter((role) => models[role].harness === 'agy');
  if (agyRoles.length === 0) return;
  handle.flushDiagnostics = () => {
    for (const role of agyRoles) flushRoleAudit(run, role);
  };
}

function flushRoleAudit(run: DetectiveRun, role: DetectiveRole): void {
  const { params, handle } = run;
  logAgyToolAttempts(run.ctx.logger, roleWorkDir(handle.workDir, role), {
    matchId: params.matchId,
    gen: params.gen,
    roundNumber: params.roundNumber,
    slotId: params.slot.id,
    harness: 'agy',
    model: roleModels(params.slot)[role].model,
    role,
  });
}
