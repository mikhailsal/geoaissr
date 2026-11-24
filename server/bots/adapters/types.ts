import type { EffortLevel } from '../../../shared/bot-tools.ts';
import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import type { HarnessId } from '../../../shared/storage-schemas.ts';

export interface ProbeCommandResult {
  found: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CommandProbe = (
  binary: string,
  args: string[],
  timeoutMs?: number,
) => ProbeCommandResult;

export interface BotLaunchOptions {
  workDir: string;
  model: string;
  effort: EffortLevel;
  prompt: string;
  apiUrl: string;
  botToken: string;
  moveEnabled: boolean;
  /** Set for the two processes of a Detective bot: the bridge then lists that role's tools. */
  role?: DetectiveRole;
  mcpScriptPath?: string;
  bunBin?: string;
}

export interface BotLaunchSpec {
  cmd: string[];
  cwd: string;
  stdinText?: string;
  deliveryMode: 'mcp' | 'file';
}

export interface HarnessAdapter {
  id: HarnessId;
  deliveryMode: 'mcp' | 'file';
  readsOwnerFiles: boolean;
  defaultModel: string;
  detect: (probe?: CommandProbe) => HarnessCatalogEntry;
  buildLaunchSpec: (opts: BotLaunchOptions) => BotLaunchSpec;
}
