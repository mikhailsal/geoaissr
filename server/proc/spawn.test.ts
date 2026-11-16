import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GeoError } from '../errors.ts';
import { acquireDataDirLock, getProcessStartTime, isProcessAlive } from './lock.ts';
import {
  cleanupOrphanedChildren,
  readChildrenRegistry,
  writeChildrenRegistry,
} from './registry.ts';
import { spawnManaged } from './spawn.ts';

test('spawnManaged stops entire detached process group including forked children', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-proc-group-'));
  try {
    const childrenFile = path.join(dir, 'children.json');
    const childPidFile = path.join(dir, 'grandchild.pid');
    const script = ['sh', '-c', `sleep 30 & echo $! > ${JSON.stringify(childPidFile)}; wait`];
    const handle = spawnManaged({
      cmd: script,
      cwd: dir,
      kind: 'test-group',
      childrenFile,
    });

    const deadline = Date.now() + 3000;
    while (!existsSync(childPidFile) && Date.now() < deadline) {
      await Bun.sleep(25);
    }
    const grandchildPid = Number(readFileSync(childPidFile, 'utf8').trim());
    expect(grandchildPid).toBeGreaterThan(0);
    expect(isProcessAlive(handle.pid)).toBe(true);
    expect(isProcessAlive(grandchildPid)).toBe(true);
    expect(readChildrenRegistry(childrenFile).some((c) => c.pid === handle.pid)).toBe(true);

    await handle.stop(500);
    await Bun.sleep(100);
    expect(isProcessAlive(handle.pid)).toBe(false);
    expect(isProcessAlive(grandchildPid)).toBe(false);
    expect(readChildrenRegistry(childrenFile)).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanupOrphanedChildren verifies 3 fields and ignores mismatched startTime/command', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-proc-orphan-'));
  const sleeper = Bun.spawn(
    [process.execPath, '-e', "console.log('ready'); await Bun.sleep(30000)"],
    {
      stdout: 'pipe',
      stderr: 'ignore',
    },
  );
  try {
    const childrenFile = path.join(dir, 'children.json');
    const reader = sleeper.stdout.getReader();
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          readinessTimer = setTimeout(() => {
            reject(new Error('Child did not become ready'));
          }, 3000);
        }),
      ]);
      expect(new TextDecoder().decode(result.value)).toContain('ready');
    } finally {
      clearTimeout(readinessTimer);
      reader.releaseLock();
    }
    const sleeperStart = getProcessStartTime(sleeper.pid) ?? 'unknown';

    // Mismatched command must NOT kill sleeper
    writeChildrenRegistry(childrenFile, [
      { pid: sleeper.pid, startTime: sleeperStart, command: 'not-sleep-binary', kind: 'fake' },
    ]);
    const killedMismatch = await cleanupOrphanedChildren(childrenFile);
    expect(killedMismatch).toHaveLength(0);
    expect(isProcessAlive(sleeper.pid)).toBe(true);

    // Exact match (pid + startTime + command) kills orphan
    writeChildrenRegistry(childrenFile, [
      { pid: sleeper.pid, startTime: sleeperStart, command: process.execPath, kind: 'fake' },
    ]);
    const killedMatch = await cleanupOrphanedChildren(childrenFile);
    expect(killedMatch).toHaveLength(1);
    await Bun.sleep(100);
    expect(isProcessAlive(sleeper.pid)).toBe(false);
  } finally {
    if (sleeper.exitCode === null && sleeper.signalCode === null) sleeper.kill();
    await sleeper.exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireDataDirLock rejects second live owner with GEO_ALREADY_RUNNING and recovers stale lock', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-proc-lock-'));
  try {
    const lockFile = path.join(dir, 'server.lock');
    const lock1 = acquireDataDirLock(lockFile);
    try {
      expect(() => acquireDataDirLock(lockFile)).toThrow(GeoError);
    } finally {
      lock1.release();
    }

    // Stale PID lock is replaced cleanly
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 9999999, startTime: '0', createdAt: new Date().toISOString() }),
    );
    const lock2 = acquireDataDirLock(lockFile);
    expect(existsSync(lockFile)).toBe(true);
    lock2.release();
    expect(existsSync(lockFile)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spawnManaged reaps grandchildren when the group leader exits on its own', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-proc-reap-'));
  try {
    const childPidFile = path.join(dir, 'grandchild.pid');
    const handle = spawnManaged({
      cmd: ['sh', '-c', `sleep 30 & echo $! > ${JSON.stringify(childPidFile)}; exit 0`],
      cwd: dir,
      kind: 'test-reap',
    });
    await handle.exited;
    const grandchildPid = Number(readFileSync(childPidFile, 'utf8').trim());
    expect(grandchildPid).toBeGreaterThan(0);
    await Bun.sleep(100);
    expect(isProcessAlive(grandchildPid)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drained waits for trailing stdout from a real child', async () => {
  const output = 'a'.repeat(180000) + 'terminal';
  let observed = '';
  const handle = spawnManaged({
    cmd: [process.execPath, '-e', "process.stdout.write('a'.repeat(180000) + 'terminal')"],
    cwd: process.cwd(),
    kind: 'test-output',
    onStdoutChunk: (chunk) => {
      observed += chunk;
    },
  });
  await handle.exited;
  await handle.drained;
  expect(observed).toBe(output);
  expect(handle.getStdout()).toBe(output);
});
