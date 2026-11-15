import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotToolApiServer } from './api.ts';
import type { ServerLogger } from '../log.ts';
import { spawnAndMonitorBotProcess, type ActiveBotHandle } from './process.ts';

const failingAccountingLogger: ServerLogger = {
  registerSecrets: () => {},
  redact: (text: string) => text,
  log: (_event, data) => {
    if (data.phase === 'accounting') throw new Error('log write failed');
  },
  writeCrash: () => '',
  pruneOld: () => 0,
  getLogsDir: () => '',
};
const accountingFailureCases = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [false, true, true],
] as const;

test('dispatches usage before finish and enriches it asynchronously', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-accounting-'));
  const events: EngineEvent[] = [];
  let releaseEstimate: ((value: { costUsd: number }) => void) | undefined;
  const estimate = new Promise<{ costUsd: number }>((resolve) => {
    releaseEstimate = resolve;
  });
  const handle: ActiveBotHandle = {
    matchId: 'match',
    gen: 2,
    roundNumber: 3,
    slotId: 'bot',
    workDir: path.join(dir, 'bot'),
    token: 'secret',
    abortQueue: () => {},
    stopped: false,
    releaseObserve: () => {},
    setStartedAt: () => {},
  };
  try {
    spawnAndMonitorBotProcess({
      childrenFile: path.join(dir, 'children.json'),
      api: { baseUrl: '', unregisterBot: () => {} } as unknown as BotToolApiServer,
      activeHandles: new Map([[handle.slotId, handle]]),
      handle,
      slot: { id: 'bot', harness: 'claude', model: 'claude-haiku-4-5' } as BotSlotConfig,
      target: {} as RoundTarget,
      roundNumber: 3,
      moveEnabled: false,
      prompt: '',
      didSubmitGuess: () => true,
      dispatch: (event) => {
        events.push(event);
      },
      estimateCost: () => estimate,
      buildCustomLaunchSpec: ({ workDir }) => ({
        cmd: [
          process.execPath,
          '-e',
          `process.stdout.write(JSON.stringify({type:'result',usage:{input_tokens:10,output_tokens:2}}))`,
        ],
        cwd: workDir,
      }),
    });
    const deadline = Date.now() + 3000;
    while (!events.some((event) => event.type === 'bot_finished') && Date.now() < deadline)
      await Bun.sleep(10);
    expect(events.map((event) => event.type)).toEqual(['bot_accounting', 'bot_finished']);
    releaseEstimate?.({ costUsd: 0.5 });
    while (events.length < 3 && Date.now() < deadline) await Bun.sleep(10);
    expect(events.map((event) => event.type)).toEqual([
      'bot_accounting',
      'bot_finished',
      'bot_accounting',
    ]);
    expect(events[2]).toMatchObject({
      accounting: { costUsd: 0.5, tokenUsage: { totalTokens: 12 } },
    });
  } finally {
    await handle.proc?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Value: protects=known usage survives stop and optional accounting errors cannot block completion; fails_when=stop guard discards usage or accounting errors suppress finish and cleanup; why_new=existing test covers only successful pricing and normal exit; seam=none; no_claim=local child does not prove provider CLI behavior.
test('retains stopped usage and finishes despite optional accounting errors', async () => {
  for (const [stopped, dispatchThrows, loggerThrows] of accountingFailureCases) {
    const dir = mkdtempSync(path.join(tmpdir(), 'geo-accounting-error-'));
    const events: EngineEvent[] = [];
    let unregistered = false;
    const handle: ActiveBotHandle = {
      matchId: 'match',
      gen: 2,
      roundNumber: 3,
      slotId: 'bot',
      workDir: path.join(dir, 'bot'),
      token: 'secret',
      abortQueue: () => {},
      stopped: false,
      releaseObserve: () => {},
      setStartedAt: () => {},
    };
    const activeHandles = new Map([[handle.slotId, handle]]);
    try {
      spawnAndMonitorBotProcess({
        childrenFile: path.join(dir, 'children.json'),
        api: {
          baseUrl: '',
          unregisterBot: () => {
            unregistered = true;
          },
        } as unknown as BotToolApiServer,
        activeHandles,
        handle,
        slot: { id: 'bot', harness: 'claude', model: 'claude-haiku-4-5' } as BotSlotConfig,
        target: {} as RoundTarget,
        roundNumber: 3,
        moveEnabled: false,
        prompt: '',
        didSubmitGuess: () => true,
        dispatch: (event) => {
          events.push(event);
          if (dispatchThrows && event.type === 'bot_accounting') throw new Error('dispatch failed');
        },
        estimateCost: () => Promise.reject(new Error('pricing unavailable')),
        logger: loggerThrows ? failingAccountingLogger : undefined,
        buildCustomLaunchSpec: ({ workDir }) => ({
          cmd: [
            process.execPath,
            '-e',
            `process.stdout.write(JSON.stringify({type:'result',usage:{input_tokens:10,output_tokens:2}}))`,
          ],
          cwd: workDir,
        }),
      });
      if (stopped) handle.stopped = true;
      await handle.proc?.exited;
      await handle.proc?.drained;
      const deadline = Date.now() + 3000;
      while (!events.some((event) => event.type === 'bot_accounting') && Date.now() < deadline)
        await Bun.sleep(10);
      expect(events.map((event) => event.type)).toEqual(
        stopped ? ['bot_accounting'] : ['bot_accounting', 'bot_finished'],
      );
      expect(events[0]).toMatchObject({
        accounting: {
          tokenUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
          costUsd: null,
        },
      });
      if (!stopped) {
        expect(unregistered).toBe(true);
        expect(activeHandles.has(handle.slotId)).toBe(false);
      }
      await Promise.resolve();
      expect(events).toHaveLength(stopped ? 1 : 2);
    } finally {
      await handle.proc?.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
