import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './errors.ts';

const RETENTION_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export type LogEventType =
  | 'profiles_unavailable'
  | 'server_start'
  | 'round_start'
  | 'round_end'
  | 'player_join'
  | 'player_leave'
  | 'harness_start'
  | 'harness_end'
  | 'harness_monitor_error'
  | 'harness_usage'
  | 'harness_cost'
  | 'harness_tool_call'
  | 'bot_tool_call'
  | 'bot_journal_correction'
  | 'google_call'
  | 'quota_update'
  | 'tunnel_event'
  | 'client_error'
  | 'shell_async_error';

export interface LogRecord {
  ts: string;
  event: LogEventType;
  data: Record<string, unknown>;
}

export interface ServerLogger {
  log: (event: LogEventType, data: Record<string, unknown>) => void;
  writeCrash: (err: unknown) => string;
  pruneOld: () => number;
  registerSecrets: (secrets: readonly string[], tokens?: readonly string[]) => void;
  /** Masks every secret and token registered so far, exactly as the log file does. */
  redact: (text: string) => string;
  getLogsDir: () => string;
}

export function formatUtcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function cleanupOldLogs(logsDir: string, nowMs = Date.now(), days = RETENTION_DAYS): number {
  if (!existsSync(logsDir)) return 0;
  const cutoff = nowMs - days * MS_PER_DAY;
  let removed = 0;
  for (const name of readdirSync(logsDir)) {
    if (!name.endsWith('.jsonl') && !name.startsWith('crash-')) continue;
    const full = path.join(logsDir, name);
    try {
      const st = statSync(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        unlinkSync(full);
        removed += 1;
      }
    } catch {
      // ignore concurrent unlink
    }
  }
  return removed;
}

export function formatStderrTail(stderr: string, maxLines = 50): string[] {
  if (!stderr.trim()) return [];
  const lines = stderr.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(-maxLines);
}

function collectDefaultEnvSecrets(): string[] {
  return [
    process.env.GOOGLE_MAPS_BROWSER_KEY ?? '',
    process.env.GOOGLE_MAPS_SERVER_KEY ?? '',
    process.env.GOOGLE_API_KEY ?? '',
  ].filter(Boolean);
}

export function createServerLogger(
  logsDir: string,
  nowFn: () => number = () => Date.now(),
): ServerLogger {
  mkdirSync(logsDir, { recursive: true });
  const secrets = new Set<string>(collectDefaultEnvSecrets());
  const tokens = new Set<string>();

  const redactString = (value: string): string => redactSecrets(value, [...secrets], [...tokens]);

  const log = (event: LogEventType, data: Record<string, unknown>): void => {
    const nowMs = nowFn();
    const record: LogRecord = { ts: new Date(nowMs).toISOString(), event, data };
    const safeLine = redactString(
      JSON.stringify(record, (_key: string, value: unknown) =>
        typeof value === 'string' ? redactString(value) : value,
      ),
    );
    const file = path.join(logsDir, `${formatUtcDate(nowMs)}.jsonl`);
    appendFileSync(file, `${safeLine}\n`, 'utf8');
  };

  const writeCrash = (err: unknown): string => {
    const nowMs = nowFn();
    const stamp = new Date(nowMs).toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const file = path.join(logsDir, `crash-${stamp}.log`);
    const stack = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
    const body = redactString(`time: ${new Date(nowMs).toISOString()}\n${stack}\n`);
    writeFileSync(file, body, 'utf8');
    return file;
  };

  const pruneOld = (): number => cleanupOldLogs(logsDir, nowFn());

  const registerSecrets = (
    newSecrets: readonly string[],
    newTokens: readonly string[] = [],
  ): void => {
    for (const s of newSecrets) {
      if (s) secrets.add(s);
    }
    for (const t of newTokens) {
      if (t) tokens.add(t);
    }
  };

  pruneOld();
  return {
    log,
    writeCrash,
    pruneOld,
    registerSecrets,
    redact: redactString,
    getLogsDir: () => logsDir,
  };
}

export function formatRoundTerminalSummary(opts: {
  roundIndex: number;
  totalRounds: number;
  answeredNames: readonly string[];
  abortedBots: ReadonlyArray<{ name: string; reason: string }>;
}): string {
  const answered = opts.answeredNames.length > 0 ? opts.answeredNames.join(', ') : 'никто';
  const aborted =
    opts.abortedBots.length > 0
      ? `; оборваны: ${opts.abortedBots.map((b) => `${b.name} (${b.reason})`).join(', ')}`
      : '';
  return `раунд ${opts.roundIndex}/${opts.totalRounds}: ответили [${answered}]${aborted}`;
}
