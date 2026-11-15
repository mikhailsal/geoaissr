import type { SettingsFile } from '../../shared/storage-schemas.ts';
import type { LoadOutcome } from '../storage/migrate.ts';
import { saveSettings } from '../storage/settings.ts';

export function persistSettingsSafe(
  file: string,
  settings: SettingsFile,
  status: LoadOutcome<SettingsFile>['status'],
): void {
  if (status !== 'newer_version') saveSettings(file, settings, status);
}

export function writeResetSettings(
  file: string,
  settings: SettingsFile,
  status: LoadOutcome<SettingsFile>['status'],
): Promise<void> {
  try {
    saveSettings(file, settings, status);
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export function writeNormalSettings(
  file: string,
  settings: SettingsFile,
  status: LoadOutcome<SettingsFile>['status'],
): Promise<void> {
  return Promise.resolve().then(() => {
    persistSettingsSafe(file, settings, status);
  });
}
