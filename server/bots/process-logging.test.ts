import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig } from '../../shared/storage-schemas.ts';
import type { RoundTarget } from '../engine/types.ts';
import { createServerLogger, type LogRecord } from '../log.ts';
import type { BotToolApiServer } from './api.ts';
import { cleanupBotHandle, spawnAndMonitorBotProcess, type ActiveBotHandle } from './process.ts';

async function runLoggedChild(stdout: string, stopped = false): Promise<LogRecord[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-process-log-'));
  const logger = createServerLogger(path.join(dir, 'logs'));
  const handle: ActiveBotHandle = {
    matchId: 'match',
    gen: 2,
    roundNumber: 3,
    slotId: 'bot',
    token: 'test-secret-token',
    workDir: path.join(dir, 'bot'),
    stopped: false,
    abortQueue: () => {},
    releaseObserve: () => {},
    setStartedAt: () => {},
  };
  const api = { baseUrl: '', unregisterBot: () => {} } as unknown as BotToolApiServer;
  const handles = new Map([[handle.slotId, handle]]);
  const journal = {
    ts: new Date().toISOString(),
    tool: 'read_file',
    decision: 'allow',
    file: 'frame.jpg',
  };
  try {
    spawnAndMonitorBotProcess({
      childrenFile: path.join(dir, 'children.json'),
      api,
      activeHandles: handles,
      handle,
      slot: { id: 'bot', harness: 'agy', model: 'gemini-3.8-flash-low' } as BotSlotConfig,
      target: {} as RoundTarget,
      roundNumber: 3,
      moveEnabled: false,
      prompt: 'PRIVATE_PROMPT',
      didSubmitGuess: () => true,
      dispatch: () => {},
      logger,
      estimateCost: () => Promise.resolve({ costUsd: 0.5 }),
      buildCustomLaunchSpec: ({ workDir }) => ({
        cmd: [
          process.execPath,
          '-e',
          `
          const fs = require('node:fs');
          const folder = '.agents/plugins/geo';
          fs.mkdirSync(folder, {recursive:true});
          fs.appendFileSync(folder+'/tool-audit.jsonl', ${JSON.stringify(JSON.stringify(journal) + '\n')});
          process.stdout.write(${JSON.stringify(stdout)});
        `,
        ],
        cwd: workDir,
      }),
    });
    handle.stopped = stopped;
    await handle.proc?.exited;
    // Reproduce stopAll cleanup occurring before stdout has drained.
    if (stopped) cleanupBotHandle(api, handles, handle);
    await handle.proc?.drained;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const text = readFileSync(
      path.join(logger.getLogsDir(), `${new Date().toISOString().slice(0, 10)}.jsonl`),
      'utf8',
    );
    expect(text).not.toContain('PRIVATE_PROMPT');
    expect(text).not.toContain('PRIVATE_RESPONSE');
    expect(existsSync(handle.workDir)).toBe(false);
    return text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LogRecord);
  } finally {
    await handle.proc?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

// Value: protects=application logs retain raw and normalized usage and AGY activity across cleanup; fails_when=usage remains memory-only or stop removes the hook journal; why_new=existing monitor tests assert engine events only; seam=none; no_claim=real CLI/provider accounting.
test('persists AGY accounting, reference cost and file-read attempts on normal exit and stop', async () => {
  for (const stopped of [false, true]) {
    const rows = await runLoggedChild(
      JSON.stringify({
        conversation_id: 'probe-session',
        status: 'SUCCESS',
        num_turns: 1,
        response: 'PRIVATE_RESPONSE',
        usage: { input_tokens: 100, cache_read_tokens: 80, output_tokens: 5, total_tokens: 105 },
      }),
      stopped,
    );
    expect(rows.find((r) => r.event === 'harness_usage')).toMatchObject({
      data: {
        matchId: 'match',
        gen: 2,
        roundNumber: 3,
        slotId: 'bot',
        model: 'gemini-3.8-flash-low',
        status: 'reported',
        metadata: { conversation_id: 'probe-session', num_turns: 1 },
        rawCounterScope: 'terminal',
        rawCounters: { input_tokens: 100, cache_read_tokens: 80, total_tokens: 105 },
        tokenUsage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 5, totalTokens: 105 },
      },
    });
    expect(rows.filter((r) => r.event === 'harness_tool_call')).toHaveLength(1);
    expect(rows.find((r) => r.event === 'harness_tool_call')).toMatchObject({
      data: { tool: 'read_file', phase: 'attempt', file: 'frame.jpg', decision: 'allow' },
    });
    expect(rows.find((r) => r.event === 'harness_cost')).toMatchObject({
      data: { matchId: 'match', gen: 2, costUsd: 0.5 },
    });
    expect(rows.find((r) => r.event === 'harness_end')).toMatchObject({
      data: { matchId: 'match', gen: 2, ...(stopped ? { stopped: true } : { aborted: false }) },
    });
  }
});

test('persists invalid and missing usage explicitly without inventing counts or prices', async () => {
  for (const [stdout, status] of [
    ['', 'missing'],
    [
      JSON.stringify({ usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 8 } }),
      'invalid',
    ],
    ['{"usage":', 'truncated'],
  ] as const) {
    const rows = await runLoggedChild(stdout);
    expect(rows.find((r) => r.event === 'harness_usage')).toMatchObject({
      data: { status, tokenUsage: null },
    });
    expect(rows.some((r) => r.event === 'harness_cost')).toBe(false);
    expect(rows.some((r) => r.event === 'harness_end')).toBe(true);
  }
});
