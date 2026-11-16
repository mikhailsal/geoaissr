import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPricingService } from './pricing.ts';
import { createUsageParser } from './usage.ts';

// Found by /qa on 2026-11-16
// Report: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// Value: protects=AGY usage and estimated price from cache double counting; fails_when=reported totals are ignored or ambiguous usage is published; why_new=existing fixture covered only one cache interpretation; seam=none; no_claim=actual provider billing.
function parseAgy(usage: Record<string, number>) {
  const parser = createUsageParser('agy');
  const body = JSON.stringify({ status: 'SUCCESS', usage });
  parser.push(body.slice(0, 25));
  parser.push(body.slice(25));
  return parser.finish();
}

// The reported total identifies whether the cache reads are already included in input.
test('normalizes AGY cached input according to its reported total', () => {
  const expected = {
    inputTokens: 30662,
    outputTokens: 8,
    cachedInputTokens: 30214,
    totalTokens: 30670,
  };
  expect(
    parseAgy({
      input_tokens: 30662,
      output_tokens: 8,
      cache_read_tokens: 30214,
      total_tokens: 30670,
    }),
  ).toEqual(expected);
  expect(
    parseAgy({
      input_tokens: 448,
      output_tokens: 8,
      cache_read_tokens: 30214,
      total_tokens: 30670,
    }),
  ).toEqual(expected);
  expect(parseAgy({ input_tokens: 100, output_tokens: 5, total_tokens: 105 })).toEqual({
    inputTokens: 100,
    outputTokens: 5,
    cachedInputTokens: 0,
    totalTokens: 105,
  });
});

test('does not publish ambiguous or contradictory AGY usage', () => {
  expect(parseAgy({ input_tokens: 100, output_tokens: 5, cache_read_tokens: 20 })).toBeUndefined();
  expect(
    parseAgy({ input_tokens: 100, output_tokens: 5, cache_read_tokens: 20, total_tokens: 115 }),
  ).toBeUndefined();
  expect(
    parseAgy({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 20, total_tokens: 15 }),
  ).toBeUndefined();
  expect(parseAgy({ input_tokens: 100, output_tokens: 5 })).toEqual({
    inputTokens: 100,
    outputTokens: 5,
    cachedInputTokens: 0,
    totalTokens: 105,
  });
});

test('does not add duplicate AGY terminal objects', () => {
  const parser = createUsageParser('agy');
  const result = JSON.stringify({
    status: 'SUCCESS',
    usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
  });
  parser.push(`${result}\n${result}`);
  expect(parser.finish()).toBeUndefined();
});

test('prices AGY cache reads once when total includes them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agy-pricing-'));
  try {
    const service = createPricingService({
      dataDir: dir,
      now: () => 100,
      fetch: () =>
        Promise.resolve(
          Response.json({
            data: [
              {
                id: 'google/gemini-3.8-flash',
                pricing: { prompt: '0.01', completion: '0.1', input_cache_read: '0.001' },
              },
            ],
          }),
        ),
    });
    const usage = parseAgy({
      input_tokens: 100,
      output_tokens: 5,
      cache_read_tokens: 80,
      total_tokens: 105,
    });
    expect(usage).toBeDefined();
    if (!usage) throw new Error('Missing usage');
    expect((await service.estimateCost('gemini-3.8-flash-low', usage)).costUsd).toBeCloseTo(0.78);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
