import path from 'node:path';
import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import {
  buildSharedMcpEnv,
  defaultCommandProbe,
  ensureWorkDir,
  formatUnavailable,
  getHarnessMeta,
  parseSemverTuple,
  resolveBunBinary,
  resolveMcpToolsPath,
  writeJsonFile,
  type CommandProbe,
  type HarnessAdapter,
} from './shared.ts';

function checkClaudeAuth(probe: CommandProbe): { ok: boolean; reason?: string } {
  const auth = probe('claude', ['auth', 'status'], 4000);
  if (auth.status !== 0) {
    return { ok: false, reason: 'Не выполнен вход в Claude Code CLI' };
  }
  try {
    const parsed = JSON.parse(auth.stdout) as { loggedIn?: boolean };
    if (parsed.loggedIn === false) {
      return { ok: false, reason: 'Сессия Claude Code не авторизована' };
    }
  } catch {
    if (!/logged in|true/i.test(auth.stdout) && auth.stdout.trim().length > 0) {
      return { ok: false, reason: 'Не удалось подтвердить авторизацию Claude Code' };
    }
  }
  return { ok: true };
}

export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  deliveryMode: 'mcp',
  readsOwnerFiles: false,
  defaultModel: getHarnessMeta('claude').defaultModel,

  detect(probe = defaultCommandProbe): HarnessCatalogEntry {
    const meta = getHarnessMeta('claude');
    const ver = probe(meta.binary, ['--version'], 3000);
    if (!ver.found) {
      return formatUnavailable(
        meta,
        'CLI `claude` не найден в PATH',
        'npm i -g @anthropic-ai/claude-code && claude auth login',
      );
    }
    if (ver.status !== 0) {
      return formatUnavailable(meta, 'Ошибка запуска `claude --version`', 'claude auth login');
    }
    const tup = parseSemverTuple(ver.stdout);
    const versionWarning =
      tup && tup[0] < 2
        ? `Рекомендуется Claude Code >= 2.0 (обнаружено ${tup.join('.')})`
        : undefined;

    const auth = checkClaudeAuth(probe);
    if (!auth.ok) {
      return formatUnavailable(
        meta,
        auth.reason ?? 'Нет авторизации Claude Code',
        'claude auth login',
        versionWarning,
      );
    }

    return {
      id: 'claude',
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
    const env = buildSharedMcpEnv({
      apiUrl: opts.apiUrl,
      botToken: opts.botToken,
      deliveryMode: 'mcp',
      moveEnabled: opts.moveEnabled,
      workDir: cwd,
    });
    const cfgPath = path.join(cwd, 'mcp-config.json');
    writeJsonFile(
      cfgPath,
      {
        mcpServers: {
          geo: { command: bunBin, args: ['run', mcpPath], env },
        },
      },
      0o600,
    );

    return {
      cwd,
      deliveryMode: 'mcp',
      cmd: [
        'claude',
        '-p',
        opts.prompt,
        '--model',
        opts.model,
        '--effort',
        opts.effort,
        '--mcp-config',
        cfgPath,
        '--strict-mcp-config',
        '--tools',
        '',
        '--allowedTools',
        'mcp__geo__*',
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--output-format',
        'json',
      ],
    };
  },
};
