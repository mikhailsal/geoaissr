import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createDefaultSettings,
  settingsFileSchema,
  type SettingsFile,
} from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';
import { migrateObject, type LoadOutcome, type MigrationFn } from './migrate.ts';

export const SETTINGS_MIGRATIONS: Record<number, MigrationFn> = {};

export function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

export function loadSettings(settingsFile: string): LoadOutcome<SettingsFile> {
  if (!existsSync(settingsFile)) {
    return { status: 'missing', value: createDefaultSettings() };
  }
  let rawText: string;
  try {
    rawText = readFileSync(settingsFile, 'utf8');
  } catch (err) {
    return {
      status: 'unreadable',
      value: createDefaultSettings(),
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
  return migrateObject({
    rawText,
    filePath: settingsFile,
    schema: settingsFileSchema,
    defaultValue: createDefaultSettings,
    migrations: SETTINGS_MIGRATIONS,
  });
}

export function saveSettings(
  settingsFile: string,
  settings: SettingsFile,
  sourceStatus?: LoadOutcome<SettingsFile>['status'],
): void {
  if (sourceStatus === 'newer_version') {
    throw new GeoError({
      code: 'GEO_SETTINGS_NEWER',
      causeDetail: 'refusing to overwrite newer settings.json',
    });
  }
  const validated = settingsFileSchema.parse(settings);
  atomicWriteFile(settingsFile, `${JSON.stringify(validated, null, 2)}\n`);
}
