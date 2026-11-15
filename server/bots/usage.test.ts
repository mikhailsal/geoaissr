import { expect, test } from 'bun:test';
import { createUsageParser } from './usage.ts';

// Claude: https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance
test('normalizes Claude cache reads and writes as input', () => {
  const parser = createUsageParser('claude');
  parser.push(
    '{"type":"result","usage":{"input_tokens":120,"output_tokens":30,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}',
  );
  expect(parser.finish()).toEqual({
    inputTokens: 145,
    outputTokens: 30,
    cachedInputTokens: 20,
    totalTokens: 175,
  });
});
// Codex: https://github.com/openai/codex/issues/19022
test('parses split terminal turns while skipping oversized and intermediate events', () => {
  const parser = createUsageParser('codex');
  parser.push('x'.repeat(300000));
  parser.push('\n{"type":"thread.token_count","usage":{"input_tokens":999}}\n{"type":"turn.');
  parser.push(
    'completed","usage":{"input_tokens":140,"cached_input_tokens":40,"output_tokens":25}}\n',
  );
  parser.push('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}');
  expect(parser.finish()).toEqual({
    inputTokens: 150,
    outputTokens: 27,
    cachedInputTokens: 40,
    totalTokens: 177,
  });
});
// Value: protects=invalid terminal turns cannot publish partial or unsafe totals; fails_when=invalid turns or overflow are ignored; why_new=prior cases covered only isolated invalid counters; seam=none; no_claim=fixtures do not establish live provider format.
test('rejects missing, invalid, and truncated usage', () => {
  for (const [harness, body] of [
    ...[
      '{"type":"turn.completed","usage":',
      '{"type":"turn.completed","usage":oops}',
      '{"type":"turn.completed","padding":"' + 'x'.repeat(300000) + '"}',
    ].map(
      (tail) =>
        [
          'codex',
          '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n' + tail,
        ] as const,
    ),
    ['claude', '{"usage":{"input_tokens":1}}'],
    ['codex', '{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":1}}'],
    ['claude', 'x'.repeat(300000)],
    ['claude', '{"usage":{"input_tokens":1,"output_tokens":2}'],
    [
      'codex',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":2}}',
    ],
    [
      'codex',
      '{"type":"turn.completed","usage":{"input_tokens":3,"cached_input_tokens":4,"output_tokens":1}}',
    ],
    [
      'codex',
      '{"type":"turn.completed","usage":{"input_tokens":9007199254740990,"output_tokens":1}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":0}}',
    ],
  ] as const) {
    const parser = createUsageParser(harness);
    parser.push(body);
    expect(parser.finish()).toBeUndefined();
  }
});

// Consecutive result examples: https://antigravity.google/docs/cli/headless/#read-the-results
test('normalizes AGY terminal cache reads separately from raw input', () => {
  const parser = createUsageParser('agy');
  parser.push(
    '{"status":"SUCCESS","usage":{"input_tokens":30662,"output_tokens":8,"cache_read_tokens":30214,"total_tokens":30670}}',
  );
  expect(parser.finish()).toEqual({
    inputTokens: 60876,
    outputTokens: 8,
    cachedInputTokens: 30214,
    totalTokens: 60884,
  });
});
