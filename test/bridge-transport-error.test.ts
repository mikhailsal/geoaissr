import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { ERROR_CODES } from '../server/errors.ts';
import { BRIDGE_UNREACHABLE_CODE, transportErrorResult } from '../bot-tools/transport-error.ts';
import { connectBridgeMcp } from './fake-harness.ts';

// protects=bots get a recovery line and a stable code on transport failure; fails_when=raw exception text or no code reaches the model; no_claim=how each CLI shows isError.
test('transport error result carries the recovery line and a registered code', () => {
  const res = transportErrorResult('observe');
  expect(res.isError).toBe(true);
  const text = res.content[0]?.text ?? '';
  expect(text).toContain('Повторите вызов один раз');
  expect(text).toContain('final_guess');
  expect(text).toContain(`[${BRIDGE_UNREACHABLE_CODE}]`);
  expect(ERROR_CODES).toContain(BRIDGE_UNREACHABLE_CODE);
});

// Value: protects=a lost reply to a paid call does not invite a repeat that the server would charge again; fails_when=look or move are told to repeat the call; why_new=the line was the same for every tool; seam=none; no_claim=idempotent replays (TODOS.md).
test('a paid call is not told to repeat itself after a transport failure', () => {
  for (const tool of ['look', 'move']) {
    const text = transportErrorResult(tool).content[0]?.text ?? '';
    expect(text).not.toContain('Повторите вызов');
    expect(text).toContain('не повторяйте');
    expect(text).toContain('final_guess');
    expect(text).toContain(`[${BRIDGE_UNREACHABLE_CODE}]`);
  }
});

// Value: protects=the eyes of a Detective are never told to call a tool they do not have; fails_when=the recovery line of the eyes names final_guess; why_new=the line was written for the camera bot only; seam=none; no_claim=what a model does after the line.
test('the recovery line names only tools the role has', () => {
  for (const tool of ['observe', 'look', 'move', 'report', 'next_request', 'answer']) {
    const text = transportErrorResult(tool, 'eyes').content[0]?.text ?? '';
    expect(text).not.toContain('final_guess');
    expect(text).toContain(`[${BRIDGE_UNREACHABLE_CODE}]`);
  }
  expect(transportErrorResult('look', 'eyes').content[0]?.text).toContain('не повторяйте');
  expect(transportErrorResult('answer', 'eyes').content[0]?.text).toContain(
    'Повторите вызов один раз',
  );
  // The brain ends the round itself, like the camera bot.
  expect(transportErrorResult('ask', 'brain').content[0]?.text).toContain('final_guess');
});

// protects=the real bridge turns a dead server into the coded recovery result; fails_when=fetch errors escape as raw text or crash the bridge; no_claim=timeouts (deferred to Stage 2).
test('the bridge answers with the coded transport error when the server is down', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-bridge-down-'));
  try {
    const conn = await connectBridgeMcp({
      apiUrl: 'http://127.0.0.1:9',
      botToken: 'dead-token',
      workDir: dir,
    });
    try {
      const res = await conn.callTool('observe', {});
      expect(res.isError).toBe(true);
      expect(res.content.map((c) => c.text ?? '').join('')).toContain(BRIDGE_UNREACHABLE_CODE);
    } finally {
      await conn.close().catch(() => undefined);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
