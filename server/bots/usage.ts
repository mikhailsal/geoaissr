import type { BotTokenUsage } from '../../shared/bot-results.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';

const LIMIT = 256 * 1024;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}
function counter(value: unknown, optional = false): number | undefined {
  if (value === undefined && optional) return 0;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function normalize(harness: HarnessId, raw: unknown): BotTokenUsage | undefined {
  const u = object(raw);
  if (!u) return undefined;
  const input = counter(u.input_tokens);
  const output = counter(u.output_tokens);
  const cached = counter(
    harness === 'claude'
      ? u.cache_read_input_tokens
      : harness === 'codex'
        ? u.cached_input_tokens
        : u.cache_read_tokens,
    true,
  );
  const created = harness === 'claude' ? counter(u.cache_creation_input_tokens, true) : 0;
  if (input === undefined || output === undefined || cached === undefined || created === undefined)
    return undefined;
  let normalized = harness === 'codex' ? input : input + cached + created;
  if (harness === 'agy') {
    const reported = counter(u.total_tokens, cached === 0);
    if (reported === undefined) return undefined;
    if (u.total_tokens === undefined && cached === 0) normalized = input;
    else if (reported === input + output && cached <= input) normalized = input;
    else if (reported !== input + cached + output) return undefined;
  }
  const total = normalized + output;
  if (!Number.isSafeInteger(total) || cached > normalized) return undefined;
  return {
    inputTokens: normalized,
    outputTokens: output,
    cachedInputTokens: cached,
    totalTokens: total,
  };
}

/** Bounded framing keeps a large unrelated NDJSON item from hiding later completion events. */
export function createUsageParser(harness: HarnessId): {
  push: (chunk: string) => void;
  finish: () => BotTokenUsage | undefined;
} {
  let buffer = '';
  let skipping = false;
  let usage: BotTokenUsage | undefined;
  let invalidTurn = false;
  const terminalPrefix = (line: string): boolean =>
    /"type"\s*:\s*"turn\.completed"/.test(line.slice(0, 4096));
  const consume = (line: string): void => {
    try {
      const item = object(JSON.parse(line) as unknown);
      if (!item || item.type !== 'turn.completed') return;
      const turn = normalize('codex', item.usage);
      if (!turn) {
        invalidTurn = true;
        return;
      }
      usage = usage
        ? {
            inputTokens: usage.inputTokens + turn.inputTokens,
            outputTokens: usage.outputTokens + turn.outputTokens,
            cachedInputTokens: usage.cachedInputTokens + turn.cachedInputTokens,
            totalTokens: usage.totalTokens + turn.totalTokens,
          }
        : turn;
      if (!Number.isSafeInteger(usage.totalTokens)) invalidTurn = true;
    } catch {
      if (terminalPrefix(line)) invalidTurn = true;
    }
  };
  const push = (chunk: string): void => {
    if (harness !== 'codex') {
      if (!skipping && buffer.length + chunk.length <= LIMIT) buffer += chunk;
      else {
        skipping = true;
        buffer = '';
      }
      return;
    }
    for (const part of chunk.split(/(?<=\n)/)) {
      const ends = part.endsWith('\n');
      if (!skipping && buffer.length + part.length <= LIMIT) buffer += part;
      else {
        if (!skipping && terminalPrefix(buffer + part.slice(0, 4096))) invalidTurn = true;
        skipping = true;
        buffer = '';
      }
      if (ends) {
        if (!skipping) consume(buffer);
        buffer = '';
        skipping = false;
      }
    }
  };
  const finish = (): BotTokenUsage | undefined => {
    if (harness === 'codex') {
      if (!skipping && buffer) consume(buffer);
      return invalidTurn ? undefined : usage;
    }
    if (skipping) return undefined;
    try {
      return normalize(harness, object(JSON.parse(buffer) as unknown)?.usage);
    } catch {
      return undefined;
    }
  };
  return { push, finish };
}
