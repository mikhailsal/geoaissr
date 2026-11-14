import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agyAdapter } from '../bots/adapters/agy.ts';
import { GeoError } from '../errors.ts';
import { acquireDataDirLock } from './lock.ts';
import { cleanupOrphanedChildren, readChildrenRegistry, registerChildRecord } from './registry.ts';
import { spawnManaged } from './spawn.ts';

test('acquireDataDirLock rejects live lock holder and reaps corrupt or stale locks atomically', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-lock-test-'));
  try {
    const lockFile = path.join(dir, 'server.lock');
    const lock1 = acquireDataDirLock(lockFile);
    expect(existsSync(lockFile)).toBe(true);
    expect(() => acquireDataDirLock(lockFile)).toThrow(GeoError);
    lock1.release();
    expect(existsSync(lockFile)).toBe(false);

    // Corrupt lock file gets reaped and re-acquired cleanly.
    writeFileSync(lockFile, '{not valid json', 'utf8');
    const lock2 = acquireDataDirLock(lockFile);
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8')) as { pid: number };
    expect(parsed.pid).toBe(process.pid);
    lock2.release();

    // Dead PID lock gets reaped cleanly.
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 9999999, startTime: '0', createdAt: new Date().toISOString() }),
      'utf8',
    );
    const lock3 = acquireDataDirLock(lockFile);
    lock3.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupOrphanedChildren preserves concurrently registered records', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-reg-test-'));
  try {
    const regFile = path.join(dir, 'children.json');
    registerChildRecord(regFile, {
      pid: 9999998,
      startTime: '1',
      command: 'missing-bin',
      kind: 'bot-round',
    });
    const killed = await cleanupOrphanedChildren(regFile);
    expect(killed.length).toBe(0);
    expect(readChildrenRegistry(regFile).length).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runAgyGuard(guardPath: string, payload: string): Promise<{ decision: string }> {
  const proc = Bun.spawn([process.execPath, 'run', guardPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  void proc.stdin.write(payload);
  void proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out) as { decision: string };
}

test('agy guard blocks .agents exact dir, alternate path keys, serverName mismatch, and bad JSON', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-agy-guard-'));
  try {
    agyAdapter.buildLaunchSpec({
      workDir: dir,
      model: 'gemini-3.8-flash-low',
      effort: 'low',
      prompt: 'test',
      apiUrl: 'http://127.0.0.1:9999',
      botToken: 'tok',
      moveEnabled: false,
    });
    const guardPath = path.join(dir, '.agents', 'plugins', 'geo', 'guard.ts');
    writeFileSync(path.join(dir, 'clue.txt'), 'ok');

    expect((await runAgyGuard(guardPath, '{bad')).decision).toBe('deny');
    expect(
      (
        await runAgyGuard(
          guardPath,
          JSON.stringify({
            toolCall: { name: 'call_mcp_tool', args: { serverName: 'evil', server_name: 'geo' } },
          }),
        )
      ).decision,
    ).toBe('deny');
    expect(
      (
        await runAgyGuard(
          guardPath,
          JSON.stringify({
            toolCall: { name: 'read_file', args: { path: path.join(dir, '.agents') } },
          }),
        )
      ).decision,
    ).toBe('deny');
    expect(
      (
        await runAgyGuard(
          guardPath,
          JSON.stringify({
            toolCall: { name: 'read_file', args: { file_path: '/etc/passwd' } },
          }),
        )
      ).decision,
    ).toBe('deny');
    expect(
      (
        await runAgyGuard(
          guardPath,
          JSON.stringify({
            toolCall: { name: 'read_file', args: { Path: path.join(dir, 'clue.txt') } },
          }),
        )
      ).decision,
    ).toBe('allow');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireDataDirLock reaps stale .reap lock and spawnManaged handles bad binary safely', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-reap-spawn-'));
  try {
    const lockFile = path.join(dir, 'server.lock');
    const reapFile = `${lockFile}.reap`;
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 9999997, startTime: '0', createdAt: new Date().toISOString() }),
      'utf8',
    );
    writeFileSync(reapFile, '', 'utf8');
    const staleDate = new Date(Date.now() - 20_000);
    utimesSync(reapFile, staleDate, staleDate);

    const acquired = acquireDataDirLock(lockFile);
    expect(existsSync(reapFile)).toBe(false);
    acquired.release();

    const proc = spawnManaged({
      cmd: ['nonexistent-binary-geoaissr-test-xyz'],
      cwd: dir,
      stdinText: 'hello stdin',
      kind: 'test-fail',
    });
    const res = await proc.exited;
    expect(res.code).not.toBe(0);
    await proc.stop(50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
