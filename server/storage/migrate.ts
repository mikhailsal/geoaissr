import { renameSync } from 'node:fs';
import { z } from 'zod';

export const CURRENT_STORAGE_VERSION = 1;

export type LoadStatus = 'ok' | 'missing' | 'migrated' | 'unreadable' | 'newer_version';

export interface LoadOutcome<T> {
  status: LoadStatus;
  value: T;
  backupPath?: string;
  fileVersion?: number;
  errorDetail?: string;
}

const versionHeaderSchema = z.object({
  version: z.number().int().positive(),
});

export type MigrationFn = (raw: Record<string, unknown>) => Record<string, unknown>;

export function backupUnreadableFile(filePath: string, suffix = '.bad'): string {
  const backupPath = `${filePath}${suffix}`;
  try {
    renameSync(filePath, backupPath);
    return backupPath;
  } catch {
    return backupPath;
  }
}

export function migrateObject<T>(opts: {
  rawText: string;
  filePath: string;
  schema: z.ZodType<T>;
  defaultValue: () => T;
  migrations: Record<number, MigrationFn>;
  currentVersion?: number;
}): LoadOutcome<T> {
  const targetVersion = opts.currentVersion ?? CURRENT_STORAGE_VERSION;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(opts.rawText);
  } catch (err) {
    const backupPath = backupUnreadableFile(opts.filePath);
    return {
      status: 'unreadable',
      value: opts.defaultValue(),
      backupPath,
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }

  const header = versionHeaderSchema.safeParse(parsedJson);
  if (!header.success || typeof parsedJson !== 'object' || parsedJson === null) {
    const backupPath = backupUnreadableFile(opts.filePath);
    return {
      status: 'unreadable',
      value: opts.defaultValue(),
      backupPath,
      errorDetail: 'missing or invalid version field',
    };
  }

  let version = header.data.version;
  if (version > targetVersion) {
    return {
      status: 'newer_version',
      value: opts.defaultValue(),
      fileVersion: version,
      errorDetail: `version ${version} > supported ${targetVersion}`,
    };
  }

  let doc = { ...(parsedJson as Record<string, unknown>) };
  let migrated = false;
  while (version < targetVersion) {
    const step = opts.migrations[version];
    if (!step) {
      const backupPath = backupUnreadableFile(opts.filePath);
      return {
        status: 'unreadable',
        value: opts.defaultValue(),
        backupPath,
        errorDetail: `missing migration from version ${version}`,
      };
    }
    doc = step(doc);
    version += 1;
    doc.version = version;
    migrated = true;
  }

  const validated = opts.schema.safeParse(doc);
  if (!validated.success) {
    const backupPath = backupUnreadableFile(opts.filePath);
    return {
      status: 'unreadable',
      value: opts.defaultValue(),
      backupPath,
      errorDetail: validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }

  return { status: migrated ? 'migrated' : 'ok', value: validated.data };
}
