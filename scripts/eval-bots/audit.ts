import type { ServerLogger } from '../../server/log.ts';
import type { ToolAudit } from './records.ts';

/**
 * A logger that only counts the runner's `bot_tool_call` dispatch diagnostics.
 * `audit()` is null when no tool call was seen (for example fake bots), meaning "not observable".
 */
export function createToolAuditLogger(): { logger: ServerLogger; audit: () => ToolAudit | null } {
  let toolCalls = 0;
  let corrections = 0;
  const logger: ServerLogger = {
    log: (event, data) => {
      if (event !== 'bot_tool_call') return;
      toolCalls += 1;
      if (data.ok === false) corrections += 1;
    },
    writeCrash: () => '',
    pruneOld: () => 0,
    registerSecrets: () => undefined,
    redact: (text) => text,
    getLogsDir: () => '',
  };
  return { logger, audit: () => (toolCalls === 0 ? null : { toolCalls, corrections }) };
}
