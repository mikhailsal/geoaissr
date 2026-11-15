import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDefaultSettings } from '../../shared/storage-schemas.ts';
import type { ServerLogger } from '../log.ts';
import { loadWinsHistory } from './wins-history.ts';
import { writeResetSettings } from './settings-writer.ts';

test('unreadable match history returns a warning and preserves the input', () => {
  // protects: startup with an unreadable history and private UI warning; fails_when: read error escapes or warning exposes the path; no_claim: recovery of missing history.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-history-'));
  const messages: unknown[] = [];
  const logger = {
    log: (_event: unknown, data: unknown) => {
      messages.push(data);
    },
  } as ServerLogger;
  try {
    writeFileSync(path.join(dir, 'sentinel'), 'unchanged');
    const result = loadWinsHistory(dir, logger);
    expect(result.records).toEqual([]);
    expect(result.warning).toBeDefined();
    expect(result.warning).not.toContain(dir);
    expect(messages).toHaveLength(1);
    expect(readFileSync(path.join(dir, 'sentinel'), 'utf8')).toBe('unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset rejects a newer settings file without overwriting it', async () => {
  // protects: newer-version refusal and file preservation; fails_when: reset appears persisted by silently skipping; no_claim: normal-version disk failures.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-new-settings-'));
  const file = path.join(dir, 'settings.json');
  try {
    writeFileSync(file, '{"version":999}');
    let rejected = false;
    try {
      await writeResetSettings(file, createDefaultSettings(), 'newer_version');
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{"version":999}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an existing unreadable history is not mistaken for a missing file', () => {
  // protects: read failures hidden by existsSync still produce a warning; fails_when: an unreadable existing path returns healthy zero wins; no_claim: repairs filesystem permissions.
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-history-link-'));
  const file = path.join(dir, 'matches.jsonl');
  let errors = 0;
  const logger = {
    log: () => {
      errors++;
    },
  } as unknown as ServerLogger;
  try {
    symlinkSync('matches.jsonl', file);
    const result = loadWinsHistory(file, logger);
    expect(result.warning).toBeTruthy();
    expect(result.records).toEqual([]);
    expect(errors).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
