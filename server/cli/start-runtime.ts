import path from 'node:path';
import type { HarnessCatalogEntry, TunnelStatusView } from '../../shared/protocol.ts';
import type { BotSlotConfig, SettingsFile } from '../../shared/storage-schemas.ts';
import { migrateSavedBotSlot } from '../bots/adapters/shared.ts';
import type { BotRunner } from '../bots/runner.ts';
import { resolveInstalledCliVersions } from '../bots/process.ts';
import { createRoomShell, type RoomShell } from '../engine/shell.ts';
import type { RoomState } from '../engine/types.ts';
import { GeoError } from '../errors.ts';
import type { ThumbStore } from '../http/thumbs.ts';
import type { createBotImageService } from '../images/bot-image-service.ts';
import type { LocationService } from '../location.ts';
import type { ServerLogger } from '../log.ts';
import type { AppPaths } from '../paths.ts';
import type { ManagedProcess } from '../proc/spawn.ts';
import { spawnManaged } from '../proc/spawn.ts';
import { loadHarnessVerified } from '../storage/harness-verified.ts';
import { appendMatchRecord } from '../storage/matches.ts';
import { loadWinsHistory } from './wins-history.ts';
import { createSettingsWriter, writeResetSettings } from './settings-writer.ts';
import type { LoadOutcome } from '../storage/migrate.ts';
import { buildQuotaSummaryForRoom, type QuotaManager } from '../storage/quota.ts';
import { loadSettings } from '../storage/settings.ts';
export { persistSettingsSafe } from './settings-writer.ts';
import {
  createCloudflaredManager,
  probePublicReadiness,
  type TunnelManager,
} from '../tunnel/cloudflared.ts';
import { type StartCliOptions } from './preflight.ts';
import { formatCliError } from './report-error.ts';
import { printRemoteOwnerInvite } from './start-banner.ts';

export function buildInitialSettings(opts: {
  settingsFile: string;
  cli: StartCliOptions;
  availableHarnesses: readonly HarnessCatalogEntry[];
  fakeMode: boolean;
}): {
  settings: SettingsFile;
  settingsOutcomeStatus: LoadOutcome<SettingsFile>['status'];
  settingsNotice?: string;
} {
  const outcome = loadSettings(opts.settingsFile);
  let settings = structuredClone(outcome.value);
  let settingsNotice: string | undefined;

  if (outcome.status === 'unreadable') {
    settingsNotice = 'Файл settings.json повреждён (.bad). Загружены настройки по умолчанию.';
  } else if (outcome.status === 'newer_version') {
    settingsNotice =
      'Файл settings.json от более новой версии geoaissr. Используются настройки по умолчанию без перезаписи.';
  }

  if (opts.cli.roundsOverride !== undefined) settings.rounds = opts.cli.roundsOverride;
  if (opts.cli.regionOverride !== undefined) settings.region = opts.cli.regionOverride;
  if (opts.cli.durationOverride !== undefined)
    settings.roundDurationSec = opts.cli.durationOverride;
  if (opts.cli.noMoveOverride !== undefined) settings.moveEnabled = !opts.cli.noMoveOverride;

  const availableMap = new Map(opts.availableHarnesses.map((h) => [h.id, h]));
  const prevBots = settings.bots;
  const sanitizedBots: BotSlotConfig[] = prevBots.map((stored) => {
    const slot = migrateSavedBotSlot(stored);
    const info = availableMap.get(slot.harness);
    if (!opts.fakeMode && (!info || !info.available)) {
      return {
        ...slot,
        enabled: false,
        disabledReason: info?.reason ?? `Харнесс ${slot.harness} недоступен`,
      };
    }
    return slot;
  });
  const disabledAny = sanitizedBots.some((b, idx) => !b.enabled && Boolean(prevBots[idx]?.enabled));
  if (disabledAny && !settingsNotice) {
    settingsNotice = 'Часть сохранённых слотов ИИ отключена: выбранный харнесс недоступен.';
  }
  if (sanitizedBots.some((b) => b.enabled) && settings.roundDurationSec < 60) {
    settings.roundDurationSec = 60;
  }
  settings = { ...settings, bots: sanitizedBots };
  return { settings, settingsOutcomeStatus: outcome.status, settingsNotice };
}

export function collectHarnessVersionWarnings(
  harnesses: readonly HarnessCatalogEntry[],
  verifiedFile: string,
  fakeMode: boolean,
): HarnessCatalogEntry[] {
  if (fakeMode) return [...harnesses];
  const verified = loadHarnessVerified(verifiedFile).harnesses;
  const installed = resolveInstalledCliVersions(harnesses);
  return harnesses.map((h) => {
    const curVer = installed[h.id];
    const prevVer = verified[h.id]?.cliVersion;
    if (curVer && prevVer && curVer !== prevVer) {
      const warn = `${h.id}: версия CLI (${curVer}) отличается от проверенной (${prevVer}); запустите \`bun run test:harness\``;
      console.warn(warn);
      return { ...h, versionWarning: warn };
    }
    return h;
  });
}

export async function runViteBuild(childrenFile: string): Promise<number> {
  const t0 = Date.now();
  console.log('Собираю клиент...');
  const bunExe = process.execPath || 'bun';
  const proc: ManagedProcess = spawnManaged({
    cmd: [bunExe, 'x', 'vite', 'build'],
    cwd: path.resolve(import.meta.dir, '../..'),
    kind: 'vite-build',
    childrenFile,
  });
  const res = await proc.exited;
  if (res.code !== 0) {
    throw new GeoError({
      code: 'GEO_CRASH',
      what: `Сборка клиента (vite build) завершилась с кодом ${res.code ?? -1}`,
      causeDetail:
        proc.getStderr().slice(-400) || proc.getStdout().slice(-400) || 'vite build failed',
      fix: 'Исправьте ошибки сборки выше или выполните `bun run build` для диагностики',
    });
  }
  const elapsedMs = Date.now() - t0;
  console.log(`Клиент собран за ${(elapsedMs / 1000).toFixed(1)} с.`);
  return elapsedMs;
}

export function openUrlInBrowser(url: string): boolean {
  const hasGui =
    process.platform === 'darwin' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!hasGui) {
    console.log('Графическая сессия не найдена: откройте ссылку хоста вручную.');
    return false;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  if (!Bun.which(opener)) {
    console.log(`Команда ${opener} не найдена: откройте ссылку хоста вручную.`);
    return false;
  }
  Bun.spawn([opener, url], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
  return true;
}

export async function waitPublicUrlReady(opts: {
  publicUrl: string;
  guestToken: string;
  isStopped: () => boolean;
  onStatus: (status: TunnelStatusView) => void;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<TunnelStatusView> {
  const guestUrl = `${opts.publicUrl}/#t=${opts.guestToken}`;
  opts.onStatus({
    mode: 'public_url',
    status: 'checking',
    inviteUrl: guestUrl,
    changedSinceStart: false,
  });
  const deadline = Date.now() + 60_000;
  let lastDetail = 'DNS не разрешает имя';
  while (!opts.isStopped() && Date.now() < deadline) {
    const probe = await probePublicReadiness(opts.publicUrl, opts.fetchImpl);
    if (opts.isStopped()) break;
    if (probe.ok) {
      const ready: TunnelStatusView = {
        mode: 'public_url',
        status: 'ready',
        inviteUrl: guestUrl,
        changedSinceStart: false,
      };
      opts.onStatus(ready);
      return ready;
    }
    lastDetail = probe.detail;
    await Bun.sleep(2_000);
  }
  const errView: TunnelStatusView = {
    mode: 'public_url',
    status: 'error',
    inviteUrl: guestUrl,
    errorReason: `Адрес ${opts.publicUrl} не ответил за 60 с (${lastDetail})`,
    changedSinceStart: false,
  };
  opts.onStatus(errView);
  return errView;
}

export function buildQuotaSummaryForState(quotaManager: QuotaManager, state?: RoomState) {
  const botMoveLimits = (state?.settings.bots ?? [])
    .filter((b) => b.enabled)
    .map((b) => b.moveLimit);
  return buildQuotaSummaryForRoom(quotaManager, {
    rounds: state?.settings.rounds,
    humanCount: state?.playerOrder.length,
    botMoveLimits,
  });
}

export function computeInitialTunnelView(
  opts: StartCliOptions,
  guestToken: string,
  port: number,
): TunnelStatusView {
  if (opts.noTunnel) {
    return {
      mode: 'local',
      status: 'local',
      inviteUrl: `http://localhost:${port}/#t=${guestToken}`,
      changedSinceStart: false,
    };
  }
  return {
    mode: opts.publicUrl ? 'public_url' : 'tunnel',
    status: 'checking',
    inviteUrl: opts.publicUrl ? `${opts.publicUrl}/#t=${guestToken}` : null,
    changedSinceStart: false,
  };
}

export function buildConfiguredShell(opts: {
  initialState: RoomState;
  paths: AppPaths;
  settingsOutcomeStatus: LoadOutcome<SettingsFile>['status'];
  quotaManager: QuotaManager;
  locationService: LocationService;
  imageService: ReturnType<typeof createBotImageService>;
  thumbStore: ThumbStore;
  logger: ServerLogger;
  getBotRunner: () => BotRunner | null;
  onStateChanged: () => void;
}): RoomShell {
  let shellRef: RoomShell | null = null;
  const history = loadWinsHistory(opts.paths.matchesFile, opts.logger);
  const initialState = { ...opts.initialState, winsWarning: history.warning };
  const shell = createRoomShell(initialState, {
    matchRecords: history.records,
    onStateChange: opts.onStateChanged,
    onAsyncError: (context, err) => {
      opts.logger.log('shell_async_error', {
        context,
        message: err instanceof Error ? err.message : String(err),
      });
    },
    saveSettings: createSettingsWriter(opts.paths.settingsFile, opts.settingsOutcomeStatus),
    saveSettingsForReset: (nextSettings) =>
      writeResetSettings(opts.paths.settingsFile, nextSettings, opts.settingsOutcomeStatus),
    confirmQuotaReset: () => {
      opts.quotaManager.confirmReset();
      return Promise.resolve(buildQuotaSummaryForState(opts.quotaManager, shellRef?.getState()));
    },
    recalculateQuotaSummary: (s) => buildQuotaSummaryForState(opts.quotaManager, s),
    prepareRound: async ({ region, excludeCountryIds, withBots }) => {
      const target = await opts.locationService.prepareRoundLocation({
        region,
        excludeCountryIds,
      });
      if (withBots) await opts.imageService.prepareStartViews(target);
      return target;
    },
    startBotProcesses: (arg) => {
      opts.getBotRunner()?.startRoundBots(arg);
    },
    releaseBotObserve: (matchId, gen, roundNumber) => {
      opts.getBotRunner()?.releaseObserve(matchId, gen, roundNumber);
    },
    stopBotProcess: (matchId, gen, botId, reason) => {
      opts.getBotRunner()?.stopBot(matchId, gen, botId, reason);
    },
    stopAllBots: (reason) => {
      void opts.getBotRunner()?.stopAll(reason);
    },
    clearRoundImages: () => {
      opts.imageService.clearRound();
    },
    clearThumbs: () => {
      opts.thumbStore.clear();
    },
    appendMatchRecord: (record) =>
      Promise.resolve().then(() => {
        appendMatchRecord(opts.paths.matchesFile, record);
      }),
    logRoundEnd: (info) => {
      opts.logger.log('round_end', info);
      const ans = info.answeredNames.length > 0 ? info.answeredNames.join(', ') : 'никто';
      const abortStr =
        info.abortedBots.length > 0
          ? ` | оборваны: ${info.abortedBots.map((b) => `${b.name} (${b.reason})`).join(', ')}`
          : '';
      console.log(
        `Раунд ${info.roundNumber}/${info.totalRounds} (${info.target.countryNameRu}): ответили ${ans}${abortStr}`,
      );
    },
  });
  shellRef = shell;
  return shell;
}

export function startTunnelPhase(opts: {
  hostUrl: string;
  cli: StartCliOptions;
  boundPort: number;
  guestToken: string;
  childrenFile: string;
  whichCf: () => string | null;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  isStopped: () => boolean;
  logger: ServerLogger;
  shell: RoomShell;
}): { tunnelMgr: TunnelManager | null; readyPromise: Promise<TunnelStatusView> } {
  if (opts.cli.noTunnel) {
    const tv = computeInitialTunnelView(opts.cli, opts.guestToken, opts.boundPort);
    opts.shell.dispatch({ type: 'tunnel_updated', tunnel: tv });
    return { tunnelMgr: null, readyPromise: Promise.resolve(tv) };
  }
  if (opts.cli.publicUrl) {
    return {
      tunnelMgr: null,
      readyPromise: waitPublicUrlReady({
        publicUrl: opts.cli.publicUrl,
        guestToken: opts.guestToken,
        isStopped: opts.isStopped,
        fetchImpl: opts.fetchImpl,
        onStatus: (tv) => {
          opts.logger.log('tunnel_event', { ...tv });
          opts.shell.dispatch({ type: 'tunnel_updated', tunnel: tv });
        },
      }),
    };
  }
  let tunnelMgr: TunnelManager | null = null;
  const readyPromise = new Promise<TunnelStatusView>((resolve) => {
    let resolved = false;
    let stopPoll: ReturnType<typeof setInterval> | null = null;
    const finish = (tv: TunnelStatusView): void => {
      if (resolved) return;
      resolved = true;
      if (stopPoll !== null) clearInterval(stopPoll);
      resolve(tv);
    };
    stopPoll = setInterval(() => {
      if (opts.isStopped()) {
        finish({ mode: 'tunnel', status: 'error', inviteUrl: null, changedSinceStart: false });
      }
    }, 100);
    tunnelMgr = createCloudflaredManager({
      localPort: opts.boundPort,
      guestToken: opts.guestToken,
      childrenFile: opts.childrenFile,
      whichCloudflared: opts.whichCf,
      fetchImpl: opts.fetchImpl,
      onStatus: (tv) => {
        opts.logger.log('tunnel_event', { ...tv });
        opts.shell.dispatch({ type: 'tunnel_updated', tunnel: tv });
        if (resolved && tv.status === 'ready' && tv.inviteUrl) {
          console.log(`\nНовый адрес приглашения: ${tv.inviteUrl}`);
          printRemoteOwnerInvite(tv.inviteUrl, opts.hostUrl);
        }
        if (tv.status === 'ready' || tv.status === 'error') {
          finish(tv);
        }
      },
    });
    tunnelMgr.start();
  });
  return { tunnelMgr, readyPromise };
}

/**
 * Installed right after the data-dir lock is taken, so Ctrl-C during the build or tunnel warmup
 * still stops detached children (cloudflared, vite) and releases the lock.
 */
export function registerSignalHandlers(opts: {
  install: boolean;
  stop: () => Promise<void>;
}): void {
  if (!opts.install) return;
  const onSig = (): void => {
    void opts.stop().finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);
}

export function registerCrashHandlers(opts: {
  install: boolean;
  simulateCrash: (err: unknown) => Promise<{ exitCode: 70; crashFile: string }>;
}): void {
  if (!opts.install) return;
  let crashing = false;
  const onCrash = (err: unknown): void => {
    if (crashing) return;
    crashing = true;
    void opts.simulateCrash(err).finally(() => {
      process.exit(70);
    });
  };
  process.once('uncaughtException', onCrash);
  process.once('unhandledRejection', onCrash);
}

async function ignoreFailure(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // Shutdown is best-effort per step; later steps (and the lock release) must still run.
  }
}

/**
 * Stop order: stop accepting commands first (HTTP/WS, shell), then kill bots and the tunnel, and
 * release the data-dir lock last, even when a step throws. Other managed children (vite) are
 * SIGKILLed by the process exit hook in proc/spawn.ts.
 */
export async function runShutdownSequence(opts: {
  pipeline: { httpServer: { stop: () => void }; shell: RoomShell; botRunner: BotRunner } | null;
  tunnel: TunnelManager | null;
  releaseLock: () => void;
}): Promise<void> {
  try {
    await ignoreFailure(() => opts.pipeline?.httpServer.stop());
    await ignoreFailure(() => opts.pipeline?.shell.dispose());
    await ignoreFailure(() => opts.pipeline?.botRunner.close());
    await ignoreFailure(() => opts.tunnel?.stop());
  } finally {
    opts.releaseLock();
  }
}

export function buildCrashHandler(opts: {
  stop: () => Promise<void>;
  logger: ServerLogger;
  hostToken: string;
  guestToken: string;
  onUnexpectedCrash?: (crashFile: string, err: unknown) => void;
}) {
  return async (err: unknown): Promise<{ exitCode: 70; crashFile: string }> => {
    let crashFile = '';
    try {
      crashFile = opts.logger.writeCrash(err);
    } catch {
      crashFile = '(write_failed)';
    }
    try {
      await Promise.race([opts.stop(), Bun.sleep(2000)]);
    } catch {
      // Best-effort cleanup during crash handling.
    }
    console.error(
      opts.logger.redact(
        `${formatCliError({
          command: 'start',
          code: 'GEO_CRASH',
          cause: err instanceof Error ? err.message : String(err),
          context: `crashFile=${crashFile}`,
          knownTokens: [opts.hostToken, opts.guestToken],
        })}\nФайл сбоя: ${crashFile}`,
      ),
    );
    opts.onUnexpectedCrash?.(crashFile, err);
    return { exitCode: 70, crashFile };
  };
}
