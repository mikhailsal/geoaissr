import type { QuotaSummaryView } from '../../shared/protocol.ts';
import type { SettingsFile } from '../../shared/storage-schemas.ts';
import type { AppPaths } from '../paths.ts';
import { createQuotaManager } from '../storage/quota.ts';

export function createConfiguredQuotaManager(paths: AppPaths, settings: SettingsFile) {
  return createQuotaManager(paths.quotaFile, Date.now, {
    ceilings: settings.quotaCeilings,
    apiUsageFile: paths.apiUsageFile,
  });
}

export function formatQuotaUsageLine(quota: QuotaSummaryView): string {
  return [
    `Static ${quota.staticUsed}/${quota.staticCeiling} (${quota.metrics.static.percent}%)`,
    `Pano ${quota.panoUsed}/${quota.panoCeiling} (${quota.metrics.pano.percent}%)`,
    `Карты ${quota.mapUsed}/${quota.mapCeiling} (${quota.metrics.map.percent}%)`,
  ].join(', ');
}
