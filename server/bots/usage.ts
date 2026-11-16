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

export interface UsageDiagnostics {
  status: 'reported' | 'missing' | 'invalid' | 'truncated';
  rawCounters: Record<string, number>;
  terminalRecordCount: number;
  metadata: {
    conversation_id?: string;
    status?: string;
    num_turns?: number;
    duration_seconds?: number;
  };
}

const COUNTERS = [
  'input_tokens',
  'output_tokens',
  'cached_input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'cache_read_tokens',
  'total_tokens',
  'thinking_tokens',
  'thinking_output_tokens',
  'response_output_tokens',
  'cache_write_tokens',
] as const;
function rawCounters(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  const value = object(raw);
  for (const key of COUNTERS) {
    const number = value?.[key];
    if (typeof number === 'number' && Number.isFinite(number)) result[key] = number;
  }
  return result;
}
function metadata(raw: ObjectValue): UsageDiagnostics['metadata'] {
  const result: UsageDiagnostics['metadata'] = {};
  for (const key of ['conversation_id', 'status'] as const) {
    const value = raw[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) result[key] = value;
  }
  for (const key of ['num_turns', 'duration_seconds'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
  }
  return result;
}

interface ParserState {
  usage: BotTokenUsage | undefined;
  invalidTurn: boolean;
  truncated: boolean;
  diagnostics: UsageDiagnostics;
}
const terminalPrefix = (line: string): boolean =>
  /"type"\s*:\s*"turn\.completed"/.test(line.slice(0, 4096));
function codexConsumer(state: ParserState): (line: string, incomplete?: boolean) => void {
  return (line: string, incomplete = false): void => {
    try {
      const item = object(JSON.parse(line) as unknown);
      if (!item || item.type !== 'turn.completed') return;
      state.diagnostics.terminalRecordCount++;
      state.diagnostics.rawCounters = rawCounters(item.usage);
      const turn = normalize('codex', item.usage);
      if (!turn) {
        state.invalidTurn = true;
        return;
      }
      state.usage = state.usage
        ? {
            inputTokens: state.usage.inputTokens + turn.inputTokens,
            outputTokens: state.usage.outputTokens + turn.outputTokens,
            cachedInputTokens: state.usage.cachedInputTokens + turn.cachedInputTokens,
            totalTokens: state.usage.totalTokens + turn.totalTokens,
          }
        : turn;
      if (!Number.isSafeInteger(state.usage.totalTokens)) state.invalidTurn = true;
    } catch {
      if (terminalPrefix(line)) {
        state.diagnostics.terminalRecordCount++;
        state.diagnostics.rawCounters = {};
        if (incomplete && !line.trimEnd().endsWith('}')) state.truncated = true;
        else state.invalidTurn = true;
      }
    }
  };
}

function createState(): ParserState {
  return {
    usage: undefined,
    invalidTurn: false,
    truncated: false,
    diagnostics: { status: 'missing', rawCounters: {}, terminalRecordCount: 0, metadata: {} },
  };
}

/** Bounded framing keeps a large unrelated NDJSON item from hiding later completion events. */
export function createUsageParser(harness: HarnessId): {
  push: (chunk: string) => void;
  finish: () => BotTokenUsage | undefined;
  getDiagnostics: () => UsageDiagnostics;
} {
  let buffer = '';
  let skipping = false;
  let finished = false;
  const state = createState();
  const diagnostics = state.diagnostics;
  const consume = codexConsumer(state);
  const push = (chunk: string): void => {
    if (harness !== 'codex') {
      if (!skipping && buffer.length + chunk.length <= LIMIT) buffer += chunk;
      else {
        skipping = true;
        state.truncated = true;
        buffer = '';
      }
      return;
    }
    for (const part of chunk.split(/(?<=\n)/)) {
      const ends = part.endsWith('\n');
      if (!skipping && buffer.length + part.length <= LIMIT) buffer += part;
      else {
        if (!skipping && terminalPrefix(buffer + part.slice(0, 4096))) {
          state.truncated = true;
          diagnostics.terminalRecordCount++;
          diagnostics.rawCounters = {};
        }
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
    if (finished) return state.invalidTurn || state.truncated ? undefined : state.usage;
    finished = true;
    if (harness === 'codex') {
      if (!skipping && buffer) consume(buffer, true);
    } else if (!skipping && buffer.trim()) {
      try {
        const item = object(JSON.parse(buffer) as unknown);
        if (!item) state.invalidTurn = true;
        else {
          diagnostics.metadata = metadata(item);
          diagnostics.rawCounters = rawCounters(item.usage);
          if (item.usage !== undefined) {
            diagnostics.terminalRecordCount = 1;
            state.usage = normalize(harness, item.usage);
            if (!state.usage) state.invalidTurn = true;
          }
        }
      } catch {
        if (!buffer.trimEnd().endsWith('}')) state.truncated = true;
        else state.invalidTurn = true;
      }
    }
    diagnostics.status = state.truncated
      ? 'truncated'
      : state.invalidTurn
        ? 'invalid'
        : state.usage
          ? 'reported'
          : 'missing';
    return state.invalidTurn || state.truncated ? undefined : state.usage;
  };
  return { push, finish, getDiagnostics: () => structuredClone(diagnostics) };
}
