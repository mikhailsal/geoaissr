import { createHash } from 'node:crypto';
import { getHarnessAdapter } from '../../server/bots/adapters/index.ts';
import { buildBotRoundPrompt } from '../../server/bots/prompt.ts';
import { describePlayAreaRu } from '../../server/bots/runner-types.ts';
import { getBotToolDefinitions } from '../../shared/bot-tools.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';

export const EVAL_BOT_NAME = 'EvalBot';

export function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The system prompt the runner sends for an eval slot. It is built by the same function and with
 * the same inputs as `startBotExecution` (server/bots/runner-launch.ts), so it is what the bot sees.
 */
export function buildEvalPrompt(opts: {
  harness: HarnessId;
  moveLimit: number;
  budgetSec: number;
}): string {
  return buildBotRoundPrompt({
    botName: EVAL_BOT_NAME,
    regionLabelRu: describePlayAreaRu({ map: 'standard', region: 'world' }),
    moveEnabled: false,
    moveLimit: opts.moveLimit,
    budgetSec: opts.budgetSec,
    personalityPreset: 'neutral',
    personalityText: '',
    deliveryMode: getHarnessAdapter(opts.harness).deliveryMode,
  });
}

/** Tool list as sent to the bots (eval rounds run with move disabled). */
export function evalToolListJson(): string {
  return JSON.stringify(getBotToolDefinitions(false));
}

export function promptHash(opts: Parameters<typeof buildEvalPrompt>[0]): string {
  return shortHash(buildEvalPrompt(opts));
}

export function toolSchemaHash(): string {
  return shortHash(evalToolListJson());
}
