import type { HarnessCatalogEntry, TunnelStatusView } from '../../shared/protocol.ts';

/** Only the launcher's private console receives the owner invitation. */
export function printRemoteOwnerInvite(guestUrl: string, localHostUrl: string): void {
  const ownerUrl = new URL(guestUrl);
  ownerUrl.searchParams.set('entry', 'owner');
  ownerUrl.hash = new URL(localHostUrl).hash;
  console.log(`Удалённый вход хоста (только для владельца): ${ownerUrl.href}`);
}

export function printStartupBanner(opts: {
  hostUrl: string;
  tunnel: TunnelStatusView;
  elapsedMs: number;
  quotaLine: string;
  harnesses: readonly HarnessCatalogEntry[];
  fakeMode: boolean;
}): void {
  const sec = Math.max(1, Math.round(opts.elapsedMs / 1000));
  const readyLabel =
    opts.tunnel.mode === 'local'
      ? `Сервер готов за ${sec} с (локальный режим --no-tunnel)`
      : opts.tunnel.status === 'ready'
        ? `Ссылка готова за ${sec} с`
        : `Внимание: ${opts.tunnel.errorReason ?? 'ссылка ещё проверяется'}`;
  const availableNames = opts.harnesses.filter((h) => h.available).map((h) => h.id);
  console.log('\n=== geoaissr ===');
  if (opts.fakeMode) console.log('Режим: ТЕСТОВЫЙ (--fake, без ключей Google и туннеля)');
  console.log(`Ссылка хоста:       ${opts.hostUrl}`);
  if (opts.tunnel.inviteUrl) {
    if (opts.tunnel.mode !== 'local' && opts.tunnel.status === 'ready') {
      printRemoteOwnerInvite(opts.tunnel.inviteUrl, opts.hostUrl);
    }
    console.log(`Приглашение гостям: ${opts.tunnel.inviteUrl}`);
  }
  console.log(`Статус:             ${readyLabel}`);
  console.log(`Квота за месяц:     ${opts.quotaLine}`);
  console.log(
    `Харнессы ИИ:        ${availableNames.length > 0 ? availableNames.join(', ') : 'нет доступных'}`,
  );
  console.log('================\n');
}
