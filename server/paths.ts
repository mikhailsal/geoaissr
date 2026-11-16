import { homedir } from 'node:os';
import path from 'node:path';

export interface AppPaths {
  configDir: string;
  dataDir: string;
  settingsFile: string;
  harnessVerifiedFile: string;
  quotaFile: string;
  apiUsageFile: string;
  matchesFile: string;
  profilesFile: string;
  logsDir: string;
  runDir: string;
  lockFile: string;
  childrenFile: string;
}

/**
 * Join path segments under `root` and refuse any result that escapes it.
 * Used for per-bot work directories that are later removed recursively.
 */
export function joinUnder(root: string, ...segments: string[]): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  if (target === base || !target.startsWith(base + path.sep)) {
    throw new Error(`Path escapes ${base}: ${segments.join('/')}`);
  }
  return target;
}

export function resolveAppPaths(env: Record<string, string | undefined> = process.env): AppPaths {
  const home = env.HOME || homedir();
  const configDir = path.resolve(env.GEOAISSR_CONFIG_DIR || path.join(home, '.config', 'geoaissr'));
  const dataDir = path.resolve(
    env.GEOAISSR_DATA_DIR || path.join(home, '.local', 'share', 'geoaissr'),
  );
  const logsDir = path.join(dataDir, 'logs');
  const runDir = path.join(dataDir, 'run');

  return {
    configDir,
    dataDir,
    settingsFile: path.join(configDir, 'settings.json'),
    harnessVerifiedFile: path.join(configDir, 'harness-verified.json'),
    quotaFile: path.join(dataDir, 'quota.json'),
    apiUsageFile: path.join(dataDir, 'api-usage.jsonl'),
    matchesFile: path.join(dataDir, 'matches.jsonl'),
    profilesFile: path.join(dataDir, 'profiles.json'),
    logsDir,
    runDir,
    lockFile: path.join(runDir, 'server.lock'),
    childrenFile: path.join(runDir, 'children.json'),
  };
}
