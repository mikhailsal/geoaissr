import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import {
  botNameFromModel,
  getBotToolDefinitions,
  isAutoBotName,
} from '../../../shared/bot-tools.ts';
import { getDetectiveToolNames, type DetectiveRole } from '../../../shared/detective-tools.ts';
import type { BotSlotConfig, HarnessId } from '../../../shared/storage-schemas.ts';
import harnessesMeta from './harnesses.json' with { type: 'json' };
import type { CommandProbe, HarnessAdapter } from './types.ts';

interface HarnessMetaEntry {
  id: HarnessId;
  binary: string;
  deliveryMode: 'mcp' | 'file';
  readsOwnerFiles: boolean;
  defaultModel: string;
  fallbackModels: string[];
  /** Short names the CLI also accepts, mapped to full model ids (saved bots are migrated). */
  modelAliases?: Record<string, string>;
}

/** The harness default goes first: a new bot and a harness switch both take the first model. */
export function withDefaultFirst(models: readonly string[], defaultModel: string): string[] {
  const unique = [...new Set(models)];
  return unique.includes(defaultModel)
    ? [defaultModel, ...unique.filter((m) => m !== defaultModel)]
    : unique;
}

/**
 * A bot slot as saved by an earlier version, brought up to date: a short alias ("haiku") becomes the
 * full model id so the slot matches the model list (a passed vision check keeps counting), and a
 * bot with an old default name picks up the current model-based name.
 */
export function migrateSavedBotSlot(stored: BotSlotConfig): BotSlotConfig {
  const model = resolveModelAlias(stored.harness, stored.model);
  const eyes = stored.eyes && {
    ...stored.eyes,
    model: resolveModelAlias(stored.eyes.harness, stored.eyes.model),
  };
  const check = stored.lastVisionCheck;
  // The check of a Detective tested its eyes, so it may name the eyes' model.
  const checkModel =
    check?.model === stored.model
      ? model
      : check?.model === stored.eyes?.model
        ? eyes?.model
        : null;
  return {
    ...stored,
    model,
    ...(eyes ? { eyes } : {}),
    name: isAutoBotName(stored.name, stored.model) ? botNameFromModel(model) : stored.name,
    lastVisionCheck: check && checkModel ? { ...check, model: checkModel } : check,
  };
}

/** Full model id for a saved alias ("haiku" -> "claude-haiku-5-5"); other names pass through. */
export function resolveModelAlias(harness: HarnessId, model: string): string {
  const aliases = getHarnessMeta(harness).modelAliases;
  // Own keys only: a saved model named like an object method ("constructor") stays a string.
  return aliases && Object.hasOwn(aliases, model) ? (aliases[model] ?? model) : model;
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

/**
 * The longest a CLI waits for one call of the game's tools. `ask`, `briefing` and `next_request`
 * of a Detective block for up to 45 s, so the client must not give up well before that.
 */
export const MCP_TOOL_TIMEOUT_SEC = 120;

/**
 * Every tool name the bridge may list for a launch: the tools of a Detective role, or of a camera
 * bot. Movement is included either way; a tool the bridge does not list is never called.
 */
export function geoToolNames(role: DetectiveRole | undefined): string[] {
  return role ? getDetectiveToolNames(role) : getBotToolDefinitions().map((t) => t.name);
}

export function buildSharedMcpEnv(opts: {
  apiUrl: string;
  botToken: string;
  deliveryMode: 'mcp' | 'file';
  moveEnabled: boolean;
  workDir: string;
  role?: DetectiveRole | undefined;
}): Record<string, string> {
  return {
    GEO_API_URL: opts.apiUrl,
    GEO_BOT_TOKEN: opts.botToken,
    GEO_DELIVERY_MODE: opts.deliveryMode,
    GEO_MOVE_ENABLED: opts.moveEnabled ? 'true' : 'false',
    ...(opts.deliveryMode === 'file' ? { GEO_WORK_DIR: opts.workDir } : {}),
    ...(opts.role ? { GEO_BOT_ROLE: opts.role } : {}),
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
    models: withDefaultFirst(meta.fallbackModels, meta.defaultModel),
  };
}

export type { CommandProbe, HarnessAdapter };
