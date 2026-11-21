import { expect, test } from 'bun:test';
import { createToolAuditLogger } from './audit.ts';

// Value: protects=the eval audit counts bot_tool_call events and the rejected ones as corrections, and reports null when no call was seen; fails_when=other events are counted or null turns into zeros; why_new=audit.ts had no test; seam=none; no_claim=real runner log shape (hand-fed events).
test('tool audit counts only bot_tool_call events and treats ok:false as a correction', () => {
  const empty = createToolAuditLogger();
  empty.logger.log('harness_start', {});
  expect(empty.audit()).toBeNull();

  const { logger, audit } = createToolAuditLogger();
  logger.log('bot_tool_call', { ok: true });
  logger.log('bot_tool_call', { ok: false });
  logger.log('harness_start', { ok: false });
  expect(audit()).toEqual({ toolCalls: 2, corrections: 1 });
});
