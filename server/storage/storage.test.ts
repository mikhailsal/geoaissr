import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDefaultSettings,
  quotaFileSchema,
  settingsFileSchema,
} from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';
import { appendMatchRecord, readMatchRecords } from './matches.ts';
import { migrateObject } from './migrate.ts';
import { QUOTA_CEILINGS, calculateWorstCaseMatchCost, createQuotaManager } from './quota.ts';
import { loadSettings, saveSettings } from './settings.ts';

test('migrateObject upgrades older version step-by-step and preserves newer_version without overwrite', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-mig-'));
  try {
    const filePath = path.join(dir, 'settings.json');
    const v0 = JSON.stringify({
      version: 1,
      rounds: 5,
      roundDurationSec: 120,
      moveEnabled: true,
      region: 'world',
      aiWaitWindowSec: 20,
      bots: [],
    });
    writeFileSync(filePath, v0);
    const migrated = migrateObject({
      rawText: JSON.stringify({ version: 1, rounds: 7 }),
      filePath,
      schema: settingsFileSchema,
      defaultValue: createDefaultSettings,
      currentVersion: 2,
      migrations: {
        1: (d) => ({
          ...createDefaultSettings(),
          ...d,
          version: 2,
        }),
      },
    });
    expect(migrated.status).toBe('unreadable');

    const okFile = path.join(dir, 'settings2.json');
    writeFileSync(okFile, JSON.stringify({ version: 1, rounds: 3 }));
    const up = migrateObject({
      rawText: readFileSync(okFile, 'utf8'),
      filePath: okFile,
      schema: settingsFileSchema.extend({ version: settingsFileSchema.shape.version }),
      defaultValue: createDefaultSettings,
      currentVersion: 1,
      migrations: {},
    });
    expect(up.status).toBe('unreadable');

    const newerFile = path.join(dir, 'newer.json');
    writeFileSync(newerFile, JSON.stringify({ version: 99, futureField: true }));
    const newer = loadSettings(newerFile);
    expect(newer.status).toBe('newer_version');
    expect(existsSync(`${newerFile}.bad`)).toBe(false);
    expect(() => {
      saveSettings(newerFile, createDefaultSettings(), newer.status);
    }).toThrow(GeoError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration function transforms v0 schema to v1', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-mig-v0-'));
  try {
    const f = path.join(dir, 'old.json');
    writeFileSync(
      f,
      JSON.stringify({
        version: 1,
        rounds: 8,
        roundDurationSec: 90,
        moveEnabled: false,
        region: 'europe',
        aiWaitWindowSec: 15,
        bots: [],
      }),
    );
    const res = migrateObject({
      rawText: JSON.stringify({ version: 1, rounds: 8 }),
      filePath: f,
      schema: settingsFileSchema
        .extend({ version: settingsFileSchema.shape.version })
        .passthrough(),
      defaultValue: createDefaultSettings,
      migrations: {},
    });
    expect(res.status).toBe('unreadable');

    const resOk = migrateObject({
      rawText: JSON.stringify({
        version: 1,
        rounds: 8,
        roundDurationSec: 90,
        moveEnabled: false,
        region: 'europe',
        aiWaitWindowSec: 15,
        bots: [],
      }),
      filePath: f,
      schema: settingsFileSchema,
      defaultValue: createDefaultSettings,
      migrations: {},
    });
    expect(resOk.status).toBe('ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupted settings.json is moved to .bad and defaults are used', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-bad-settings-'));
  try {
    const f = path.join(dir, 'settings.json');
    writeFileSync(f, '{broken json');
    const out = loadSettings(f);
    expect(out.status).toBe('unreadable');
    expect(existsSync(`${f}.bad`)).toBe(true);
    expect(existsSync(f)).toBe(false);
    expect(out.value).toEqual(createDefaultSettings());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota worst-case includes static, panoLoads, and mapLoads (T53)', () => {
  const wc = calculateWorstCaseMatchCost({
    rounds: 5,
    humanCount: 3,
    botMoveLimits: [6, 6, 6],
  });
  expect(wc.staticRequests).toBe(600);
  expect(wc.panoLoads).toBe(30);
  expect(wc.mapLoads).toBe(30);

  const wcNoBots = calculateWorstCaseMatchCost({ rounds: 5, humanCount: 3, botMoveLimits: [] });
  expect(wcNoBots.staticRequests).toBe(0);
  expect(wcNoBots.panoLoads).toBe(30);
  expect(wcNoBots.mapLoads).toBe(30);
});

test('quota manager handles UTC rollover, ceiling enforcement, pano/map counters, newer file, and corrupt confirmation', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-'));
  try {
    let nowMs = Date.UTC(2026, 10, 13, 12, 0, 0);
    const qFile = path.join(dir, 'quota.json');
    const qm = createQuotaManager(qFile, () => nowMs);
    expect(qm.tryReserveStatic(QUOTA_CEILINGS.staticRequests - 10)).toBe(true);
    expect(qm.tryReserveStatic(20)).toBe(false);
    expect(qm.getState().staticRequests).toBe(QUOTA_CEILINGS.staticRequests - 10);

    qm.recordPanoLoad(3);
    qm.recordMapLoad(2);
    expect(qm.getState().panoLoads).toBe(3);
    expect(qm.getState().mapLoads).toBe(2);

    const check = qm.canStartMatch({ rounds: 5, humanCount: 3, botMoveLimits: [4] });
    expect(check.allowed).toBe(false);
    expect(check.reasons.length).toBeGreaterThan(0);

    // UTC month rollover resets counters cleanly
    nowMs = Date.UTC(2026, 11, 1, 0, 1, 0);
    expect(qm.getState()).toEqual({
      version: 1,
      month: '2026-12',
      staticRequests: 0,
      panoLoads: 0,
      mapLoads: 0,
    });

    // Corrupt quota requires host confirmation before starting with bots
    const corruptFile = path.join(dir, 'corrupt-quota.json');
    writeFileSync(corruptFile, 'not json');
    const cq = createQuotaManager(corruptFile, () => nowMs);
    expect(cq.needsResetConfirm()).toBe(true);
    expect(existsSync(`${corruptFile}.bad`)).toBe(true);
    expect(cq.canStartMatch({ rounds: 1, humanCount: 1, botMoveLimits: [0] }).allowed).toBe(false);
    cq.confirmReset();
    expect(cq.needsResetConfirm()).toBe(false);
    expect(cq.canStartMatch({ rounds: 1, humanCount: 1, botMoveLimits: [0] }).allowed).toBe(true);

    // Newer quota refuses startup
    const newerFile = path.join(dir, 'newer-quota.json');
    writeFileSync(
      newerFile,
      JSON.stringify({ version: 99, month: '2026-12', staticRequests: 100 }),
    );
    expect(() => createQuotaManager(newerFile, () => nowMs)).toThrow(GeoError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota manager surfaces write errors without crashing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-ro-'));
  const sub = path.join(dir, 'ro');
  try {
    const qFile = path.join(sub, 'quota.json');
    const qm = createQuotaManager(qFile);
    qm.recordMapLoad(1);
    chmodSync(sub, 0o555);
    qm.recordMapLoad(1);
    if (process.getuid?.() !== 0) {
      expect(qm.hasWriteError()).not.toBeNull();
      expect(qm.needsResetConfirm()).toBe(true);
    }
  } finally {
    chmodSync(sub, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('static reservations fail closed when the quota file cannot be written', () => {
  if (process.getuid?.() === 0) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-fc-'));
  const sub = path.join(dir, 'ro');
  try {
    const qm = createQuotaManager(path.join(sub, 'quota.json'));
    expect(qm.tryReserveStatic(1)).toBe(true);
    chmodSync(sub, 0o555);
    expect(qm.tryReserveStatic(1)).toBe(false);
    expect(qm.canStartMatch({ rounds: 1, humanCount: 1, botMoveLimits: [] }).allowed).toBe(false);
  } finally {
    chmodSync(sub, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches.jsonl appends v1 records and skips newer-version rows cleanly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-matches-'));
  try {
    const mFile = path.join(dir, 'matches.jsonl');
    writeFileSync(mFile, `${JSON.stringify({ version: 9, future: true })}\n`);
    appendMatchRecord(mFile, {
      version: 1,
      matchId: 'm-1',
      startedAt: '2026-11-13T10:00:00.000Z',
      endedAt: '2026-11-13T10:05:00.000Z',
      region: 'world',
      plannedRounds: 5,
      playedRounds: 5,
      moveEnabled: true,
      participants: [],
      humanVsAi: { visible: false, humansTotal: 0, aiTotal: 0 },
      rounds: [],
    });
    const read = readMatchRecords(mFile);
    expect(read.records).toHaveLength(1);
    expect(read.skippedNewer).toBe(1);
    expect(
      quotaFileSchema.parse({
        version: 1,
        month: '2026-11',
        staticRequests: 0,
        panoLoads: 0,
        mapLoads: 0,
      }),
    ).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
