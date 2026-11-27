// Value: protects=bot results thumbs include fullUrl and HTTP serves full image; fails_when=makeThumb drops fullUrl or thumbStore lacks fullId; why_new=thumbUrl was verified but fullUrl remained unasserted; seam=none; no_claim=none beyond protects
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { expect, spyOn, test } from 'bun:test';
import { ROUND_INTRO_MS, type ClientViewState, type ServerMessage } from '../shared/protocol.ts';
import { createDefaultSettings } from '../shared/storage-schemas.ts';
import { parseStartArgs } from '../server/cli/preflight.ts';
import { startGeoServer } from '../server/cli/start.ts';
import { createBotRunner } from '../server/bots/runner.ts';
import { createFakeLocationService } from '../server/location.ts';
import { createBotImageService } from '../server/images/bot-image-service.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import { createQuotaManager } from '../server/storage/quota.ts';
import { saveSettings as realSaveSettings } from '../server/storage/settings.ts';
import {
  connectBridgeMcp,
  runFakeHarnessScenario,
  type FakeHarnessScenario,
} from './fake-harness.ts';
import type { EngineEvent } from '../server/engine/types.ts';

function assertIsolatedTestEnv(configDir: string, dataDir: string): void {
  const realCfg = path.resolve(homedir(), '.config', 'geoaissr');
  const realData = path.resolve(homedir(), '.local', 'share', 'geoaissr');
  if (path.resolve(configDir) === realCfg || path.resolve(dataDir) === realData) {
    throw new Error('Test harness MUST NOT target owner real config/data directories');
  }
}

interface WsHarnessClient {
  ws: WebSocket;
  msgs: ServerMessage[];
  waitFor: (pred: (m: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
  latestView: () => ClientViewState | null;
  close: () => void;
}

async function openWsClient(wsUrl: string): Promise<WsHarnessClient> {
  const msgs: ServerMessage[] = [];
  let lastView: ClientViewState | null = null;
  const waiters: Array<(m: ServerMessage) => void> = [];
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('message', (ev) => {
    const parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMessage;
    msgs.push(parsed);
    if (parsed.type === 'state') lastView = parsed.view;
    for (let i = waiters.length - 1; i >= 0; i -= 1) waiters[i]?.(parsed);
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      () => {
        reject(new Error('WS open failed'));
      },
      { once: true },
    );
  });
  const waitFor = (
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 8_000,
  ): Promise<ServerMessage> => {
    const existing = msgs.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for WS message (${msgs.length} received)`));
      }, timeoutMs);
      const listener = (m: ServerMessage): void => {
        if (!pred(m)) return;
        clearTimeout(timer);
        const idx = waiters.indexOf(listener);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve(m);
      };
      waiters.push(listener);
    });
  };
  return {
    ws,
    msgs,
    waitFor,
    latestView: () => lastView,
    close: () => {
      ws.close();
    },
  };
}

async function assertMcpScenarioOutcome(opts: {
  sc: FakeHarnessScenario;
  exitCode: number;
  events: EngineEvent[];
  capturedApi: string;
  capturedToken: string;
  subDir: string;
}): Promise<void> {
  if (opts.sc === 'exit_before_guess') {
    expect(opts.exitCode).toBe(1);
    expect(opts.events.some((e) => e.type === 'bot_guess_recorded')).toBe(false);
  } else if (opts.sc === 'exit_after_guess') {
    expect(opts.exitCode).toBe(1);
    expect(opts.events.some((e) => e.type === 'bot_guess_recorded')).toBe(true);
  } else {
    expect(opts.exitCode).toBe(0);
    const guessEv = opts.events.find(
      (e): e is Extract<EngineEvent, { type: 'bot_guess_recorded' }> =>
        e.type === 'bot_guess_recorded',
    );
    expect(guessEv).toBeDefined();
    if (opts.sc === 'invalid_args' && guessEv) {
      expect(guessEv.guess.explanation.length).toBeLessThanOrEqual(600);
      expect((guessEv.guess.quip ?? '').length).toBeLessThanOrEqual(120);
    }
  }
  const conn = await connectBridgeMcp({
    apiUrl: opts.capturedApi,
    botToken: opts.capturedToken,
    workDir: opts.subDir,
  });
  expect((await conn.callTool('observe', {})).isError).toBe(true);
  await conn.close().catch(() => undefined);
}

async function verifySingleMcpScenario(root: string, sc: FakeHarnessScenario): Promise<void> {
  const subDir = path.join(root, sc);
  const events: EngineEvent[] = [];
  const thumbStore = createThumbStore();
  const qm = createQuotaManager(path.join(subDir, 'quota.json'));
  const loc = createFakeLocationService();
  const img = createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: qm,
    thumbStore,
  });
  let capturedToken = '';
  let capturedApi = '';
  const runner = createBotRunner({
    runDir: path.join(subDir, 'run'),
    childrenFile: path.join(subDir, 'run', 'children.json'),
    fakeMode: false,
    imageService: img,
    locationService: loc,
    dispatch: (e) => events.push(e),
    buildCustomLaunchSpec: ({ apiUrl, botToken }) => {
      capturedApi = apiUrl;
      capturedToken = botToken;
      return {
        cmd: [process.execPath || 'bun', '-e', 'await new Promise((r) => setTimeout(r, 30000));'],
        cwd: subDir,
      };
    },
  });
  const target = await loc.prepareRoundLocation({
    map: 'standard',
    region: 'europe',
    excludeCountryIds: [],
  });
  await img.prepareStartViews(target);
  runner.startRoundBots({
    matchId: 'm1',
    gen: 1,
    roundNumber: 1,
    target,
    moveEnabled: true,
    bots: [
      {
        id: 'slot-1',
        name: 'ТестБот',
        color: 'p-4',
        harness: 'claude',
        model: 'haiku',
        effort: 'low',
        moveLimit: sc === 'parallel_calls' ? 1 : 4,
        imageSize: 400,
        budgetSec: 90,
        personalityPreset: 'neutral',
        personalityText: '',
        difficultyPreset: 'amateur',
        enabled: true,
      },
    ],
  });
  runner.releaseObserve('m1', 1, 1);

  const exitCode = await runFakeHarnessScenario({
    scenario: sc,
    apiUrl: capturedApi,
    botToken: capturedToken,
    workDir: subDir,
  });
  await runner.stopAll('scenario_done');
  await runner.close();

  await assertMcpScenarioOutcome({ sc, exitCode, events, capturedApi, capturedToken, subDir });
}

async function submitHumanRoundGuesses(
  host: WsHarnessClient,
  guest: WsHarnessClient,
  round: number,
  baseSeq: number,
): Promise<void> {
  host.ws.send(
    JSON.stringify({
      type: 'set_pin',
      seq: baseSeq + 20,
      roundNumber: round,
      lat: 55.7,
      lng: 37.6,
    }),
  );
  host.ws.send(
    JSON.stringify({
      type: 'submit_guess',
      seq: baseSeq + 30,
      roundNumber: round,
      lat: 55.75,
      lng: 37.61,
    }),
  );
  guest.ws.send(
    JSON.stringify({
      type: 'submit_guess',
      seq: baseSeq + 30,
      roundNumber: round,
      lat: 48.85,
      lng: 2.35,
    }),
  );
  host.ws.send(
    JSON.stringify({ type: 'submit_guess', seq: baseSeq + 40, roundNumber: round, lat: 0, lng: 0 }),
  );
  await host.waitFor(
    (m) => m.type === 'ack' && m.seq === baseSeq + 40 && m.result === 'already_confirmed',
  );
}

async function driveMatchRound(
  host: WsHarnessClient,
  guest: WsHarnessClient,
  baseUrl: string,
  round: number,
  advanceClock: (elapsedMs: number) => void,
): Promise<string> {
  const baseSeq = round * 100;
  await host.waitFor(
    (m) => m.type === 'state' && m.view.phase === 'ROUND_LOADING' && m.view.roundNumber === round,
  );
  // Elapse the intro before signaling readiness. The server still runs its real countdown timer.
  advanceClock(ROUND_INTRO_MS);
  host.ws.send(
    JSON.stringify({
      type: 'pano_loaded',
      seq: baseSeq + 10,
      roundNumber: round,
      countedLoad: true,
    }),
  );
  guest.ws.send(
    JSON.stringify({
      type: 'pano_loaded',
      seq: baseSeq + 10,
      roundNumber: round,
      countedLoad: true,
    }),
  );
  await host.waitFor(
    (m) => m.type === 'state' && m.view.phase === 'ROUND_ACTIVE' && m.view.roundNumber === round,
  );

  const activeView = host.latestView();
  expect(activeView?.results).toBeUndefined();
  expect(activeView?.active?.panoId).toBeTruthy();

  await submitHumanRoundGuesses(host, guest, round, baseSeq);

  const resMsg = await host.waitFor(
    (m) => m.type === 'state' && m.view.phase === 'ROUND_RESULTS' && m.view.roundNumber === round,
  );
  let thumbUrl = '';
  let fullUrl = '';
  if (resMsg.type === 'state') {
    const aiEntry = resMsg.view.results?.entries.find((e) => e.isAi);
    expect(aiEntry?.explanation).toBeTruthy();
    expect(aiEntry?.quip).toBeTruthy();
    thumbUrl = aiEntry?.thumbs[0]?.thumbUrl ?? '';
    fullUrl = aiEntry?.thumbs[0]?.fullUrl ?? '';
    expect(fullUrl).toBeTruthy();
    expect(fullUrl).toMatch(/^\/thumb\/[0-9a-f]{32}$/);
  }
  if (thumbUrl) {
    const thumbRes = await fetch(`${baseUrl}${thumbUrl}`);
    expect(thumbRes.status).toBe(200);
  }
  if (fullUrl) {
    const fullRes = await fetch(`${baseUrl}${fullUrl}`);
    expect(fullRes.status).toBe(200);
  }
  host.ws.send(
    JSON.stringify({ type: 'next_round', seq: baseSeq + 50, roundNumber: round, force: true }),
  );
  return thumbUrl;
}

test('test harness guard rejects real owner directories', () => {
  expect(() => {
    assertIsolatedTestEnv(path.join(homedir(), '.config', 'geoaissr'), '/tmp/a');
  }).toThrow();
  expect(existsSync('/home')).toBe(true);
});

test('fake-harness MCP bridge handles all 5 completion scenarios and rejects expired token', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-mcp-scenarios-'));
  try {
    for (const sc of [
      'normal',
      'exit_before_guess',
      'exit_after_guess',
      'invalid_args',
      'parallel_calls',
    ] as FakeHarnessScenario[]) {
      await verifySingleMcpScenario(root, sc);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

test('hanging fake-harness process is terminated cleanly by runner stopAll / crash handler', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-mcp-hang-'));
  try {
    const thumbStore = createThumbStore();
    const qm = createQuotaManager(path.join(root, 'quota.json'));
    const loc = createFakeLocationService();
    const img = createBotImageService({
      serverKey: '',
      fakeMode: true,
      quotaManager: qm,
      thumbStore,
    });
    const events: EngineEvent[] = [];
    const runner = createBotRunner({
      runDir: path.join(root, 'run'),
      childrenFile: path.join(root, 'run', 'children.json'),
      fakeMode: false,
      imageService: img,
      locationService: loc,
      dispatch: (e) => {
        events.push(e);
      },
      buildCustomLaunchSpec: ({ workDir }) => ({
        cmd: [
          process.execPath || 'bun',
          'run',
          path.resolve('test/fake-harness.ts'),
          '--scenario',
          'hanging',
        ],
        cwd: workDir,
      }),
    });
    const target = await loc.prepareRoundLocation({
      map: 'standard',
      region: 'europe',
      excludeCountryIds: [],
    });
    await img.prepareStartViews(target);
    runner.startRoundBots({
      matchId: 'm-hang',
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: true,
      bots: [
        {
          id: 'hang-1',
          name: 'Зависший',
          color: 'p-4',
          harness: 'claude',
          model: 'haiku',
          effort: 'low',
          moveLimit: 2,
          imageSize: 400,
          budgetSec: 60,
          personalityPreset: 'neutral',
          personalityText: '',
          difficultyPreset: 'amateur',
          enabled: true,
        },
      ],
    });
    runner.releaseObserve('m-hang', 1, 1);
    await Bun.sleep(400);
    await runner.stopAll('deadline_reached');
    await Bun.sleep(650);
    await runner.close();
    const regRaw = existsSync(path.join(root, 'run', 'children.json'))
      ? readFileSync(path.join(root, 'run', 'children.json'), 'utf8')
      : '{"children":[]}';
    expect((JSON.parse(regRaw) as { children: unknown[] }).children.length).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

function seedTwoRoundBotSettings(configDir: string): void {
  const settings = createDefaultSettings();
  settings.rounds = 2;
  settings.roundDurationSec = 60;
  settings.aiWaitWindowSec = 5;
  settings.bots = [
    {
      id: 'b1',
      name: 'Клод',
      color: 'p-4',
      harness: 'claude',
      model: 'haiku',
      effort: 'low',
      moveLimit: 2,
      imageSize: 400,
      budgetSec: 60,
      personalityPreset: 'braggart',
      personalityText: '',
      difficultyPreset: 'amateur',
      enabled: true,
    },
  ];
  realSaveSettings(path.join(configDir, 'settings.json'), settings);
}

test('full 2-round fake match via WebSocket writes redacted logs, serves/clears thumbs, and supports play_again', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-e2e-ws-'));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  assertIsolatedTestEnv(configDir, dataDir);
  const prevCfg = process.env.GEOAISSR_CONFIG_DIR;
  const prevData = process.env.GEOAISSR_DATA_DIR;
  process.env.GEOAISSR_CONFIG_DIR = configDir;
  process.env.GEOAISSR_DATA_DIR = dataDir;
  seedTwoRoundBotSettings(configDir);

  const srv = await startGeoServer(
    { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 },
    {
      skipClientBuild: true,
      fakeStepDelayMs: 30,
      // Short countdown: the match still runs the real timers, only the three seconds shrink.
      timing: { roundIntroMs: ROUND_INTRO_MS, countdownMs: 200 },
    },
  );
  const wsUrl = srv.baseUrl.replace('http://', 'ws://') + '/ws';
  const host = await openWsClient(wsUrl);
  const guest = await openWsClient(wsUrl);
  const realNow = Date.now.bind(Date);
  let elapsedIntroMs = 0;
  const clock = spyOn(Date, 'now').mockImplementation(() => realNow() + elapsedIntroMs);
  const advanceClock = (elapsedMs: number): void => {
    elapsedIntroMs += elapsedMs;
  };

  try {
    host.ws.send(JSON.stringify({ type: 'hello', token: srv.hostToken }));
    guest.ws.send(JSON.stringify({ type: 'hello', token: srv.guestToken }));
    await host.waitFor((m) => m.type === 'hello_ok');
    await guest.waitFor((m) => m.type === 'hello_ok');
    host.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Хост', color: 'p-1' }));
    guest.ws.send(JSON.stringify({ type: 'join', seq: 1, nick: 'Гость', color: 'p-2' }));
    await host.waitFor((m) => m.type === 'join_ok');
    await guest.waitFor((m) => m.type === 'join_ok');
    host.ws.send(JSON.stringify({ type: 'start_match', seq: 2 }));

    let savedThumbUrl = '';
    for (let r = 1; r <= 2; r += 1) {
      savedThumbUrl =
        (await driveMatchRound(host, guest, srv.baseUrl, r, advanceClock)) || savedThumbUrl;
    }

    const finalMsg = await host.waitFor((m) => m.type === 'state' && m.view.phase === 'FINAL');
    if (finalMsg.type === 'state') expect(finalMsg.view.final?.playedRounds).toBe(2);

    // The guest has not pressed «Готов»: the host goes back without them.
    host.ws.send(JSON.stringify({ type: 'play_again', seq: 999, force: true }));
    await host.waitFor((m) => m.type === 'state' && m.view.phase === 'LOBBY');
    if (savedThumbUrl) expect((await fetch(`${srv.baseUrl}${savedThumbUrl}`)).status).toBe(404);

    const logFiles = readdirSync(path.join(dataDir, 'logs')).filter((f) => f.endsWith('.jsonl'));
    expect(logFiles.length).toBeGreaterThan(0);
    const firstLog = logFiles[0];
    if (firstLog) {
      const logText = readFileSync(path.join(dataDir, 'logs', firstLog), 'utf8');
      expect(logText).toContain('harness_start');
      expect(logText).toContain('harness_end');
      expect(logText).not.toContain(srv.hostToken);
      expect(logText).not.toContain(srv.guestToken);
    }
  } finally {
    clock.mockRestore();
    host.close();
    guest.close();
    await srv.stop();
    if (prevCfg === undefined) delete process.env.GEOAISSR_CONFIG_DIR;
    else process.env.GEOAISSR_CONFIG_DIR = prevCfg;
    if (prevData === undefined) delete process.env.GEOAISSR_DATA_DIR;
    else process.env.GEOAISSR_DATA_DIR = prevData;
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
