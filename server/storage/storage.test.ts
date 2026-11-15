import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  createDefaultSettings,
  quotaFileSchema,
  settingsFileSchema,
} from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';
import { appendMatchRecord, readMatchRecords } from './matches.ts';
import { migrateObject } from './migrate.ts';
import {
  QUOTA_CEILINGS,
  buildQuotaMetric,
  buildQuotaSummaryForRoom,
  calculateWorstCaseMatchCost,
  createQuotaManager,
} from './quota.ts';
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

test('legacy quota gains UTC daily counts and usage log, then resets on rollover', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-daily-'));
  try {
    const file = path.join(dir, 'quota.json');
    const log = path.join(dir, 'api-usage.jsonl');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        month: '2026-02',
        staticRequests: 10,
        panoLoads: 4,
        mapLoads: 3,
      }),
    );
    let now = Date.UTC(2026, 1, 28, 23, 59);
    const manager = createQuotaManager(file, () => now, {
      apiUsageFile: log,
      ceilings: { staticRequests: 12 },
    });
    expect(manager.getState().staticRequests).toBe(10);
    expect(manager.tryReserveStatic(2)).toBe(true);
    expect(manager.tryReserveStatic(1)).toBe(false);
    manager.recordPanoLoad(3);
    manager.recordMapLoad();
    expect(
      quotaFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).daily?.['2026-02-28'],
    ).toEqual({
      staticRequests: 2,
      panoLoads: 3,
      mapLoads: 1,
    });
    expect(
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) =>
          z
            .object({ ts: z.string(), api: z.enum(['static', 'pano', 'map']), count: z.number() })
            .parse(JSON.parse(line)),
        ),
    ).toEqual([
      { ts: '2026-02-28T23:59:00.000Z', api: 'static', count: 2 },
      { ts: '2026-02-28T23:59:00.000Z', api: 'pano', count: 3 },
      { ts: '2026-02-28T23:59:00.000Z', api: 'map', count: 1 },
    ]);
    now = Date.UTC(2026, 2, 1);
    expect(manager.getState().staticRequests).toBe(0);
    manager.recordMapLoad();
    expect(manager.getState().daily).toEqual({
      '2026-03-01': { staticRequests: 0, panoLoads: 0, mapLoads: 1 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage log errors are best effort and configured limits enforce checks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-log-'));
  try {
    const manager = createQuotaManager(path.join(dir, 'quota.json'), () => Date.UTC(2026, 0, 15), {
      ceilings: { staticRequests: 2, panoLoads: 1 },
      apiUsageFile: dir,
    });
    expect(manager.getCeilings()).toEqual({ ...QUOTA_CEILINGS, staticRequests: 2, panoLoads: 1 });
    expect(manager.tryReserveStatic(2)).toBe(true);
    expect(manager.tryReserveStatic(1)).toBe(false);
    manager.recordPanoLoad();
    expect(manager.hasWriteError()).toBeNull();
    expect(manager.canStartMatch({ rounds: 1, humanCount: 1, botMoveLimits: [] }).allowed).toBe(
      false,
    );
    const summary = buildQuotaSummaryForRoom(manager);
    expect(summary.staticCeiling).toBe(2);
    expect(summary.metrics.static.status).toBe('danger');
    expect(summary.metrics.pano.dailyAvg).toBe(0.1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings validate optional quota ceilings', () => {
  const defaults = createDefaultSettings();
  expect(settingsFileSchema.parse(defaults).quotaCeilings).toBeUndefined();
  expect(
    settingsFileSchema.parse({ ...defaults, quotaCeilings: { mapLoads: 42 } }).quotaCeilings,
  ).toEqual({ mapLoads: 42 });
  for (const invalid of [0, -1, 1.5]) {
    expect(
      settingsFileSchema.safeParse({ ...defaults, quotaCeilings: { staticRequests: invalid } })
        .success,
    ).toBe(false);
  }
});

test('quota metrics use UTC month length and forecast status precedence', () => {
  const now = Date.UTC(2024, 1, 10);
  expect(buildQuotaMetric(0, 100, now)).toEqual({
    used: 0,
    ceiling: 100,
    percent: 0,
    dailyAvg: null,
    projectedMonth: null,
    status: 'ok',
  });
  expect(buildQuotaMetric(17, 200, now)).toEqual({
    used: 17,
    ceiling: 200,
    percent: 9,
    dailyAvg: 1.7,
    projectedMonth: 49,
    status: 'ok',
  });
  expect(buildQuotaMetric(30, 100, now).status).toBe('warn');
  expect(buildQuotaMetric(35, 100, now).status).toBe('danger');
  expect(buildQuotaMetric(100, 100, Date.UTC(2024, 1, 29)).status).toBe('danger');
  expect(buildQuotaMetric(85, 100, Date.UTC(2024, 1, 29)).status).toBe('warn');
});

test('failed static persistence does not append a usage event', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-failed-log-'));
  try {
    const blocker = path.join(dir, 'not-a-directory');
    const log = path.join(dir, 'api-usage.jsonl');
    writeFileSync(blocker, 'block parent directory');
    const manager = createQuotaManager(
      path.join(blocker, 'quota.json'),
      () => Date.UTC(2026, 0, 1),
      {
        apiUsageFile: log,
      },
    );
    expect(manager.tryReserveStatic(1)).toBe(false);
    expect(manager.hasWriteError()).not.toBeNull();
    expect(existsSync(log)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily history and legacy totals survive a reload across UTC days', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-reload-'));
  try {
    const file = path.join(dir, 'quota.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        month: '2026-02',
        staticRequests: 10,
        panoLoads: 4,
        mapLoads: 3,
      }),
    );
    let now = Date.UTC(2026, 1, 10, 23, 59);
    const manager = createQuotaManager(file, () => now);
    expect(manager.tryReserveStatic(2)).toBe(true);
    manager.recordPanoLoad();
    now = Date.UTC(2026, 1, 11);
    manager.recordMapLoad(2);
    const reloaded = createQuotaManager(file, () => now).getState();
    expect(reloaded.staticRequests).toBe(12);
    expect(reloaded.panoLoads).toBe(5);
    expect(reloaded.mapLoads).toBe(5);
    expect(reloaded.daily).toEqual({
      '2026-02-10': { staticRequests: 2, panoLoads: 1, mapLoads: 0 },
      '2026-02-11': { staticRequests: 0, panoLoads: 0, mapLoads: 2 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configured worst case ceilings independently enforce all three API limits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-quota-check-'));
  try {
    const opts = { rounds: 1, humanCount: 1, botMoveLimits: [0] };
    const cost = calculateWorstCaseMatchCost(opts);
    const exact = { ...cost };
    const allowed = createQuotaManager(path.join(dir, 'allowed.json'), Date.now, {
      ceilings: exact,
    });
    expect(allowed.canStartMatch(opts).allowed).toBe(true);
    for (const field of ['staticRequests', 'panoLoads', 'mapLoads'] as const) {
      const ceilings = { ...exact, [field]: exact[field] - 1 };
      const manager = createQuotaManager(path.join(dir, `${field}.json`), Date.now, { ceilings });
      const check = manager.canStartMatch(opts);
      expect(check.allowed).toBe(false);
      expect(check.reasons).toHaveLength(1);
      expect(check.reasons[0]).toContain(`> ${ceilings[field]}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
