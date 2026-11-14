import type { HarnessCatalogEntry } from '../../shared/protocol.ts';

export const FAKE_HARNESS_CATALOG: HarnessCatalogEntry[] = [
  {
    id: 'claude',
    available: true,
    readsOwnerFiles: false,
    models: ['haiku', 'sonnet', 'opus'],
  },
  {
    id: 'codex',
    available: true,
    readsOwnerFiles: false,
    models: ['gpt-6-luna', 'gpt-5.4', 'gpt-5.4-mini'],
  },
  {
    id: 'agy',
    available: true,
    readsOwnerFiles: true,
    models: ['gemini-3.8-flash-low', 'gemini-3.8-flash', 'gemini-3-pro'],
  },
];
