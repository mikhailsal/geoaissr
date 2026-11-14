import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GeoError } from '../errors.ts';

const lockFileSchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.string().nullable().optional(),
  createdAt: z.string(),
});

export function getProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') {
    const statPath = `/proc/${pid}/stat`;
    if (!existsSync(statPath)) return null;
    try {
      const content = readFileSync(statPath, 'utf8');
      const rparen = content.lastIndexOf(')');
      if (rparen === -1) return null;
      const fields = content
        .slice(rparen + 2)
        .trim()
        .split(/\s+/);
      // After ')' (field 2), index 19 corresponds to field 22 (starttime in clock ticks).
      return fields[19] ?? null;
    } catch {
      return null;
    }
  }
  const res = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'lstart='], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const txt = new TextDecoder().decode(res.stdout).trim();
  return res.exitCode === 0 && txt ? txt : null;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface DataDirLock {
  release: () => void;
  lockFile: string;
}

function tryCreateLockAtomic(lockFile: string): boolean {
  const payload = `${JSON.stringify({
    pid: process.pid,
    startTime: getProcessStartTime(process.pid),
    createdAt: new Date().toISOString(),
  })}\n`;
  const tmpFile = `${lockFile}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  writeFileSync(tmpFile, payload, { encoding: 'utf8', flag: 'wx' });
  try {
    linkSync(tmpFile, lockFile);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
      try {
        const fd = openSync(lockFile, 'wx');
        try {
          writeFileSync(fd, payload, 'utf8');
        } finally {
          closeSync(fd);
        }
        return true;
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw e2;
      }
    }
    throw err;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // already removed
    }
  }
}

function isLockHolderAlive(lockFile: string): { alive: boolean; pid?: number } {
  try {
    const rawText = readFileSync(lockFile, 'utf8');
    if (!rawText.trim()) {
      const ageMs = Date.now() - statSync(lockFile).mtimeMs;
      return ageMs < 500 ? { alive: true } : { alive: false };
    }
    const raw = JSON.parse(rawText) as unknown;
    const parsed = lockFileSchema.safeParse(raw);
    if (!parsed.success) return { alive: false };
    const { pid, startTime } = parsed.data;
    if (!isProcessAlive(pid)) return { alive: false };
    if (startTime) {
      const curStart = getProcessStartTime(pid);
      if (curStart && curStart !== startTime) return { alive: false };
    }
    return { alive: true, pid };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') return { alive: true };
    return { alive: false };
  }
}

function openReapLock(reapFile: string): number | null {
  try {
    return openSync(reapFile, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null;
    try {
      const st = statSync(reapFile);
      if (Date.now() - st.mtimeMs <= 10_000) return null;
      unlinkSync(reapFile);
      return openSync(reapFile, 'wx');
    } catch {
      return null;
    }
  }
}

function tryReapStaleLock(lockFile: string): void {
  const reapFile = `${lockFile}.reap`;
  const reapFd = openReapLock(reapFile);
  if (reapFd === null) return;
  try {
    const holder = isLockHolderAlive(lockFile);
    if (!holder.alive) {
      try {
        unlinkSync(lockFile);
      } catch {
        // already removed
      }
    }
  } finally {
    closeSync(reapFd);
    try {
      unlinkSync(reapFile);
    } catch {
      // ignore
    }
  }
}

export function acquireDataDirLock(lockFile: string): DataDirLock {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (tryCreateLockAtomic(lockFile)) {
      let released = false;
      return {
        lockFile,
        release: () => {
          if (released) return;
          released = true;
          try {
            const cur = readFileSync(lockFile, 'utf8');
            const parsed = lockFileSchema.safeParse(JSON.parse(cur));
            if (parsed.success && parsed.data.pid === process.pid) {
              unlinkSync(lockFile);
            }
          } catch {
            // already removed
          }
        },
      };
    }
    const holder = isLockHolderAlive(lockFile);
    if (holder.alive && holder.pid !== undefined) {
      throw new GeoError({
        code: 'GEO_ALREADY_RUNNING',
        causeDetail: `обнаружен активный сервер (PID ${holder.pid}, ${lockFile})`,
      });
    }
    tryReapStaleLock(lockFile);
  }
  const finalHolder = isLockHolderAlive(lockFile);
  throw new GeoError({
    code: 'GEO_ALREADY_RUNNING',
    causeDetail: finalHolder.pid
      ? `обнаружен активный сервер (PID ${finalHolder.pid}, ${lockFile})`
      : `не удалось захватить блокировку ${lockFile}`,
  });
}
