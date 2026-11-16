import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServerLogger, type LogRecord, type ServerLogger } from '../log.ts';
import { agyToolAuditPath } from './adapters/agy.ts';
import { logAgyToolAttempts, logBotDiagnostic } from './diagnostics.ts';

function readLogs(dir: string): LogRecord[] {
  return readFileSync(path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LogRecord);
}

// Value: protects=bounded diagnostics redact before clipping and exclude image bytes; fails_when=long secret prefixes or image data survive; why_new=existing logger tests do not bound nested bot data; seam=none; no_claim=provider telemetry.
test('bounds nested diagnostic data and redacts long secrets before clipping', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-bot-diagnostic-'));
  try {
    const logger = createServerLogger(dir);
    const secret = 'UniqueSecretPrefix' + 'x'.repeat(5000);
    logger.registerSecrets([secret]);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    logBotDiagnostic(logger, 'bot_tool_call', {
      args: { facts: secret, base64: 'PRIVATE_IMAGE_BYTES', nested: cycle },
      other: 'data:image/jpeg;base64,PRIVATE_DATA_URI',
      big: 'y'.repeat(30_000),
    });
    const text = JSON.stringify(readLogs(dir));
    expect(text).not.toContain('UniqueSecretPrefix');
    expect(text).not.toContain('PRIVATE_IMAGE_BYTES');
    expect(text).not.toContain('PRIVATE_DATA_URI');
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('[circular]');
    expect(text).toContain('[truncated]');
    expect(text.length).toBeLessThan(20_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostic redaction and log-write failures do not escape', () => {
  for (const failRedaction of [false, true]) {
    const logger = {
      redact: (value: string) => {
        if (failRedaction) throw new Error('redaction failed');
        return value;
      },
      log: () => {
        throw new Error('disk full');
      },
    } as unknown as ServerLogger;
    expect(() => {
      logBotDiagnostic(logger, 'harness_end', { model: 'test' });
    }).not.toThrow();
  }
});

// Value: protects=AGY permission attempts remain reconstructable without trusting journal payloads; fails_when=invalid records or arbitrary file content enter logs; why_new=adapter tests stop before journal ingestion; seam=none; no_claim=tool execution success.
test('copies validated AGY attempts while reporting malformed and excessive journals', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-agy-journal-'));
  try {
    const logger = createServerLogger(path.join(dir, 'logs'));
    const file = agyToolAuditPath(dir);
    mkdirSync(path.dirname(file), { recursive: true });
    const valid = JSON.stringify({
      ts: new Date().toISOString(),
      tool: 'read_file',
      decision: 'allow',
      file: 'frame.jpg',
      base64: 'DO_NOT_COPY',
    });
    const invalid = JSON.stringify({
      ts: 'bad',
      tool: 'read_file',
      decision: 'allow',
      text: 'DO_NOT_COPY',
    });
    writeFileSync(file, `${valid}\n${invalid}\n{broken\n` + `${valid}\n`.repeat(600));
    logAgyToolAttempts(logger, dir, { matchId: 'match', gen: 2, slotId: 'bot', roundNumber: 3 });
    const rows = readLogs(logger.getLogsDir());
    expect(rows[0]).toMatchObject({
      event: 'harness_tool_call',
      data: {
        matchId: 'match',
        gen: 2,
        slotId: 'bot',
        roundNumber: 3,
        phase: 'attempt',
        tool: 'read_file',
        decision: 'allow',
        file: 'frame.jpg',
      },
    });
    expect(JSON.stringify(rows)).not.toContain('DO_NOT_COPY');
    expect(rows.filter((r) => r.event === 'harness_tool_call')).toHaveLength(510);
    expect(rows.at(-1)).toMatchObject({
      event: 'harness_monitor_error',
      data: { phase: 'tool-audit', invalidRecords: 2, truncated: true },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('journal ingestion rejects symlink files and accepts a missing journal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-agy-symlink-'));
  try {
    const logger = createServerLogger(path.join(dir, 'logs'));
    logAgyToolAttempts(logger, dir, {});
    const file = agyToolAuditPath(dir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(path.join(dir, 'other'), 'PRIVATE_BYTES');
    symlinkSync(path.join(dir, 'other'), file);
    logAgyToolAttempts(logger, dir, { slotId: 'bot' });
    const rows = readLogs(logger.getLogsDir());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'harness_monitor_error',
      data: { slotId: 'bot', phase: 'tool-audit' },
    });
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_BYTES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
