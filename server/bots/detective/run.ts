import path from 'node:path';
import type { BotCostEstimate, BotTokenUsage } from '../../../shared/bot-results.ts';
import type { EffortLevel } from '../../../shared/bot-tools.ts';
import { DETECTIVE_ROLES, type DetectiveRole } from '../../../shared/detective-tools.ts';
import { eyesEffortOf, eyesModel, type RoleModel } from '../../../shared/play-style.ts';
import type { BotSlotConfig } from '../../../shared/storage-schemas.ts';
import type { ActiveBotHandle } from '../process.ts';
import type { RoundBotParams, RunnerCtx } from '../runner-types.ts';
import { sumUsage } from './procs.ts';
import type { DetectiveSession } from './session.ts';

/** One Detective bot in one round: what the launcher, the process monitor and the fake share. */
export interface DetectiveRun {
  ctx: RunnerCtx;
  params: RoundBotParams;
  handle: ActiveBotHandle;
  session: DetectiveSession;
  /** The eyes can drive along the road: movement is on and the slot has paid turns. */
  canMove: boolean;
  tokens: { brain: string; eyes: string };
  usage: { brain?: BotTokenUsage; eyes?: BotTokenUsage };
  /** Counts accounting reports, so a late price for an older sum is dropped. */
  usageSeq: number;
}

export function runIds(run: DetectiveRun): {
  matchId: string;
  gen: number;
  roundNumber: number;
  botId: string;
} {
  const { matchId, gen, roundNumber, slot } = run.params;
  return { matchId, gen, roundNumber, botId: slot.id };
}

/** Each role in its own directory: siblings, so a guard on one never covers the other. */
export function roleWorkDir(botWorkDir: string, role: DetectiveRole): string {
  return path.join(botWorkDir, role);
}

/** Where each role runs: the brain on the slot's harness and model, the eyes on theirs. */
export function roleModels(slot: BotSlotConfig): Record<DetectiveRole, RoleModel> {
  return { brain: { harness: slot.harness, model: slot.model }, eyes: eyesModel(slot) };
}

/** The brain thinks at the slot's effort, the eyes at their own (low unless the host set one). */
export function roleEffort(slot: BotSlotConfig, role: DetectiveRole): EffortLevel {
  return role === 'brain' ? slot.effort : eyesEffortOf(slot);
}

/**
 * The price of the tokens so far: each role at its own model. Unknown when a role's price is,
 * including a role that has reported no usage yet or had none to report: the price of one process
 * alone would read as the bot's whole price. The matched model ids are listed once each.
 */
export async function estimateRoles(
  run: { ctx: Pick<RunnerCtx, 'estimateCost'>; params: { slot: BotSlotConfig } },
  roleUsage: DetectiveRun['usage'],
): Promise<BotCostEstimate | null> {
  const { estimateCost } = run.ctx;
  if (!estimateCost) return null;
  const models = roleModels(run.params.slot);
  const parts = await Promise.all(
    DETECTIVE_ROLES.flatMap((role) => {
      const usage = roleUsage[role];
      return usage ? [estimateCost(models[role].model, usage)] : [];
    }),
  );
  const ids = [...new Set(parts.flatMap((p) => (p.matchedModelId ? [p.matchedModelId] : [])))];
  const costs = parts.flatMap((p) => (p.costUsd === null ? [] : [p.costUsd]));
  return {
    costUsd: costs.length === DETECTIVE_ROLES.length ? costs.reduce((a, c) => a + c, 0) : null,
    ...(ids.length > 0 ? { matchedModelId: ids.join(' + ') } : {}),
    ...(parts.some((p) => p.isApproximateMatch) ? { isApproximateMatch: true } : {}),
  };
}

/**
 * Reports the tokens of one finished process. The badge shows the sum of both processes, so every
 * report carries the running sum and replaces the previous one.
 */
export function reportRoleUsage(
  run: DetectiveRun,
  role: DetectiveRole,
  usage: BotTokenUsage | null,
): void {
  if (!usage) return;
  run.usage[role] = usage;
  run.usageSeq += 1;
  const seq = run.usageSeq;
  const roleUsage = { ...run.usage };
  const tokenUsage = sumUsage(Object.values(roleUsage));
  const models = roleModels(run.params.slot);
  const accounting = {
    tokenUsage,
    roleUsage,
    roleModels: { brain: models.brain.model, eyes: models.eyes.model },
  };
  const { ctx } = run;
  const ids = runIds(run);
  ctx.dispatch({ type: 'bot_accounting', ...ids, accounting: { ...accounting, costUsd: null } });
  void estimateRoles(run, roleUsage)
    .then((estimate) => {
      if (!estimate || seq !== run.usageSeq) return;
      ctx.dispatch({ type: 'bot_accounting', ...ids, accounting: { ...accounting, ...estimate } });
    })
    .catch(() => undefined);
}
