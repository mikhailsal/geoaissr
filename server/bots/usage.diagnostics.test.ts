import { expect, test } from 'bun:test';
import { createUsageParser } from './usage.ts';

test('captures AGY metadata and raw counters even when normalization is ambiguous', () => {
  const parser = createUsageParser('agy');
  const body = JSON.stringify({
    conversation_id: 'conversation-42',
    status: 'SUCCESS',
    num_turns: 4,
    duration_seconds: 2.5,
    response: 'private response',
    usage: {
      input_tokens: 100,
      output_tokens: 5,
      cache_read_tokens: 20,
      total_tokens: 115,
      thinking_tokens: 0,
      secret: 99,
    },
  });
  parser.push(body.slice(0, 31));
  parser.push(body.slice(31));
  expect(parser.finish()).toBeUndefined();
  expect(parser.getDiagnostics()).toEqual({
    status: 'invalid',
    terminalRecordCount: 1,
    rawCounters: {
      input_tokens: 100,
      output_tokens: 5,
      cache_read_tokens: 20,
      total_tokens: 115,
      thinking_tokens: 0,
    },
    metadata: {
      conversation_id: 'conversation-42',
      status: 'SUCCESS',
      num_turns: 4,
      duration_seconds: 2.5,
    },
  });
});

test('records last Codex terminal counters separately from aggregate usage', () => {
  const parser = createUsageParser('codex');
  parser.push(
    '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":1}}\n{"type":"turn.',
  );
  parser.push(
    'completed","usage":{"input_tokens":4,"output_tokens":2,"cached_input_tokens":-1}}\n',
  );
  expect(parser.finish()).toBeUndefined();
  expect(parser.getDiagnostics()).toEqual({
    status: 'invalid',
    terminalRecordCount: 2,
    rawCounters: { input_tokens: 4, output_tokens: 2, cached_input_tokens: -1 },
    metadata: {},
  });
});

test('classifies missing, malformed, truncated and oversized input', () => {
  for (const [harness, body, status] of [
    ['claude', '', 'missing'],
    ['claude', '{"result":"ok"}', 'missing'],
    ['claude', '{"usage":oops}', 'invalid'],
    ['claude', '{"usage":', 'truncated'],
    ['claude', 'x'.repeat(300000), 'truncated'],
    ['codex', '{"type":"turn.completed","usage":oops}', 'invalid'],
    ['codex', '{"type":"turn.completed","usage":', 'truncated'],
    ['codex', '{"type":"turn.completed","padding":"' + 'x'.repeat(300000), 'truncated'],
  ] as const) {
    const parser = createUsageParser(harness);
    parser.push(body);
    expect(parser.finish()).toBeUndefined();
    expect(parser.getDiagnostics().status).toBe(status);
  }
});

test('reports Claude usage and excludes free text and nonnumeric counters', () => {
  const parser = createUsageParser('claude');
  parser.push(
    JSON.stringify({
      conversation_id: 'private response with spaces',
      status: 'SUCCESS',
      num_turns: 8,
      duration_seconds: 1.2,
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 'secret' },
      response: 'secret',
    }),
  );
  expect(parser.finish()).toBeUndefined();
  expect(parser.getDiagnostics()).toEqual({
    status: 'invalid',
    terminalRecordCount: 1,
    rawCounters: { input_tokens: 1, output_tokens: 2 },
    metadata: { status: 'SUCCESS', num_turns: 8, duration_seconds: 1.2 },
  });
});

test('reports aggregate Codex usage while retaining only the last raw terminal counters', () => {
  const parser = createUsageParser('codex');
  parser.push('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}\n');
  parser.push('{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}');
  expect(parser.finish()).toEqual({
    inputTokens: 15,
    outputTokens: 3,
    cachedInputTokens: 0,
    totalTokens: 18,
  });
  expect(parser.finish()?.totalTokens).toBe(18);
  expect(parser.getDiagnostics()).toEqual({
    status: 'reported',
    terminalRecordCount: 2,
    rawCounters: { input_tokens: 5, output_tokens: 1 },
    metadata: {},
  });
});
