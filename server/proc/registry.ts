import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from '../storage/settings.ts';
import { getProcessStartTime, isProcessAlive } from './lock.ts';

const childEntrySchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.string().min(1),
  command: z.string().min(1),
  kind: z.string().min(1),
});

const childrenFileSchema = z.object({
  version: z.literal(1),
  children: z.array(childEntrySchema),
});

export type ChildProcessRecord = z.infer<typeof childEntrySchema>;

export function readChildrenRegistry(filePath: string): ChildProcessRecord[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const parsed = childrenFileSchema.safeParse(raw);
    return parsed.success ? parsed.data.children : [];
  } catch {
    return [];
  }
}

export function writeChildrenRegistry(
  filePath: string,
  children: readonly ChildProcessRecord[],
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteFile(filePath, `${JSON.stringify({ version: 1, children }, null, 2)}\n`);
}

export function registerChildRecord(filePath: string, entry: ChildProcessRecord): void {
  const existing = readChildrenRegistry(filePath).filter((c) => c.pid !== entry.pid);
  existing.push(entry);
  writeChildrenRegistry(filePath, existing);
}

export function unregisterChildRecord(filePath: string, pid: number): void {
  if (!existsSync(filePath)) return;
  const remaining = readChildrenRegistry(filePath).filter((c) => c.pid !== pid);
  writeChildrenRegistry(filePath, remaining);
}

export function matchesRecordedProcess(entry: ChildProcessRecord): boolean {
  if (!isProcessAlive(entry.pid)) return false;
  const curStart = getProcessStartTime(entry.pid);
  if (!curStart || curStart !== entry.startTime) return false;
  if (process.platform === 'linux' && existsSync(`/proc/${entry.pid}/cmdline`)) {
    try {
      const cmdline = readFileSync(`/proc/${entry.pid}/cmdline`, 'utf8')
        .replaceAll('\0', ' ')
        .trim();
      const base = path.basename(entry.command);
      if (cmdline && !cmdline.includes(base)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isLeaderRunningNonZombie(pid: number): boolean {
  if (!isProcessAlive(pid)) return false;
  if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const rparen = stat.lastIndexOf(')');
      if (rparen >= 0 && stat[rparen + 2] === 'Z') return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isGroupAlive(pid: number): boolean {
  if (isLeaderRunningNonZombie(pid)) return true;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function killProcessGroup(pid: number, graceMs = 2000): Promise<void> {
  if (!isGroupAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isGroupAlive(pid)) {
    await Bun.sleep(50);
  }

  if (isGroupAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already dead
      }
    }
  }
}

export async function cleanupOrphanedChildren(filePath: string): Promise<ChildProcessRecord[]> {
  const initialRecords = readChildrenRegistry(filePath);
  const inspectedPids = new Set(initialRecords.map((r) => r.pid));
  const killed: ChildProcessRecord[] = [];
  for (const entry of initialRecords) {
    if (matchesRecordedProcess(entry)) {
      await killProcessGroup(entry.pid, 1500);
      killed.push(entry);
    }
  }
  const latestRecords = readChildrenRegistry(filePath).filter((c) => !inspectedPids.has(c.pid));
  writeChildrenRegistry(filePath, latestRecords);
  return killed;
}
