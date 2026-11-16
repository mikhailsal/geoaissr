import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { LogEventType, ServerLogger } from '../log.ts';
import { agyToolAuditPath } from './adapters/agy.ts';

const OMITTED = '[omitted]';
const PAYLOAD_KEY = /^(?:base64|data|authorization|token|api_?key|password)$/i;

/** Mask before clipping so a long secret cannot survive as a readable prefix. */
function boundedData(logger: ServerLogger, data: Record<string, unknown>): Record<string, unknown> {
  let remaining = 16_384;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 6) return OMITTED;
    remaining -= 8;
    if (typeof value === 'string') {
      if (/data:image\/[^;]+;base64,/i.test(value)) return OMITTED;
      const safe = logger.redact(value);
      const limit = Math.min(4096, remaining);
      remaining -= Math.min(safe.length, limit);
      return safe.length > limit ? `${safe.slice(0, limit)}…[truncated]` : safe;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') return OMITTED;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => visit(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      const safeKey = logger.redact(key).slice(0, 128);
      remaining -= safeKey.length + 8;
      out[safeKey] = PAYLOAD_KEY.test(key) ? OMITTED : visit(item, depth + 1);
      if (remaining <= 0) break;
    }
    return out;
  };
  return visit(data, 0) as Record<string, unknown>;
}

/** Diagnostic I/O is optional and must never change a tool result or bot lifecycle. */
export function logBotDiagnostic(
  logger: ServerLogger | undefined,
  event: LogEventType,
  data: Record<string, unknown>,
): void {
  if (!logger) return;
  try {
    logger.log(event, boundedData(logger, data));
  } catch {
    // Preserve gameplay and process cleanup if redaction or disk writes fail.
  }
}

function auditRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.ts !== 'string' || !Number.isFinite(Date.parse(v.ts))) return undefined;
  if (v.decision !== 'allow' && v.decision !== 'deny') return undefined;
  if (typeof v.tool !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(v.tool)) return undefined;
  const out: Record<string, string> = {
    observedAt: v.ts,
    phase: 'attempt',
    tool: v.tool,
    decision: v.decision,
  };
  for (const key of ['file', 'server', 'mcpTool']) {
    if (typeof v[key] === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(v[key])) out[key] = v[key];
  }
  return out;
}

/** Copy the hook journal before cleanup, accepting only small, validated metadata records. */
export function logAgyToolAttempts(
  logger: ServerLogger | undefined,
  workDir: string,
  identity: Record<string, unknown>,
): void {
  if (!logger) return;
  let fd: number | undefined;
  try {
    fd = openSync(agyToolAuditPath(workDir), constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) throw new Error('Tool audit is not a regular file');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    const lines = buffer
      .subarray(0, Math.min(size, buffer.length - 1))
      .toString('utf8')
      .split('\n');
    let invalidRecords = 0;
    for (const line of lines.slice(0, 512)) {
      if (!line.trim()) continue;
      try {
        const record = line.length <= 2048 ? auditRecord(JSON.parse(line) as unknown) : undefined;
        if (record) logBotDiagnostic(logger, 'harness_tool_call', { ...identity, ...record });
        else invalidRecords++;
      } catch {
        invalidRecords++;
      }
    }
    const truncated = size === buffer.length || lines.length > 513;
    if (truncated || invalidRecords)
      logBotDiagnostic(logger, 'harness_monitor_error', {
        ...identity,
        phase: 'tool-audit',
        invalidRecords,
        truncated,
      });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      logBotDiagnostic(logger, 'harness_monitor_error', {
        ...identity,
        phase: 'tool-audit',
        message: err instanceof Error ? err.message : String(err),
      });
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } catch {
      // A diagnostic descriptor failure must not prevent bot cleanup.
    }
  }
}
