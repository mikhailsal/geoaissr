import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isKnownRegion } from '../../shared/regions.ts';
import {
  SETTINGS_FILE_VERSION,
  createDefaultSettings,
  settingsFileSchema,
  splitLegacyRegion,
  type SettingsFile,
} from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';
import { migrateObject, type LoadOutcome, type MigrationFn } from './migrate.ts';

export const SETTINGS_MIGRATIONS: Record<number, MigrationFn> = {
  // Version 2 split the map from the region; version 1 kept the airports map among the regions.
  1: (raw) => ({ ...raw, ...splitLegacyRegion(raw.region) }),
};

/** A region naming a country this build does not know (a hand-edited file) becomes the world. */
function withKnownRegion(outcome: LoadOutcome<SettingsFile>): LoadOutcome<SettingsFile> {
  if (isKnownRegion(outcome.value.region)) return outcome;
  return { ...outcome, value: { ...outcome.value, region: 'world' } };
}

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
  return withKnownRegion(
    migrateObject({
      rawText,
      filePath: settingsFile,
      schema: settingsFileSchema,
      defaultValue: createDefaultSettings,
      migrations: SETTINGS_MIGRATIONS,
      currentVersion: SETTINGS_FILE_VERSION,
    }),
  );
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
