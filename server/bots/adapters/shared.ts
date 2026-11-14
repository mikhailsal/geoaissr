import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import type { HarnessId } from '../../../shared/storage-schemas.ts';
import harnessesMeta from './harnesses.json' with { type: 'json' };
import type { CommandProbe, HarnessAdapter } from './types.ts';

interface HarnessMetaEntry {
  id: HarnessId;
  binary: string;
  deliveryMode: 'mcp' | 'file';
  readsOwnerFiles: boolean;
  defaultModel: string;
  fallbackModels: string[];
}

export function getHarnessMeta(id: HarnessId): HarnessMetaEntry {
  const found = (harnessesMeta.harnesses as HarnessMetaEntry[]).find((h) => h.id === id);
  if (!found) {
    throw new Error(`Missing harness metadata for ${id}`);
  }
  return found;
}

export const defaultCommandProbe: CommandProbe = (binary, args, timeoutMs = 4000) => {
  const binPath = Bun.which(binary);
  if (!binPath) {
    return {
      found: false,
      status: null,
      stdout: '',
      stderr: `Бинарник «${binary}» не найден в PATH`,
    };
  }
  const res = spawnSync(binPath, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return {
    found: true,
    status: res.status,
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
    stderr: typeof res.stderr === 'string' ? res.stderr : '',
  };
};

export function resolveMcpToolsPath(override?: string): string {
  if (override) return path.resolve(override);
  const direct = path.resolve('bot-tools/main.ts');
  if (existsSync(direct)) return direct;
  return path.resolve(import.meta.dir, '../../../bot-tools/main.ts');
}

export function resolveBunBinary(override?: string): string {
  if (override) return override;
  if (process.execPath) return process.execPath;
  return Bun.which('bun') ?? 'bun';
}

export function buildSharedMcpEnv(opts: {
  apiUrl: string;
  botToken: string;
  deliveryMode: 'mcp' | 'file';
  moveEnabled: boolean;
  workDir: string;
}): Record<string, string> {
  return {
    GEO_API_URL: opts.apiUrl,
    GEO_BOT_TOKEN: opts.botToken,
    GEO_DELIVERY_MODE: opts.deliveryMode,
    GEO_MOVE_ENABLED: opts.moveEnabled ? 'true' : 'false',
    ...(opts.deliveryMode === 'file' ? { GEO_WORK_DIR: opts.workDir } : {}),
  };
}

const BLOCKED_CHILD_ENV_KEYS = new Set([
  'GOOGLE_MAPS_SERVER_KEY',
  'GOOGLE_MAPS_BROWSER_KEY',
  'GOOGLE_API_KEY',
]);

export function buildSanitizedChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined && !BLOCKED_CHILD_ENV_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

export function ensureWorkDir(workDir: string): string {
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

export function writeJsonFile(filePath: string, data: unknown, mode?: number): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    ...(mode !== undefined ? { mode } : {}),
  });
}

export function parseSemverTuple(versionOutput: string): [number, number, number] | null {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(versionOutput);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function formatUnavailable(
  meta: HarnessMetaEntry,
  reason: string,
  fixCommand?: string,
  versionWarning?: string,
): HarnessCatalogEntry {
  return {
    id: meta.id,
    available: false,
    reason,
    fixCommand,
    readsOwnerFiles: meta.readsOwnerFiles,
    versionWarning,
    models: [...meta.fallbackModels],
  };
}

export type { CommandProbe, HarnessAdapter };
