import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MATCH_RECORD_VERSION,
  matchRecordSchema,
  type MatchRecord,
} from '../../shared/storage-schemas.ts';

export function appendMatchRecord(matchesFile: string, record: MatchRecord): void {
  const validated = matchRecordSchema.parse(record);
  mkdirSync(path.dirname(matchesFile), { recursive: true });
  appendFileSync(matchesFile, `${JSON.stringify(validated)}\n`, 'utf8');
}

export interface ReadMatchesResult {
  records: MatchRecord[];
  skippedNewer: number;
  skippedInvalid: number;
}

export function readMatchRecords(matchesFile: string): ReadMatchesResult {
  let text: string;
  try {
    text = readFileSync(matchesFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: [], skippedNewer: 0, skippedInvalid: 0 };
    }
    throw error;
  }
  const records: MatchRecord[] = [];
  let skippedNewer = 0;
  let skippedInvalid = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skippedInvalid += 1;
      continue;
    }
    const ver =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : null;
    if (typeof ver === 'number' && ver > MATCH_RECORD_VERSION) {
      skippedNewer += 1;
      continue;
    }
    const validated = matchRecordSchema.safeParse(parsed);
    if (!validated.success) {
      skippedInvalid += 1;
      continue;
    }
    records.push(validated.data);
  }
  return { records, skippedNewer, skippedInvalid };
}
