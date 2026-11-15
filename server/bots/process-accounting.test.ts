import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoundTarget } from '../engine/types.ts';
import type { BotToolApiServer } from './api.ts';
import { spawnAndMonitorBotProcess, type ActiveBotHandle } from './process.ts';

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

// Value: protects=known usage survives stop and rejected pricing cannot block completion; fails_when=stop guard discards parsed usage or estimator failure suppresses finish; why_new=existing test covers only successful pricing and normal exit; seam=none; no_claim=local child does not prove provider CLI behavior.
test('retains stopped usage and finishes despite estimator rejection', async () => {
  for (const stopped of [false, true]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'geo-accounting-error-'));
    const events: EngineEvent[] = [];
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
        estimateCost: () => Promise.reject(new Error('pricing unavailable')),
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
      await Promise.resolve();
      expect(events).toHaveLength(stopped ? 1 : 2);
    } finally {
      await handle.proc?.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
