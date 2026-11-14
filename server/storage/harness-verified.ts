import { existsSync, readFileSync } from 'node:fs';
import {
  harnessVerifiedFileSchema,
  type HarnessId,
  type HarnessVerifiedFile,
} from '../../shared/storage-schemas.ts';
import { atomicWriteFile } from './settings.ts';

export function loadHarnessVerified(filePath: string): HarnessVerifiedFile {
  if (!existsSync(filePath)) {
    return { version: 1, harnesses: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const res = harnessVerifiedFileSchema.safeParse(parsed);
    return res.success ? res.data : { version: 1, harnesses: {} };
  } catch {
    return { version: 1, harnesses: {} };
  }
}

export function saveHarnessVerifiedEntry(
  filePath: string,
  harness: HarnessId,
  entry: { cliVersion: string; verifiedAt: string; deliveryMode: 'mcp' | 'file' },
): HarnessVerifiedFile {
  const current = loadHarnessVerified(filePath);
  const next: HarnessVerifiedFile = {
    version: 1,
    harnesses: {
      ...current.harnesses,
      [harness]: entry,
    },
  };
  atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
