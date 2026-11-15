import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BotCostEstimate, BotTokenUsage } from '../../shared/bot-results.ts';
import { matchModel } from './model-matching.ts';

const DEFAULT_TTL = 24 * 60 * 60 * 1000;
const ENDPOINT = 'https://openrouter.ai/api/v1/models';
type Price = { id: string; prompt: number; completion: number; cache?: number };
type Cache = { fetchedAt: number; models: Price[] };
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function price(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
    return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function parseModels(data: unknown): Price[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value: unknown) => {
    const item = record(value);
    const pricing = record(item?.pricing);
    const prompt = price(pricing?.prompt);
    const completion = price(pricing?.completion);
    const cache =
      pricing?.input_cache_read === undefined || pricing.input_cache_read === null
        ? undefined
        : price(pricing.input_cache_read);
    if (
      typeof item?.id !== 'string' ||
      prompt === undefined ||
      completion === undefined ||
      (pricing?.input_cache_read != null && cache === undefined)
    )
      return [];
    return [{ id: item.id, prompt, completion, cache }];
  });
}
function parseCache(value: unknown): Cache | undefined {
  const obj = record(value);
  if (
    typeof obj?.fetchedAt !== 'number' ||
    !Number.isFinite(obj.fetchedAt) ||
    !Array.isArray(obj.models)
  )
    return undefined;
  const models = obj.models.flatMap((v: unknown) => {
    const p = record(v);
    if (
      typeof p?.id !== 'string' ||
      typeof p.prompt !== 'number' ||
      typeof p.completion !== 'number' ||
      !Number.isFinite(p.prompt) ||
      !Number.isFinite(p.completion) ||
      p.prompt < 0 ||
      p.completion < 0 ||
      (p.cache !== undefined &&
        (typeof p.cache !== 'number' || !Number.isFinite(p.cache) || p.cache < 0))
    )
      return [];
    return [
      {
        id: p.id,
        prompt: p.prompt,
        completion: p.completion,
        cache: p.cache,
      },
    ];
  });
  return models.length ? { fetchedAt: obj.fetchedAt, models } : undefined;
}
function validUsage(u: BotTokenUsage): boolean {
  return (
    [u.inputTokens, u.outputTokens, u.cachedInputTokens, u.totalTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    u.cachedInputTokens <= u.inputTokens &&
    u.totalTokens === u.inputTokens + u.outputTokens
  );
}
function makeEstimate(
  p: Price,
  match: { id: string; approximate: boolean },
  usage: BotTokenUsage,
): BotCostEstimate {
  const cost =
    (usage.inputTokens - usage.cachedInputTokens) * p.prompt +
    usage.cachedInputTokens * (p.cache ?? p.prompt) +
    usage.outputTokens * p.completion;
  return {
    costUsd: Number.isFinite(cost) ? cost : null,
    matchedModelId: match.id,
    isApproximateMatch: match.approximate,
  };
}
export function createPricingService(opts: {
  dataDir: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}): { estimateCost: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate> } {
  const file = path.join(opts.dataDir, 'openrouter-models-cache.json');
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  let current: Cache | undefined;
  let pending: Promise<Cache | undefined> | undefined;

  const load = async (): Promise<Cache | undefined> => {
    if (!current) {
      try {
        current = parseCache(JSON.parse(await readFile(file, 'utf8')) as unknown);
      } catch {
        /* Missing or corrupt cache. */
      }
    }
    if (current && now() - current.fetchedAt >= 0 && now() - current.fetchedAt < ttl)
      return current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, opts.timeoutMs ?? 5000);
      });
      const response = await Promise.race([
        (opts.fetch ?? fetch)(ENDPOINT, { signal: controller.signal }),
        timeout,
      ]);
      if (!response.ok) throw new Error('pricing unavailable');
      const body: unknown = await Promise.race([response.json(), timeout]);
      const models = parseModels(record(body)?.data);
      if (!models.length) throw new Error('invalid pricing');
      current = { fetchedAt: now(), models };
      try {
        await mkdir(opts.dataDir, { recursive: true });
        await writeFile(file, JSON.stringify(current));
      } catch {
        /* In-memory cache remains useful. */
      }
    } catch {
      /* Use stale cache when available. */
    } finally {
      if (timer) clearTimeout(timer);
    }
    return current;
  };
  const get = async (): Promise<Cache | undefined> => {
    pending ??= load().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const estimateCost = async (model: string, usage: BotTokenUsage): Promise<BotCostEstimate> => {
    if (!validUsage(usage)) return { costUsd: null };
    const cache = await get();
    if (!cache) return { costUsd: null };
    const match = matchModel(
      model,
      cache.models.map((p) => p.id),
    );
    const p = cache.models.find((entry) => entry.id === match?.id);
    if (!p || !match) return { costUsd: null };
    return makeEstimate(p, match, usage);
  };
  return { estimateCost };
}
