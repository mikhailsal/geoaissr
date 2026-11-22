import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import {
  defaultCommandProbe,
  ensureWorkDir,
  formatUnavailable,
  getHarnessMeta,
  parseSemverTuple,
  resolveBunBinary,
  resolveMcpToolsPath,
  withDefaultFirst,
  type CommandProbe,
  type HarnessAdapter,
} from './shared.ts';

function checkCodexAuth(probe: CommandProbe): { ok: boolean; reason?: string } {
  const login = probe('codex', ['login', 'status'], 4000);
  if (login.status !== 0) {
    return { ok: false, reason: 'Не выполнен вход в Codex CLI' };
  }
  const combined = `${login.stdout}\n${login.stderr}`;
  if (/not logged in|please sign in|logged out/i.test(combined)) {
    return { ok: false, reason: 'Сессия Codex CLI не авторизована' };
  }
  return { ok: true };
}

/**
 * Models from `codex debug models` (the CLI's own catalog): the ones Codex shows in its picker and
 * that accept images, in Codex's priority order. Falls back to the list in harnesses.json.
 */
export function parseCodexModelsCatalog(stdout: string, fallback: readonly string[]): string[] {
  try {
    const parsed = JSON.parse(stdout) as {
      models?: Array<{
        slug?: unknown;
        visibility?: unknown;
        priority?: unknown;
        input_modalities?: unknown;
      }>;
    };
    const models = (parsed.models ?? [])
      .filter(
        (m) =>
          typeof m.slug === 'string' &&
          m.visibility === 'list' &&
          Array.isArray(m.input_modalities) &&
          m.input_modalities.includes('image'),
      )
      .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0))
      .map((m) => String(m.slug));
    return models.length > 0 ? models : [...fallback];
  } catch {
    return [...fallback];
  }
}

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  deliveryMode: 'mcp',
  readsOwnerFiles: false,
  defaultModel: getHarnessMeta('codex').defaultModel,

  detect(probe = defaultCommandProbe): HarnessCatalogEntry {
    const meta = getHarnessMeta('codex');
    const ver = probe(meta.binary, ['--version'], 3000);
    if (!ver.found) {
      return formatUnavailable(meta, 'CLI `codex` не найден в PATH', 'codex login');
    }
    if (ver.status !== 0) {
      return formatUnavailable(meta, 'Ошибка запуска `codex --version`', 'codex login');
    }
    const tup = parseSemverTuple(ver.stdout);
    const versionWarning =
      tup && tup[0] === 0 && tup[1] < 100
        ? `Рекомендуется codex-cli >= 0.100 (обнаружено ${tup.join('.')})`
        : undefined;

    const auth = checkCodexAuth(probe);
    if (!auth.ok) {
      return formatUnavailable(
        meta,
        auth.reason ?? 'Нет авторизации Codex CLI',
        'codex login',
        versionWarning,
      );
    }

    const modelsProbe = probe(meta.binary, ['debug', 'models'], 8000);
    return {
      id: 'codex',
      available: true,
      readsOwnerFiles: false,
      versionWarning,
      models: withDefaultFirst(
        modelsProbe.status === 0
          ? parseCodexModelsCatalog(modelsProbe.stdout, meta.fallbackModels)
          : meta.fallbackModels,
        meta.defaultModel,
      ),
    };
  },

  buildLaunchSpec(opts) {
    const cwd = ensureWorkDir(opts.workDir);
    const mcpPath = resolveMcpToolsPath(opts.mcpScriptPath);
    const bunBin = resolveBunBinary(opts.bunBin);
    const tokenFile = path.join(cwd, 'geo-bot-token');
    writeFileSync(tokenFile, opts.botToken, { encoding: 'utf8', mode: 0o600 });
    const env: Record<string, string> = {
      GEO_API_URL: opts.apiUrl,
      GEO_BOT_TOKEN_FILE: tokenFile,
      GEO_DELIVERY_MODE: 'mcp',
      GEO_MOVE_ENABLED: opts.moveEnabled ? 'true' : 'false',
    };

    const args: string[] = [
      'codex',
      'exec',
      '-m',
      opts.model,
      '-c',
      `model_reasoning_effort=${JSON.stringify(opts.effort)}`,
      '-c',
      'web_search="disabled"',
      '-c',
      'features.apps=false',
      '-c',
      'features.shell_tool=false',
      '-c',
      `mcp_servers.geo.command=${JSON.stringify(bunBin)}`,
      '-c',
      `mcp_servers.geo.args=${JSON.stringify(['run', mcpPath])}`,
    ];
    for (const [k, v] of Object.entries(env)) {
      args.push('-c', `mcp_servers.geo.env.${k}=${JSON.stringify(v)}`);
    }
    for (const tool of ['observe', 'look', 'move', 'final_guess']) {
      args.push('-c', `mcp_servers.geo.tools.${tool}.approval_mode="approve"`);
    }
    args.push(
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      '-C',
      cwd,
      '-',
    );

    return {
      cwd,
      stdinText: opts.prompt,
      deliveryMode: 'mcp',
      cmd: args,
    };
  },
};
