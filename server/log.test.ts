import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { normalizeProfileToken } from '../shared/profile-token.ts';
import {
  cleanupOldLogs,
  createServerLogger,
  formatRoundTerminalSummary,
  formatStderrTail,
} from './log.ts';

test('logger writes daily JSONL with redacted keys and masked tokens', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-log-test-'));
  try {
    const fixedNow = Date.UTC(2026, 10, 13, 12, 0, 0);
    const logger = createServerLogger(dir, () => fixedNow);
    const secret = 'AIzaSyFakeServerKey987654321';
    const token = 'HostSecretToken123456';
    logger.registerSecrets([secret], [token]);

    logger.log('harness_start', {
      adapter: 'claude',
      argv: ['--token', token, '--key', secret],
    });

    const logFile = path.join(dir, '2026-11-13.jsonl');
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, 'utf8');
    expect(content).not.toContain(secret);
    expect(content).not.toContain(token);
    expect(content).toContain('[REDACTED]');
    expect(content).toContain('Host…');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logger.redact masks registered keys and tokens the way the log file does', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-redact-test-'));
  try {
    const logger = createServerLogger(dir);
    const secret = 'AIzaSyRedactKey000111222333';
    const token = 'InviteTokenAbcdef123456';
    logger.registerSecrets([secret], [token]);

    const out = logger.redact(`boom: ${secret} then ${token} and a plain line`);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('Invi…');
    expect(out).toContain('a plain line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Value: protects=registered code spellings are scrubbed before JSON escaping;
// fails_when=decoded nested log strings still authenticate as the private code;
// why_new=raw-string and crash tests do not cover JSON-escaped whitespace; seam=none;
// no_claim=arbitrary intentional encodings are not profile-code spellings.
test('JSON log fields cannot recover a code through escaped whitespace', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-log-profile-'));
  try {
    const logger = createServerLogger(dir, () => Date.UTC(2026, 10, 13));
    const profileToken = randomBytes(16).toString('hex');
    logger.registerSecrets([], [profileToken]);
    const groups = Array.from({ length: 8 }, (_, i) => profileToken.slice(i * 4, i * 4 + 4));
    const variants = [profileToken.toUpperCase(), groups.join('-'), groups.join('\t\n')];
    logger.log('client_error', { spellings: variants, nested: { value: variants[2] } });
    const record = JSON.parse(readFileSync(path.join(dir, '2026-11-13.jsonl'), 'utf8')) as {
      data: { spellings: string[]; nested: { value: string } };
    };
    for (const value of [...record.data.spellings, record.data.nested.value]) {
      expect(normalizeProfileToken(value) === profileToken).toBe(false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeCrash strips tokens and secrets from stack trace', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-crash-test-'));
  try {
    const fixedNow = Date.UTC(2026, 10, 13, 12, 30, 0);
    const logger = createServerLogger(dir, () => fixedNow);
    const token = 'SecretInviteToken000111';
    const apiKey = 'AIzaSyAnotherFakeKey000111';
    logger.registerSecrets([apiKey], [token]);

    const crashPath = logger.writeCrash(new Error(`boom with #t=${token} and key=${apiKey}`));
    expect(existsSync(crashPath)).toBe(true);
    const text = readFileSync(crashPath, 'utf8');
    expect(text).not.toContain(token);
    expect(text).not.toContain(apiKey);
    expect(text).toContain('Secr…');
    expect(text).toContain('[REDACTED]');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupOldLogs removes jsonl and crash files older than 14 days', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-prune-test-'));
  try {
    const now = Date.UTC(2026, 10, 13, 12, 0, 0);
    const oldLog = path.join(dir, '2026-10-20.jsonl');
    const oldCrash = path.join(dir, 'crash-2026-10-20.log');
    const recentLog = path.join(dir, '2026-11-12.jsonl');
    writeFileSync(oldLog, '{}\n');
    writeFileSync(oldCrash, 'stack\n');
    writeFileSync(recentLog, '{}\n');

    const oldDate = new Date(now - 15 * 86_400_000);
    utimesSync(oldLog, oldDate, oldDate);
    utimesSync(oldCrash, oldDate, oldDate);

    const removed = cleanupOldLogs(dir, now);
    expect(removed).toBe(2);
    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(oldCrash)).toBe(false);
    expect(existsSync(recentLog)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatStderrTail keeps last 50 lines and formatRoundTerminalSummary formats compact line', () => {
  const lines = Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join('\n');
  const tail = formatStderrTail(lines, 50);
  expect(tail).toHaveLength(50);
  expect(tail[0]).toBe('line-31');
  expect(tail[49]).toBe('line-80');

  expect(
    formatRoundTerminalSummary({
      roundIndex: 2,
      totalRounds: 5,
      answeredNames: ['Миша', 'Клод'],
      abortedBots: [{ name: 'Кодекс', reason: 'лимит времени' }],
    }),
  ).toBe('раунд 2/5: ответили [Миша, Клод]; оборваны: Кодекс (лимит времени)');
});
