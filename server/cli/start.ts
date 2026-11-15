import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { TunnelStatusView } from '../../shared/protocol.ts';
import type { CommandProbe } from '../bots/adapters/types.ts';
import { detectAllHarnesses } from '../bots/adapters/index.ts';
import { FAKE_HARNESS_CATALOG } from '../dev/fake.ts';
import { createBotRunner, type BotRunner, type CustomBotLaunchBuilder } from '../bots/runner.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { type RoomShell } from '../engine/shell.ts';
import { GeoError } from '../errors.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createBotImageService } from '../images/bot-image-service.ts';
import { createFakeLocationService, createLocationService } from '../location.ts';
import { createServerLogger, type ServerLogger } from '../log.ts';
import { startAppHttpServer } from '../net/http.ts';
import { createAuthRateLimiter } from '../net/rate-limit.ts';
import { createWsRoomCoordinator } from '../net/ws.ts';
import { resolveAppPaths, type AppPaths } from '../paths.ts';
import { acquireDataDirLock } from '../proc/lock.ts';
import { cleanupOrphanedChildren } from '../proc/registry.ts';
import type { createQuotaManager } from '../storage/quota.ts';
import { createConfiguredQuotaManager, formatQuotaUsageLine } from './quota.ts';
import { type TunnelManager } from '../tunnel/cloudflared.ts';
import { exitWithGeoError } from './report-error.ts';
import {
  assertPortAvailable,
  parseStartArgs,
  resolveGoogleEnvKeys,
  type StartCliOptions,
} from './preflight.ts';
import {
  buildConfiguredShell,
  buildCrashHandler,
  buildInitialSettings,
  buildQuotaSummaryForState,
  collectHarnessVersionWarnings,
  computeInitialTunnelView,
  openUrlInBrowser,
  printStartupBanner,
  registerCrashHandlers,
  registerSignalHandlers,
  runShutdownSequence,
  runViteBuild,
  startTunnelPhase,
} from './start-runtime.ts';

export interface StartGeoServerDeps {
  skipClientBuild?: boolean;
  fakeStepDelayMs?: number;
  probe?: CommandProbe;
  whichCloudflared?: () => string | null;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  openBrowserFn?: (url: string) => void;
  buildClientFn?: () => Promise<number>;
  buildCustomLaunchSpec?: CustomBotLaunchBuilder;
  installProcessHandlers?: boolean;
  onUnexpectedCrash?: (crashFile: string, err: unknown) => void;
}

export interface RunningGeoServer {
  port: number;
  baseUrl: string;
  hostToken: string;
  guestToken: string;
  hostUrl: string;
  inviteUrl: string | null;
  shell: RoomShell;
  stop: () => Promise<void>;
  simulateCrash: (err: unknown) => Promise<{ exitCode: 70; crashFile: string }>;
}

interface PipelineBuildOpts {
  cli: StartCliOptions;
  deps: StartGeoServerDeps;
  paths: AppPaths;
  browserKey: string | null;
  serverKey: string | null;
  whichCf: () => string | null;
  hostToken: string;
  guestToken: string;
  logger: ServerLogger;
}

function createNetTransport(opts: {
  cli: StartCliOptions;
  shell: ReturnType<typeof buildConfiguredShell>;
  thumbStore: ReturnType<typeof createThumbStore>;
  botRunner: BotRunner;
  quotaManager: ReturnType<typeof createQuotaManager>;
  optsInput: PipelineBuildOpts;
}) {
  const rateLimiter = createAuthRateLimiter(
    opts.cli.noTunnel ? 'local' : opts.cli.publicUrl ? 'public_url' : 'tunnel',
  );
  const wsCoordinator = createWsRoomCoordinator({
    shell: opts.shell,
    hostToken: opts.optsInput.hostToken,
    guestToken: opts.optsInput.guestToken,
    browserMapsKey: opts.optsInput.browserKey,
    fakeMode: opts.cli.fake,
    quotaManager: opts.quotaManager,
    rateLimiter,
    botRunner: opts.botRunner,
  });
  const httpServer = startAppHttpServer({
    port: opts.cli.port,
    staticDir: path.resolve(import.meta.dir, '../../web/dist'),
    shell: opts.shell,
    thumbStore: opts.thumbStore,
    wsCoordinator,
    rateLimiter,
  });
  return { wsCoordinator, httpServer };
}

function createServerPipeline(opts: PipelineBuildOpts) {
  const { cli, deps, paths, serverKey, guestToken, logger } = opts;
  const availableHarnesses = collectHarnessVersionWarnings(
    cli.fake ? FAKE_HARNESS_CATALOG : detectAllHarnesses(deps.probe),
    paths.harnessVerifiedFile,
    cli.fake,
  );
  const { settings, settingsOutcomeStatus, settingsNotice } = buildInitialSettings({
    settingsFile: paths.settingsFile,
    cli,
    availableHarnesses,
    fakeMode: cli.fake,
  });
  const quotaManager = createConfiguredQuotaManager(paths, settings);
  const thumbStore = createThumbStore();
  const locationService = cli.fake
    ? createFakeLocationService()
    : createLocationService({ serverKey: serverKey ?? '' });
  const imageService = createBotImageService({
    serverKey: serverKey ?? '',
    fakeMode: cli.fake,
    quotaManager,
    thumbStore,
    fetchImpl: deps.fetchImpl,
  });
  const initialState = createInitialRoomState({
    matchId: randomBytes(6).toString('hex'),
    fakeMode: cli.fake,
    settings,
    settingsNotice,
    quotaWarning: quotaManager.needsResetConfirm()
      ? 'Расход за месяц неизвестен: файл квоты повреждён. Сверьте расход в Cloud Console'
      : undefined,
    quotaSummary: buildQuotaSummaryForState(quotaManager),
    tunnel: computeInitialTunnelView(cli, guestToken, cli.port),
    availableHarnesses,
  });
  let wsCoordRef: ReturnType<typeof createWsRoomCoordinator> | null = null;
  let botRunnerRef: BotRunner | null = null;
  const shell = buildConfiguredShell({
    initialState,
    paths,
    settingsOutcomeStatus,
    quotaManager,
    locationService,
    imageService,
    thumbStore,
    logger,
    getBotRunner: () => botRunnerRef,
    onStateChanged: () => wsCoordRef?.broadcastState(),
  });
  botRunnerRef = createBotRunner({
    runDir: paths.runDir,
    childrenFile: paths.childrenFile,
    fakeMode: cli.fake,
    fakeStepDelayMs: deps.fakeStepDelayMs,
    imageService,
    locationService,
    dispatch: (ev) => shell.dispatch(ev),
    logger,
    buildCustomLaunchSpec: deps.buildCustomLaunchSpec,
  });
  const net = createNetTransport({
    cli,
    shell,
    thumbStore,
    botRunner: botRunnerRef,
    quotaManager,
    optsInput: opts,
  });
  wsCoordRef = net.wsCoordinator;
  return {
    availableHarnesses,
    quotaManager,
    shell,
    botRunner: botRunnerRef,
    httpServer: net.httpServer,
  };
}

async function runStartupAwaiters(opts: {
  cli: StartCliOptions;
  deps: StartGeoServerDeps;
  pipeline: ReturnType<typeof createServerPipeline>;
  paths: AppPaths;
  whichCf: () => string | null;
  hostToken: string;
  guestToken: string;
  hostUrl: string;
  logger: ServerLogger;
  tStart: number;
  isStopped: () => boolean;
  setTunnelMgr: (m: TunnelManager | null) => void;
}): Promise<TunnelStatusView> {
  const boundPort = opts.pipeline.httpServer.port;
  const buildPromise = opts.deps.skipClientBuild
    ? Promise.resolve(0)
    : opts.deps.buildClientFn
      ? opts.deps.buildClientFn()
      : runViteBuild(opts.paths.childrenFile);
  const tunnelPhase = startTunnelPhase({
    cli: opts.cli,
    boundPort,
    guestToken: opts.guestToken,
    childrenFile: opts.paths.childrenFile,
    whichCf: opts.whichCf,
    fetchImpl: opts.deps.fetchImpl,
    isStopped: opts.isStopped,
    logger: opts.logger,
    shell: opts.pipeline.shell,
  });
  opts.setTunnelMgr(tunnelPhase.tunnelMgr);
  const [, resolvedTunnel] = await Promise.all([buildPromise, tunnelPhase.readyPromise]);
  const quotaSummary = buildQuotaSummaryForState(opts.pipeline.quotaManager);
  printStartupBanner({
    hostUrl: opts.hostUrl,
    tunnel: resolvedTunnel,
    elapsedMs: Date.now() - opts.tStart,
    quotaLine: formatQuotaUsageLine(quotaSummary),
    harnesses: opts.pipeline.availableHarnesses,
    fakeMode: opts.cli.fake,
  });
  if (!opts.cli.noOpen) {
    if (opts.deps.openBrowserFn) opts.deps.openBrowserFn(opts.hostUrl);
    else openUrlInBrowser(opts.hostUrl);
  }
  return resolvedTunnel;
}

function finalizeServerHandle(opts: {
  pipeline: ReturnType<typeof createServerPipeline>;
  hostToken: string;
  guestToken: string;
  hostUrl: string;
  inviteUrl: string | null;
  logger: ServerLogger;
  dataLock: ReturnType<typeof acquireDataDirLock>;
  tunnelRef: { mgr: TunnelManager | null };
  stop: () => Promise<void>;
  deps: StartGeoServerDeps;
}): RunningGeoServer {
  const stop = opts.stop;
  const simulateCrash = buildCrashHandler({
    stop,
    logger: opts.logger,
    hostToken: opts.hostToken,
    guestToken: opts.guestToken,
    onUnexpectedCrash: opts.deps.onUnexpectedCrash,
  });
  registerCrashHandlers({ install: Boolean(opts.deps.installProcessHandlers), simulateCrash });
  return {
    port: opts.pipeline.httpServer.port,
    baseUrl: opts.pipeline.httpServer.baseUrl,
    hostToken: opts.hostToken,
    guestToken: opts.guestToken,
    hostUrl: opts.hostUrl,
    inviteUrl: opts.inviteUrl,
    shell: opts.pipeline.shell,
    stop,
    simulateCrash,
  };
}

async function initializeAndLaunchServer(opts: {
  cli: StartCliOptions;
  deps: StartGeoServerDeps;
  paths: ReturnType<typeof resolveAppPaths>;
  browserKey: string | null;
  serverKey: string | null;
  whichCf: () => string | null;
  tStart: number;
  dataLock: ReturnType<typeof acquireDataDirLock>;
  tunnelRef: { mgr: TunnelManager | null };
  setPipeline: (p: ReturnType<typeof createServerPipeline>) => void;
  stop: () => Promise<void>;
  isStopped: () => boolean;
}): Promise<RunningGeoServer> {
  await cleanupOrphanedChildren(opts.paths.childrenFile);
  const hostToken = randomBytes(16).toString('hex');
  const guestToken = randomBytes(16).toString('hex');
  const logger = createServerLogger(opts.paths.logsDir);
  logger.pruneOld();
  logger.registerSecrets([opts.browserKey ?? '', opts.serverKey ?? ''], [hostToken, guestToken]);
  logger.log('server_start', {
    fake: opts.cli.fake,
    port: opts.cli.port,
    noTunnel: opts.cli.noTunnel,
    publicUrl: opts.cli.publicUrl,
  });

  const pipeline = createServerPipeline({
    cli: opts.cli,
    deps: opts.deps,
    paths: opts.paths,
    browserKey: opts.browserKey,
    serverKey: opts.serverKey,
    whichCf: opts.whichCf,
    hostToken,
    guestToken,
    logger,
  });
  opts.setPipeline(pipeline);
  const hostUrl = `http://localhost:${pipeline.httpServer.port}/#t=${hostToken}`;
  const resolvedTunnel = await runStartupAwaiters({
    cli: opts.cli,
    deps: opts.deps,
    pipeline,
    paths: opts.paths,
    whichCf: opts.whichCf,
    hostToken,
    guestToken,
    hostUrl,
    logger,
    tStart: opts.tStart,
    isStopped: opts.isStopped,
    setTunnelMgr: (m) => {
      opts.tunnelRef.mgr = m;
    },
  });
  return finalizeServerHandle({
    pipeline,
    hostToken,
    guestToken,
    hostUrl,
    inviteUrl: resolvedTunnel.inviteUrl,
    logger,
    dataLock: opts.dataLock,
    tunnelRef: opts.tunnelRef,
    stop: opts.stop,
    deps: opts.deps,
  });
}

export async function startGeoServer(
  cli: StartCliOptions,
  deps: StartGeoServerDeps = {},
): Promise<RunningGeoServer> {
  const tStart = Date.now();
  const env = process.env;
  const { browserKey, serverKey } = resolveGoogleEnvKeys(cli.fake, env);
  const whichCf = deps.whichCloudflared ?? (() => Bun.which('cloudflared'));
  if (!cli.fake && !cli.noTunnel && !cli.publicUrl && !whichCf()) {
    throw new GeoError({
      code: 'GEO_CLOUDFLARED_MISSING',
      causeDetail: 'cloudflared не найден в PATH',
    });
  }
  await assertPortAvailable(cli.port);

  const paths = resolveAppPaths(env);
  const dataLock = acquireDataDirLock(paths.lockFile);
  const pipelineRef: { current: ReturnType<typeof createServerPipeline> | null } = {
    current: null,
  };
  const tunnelRef: { mgr: TunnelManager | null } = { mgr: null };
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    stopped = true;
    stopPromise ??= runShutdownSequence({
      pipeline: pipelineRef.current,
      tunnel: tunnelRef.mgr,
      releaseLock: () => {
        dataLock.release();
      },
    });
    return stopPromise;
  };
  registerSignalHandlers({ install: Boolean(deps.installProcessHandlers), stop: shutdown });

  try {
    return await initializeAndLaunchServer({
      cli,
      deps,
      paths,
      browserKey,
      serverKey,
      whichCf,
      tStart,
      dataLock,
      tunnelRef,
      setPipeline: (p) => {
        pipelineRef.current = p;
      },
      stop: shutdown,
      isStopped: () => stopped,
    });
  } catch (err) {
    await shutdown();
    throw err;
  }
}

async function main(): Promise<void> {
  let cli: StartCliOptions;
  try {
    cli = parseStartArgs(Bun.argv.slice(2), process.env);
  } catch (err) {
    exitWithGeoError('start', err);
  }
  try {
    await startGeoServer(cli, { installProcessHandlers: true });
  } catch (err) {
    if (err instanceof GeoError) exitWithGeoError('start', err);
    const paths = resolveAppPaths(process.env);
    const crashFile = createServerLogger(paths.logsDir).writeCrash(err);
    console.error(
      `start: непредвиденный сбой (${crashFile})\n  исправить: запустите \`bun run start\` снова`,
    );
    process.exit(70);
  }
}

if (import.meta.main) await main();
