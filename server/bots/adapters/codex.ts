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

    return {
      id: 'codex',
      available: true,
      readsOwnerFiles: false,
      versionWarning,
      models: [...meta.fallbackModels],
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
    for (const tool of ['observe', 'look', 'move', 'submit_guess']) {
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
