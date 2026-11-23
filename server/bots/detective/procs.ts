import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BotTokenUsage } from '../../../shared/bot-results.ts';
import type { EffortLevel } from '../../../shared/bot-tools.ts';
import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { formatStderrTail } from '../../log.ts';
import { spawnManaged, type ManagedProcess } from '../../proc/spawn.ts';
import { getHarnessAdapter } from '../adapters/index.ts';
import { buildSanitizedChildEnv } from '../adapters/shared.ts';
import type { RoundBotParams, RunnerCtx } from '../runner-types.ts';
import { createUsageParser } from '../usage.ts';

/** Launches one role of a Detective bot as a one-shot CLI process behind the MCP bridge. */

/**
 * `ask`, `briefing` and `next_request` block for up to 45 s. The CLI's own MCP timeout must stay
 * well above that, or the client gives up on a call the server is still answering.
 */
const MCP_TOOL_TIMEOUT_MS = 120_000;

export interface RoleExit {
  role: DetectiveRole;
  /** False when the OS never started the process (the CLI is missing, for example). */
  started: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  usage: BotTokenUsage | null;
  stderrTail: string[];
  durationMs: number;
}

export interface RoleProcess {
  role: DetectiveRole;
  proc: ManagedProcess;
  /** Resolves after the exit and the output drain; never rejects. */
  done: Promise<RoleExit>;
}

export function spawnRole(
  ctx: RunnerCtx,
  params: RoundBotParams,
  role: {
    role: DetectiveRole;
    workDir: string;
    token: string;
    prompt: string;
    effort: EffortLevel;
    canMove: boolean;
  },
): RoleProcess {
  const { slot } = params;
  mkdirSync(role.workDir, { recursive: true });
  const spec = ctx.buildCustomLaunchSpec
    ? ctx.buildCustomLaunchSpec({
        slot,
        workDir: role.workDir,
        apiUrl: ctx.api.baseUrl,
        botToken: role.token,
        prompt: role.prompt,
        role: role.role,
      })
    : getHarnessAdapter(slot.harness).buildLaunchSpec({
        workDir: role.workDir,
        model: slot.model,
        effort: role.effort,
        prompt: role.prompt,
        apiUrl: ctx.api.baseUrl,
        botToken: role.token,
        moveEnabled: role.canMove,
        role: role.role,
      });
  const parser = createUsageParser(slot.harness);
  const startedAtMs = Date.now();
  const proc = spawnManaged({
    cmd: spec.cmd,
    cwd: path.resolve(spec.cwd),
    env: { ...buildSanitizedChildEnv(), MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
    stdinText: spec.stdinText,
    kind: 'bot',
    childrenFile: ctx.childrenFile,
    onStdoutChunk: parser.push,
  });
  const done = proc.exited.then(async (exit): Promise<RoleExit> => {
    await proc.drained?.catch(() => undefined);
    let usage: BotTokenUsage | null = null;
    try {
      usage = parser.finish() ?? null;
    } catch {
      // A broken usage report must not hide the exit itself.
    }
    return {
      role: role.role,
      started: proc.pid > 0,
      code: exit.code,
      signal: exit.signal,
      usage,
      stderrTail: formatStderrTail(proc.getStderr(), 50),
      durationMs: Date.now() - startedAtMs,
    };
  });
  return { role: role.role, proc, done };
}

export function sumUsage(parts: readonly BotTokenUsage[]): BotTokenUsage {
  const total: BotTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  };
  for (const part of parts) {
    total.inputTokens += part.inputTokens;
    total.outputTokens += part.outputTokens;
    total.cachedInputTokens += part.cachedInputTokens;
    total.totalTokens += part.totalTokens;
  }
  return total;
}
