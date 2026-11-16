import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getBotToolDefinitions, MODEL_EFFORT_SUFFIX } from '../../../shared/bot-tools.ts';
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
  withDefaultFirst,
  writeJsonFile,
  type HarnessAdapter,
} from './shared.ts';

function parseAgyModelsOutput(stdout: string, fallback: readonly string[]): string[] {
  const discovered: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('-') || line.startsWith('Available') || line.startsWith('Usage')) {
      continue;
    }
    const token = line.split(/\s+/)[0];
    if (token && /^[a-z0-9._-]+$/i.test(token) && !discovered.includes(token)) {
      discovered.push(token);
    }
  }
  // The known list is only a stand-in for a failed listing; it must not add models agy lacks.
  return discovered.length > 0 ? discovered : [...fallback];
}

/**
 * agy models named like `gemini-4-argon-medium` already fix the reasoning effort, and agy rejects a
 * different `--effort` for them ("conflicts with --effort=low"). Pass `--effort` only to models
 * without such a suffix.
 */
export function agyEffortArgs(model: string, effort: string): string[] {
  return MODEL_EFFORT_SUFFIX.test(model) ? [] : ['--effort', effort];
}

/** Only the game's own MCP tools pass the guard; other servers loaded from the owner's config do not. */
const GEO_TOOL_NAMES = getBotToolDefinitions().map((t) => t.name);

/** PreToolUse attempts, consumed by the bot runner before its work directory is removed. */
export function agyToolAuditPath(workDir: string): string {
  return path.join(workDir, '.agents', 'plugins', 'geo', 'tool-audit.jsonl');
}

function buildAgyAuditLines(): string[] {
  return [
    `const markTruncated = () => { try { writeFileSync(auditPath + '.truncated', '1', { flag: 'wx', mode: 0o600 }); } catch {} };`,
    `let lock: number | undefined;`,
    `try {`,
    `  for (let i = 0; i < 10; i++) {`,
    `    try { lock = openSync(auditPath + '.lock', 'wx', 0o600); break; }`,
    `    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; await Bun.sleep(5); }`,
    `  }`,
    `  if (lock === undefined) { markTruncated(); } else {`,
    `    const line = JSON.stringify({ ts: new Date().toISOString(), tool: safeName(n) || 'unknown', decision: allow ? 'allow' : 'deny', ...(auditFile && { file: auditFile }), ...(auditServer && { server: auditServer }), ...(auditMcpTool && { mcpTool: auditMcpTool }) }) + '\\n';`,
    `    let size = 0;`,
    `    try { size = statSync(auditPath).size; } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }`,
    `    if (size + Buffer.byteLength(line) > 256 * 1024) markTruncated();`,
    `    else appendFileSync(auditPath, line, { mode: 0o600 });`,
    `  }`,
    `} catch { markTruncated(); } finally {`,
    `  if (lock !== undefined) { try { closeSync(lock); } catch {} try { unlinkSync(auditPath + '.lock'); } catch {} }`,
    `}`,
  ];
}

function buildAgyGuardScript(realWorkDir: string): string {
  return [
    `import path from 'node:path';`,
    `import { appendFileSync, closeSync, existsSync, openSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';`,
    `const wd = ${JSON.stringify(realWorkDir)};`,
    `const auditPath = ${JSON.stringify(agyToolAuditPath(realWorkDir))};`,
    `let allow = false;`,
    `let n = '';`,
    `let auditFile = '';`,
    `let auditServer = '';`,
    `let auditMcpTool = '';`,
    `const safeName = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(v) ? v : '';`,
    `try {`,
    `  const p = JSON.parse(await new Response(Bun.stdin.stream()).text());`,
    `  n = String(p?.toolCall?.name ?? '');`,
    `  const a = (p?.toolCall?.args && typeof p.toolCall.args === 'object' ? p.toolCall.args : {}) as Record<string, unknown>;`,
    `  const srvVals = ['serverName', 'ServerName', 'server_name'].map((k) => a[k]).filter((v) => v !== undefined);`,
    `  const s = srvVals.length === 1 || (srvVals.length > 1 && srvVals.every((v) => v === srvVals[0])) ? String(srvVals[0] ?? '') : '';`,
    `  auditServer = safeName(s);`,
    `  auditMcpTool = safeName(a.ToolName ?? a.toolName ?? a.tool_name);`,
    `  const geoTools = new Set(${JSON.stringify(GEO_TOOL_NAMES.map((t) => `mcp_geo_geo_${t}`))});`,
    `  allow = geoTools.has(n) || (n === 'call_mcp_tool' && (s === 'geo_geo' || s === 'geo'));`,
    `  if (!allow && (n === 'read_file' || n === 'view_file')) {`,
    `    const pathKeys = ['Path', 'path', 'file_path', 'target_file', 'TargetFile', 'uri'];`,
    `    const rawPaths = pathKeys.map((k) => a[k]).filter((v): v is string => typeof v === 'string');`,
    `    const raw = rawPaths.length > 0 && rawPaths.every((v) => v === rawPaths[0]) ? rawPaths[0] : null;`,
    `    if (raw) {`,
    `      auditFile = safeName(path.basename(raw));`,
    `      const abs = path.resolve(wd, raw);`,
    `      const resolved = existsSync(abs) ? realpathSync(abs) : realpathSync(path.dirname(abs));`,
    `      const agentsRoot = path.join(wd, '.agents');`,
    `      const inWd = resolved === wd || resolved.startsWith(wd + path.sep);`,
    `      const inAgents = resolved === agentsRoot || resolved.startsWith(agentsRoot + path.sep);`,
    `      allow = inWd && !inAgents;`,
    `    }`,
    `  }`,
    `} catch { allow = false; }`,
    ...buildAgyAuditLines(),
    `console.log(JSON.stringify(allow ? { decision: 'allow' } : { decision: 'deny', reason: 'geo_geo only (' + n + ')' }));`,
  ].join('\n');
}

export const agyAdapter: HarnessAdapter = {
  id: 'agy',
  deliveryMode: 'file',
  readsOwnerFiles: true,
  defaultModel: getHarnessMeta('agy').defaultModel,

  detect(probe = defaultCommandProbe): HarnessCatalogEntry {
    const meta = getHarnessMeta('agy');
    const ver = probe(meta.binary, ['--version'], 3000);
    if (!ver.found) {
      return formatUnavailable(
        meta,
        'CLI `agy` не найден в PATH',
        'Установите Antigravity CLI (`agy`) и выполните вход',
      );
    }
    if (ver.status !== 0) {
      return formatUnavailable(meta, 'Ошибка запуска `agy --version`', 'agy');
    }
    const tup = parseSemverTuple(ver.stdout);
    const versionWarning =
      tup && (tup[0] < 1 || (tup[0] === 1 && tup[1] < 5))
        ? `Рекомендуется agy >= 1.5 (обнаружено ${tup.join('.')})`
        : undefined;

    const modelsProbe = probe(meta.binary, ['models'], 4000);
    const models = withDefaultFirst(
      modelsProbe.status === 0
        ? parseAgyModelsOutput(modelsProbe.stdout, meta.fallbackModels)
        : meta.fallbackModels,
      meta.defaultModel,
    );

    return {
      id: 'agy',
      available: true,
      readsOwnerFiles: true,
      versionWarning,
      models,
    };
  },

  buildLaunchSpec(opts) {
    const createdWd = ensureWorkDir(opts.workDir);
    const realWd = realpathSync(createdWd);
    const mcpPath = resolveMcpToolsPath(opts.mcpScriptPath);
    const bunBin = resolveBunBinary(opts.bunBin);
    const env = buildSharedMcpEnv({
      apiUrl: opts.apiUrl,
      botToken: opts.botToken,
      deliveryMode: 'file',
      moveEnabled: opts.moveEnabled,
      workDir: realWd,
    });

    const pluginDir = path.join(realWd, '.agents', 'plugins', 'geo');
    mkdirSync(pluginDir, { recursive: true });
    writeJsonFile(path.join(pluginDir, 'plugin.json'), { name: 'geo' });
    writeJsonFile(
      path.join(pluginDir, 'mcp_config.json'),
      {
        mcpServers: { geo: { command: bunBin, args: ['run', mcpPath], env } },
      },
      0o600,
    );

    const guardPath = path.join(pluginDir, 'guard.ts');
    writeFileSync(guardPath, buildAgyGuardScript(realWd), 'utf8');
    writeJsonFile(path.join(pluginDir, 'hooks.json'), {
      'geo-only': {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: `${JSON.stringify(bunBin)} run ${JSON.stringify(guardPath)}`,
              },
            ],
          },
        ],
      },
    });

    const settingsPath = path.join(realWd, 'settings.json');
    writeJsonFile(settingsPath, { toolPermission: 'always-proceed' });

    return {
      cwd: realWd,
      deliveryMode: 'file',
      cmd: [
        'agy',
        `--print=${opts.prompt}`,
        '--model',
        opts.model,
        ...agyEffortArgs(opts.model, opts.effort),
        '--sandbox',
        '--disable-slash-commands',
        '--settings',
        settingsPath,
        '--output-format',
        'json',
      ],
    };
  },
};
