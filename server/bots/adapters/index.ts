import type { HarnessCatalogEntry } from '../../../shared/protocol.ts';
import type { HarnessId } from '../../../shared/storage-schemas.ts';
import { agyAdapter } from './agy.ts';
import { claudeAdapter } from './claude.ts';
import { codexAdapter } from './codex.ts';
import type { CommandProbe, HarnessAdapter } from './types.ts';

const ADAPTERS: Record<HarnessId, HarnessAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  agy: agyAdapter,
};

export function getHarnessAdapter(id: HarnessId): HarnessAdapter {
  return ADAPTERS[id];
}

export function detectAllHarnesses(probe?: CommandProbe): HarnessCatalogEntry[] {
  return [claudeAdapter.detect(probe), codexAdapter.detect(probe), agyAdapter.detect(probe)];
}

export type { BotLaunchOptions, BotLaunchSpec, CommandProbe, HarnessAdapter } from './types.ts';
