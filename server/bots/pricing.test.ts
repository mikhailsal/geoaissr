import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPricingService } from './pricing.ts';
import { matchModel } from './model-matching.ts';

const usage = { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, totalTokens: 120 };
test('normalizes model names and restricts approximate matches to same provider and tier', () => {
  const ids: [string, string, string] = [
    'anthropic/claude-4.5-haiku',
    'anthropic/claude-4.6-sonnet',
    'anthropic/claude-4.6-haiku',
  ];
  expect(matchModel('claude-haiku-4-5-high', ids)).toEqual({ id: ids[0], approximate: false });
  expect(matchModel('claude-haiku-4-7', ids)).toEqual({ id: ids[2], approximate: true });
  const codexIds: [string, string] = ['openai/gpt-5.1-codex', 'openai/gpt-5.1-codex-max'];
  expect(matchModel('gpt-5.1-codex-max', codexIds)).toEqual({
    id: codexIds[1],
    approximate: false,
  });
  expect(matchModel('openai/gpt-5.1-codex-max', codexIds)).toEqual({
    id: codexIds[1],
    approximate: false,
  });
  expect(matchModel('claude-opus-4-5', ids)).toBeUndefined();
  expect(matchModel('claude-haiku-8-5', ids)).toBeUndefined();
});
test('coalesces fetches, prices cached input, and falls back to stale disk cache', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pricing-'));
  try {
    let calls = 0;
    const fakeFetch = () => {
      calls++;
      return Promise.resolve(
        Response.json({
          data: [
            {
              id: 'anthropic/claude-4.5-haiku',
              pricing: { prompt: '0.01', completion: '0.1', input_cache_read: '0.001' },
            },
          ],
        }),
      );
    };
    const service = createPricingService({ dataDir: dir, fetch: fakeFetch, now: () => 100 });
    const results = await Promise.all([
      service.estimateCost('claude-haiku-4-5', usage),
      service.estimateCost('claude-haiku-4-5', usage),
    ]);
    expect(calls).toBe(1);
    expect(results[0].costUsd).toBeCloseTo(2.64);
    const stale = createPricingService({
      dataDir: dir,
      fetch: () => Promise.reject(new Error('offline')),
      now: () => 100000000,
    });
    expect((await stale.estimateCost('claude-haiku-4-5', usage)).costUsd).toBeCloseTo(2.64);
    expect((await stale.estimateCost('claude-opus-4-5', usage)).costUsd).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('fails soft on invalid pricing and invalid usage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pricing-'));
  try {
    const service = createPricingService({
      dataDir: dir,
      fetch: () =>
        Promise.resolve(
          Response.json({ data: [{ id: 'x', pricing: { prompt: '-1', completion: '1' } }] }),
        ),
    });
    expect((await service.estimateCost('x', usage)).costUsd).toBeNull();
    expect(
      (await service.estimateCost('x', { ...usage, cachedInputTokens: 101 })).costUsd,
    ).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Value: protects=failed cache and pending network operations resolve without losing valid prices; fails_when=timeout, corruption, future cache, or write failure escapes; why_new=existing network failure rejects immediately and persistence succeeds; seam=none; no_claim=local fixtures do not establish OpenRouter availability.
test('timeouts and invalid or unwritable cache fail soft', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pricing-errors-'));
  const cacheFile = path.join(dir, 'openrouter-models-cache.json');
  const valid = {
    data: [{ id: 'anthropic/claude-4.5-haiku', pricing: { prompt: '0.01', completion: '0.1' } }],
  };
  try {
    await writeFile(cacheFile, '{broken');
    const pendingFetch = createPricingService({
      dataDir: dir,
      timeoutMs: 5,
      fetch: () => new Promise<Response>(() => {}),
    });
    expect((await pendingFetch.estimateCost('claude-haiku-4-5', usage)).costUsd).toBeNull();
    const pendingBody = createPricingService({
      dataDir: dir,
      timeoutMs: 5,
      fetch: () => Promise.resolve(new Response(new ReadableStream({ start() {} }))),
    });
    expect((await pendingBody.estimateCost('claude-haiku-4-5', usage)).costUsd).toBeNull();
    await writeFile(
      cacheFile,
      JSON.stringify({
        fetchedAt: 200,
        models: [{ id: 'anthropic/claude-4.5-haiku', prompt: 99, completion: 99 }],
      }),
    );
    let calls = 0;
    const future = createPricingService({
      dataDir: dir,
      now: () => 100,
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(valid));
      },
    });
    expect((await future.estimateCost('claude-haiku-4-5', usage)).costUsd).toBeCloseTo(3);
    expect(calls).toBe(1);
    const blocker = path.join(dir, 'not-a-directory');
    await writeFile(blocker, 'file');
    const unwritable = createPricingService({
      dataDir: blocker,
      fetch: () => Promise.resolve(Response.json(valid)),
    });
    expect((await unwritable.estimateCost('claude-haiku-4-5', usage)).costUsd).toBeCloseTo(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
