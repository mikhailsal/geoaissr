import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { claudeAdapter } from '../../server/bots/adapters/claude.ts';
import { buildSanitizedChildEnv } from '../../server/bots/adapters/shared.ts';
import { createUsageParser } from '../../server/bots/usage.ts';
import { spawnManaged, type ManagedProcess } from '../../server/proc/spawn.ts';
import type { BotTokenUsage } from '../../shared/bot-results.ts';
import type { EffortLevel } from '../../shared/bot-tools.ts';
import type { Role } from './protocol.ts';

/** Launches one role as a one-shot `claude -p` process behind the Detective MCP bridge. */

export const BRIDGE_PATH = path.resolve(import.meta.dir, 'bridge.ts');

export interface RoleProcess {
  role: Role;
  proc: ManagedProcess;
  /** Resolves after exit and output drain, with the exit code and token usage. */
  done: Promise<{ code: number | null; usage: BotTokenUsage | null; stderrTail: string }>;
}

export function launchRole(opts: {
  role: Role;
  workDir: string;
  childrenFile: string;
  model: string;
  effort: EffortLevel;
  prompt: string;
  apiUrl: string;
  token: string;
}): RoleProcess {
  mkdirSync(opts.workDir, { recursive: true });
  const spec = claudeAdapter.buildLaunchSpec({
    workDir: opts.workDir,
    model: opts.model,
    effort: opts.effort,
    prompt: opts.prompt,
    apiUrl: opts.apiUrl,
    botToken: opts.token,
    moveEnabled: false,
    mcpScriptPath: BRIDGE_PATH,
  });
  const parser = createUsageParser('claude');
  const proc = spawnManaged({
    cmd: spec.cmd,
    cwd: path.resolve(spec.cwd),
    // Blocking calls (ask, next_request) last up to 30 s; keep the client timeout well above it.
    env: { ...buildSanitizedChildEnv(), MCP_TOOL_TIMEOUT: '120000' },
    kind: 'bot',
    childrenFile: opts.childrenFile,
    onStdoutChunk: parser.push,
  });
  const done = proc.exited.then(async (exit) => {
    await proc.drained;
    return {
      code: exit.code,
      usage: parser.finish() ?? null,
      stderrTail: proc.getStderr().slice(-400),
    };
  });
  return { role: opts.role, proc, done };
}
