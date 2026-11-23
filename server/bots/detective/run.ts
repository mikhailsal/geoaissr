import type { BotTokenUsage } from '../../../shared/bot-results.ts';
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

/**
 * Reports the tokens of one finished process. The badge shows the sum of both processes, so every
 * report carries the running sum and replaces the previous one.
 */
export function reportRoleUsage(
  run: DetectiveRun,
  role: 'brain' | 'eyes',
  usage: BotTokenUsage | null,
): void {
  if (!usage) return;
  run.usage[role] = usage;
  run.usageSeq += 1;
  const seq = run.usageSeq;
  const roleUsage = { ...run.usage };
  const tokenUsage = sumUsage(Object.values(roleUsage));
  const { ctx } = run;
  const ids = runIds(run);
  ctx.dispatch({
    type: 'bot_accounting',
    ...ids,
    accounting: { tokenUsage, roleUsage, costUsd: null },
  });
  if (!ctx.estimateCost) return;
  void Promise.resolve()
    .then(() => ctx.estimateCost?.(run.params.slot.model, tokenUsage))
    .then((estimate) => {
      if (!estimate || seq !== run.usageSeq) return;
      ctx.dispatch({
        type: 'bot_accounting',
        ...ids,
        accounting: { tokenUsage, roleUsage, ...estimate },
      });
    })
    .catch(() => undefined);
}
