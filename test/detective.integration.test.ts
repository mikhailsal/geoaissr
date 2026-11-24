// Value: protects=the Detective play style end to end: two roles behind the MCP bridge and the HTTP tool API, the fake pair, the two-process monitor and its accounting; fails_when=a role reaches the other role's tools, the journal loses the report or an exchange, tokens of one process are dropped or a failed role leaves the bot hanging; why_new=session tests call the handlers directly; seam=none; no_claim=how a real model follows the prompts.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import type { JournalStep } from '../shared/bot-journal.ts';
import type { BotCostEstimate, BotTokenUsage } from '../shared/bot-results.ts';
import type { BotSlotConfig } from '../shared/storage-schemas.ts';
import { createBotImageService } from '../server/images/bot-image-service.ts';
import { createBotRunner, type CustomBotLaunchBuilder } from '../server/bots/runner.ts';
import {
  addFindingToJournal,
  addThumbToJournal,
  patchJournalStep,
} from '../server/engine/journal.ts';
import type { EngineEvent } from '../server/engine/types.ts';
import type { LogEventType, ServerLogger } from '../server/log.ts';
import { createThumbStore } from '../server/http/thumbs.ts';
import { createFakeLocationService } from '../server/location.ts';
import { createQuotaManager } from '../server/storage/quota.ts';
import { connectBridgeMcp, type McpToolCallResult } from './fake-harness.ts';

const SLOT: BotSlotConfig = {
  id: 'slot-d',
  name: 'Сыщик',
  color: 'p-4',
  harness: 'claude',
  model: 'claude-haiku-5-5',
  effort: 'low',
  moveLimit: 4,
  imageSize: 400,
  budgetSec: 120,
  playStyle: 'detective',
  personalityPreset: 'neutral',
  personalityText: '',
  difficultyPreset: 'amateur',
  enabled: true,
};

type Finished = Extract<EngineEvent, { type: 'bot_finished' }>;

function textOf(res: McpToolCallResult): string {
  return res.content.map((c) => c.text ?? '').join('\n');
}

/** Folds the engine events the runner dispatched into journal steps, as the reducer does. */
function foldJournal(events: readonly EngineEvent[]): JournalStep[] {
  let steps: JournalStep[] = [];
  for (const e of events) {
    if (e.type === 'bot_thumb_added') steps = addThumbToJournal(steps, e.thumb, 0);
    if (e.type === 'bot_step_patched') steps = patchJournalStep(steps, e.turn, e.patch, 0);
    if (e.type === 'bot_finding') steps = addFindingToJournal(steps, e);
  }
  return steps;
}

async function waitFinished(events: readonly EngineEvent[]): Promise<Finished> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = events.find((e): e is Finished => e.type === 'bot_finished');
    if (found) return found;
    await Bun.sleep(10);
  }
  throw new Error(`the bot did not finish; saw ${events.map((e) => e.type).join(', ')}`);
}

/** The work directory is removed once the bot is done: wait for that instead of a fixed pause. */
async function waitGone(target: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (existsSync(target) && Date.now() < deadline) await Bun.sleep(10);
  return !existsSync(target);
}

interface LoggedEvent {
  event: LogEventType;
  data: Record<string, unknown>;
}

/** A logger that keeps what the runner writes; redaction is the identity. */
function recordingLogger(): { logger: ServerLogger; logged: LoggedEvent[] } {
  const logged: LoggedEvent[] = [];
  const logger: ServerLogger = {
    log: (event, data) => void logged.push({ event, data }),
    writeCrash: () => '',
    pruneOld: () => 0,
    registerSecrets: () => undefined,
    redact: (text) => text,
    getLogsDir: () => '',
  };
  return { logger, logged };
}

interface Round {
  dir: string;
  events: EngineEvent[];
  /** Token of each role, as the launch spec builder received it. */
  tokens: { brain: string; eyes: string };
  apiUrl: () => string;
}

/** Starts one Detective bot for one round and hands the round to `play`. */
async function withDetective(
  opts: {
    fakeMode: boolean;
    moveEnabled?: boolean;
    launch?: CustomBotLaunchBuilder;
    slot?: Partial<BotSlotConfig>;
    estimateCost?: (model: string, usage: BotTokenUsage) => Promise<BotCostEstimate>;
    logger?: ServerLogger;
  },
  play: (round: Round) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-detective-int-'));
  const events: EngineEvent[] = [];
  const tokens = { brain: '', eyes: '' };
  const loc = createFakeLocationService();
  const images = createBotImageService({
    serverKey: '',
    fakeMode: true,
    quotaManager: createQuotaManager(path.join(dir, 'quota.json')),
    thumbStore: createThumbStore(),
  });
  const { launch } = opts;
  const runner = createBotRunner({
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'run', 'children.json'),
    fakeMode: opts.fakeMode,
    fakeStepDelayMs: 5,
    imageService: images,
    locationService: loc,
    dispatch: (e) => events.push(e),
    ...(opts.estimateCost ? { estimateCost: opts.estimateCost } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(launch
      ? {
          buildCustomLaunchSpec: (params) => {
            if (params.role) tokens[params.role] = params.botToken;
            return launch(params);
          },
        }
      : {}),
  });
  try {
    const target = await loc.prepareRoundLocation({ region: 'europe', excludeCountryIds: [] });
    await images.prepareStartViews(target);
    runner.startRoundBots({
      matchId: 'm-d',
      gen: 1,
      roundNumber: 1,
      target,
      moveEnabled: opts.moveEnabled ?? true,
      bots: [{ ...SLOT, ...opts.slot }],
    });
    runner.releaseObserve('m-d', 1, 1);
    await play({ dir, events, tokens, apiUrl: () => runner.getApiBaseUrl() });
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the fake pair plays a whole round through the real session', async () => {
  await withDetective({ fakeMode: true }, async ({ dir, events }) => {
    const finished = await waitFinished(events);
    expect(finished).toMatchObject({ aborted: false, reason: 'завершил ход' });
    const steps = foldJournal(events);
    expect(steps.map((s) => [s.index, s.kind, s.findingState])).toEqual([
      [0, 'observe', 'recorded'],
      [1, 'ask', 'recorded'],
      [2, 'ask', 'recorded'],
      [3, 'ask', 'recorded'],
    ]);
    // Step 0: four start frames, one zoom before the report, and the report itself.
    expect(steps[0]?.frames.map((f) => f.n)).toEqual([1, 2, 3, 4, 5]);
    expect(steps[0]?.report?.[0]).toEqual({
      section: 'texts',
      text: '«MAGAZIN 24» — вывеска над входом в одноэтажное здание',
      frame: 2,
    });
    expect(steps[1]?.requests?.map((r) => [r.kind, r.status])).toEqual([
      ['describe', 'answered'],
      ['text', 'answered'],
    ]);
    // Step 2: the drive brought a frame taken away from the start; one text stayed unreadable.
    expect(steps[2]?.requests?.map((r) => [r.kind, r.status])).toEqual([
      ['drive', 'answered'],
      ['text', 'abstained'],
    ]);
    expect(steps[2]?.frames.map((f) => [f.n, f.action, f.params?.fromStartM])).toEqual([
      [6, 'move', 400],
    ]);
    expect(steps[3]?.control).toBe(true);
    expect(steps[3]?.requests?.[0]).toMatchObject({ status: 'answered', confidence: 'unsure' });
    const guesses = events.filter((e) => e.type === 'bot_guess_recorded');
    expect(guesses.map((g) => g.finalized)).toEqual([false, false, false, true]);
    expect(guesses.at(-1)?.guess).toMatchObject({ confidence: 'country' });
    expect(guesses.at(-1)?.guess.clue).toContain('Разметка');
    // The badge shows the sum of both processes; the card can split it by role.
    const accounting = events.filter((e) => e.type === 'bot_accounting').at(-1)?.accounting;
    expect(accounting?.tokenUsage?.totalTokens).toBe(7720);
    expect(accounting?.roleUsage?.eyes?.totalTokens).toBe(4580);
    expect(accounting?.roleUsage?.brain?.totalTokens).toBe(3140);
    // The shared work directory of both roles is gone once the bot is done.
    expect(await waitGone(path.join(dir, 'run', 'm-d', 'r1-g1', 'slot-d'))).toBe(true);
  });
});

const SLEEP: CustomBotLaunchBuilder = ({ workDir }) => ({
  cmd: [process.execPath, '-e', 'await Bun.sleep(30000);'],
  cwd: workDir,
});

const REPORT = {
  sections: {
    texts: [{ text: '«BÄCKEREI» — вывеска на немецкой улице', frame: 2 }],
    road: [{ text: 'Сторона движения: правая — машины стоят справа', frame: 1 }],
  },
};

test('each role sees only its own tools over the bridge, and the brain gets no image', async () => {
  await withDetective({ fakeMode: false, launch: SLEEP }, async ({ dir, tokens, apiUrl }) => {
    const connect = (role: 'brain' | 'eyes') =>
      connectBridgeMcp({ apiUrl: apiUrl(), botToken: tokens[role], workDir: dir, role });
    const eyes = await connect('eyes');
    const brain = await connect('brain');
    try {
      const names = async (c: typeof eyes) => (await c.client.listTools()).tools.map((t) => t.name);
      expect(await names(eyes)).toEqual([
        'observe',
        'look',
        'move',
        'report',
        'next_request',
        'answer',
      ]);
      expect(await names(brain)).toEqual(['briefing', 'ask', 'final_guess']);
      const observed = await eyes.callTool('observe', {});
      expect(observed.content.filter((c) => c.type === 'image')).toHaveLength(4);
      // A token is bound to its role: the brain's cannot reach the camera.
      const stolen = await brain.callTool('observe', {});
      expect(stolen.isError).toBe(true);
      expect(textOf(stolen)).toContain('недоступен мозгу');
      expect((await eyes.callTool('report', REPORT)).isError ?? false).toBe(false);
      const briefing = await brain.callTool('briefing', {});
      expect(textOf(briefing)).toContain('«BÄCKEREI» — вывеска на […] улице (кадр 2)');
      expect(briefing.content.every((c) => c.type === 'text')).toBe(true);
    } finally {
      await Promise.all([eyes.close(), brain.close()].map((p) => p.catch(() => undefined)));
    }
  });
});

test('the bridge hides the drive from both roles when movement is off', async () => {
  const opts = { fakeMode: false, moveEnabled: false, launch: SLEEP };
  await withDetective(opts, async ({ dir, tokens, apiUrl }) => {
    const connect = (role: 'brain' | 'eyes') =>
      connectBridgeMcp({
        apiUrl: apiUrl(),
        botToken: tokens[role],
        workDir: dir,
        role,
        moveEnabled: false,
      });
    const eyes = await connect('eyes');
    const brain = await connect('brain');
    try {
      const eyesTools = (await eyes.client.listTools()).tools.map((t) => t.name);
      expect(eyesTools).not.toContain('move');
      const ask = (await brain.client.listTools()).tools.find((t) => t.name === 'ask');
      expect(JSON.stringify(ask?.inputSchema)).not.toContain('drive');
      await eyes.callTool('observe', {});
      const moved = await eyes.callTool('move', { heading: 0 });
      expect(moved.isError).toBe(true);
      expect(textOf(moved)).toContain('Движение выключено');
    } finally {
      await Promise.all([eyes.close(), brain.close()].map((p) => p.catch(() => undefined)));
    }
  });
});

/** The last line a CLI prints: its token usage, in the format of claude or of codex. */
function usageLine(usage: { input: number; output: number; codex?: boolean }): string {
  const counters = { input_tokens: usage.input, output_tokens: usage.output };
  return JSON.stringify(
    usage.codex
      ? { type: 'turn.completed', usage: { ...counters, cached_input_tokens: 0 } }
      : { type: 'result', usage: counters },
  );
}

/** A stand-in for a CLI: it calls the tool API as its role would and prints its usage. */
function scriptedCli(
  body: string,
  usage: { input: number; output: number; codex?: boolean },
): string {
  return [
    'const [url, token] = process.argv.slice(1);',
    "const call = async (tool, args = {}) => (await fetch(url + '/tool/' + tool, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(args) })).json();",
    body,
    `process.stdout.write(${JSON.stringify(usageLine(usage))});`,
  ].join('\n');
}

const GUESS = `{ lat: 48.1, lng: 11.5, summary: 'Я прочитал отчёт.', finding: 'Вывеска решила.', confidence: 'region', clue: 'Вывеска.' }`;
const EYES_BODY = `await call('observe');
   await call('report', ${JSON.stringify(REPORT)});
   for (;;) { const r = await call('next_request'); if (r.text.includes('Раунд окончен')) break; }`;
const EYES_CLI = scriptedCli(EYES_BODY, { input: 400, output: 40 });
/** The brain reads the report and guesses twice: the first call gets the control reminder. */
const BRAIN_CLI = scriptedCli(
  `for (;;) { const r = await call('briefing'); if (!r.text.includes('ещё не готов')) break; }
   await call('final_guess', ${GUESS});
   await call('final_guess', ${GUESS});`,
  { input: 250, output: 60 },
);

function cliLaunch(scripts: { brain: string; eyes: string }): CustomBotLaunchBuilder {
  return ({ workDir, apiUrl, botToken, role }) => ({
    cmd: [process.execPath, '-e', scripts[role ?? 'brain'], apiUrl, botToken],
    cwd: workDir,
  });
}

test('two processes play a round; the bot finishes after both, with the tokens of each', async () => {
  const launch = cliLaunch({ brain: BRAIN_CLI, eyes: EYES_CLI });
  await withDetective({ fakeMode: false, launch }, async ({ dir, events }) => {
    const finished = await waitFinished(events);
    expect(finished).toMatchObject({ aborted: false, reason: 'завершил ход' });
    const accounting = events.filter((e) => e.type === 'bot_accounting');
    // The eyes exited on their own before the bot was reported as finished.
    expect(accounting).toHaveLength(2);
    expect(events.indexOf(finished)).toBeGreaterThan(events.indexOf(accounting[1] ?? finished));
    expect(accounting.at(-1)?.accounting).toEqual({
      tokenUsage: { inputTokens: 650, outputTokens: 100, cachedInputTokens: 0, totalTokens: 750 },
      roleUsage: {
        brain: { inputTokens: 250, outputTokens: 60, cachedInputTokens: 0, totalTokens: 310 },
        eyes: { inputTokens: 400, outputTokens: 40, cachedInputTokens: 0, totalTokens: 440 },
      },
      roleModels: { brain: 'claude-haiku-5-5', eyes: 'claude-haiku-5-5' },
      costUsd: null,
    });
    const final = events.filter((e) => e.type === 'bot_guess_recorded').at(-1);
    expect(final?.finalized).toBe(true);
    expect(final?.guess).toMatchObject({ lat: 48.1, lng: 11.5, confidence: 'region' });
    expect(foldJournal(events)[0]?.report).toHaveLength(2);
    expect(await waitGone(path.join(dir, 'run', 'm-d', 'r1-g1', 'slot-d'))).toBe(true);
  });
});

test('when the eyes exit early the brain is told at once and still guesses', async () => {
  const brain = scriptedCli(
    `const briefing = await call('briefing');
     if (!briefing.text.includes('процесс напарника завершился')) process.exit(3);
     await call('final_guess', ${GUESS});`,
    { input: 100, output: 20 },
  );
  const eyes = scriptedCli(`await call('observe');`, { input: 50, output: 5 });
  const launch = cliLaunch({ brain, eyes });
  await withDetective({ fakeMode: false, launch }, async ({ events }) => {
    const finished = await waitFinished(events);
    expect(finished).toMatchObject({ aborted: false, reason: 'завершил ход' });
    const accounting = events.filter((e) => e.type === 'bot_accounting').at(-1)?.accounting;
    expect(accounting?.tokenUsage?.totalTokens).toBe(175);
  });
});

test('a brain that exits without a guess ends the bot as aborted and stops the eyes', async () => {
  const brain = scriptedCli(`await call('briefing');`, { input: 100, output: 20 });
  const launch = cliLaunch({ brain, eyes: EYES_CLI });
  await withDetective({ fakeMode: false, launch }, async ({ events }) => {
    const finished = await waitFinished(events);
    expect(finished).toMatchObject({ aborted: true, reason: 'вышел без ответа' });
    // The eyes were told the round is over, exited on their own and reported their tokens.
    const accounting = events.filter((e) => e.type === 'bot_accounting').at(-1)?.accounting;
    expect(accounting?.roleUsage?.eyes?.totalTokens).toBe(440);
  });
});

test('a role whose CLI cannot start fails the launch once and stops the other role', async () => {
  const launch: CustomBotLaunchBuilder = (params) =>
    params.role === 'eyes'
      ? { cmd: [path.join(params.workDir, 'no-such-cli')], cwd: params.workDir }
      : SLEEP(params);
  await withDetective({ fakeMode: false, launch }, async ({ events }) => {
    const finished = await waitFinished(events);
    expect(finished).toMatchObject({ aborted: true, reason: 'сбой запуска' });
    expect(finished.diagnosticsTail).toContain('не удалось запустить процесс (eyes)');
    // Nothing more may arrive: the brain is stopped with a 500 ms grace, and its exit must not
    // report the bot as finished a second time. Absence can only be checked after that grace.
    await Bun.sleep(700);
    expect(events.filter((e) => e.type === 'bot_finished')).toHaveLength(1);
  });
});

// Value: protects=each Detective role writes its harness_usage record under its own harness, model and raw-counter scope; fails_when=the record names the brain's harness or model for the eyes, or codex loses its last-turn scope; why_new=the exchange accounting asserts tokens, not the diagnostic log; seam=none; no_claim=real CLI usage output (scripted CLIs).
test('the eyes run on another harness and model; each role is read and priced as its own', async () => {
  const launched: Record<string, string> = {};
  const launch: CustomBotLaunchBuilder = (params) => {
    launched[params.role ?? 'brain'] = `${params.slot.harness} · ${params.slot.model}`;
    const eyes = scriptedCli(EYES_BODY, { input: 400, output: 40, codex: true });
    return cliLaunch({ brain: BRAIN_CLI, eyes })(params);
  };
  const PRICE_PER_TOKEN: Record<string, number> = { 'claude-haiku-5-5': 0.01, 'gpt-6-luna': 0.001 };
  const estimateCost = (model: string, usage: BotTokenUsage): Promise<BotCostEstimate> =>
    Promise.resolve({
      costUsd: usage.totalTokens * (PRICE_PER_TOKEN[model] ?? 0),
      matchedModelId: model,
    });
  const slot = { eyes: { harness: 'codex', model: 'gpt-6-luna' } } as const;
  const { logger, logged } = recordingLogger();
  await withDetective(
    { fakeMode: false, launch, slot, estimateCost, logger },
    async ({ events }) => {
      await waitFinished(events);
      // Each role writes its usage record under its own harness and model; only codex reports a
      // last-turn counter.
      const usage = logged
        .filter((l) => l.event === 'harness_usage')
        .map((l) => [l.data.role, l.data.harness, l.data.model, l.data.rawCounterScope]);
      expect(usage).toHaveLength(2);
      expect(usage).toContainEqual(['brain', 'claude', 'claude-haiku-5-5', 'terminal']);
      expect(usage).toContainEqual(['eyes', 'codex', 'gpt-6-luna', 'last-turn']);
      expect(launched).toEqual({ brain: 'claude · claude-haiku-5-5', eyes: 'codex · gpt-6-luna' });
      // The codex usage line of the eyes is read by the codex parser, not lost. The price of the
      // pair arrives in its own accounting event once both estimates are in.
      const priced = (): Extract<EngineEvent, { type: 'bot_accounting' }> | undefined =>
        events.findLast(
          (e): e is Extract<EngineEvent, { type: 'bot_accounting' }> =>
            e.type === 'bot_accounting' && e.accounting.matchedModelId?.includes('+') === true,
        );
      const deadline = Date.now() + 5_000;
      while (!priced() && Date.now() < deadline) await Bun.sleep(10);
      const last = priced()?.accounting;
      expect(last?.roleUsage?.eyes?.totalTokens).toBe(440);
      expect(last?.roleModels).toEqual({ brain: 'claude-haiku-5-5', eyes: 'gpt-6-luna' });
      expect(last?.costUsd).toBeCloseTo(310 * 0.01 + 440 * 0.001, 6);
      expect(last?.matchedModelId).toBe('claude-haiku-5-5 + gpt-6-luna');
    },
  );
});

// Value: protects=the warning that an agy brain ran without its file guard, and the audit of every agy role copied into the log at cleanup; fails_when=an unguarded agy brain looks isolated, a guarded one is flagged, or an agy role's audit is not flushed; why_new=the brain could only run on claude before; seam=the audit file stands in for agy's PreToolUse hook; no_claim=that agy runs the hook.
test('an agy brain whose guard left no record is flagged; one with a record is not', async () => {
  const AUDIT = `require('node:fs').mkdirSync('.agents/plugins/geo', { recursive: true });
     require('node:fs').writeFileSync('.agents/plugins/geo/tool-audit.jsonl', '{"tool":"mcp_geo_geo_briefing"}\\n');`;
  const brain = (guarded: boolean): string =>
    scriptedCli(
      `${guarded ? AUDIT : ''}
       for (;;) { const r = await call('briefing'); if (!r.text.includes('ещё не готов')) break; }
       await call('final_guess', ${GUESS});
       await call('final_guess', ${GUESS});`,
      { input: 250, output: 60 },
    );
  for (const guarded of [false, true]) {
    const launch = cliLaunch({ brain: brain(guarded), eyes: EYES_CLI });
    const { logger, logged } = recordingLogger();
    await withDetective(
      { fakeMode: false, launch, slot: { harness: 'agy' }, logger },
      async ({ events }) => {
        await waitFinished(events);
        const flagged = events.filter((e) => e.type === 'bot_isolation_unconfirmed');
        expect(flagged).toHaveLength(guarded ? 0 : 1);
        // The audit of the agy role is copied into the log when the work directory goes (the
        // stand-in record has no timestamp, so the copy reports it as invalid). The eyes run on
        // agy too but wrote no audit: their copy logs nothing.
        const copies = (): LoggedEvent[] =>
          logged.filter((l) => l.event === 'harness_monitor_error' && 'invalidRecords' in l.data);
        const deadline = Date.now() + 3_000;
        while (guarded && copies().length === 0 && Date.now() < deadline) await Bun.sleep(10);
        expect(copies().map((l) => [l.data.role, l.data.harness, l.data.invalidRecords])).toEqual(
          guarded ? [['brain', 'agy', 1]] : [],
        );
      },
    );
  }
});
