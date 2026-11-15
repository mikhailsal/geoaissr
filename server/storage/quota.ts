import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import type { QuotaMetricView, QuotaSummaryView } from '../../shared/protocol.ts';
import { quotaFileSchema, type QuotaFile } from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';
import { migrateObject, type LoadOutcome, type MigrationFn } from './migrate.ts';
import { atomicWriteFile } from './settings.ts';

// Google Maps Platform free tier monthly caps (post-March 2025 pricing, UTC reset on 1st of month):
// Static Street View: 10,000/mo -> 80% app ceiling = 8,000
// Dynamic Street View (pano loads): 5,000/mo -> 80% app ceiling = 4,000
// Dynamic Maps (Google Maps JS Map objects): 10,000/mo -> 80% app ceiling = 8,000
export const QUOTA_FREE_MONTHLY = {
  staticRequests: 10_000,
  panoLoads: 5_000,
  mapLoads: 10_000,
} as const;

export const QUOTA_CEILINGS = {
  staticRequests: 8_000,
  panoLoads: 4_000,
  mapLoads: 8_000,
} as const;

export type QuotaCeilings = { staticRequests: number; panoLoads: number; mapLoads: number };

export const QUOTA_MIGRATIONS: Record<number, MigrationFn> = {};

export function getUtcMonth(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

export function createEmptyQuota(nowMs = Date.now()): QuotaFile {
  return {
    version: 1,
    month: getUtcMonth(nowMs),
    staticRequests: 0,
    panoLoads: 0,
    mapLoads: 0,
  };
}

export interface WorstCaseCost {
  staticRequests: number;
  panoLoads: number;
  mapLoads: number;
}

export function calculateWorstCaseMatchCost(opts: {
  rounds: number;
  humanCount: number;
  botMoveLimits: readonly number[];
}): WorstCaseCost {
  const staticPerBotSum = opts.botMoveLimits.reduce((sum, limit) => sum + (limit + 3) * 4, 0);
  const hasBots = opts.botMoveLimits.length > 0;
  return {
    staticRequests: hasBots ? opts.rounds * (12 + staticPerBotSum) : 0,
    panoLoads: opts.rounds * Math.max(1, opts.humanCount) * 2,
    mapLoads: opts.rounds * Math.max(1, opts.humanCount) * 2,
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  worstCase: WorstCaseCost;
  reasons: string[];
}

export interface QuotaManager {
  getState: () => QuotaFile;
  getCeilings: () => QuotaCeilings;
  getNowMs: () => number;
  needsResetConfirm: () => boolean;
  hasWriteError: () => string | null;
  confirmReset: () => void;
  canStartMatch: (opts: {
    rounds: number;
    humanCount: number;
    botMoveLimits: readonly number[];
  }) => QuotaCheckResult;
  tryReserveStatic: (count: number) => boolean;
  recordPanoLoad: (count?: number) => void;
  recordMapLoad: (count?: number) => void;
}

function loadInitialQuota(
  quotaFile: string,
  sentinelFile: string,
  nowMs: number,
): {
  state: QuotaFile;
  resetConfirmNeeded: boolean;
  shouldPersistSentinel: boolean;
} {
  const hasSentinel = existsSync(sentinelFile);
  if (!existsSync(quotaFile)) {
    return {
      state: createEmptyQuota(nowMs),
      resetConfirmNeeded: hasSentinel,
      shouldPersistSentinel: false,
    };
  }
  let rawText = '';
  let readErr: string | null = null;
  try {
    rawText = readFileSync(quotaFile, 'utf8');
  } catch (err) {
    readErr = err instanceof Error ? err.message : String(err);
  }
  const outcome: LoadOutcome<QuotaFile> = readErr
    ? { status: 'unreadable', value: createEmptyQuota(nowMs), errorDetail: readErr }
    : migrateObject({
        rawText,
        filePath: quotaFile,
        schema: quotaFileSchema,
        defaultValue: () => createEmptyQuota(nowMs),
        migrations: QUOTA_MIGRATIONS,
      });

  if (outcome.status === 'newer_version') {
    throw new GeoError({
      code: 'GEO_QUOTA_NEWER',
      causeDetail: `quota.json version ${outcome.fileVersion ?? 'unknown'} is newer than supported 1`,
    });
  }
  if (outcome.status === 'unreadable') {
    return {
      state: createEmptyQuota(nowMs),
      resetConfirmNeeded: true,
      shouldPersistSentinel: true,
    };
  }
  return {
    state: outcome.value,
    resetConfirmNeeded: hasSentinel,
    shouldPersistSentinel: false,
  };
}

function checkWorstCaseReasons(
  state: QuotaFile,
  resetConfirmNeeded: boolean,
  ceilings: QuotaCeilings,
  opts: { rounds: number; humanCount: number; botMoveLimits: readonly number[] },
): QuotaCheckResult {
  const worstCase = calculateWorstCaseMatchCost(opts);
  const reasons: string[] = [];
  if (resetConfirmNeeded) {
    reasons.push('Требуется подтверждение сброса счётчика квоты');
  }
  if (
    opts.botMoveLimits.length > 0 &&
    state.staticRequests + worstCase.staticRequests > ceilings.staticRequests
  ) {
    reasons.push(
      `Static API: ${state.staticRequests} + ${worstCase.staticRequests} > ${ceilings.staticRequests}`,
    );
  }
  if (state.panoLoads + worstCase.panoLoads > ceilings.panoLoads) {
    reasons.push(`Панорамы: ${state.panoLoads} + ${worstCase.panoLoads} > ${ceilings.panoLoads}`);
  }
  if (state.mapLoads + worstCase.mapLoads > ceilings.mapLoads) {
    reasons.push(`Карты: ${state.mapLoads} + ${worstCase.mapLoads} > ${ceilings.mapLoads}`);
  }
  return { allowed: reasons.length === 0, worstCase, reasons };
}

export function buildQuotaMetric(
  used: number,
  ceiling: number,
  nowMs = Date.now(),
): QuotaMetricView {
  const date = new Date(nowMs);
  const day = date.getUTCDate();
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const percent = Math.round((used / ceiling) * 100);
  const dailyAvg = used === 0 ? null : Math.round((used / day) * 10) / 10;
  const projectedMonth = used === 0 ? null : Math.round((used / day) * days);
  const status =
    used >= ceiling || (projectedMonth !== null && projectedMonth > ceiling)
      ? 'danger'
      : percent >= 85 || (projectedMonth !== null && projectedMonth >= Math.round(ceiling * 0.85))
        ? 'warn'
        : 'ok';
  return { used, ceiling, percent, dailyAvg, projectedMonth, status };
}

/** Build a summary view from a QuotaManager and current room match configuration. */
export function buildQuotaSummaryForRoom(
  quotaManager: QuotaManager,
  opts?: { rounds?: number; humanCount?: number; botMoveLimits?: readonly number[] },
): QuotaSummaryView {
  const q = quotaManager.getState();
  const ceilings = quotaManager.getCeilings();
  const nowMs = quotaManager.getNowMs();
  const check = quotaManager.canStartMatch({
    rounds: opts?.rounds ?? 5,
    humanCount: Math.max(1, opts?.humanCount ?? 1),
    botMoveLimits: opts?.botMoveLimits ?? [],
  });
  return {
    metrics: {
      static: buildQuotaMetric(q.staticRequests, ceilings.staticRequests, nowMs),
      pano: buildQuotaMetric(q.panoLoads, ceilings.panoLoads, nowMs),
      map: buildQuotaMetric(q.mapLoads, ceilings.mapLoads, nowMs),
    },
    staticUsed: q.staticRequests,
    staticCeiling: ceilings.staticRequests,
    staticWorstCase: check.worstCase.staticRequests,
    panoUsed: q.panoLoads,
    panoCeiling: ceilings.panoLoads,
    panoWorstCase: check.worstCase.panoLoads,
    mapUsed: q.mapLoads,
    mapCeiling: ceilings.mapLoads,
    mapWorstCase: check.worstCase.mapLoads,
    needsResetConfirm: quotaManager.needsResetConfirm(),
    resetReason: quotaManager.hasWriteError() ?? undefined,
    sufficient: check.allowed,
    exceedsMessage: check.reasons.length > 0 ? check.reasons.join('; ') : undefined,
  };
}

function writeSentinelBestEffort(sentinelFile: string, nowMs: number): string | null {
  try {
    atomicWriteFile(sentinelFile, `${new Date(nowMs).toISOString()}\n`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function clearSentinelChecked(sentinelFile: string): string | null {
  try {
    if (existsSync(sentinelFile)) rmSync(sentinelFile, { force: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function applyDebit(
  state: QuotaFile,
  field: keyof QuotaCeilings,
  count: number,
  nowMs: number,
): QuotaFile {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const daily = state.daily ?? {};
  const today = daily[day] ?? { staticRequests: 0, panoLoads: 0, mapLoads: 0 };
  return {
    ...state,
    [field]: state[field] + count,
    daily: { ...daily, [day]: { ...today, [field]: today[field] + count } },
  };
}

function appendUsageBestEffort(
  file: string,
  api: 'static' | 'pano' | 'map',
  count: number,
  nowMs: number,
): void {
  try {
    appendFileSync(file, `${JSON.stringify({ ts: new Date(nowMs).toISOString(), api, count })}\n`);
  } catch {
    /* Usage logging is best effort. */
  }
}

export function createQuotaManager(
  quotaFile: string,
  nowFn: () => number = () => Date.now(),
  options: { ceilings?: Partial<QuotaCeilings>; apiUsageFile?: string } = {},
): QuotaManager {
  const ceilings = { ...QUOTA_CEILINGS, ...options.ceilings };
  const sentinelFile = `${quotaFile}.reset-pending`;
  const initial = loadInitialQuota(quotaFile, sentinelFile, nowFn());
  let state = initial.state;
  let resetConfirmNeeded = initial.resetConfirmNeeded;
  let writeErrorMsg: string | null = initial.shouldPersistSentinel
    ? writeSentinelBestEffort(sentinelFile, nowFn())
    : null;

  const rolloverIfNeeded = () => {
    const curMonth = getUtcMonth(nowFn());
    if (state.month !== curMonth) state = createEmptyQuota(nowFn());
  };

  const persist = (): boolean => {
    try {
      atomicWriteFile(quotaFile, `${JSON.stringify(state, null, 2)}\n`);
      writeErrorMsg = null;
      return true;
    } catch (err) {
      writeErrorMsg = err instanceof Error ? err.message : String(err);
      resetConfirmNeeded = true;
      return false;
    }
  };

  const debit = (
    field: keyof QuotaCeilings,
    api: 'static' | 'pano' | 'map',
    count: number,
  ): boolean => {
    const nowMs = nowFn();
    state = applyDebit(state, field, count, nowMs);
    const saved = persist();
    if ((saved || api !== 'static') && options.apiUsageFile) {
      appendUsageBestEffort(options.apiUsageFile, api, count, nowMs);
    }
    return saved;
  };

  return {
    getCeilings: () => ({ ...ceilings }),
    getNowMs: nowFn,
    getState: () => {
      rolloverIfNeeded();
      return structuredClone(state);
    },
    needsResetConfirm: () => resetConfirmNeeded,
    hasWriteError: () => writeErrorMsg,
    confirmReset: () => {
      rolloverIfNeeded();
      if (!persist()) return;
      writeErrorMsg = clearSentinelChecked(sentinelFile);
      resetConfirmNeeded = writeErrorMsg !== null;
    },
    canStartMatch: (opts) => {
      rolloverIfNeeded();
      return checkWorstCaseReasons(state, resetConfirmNeeded, ceilings, opts);
    },
    tryReserveStatic: (count) => {
      rolloverIfNeeded();
      if (state.staticRequests + count > ceilings.staticRequests) return false;
      // Fail closed: a request that cannot be recorded on disk is not allowed.
      return debit('staticRequests', 'static', count);
    },
    recordPanoLoad: (count = 1) => {
      rolloverIfNeeded();
      debit('panoLoads', 'pano', count);
    },
    recordMapLoad: (count = 1) => {
      rolloverIfNeeded();
      debit('mapLoads', 'map', count);
    },
  };
}
