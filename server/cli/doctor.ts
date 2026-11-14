import { existsSync } from 'node:fs';
import { loadHarnessVerified } from '../storage/harness-verified.ts';
import { createQuotaManager, QUOTA_CEILINGS, QUOTA_FREE_MONTHLY } from '../storage/quota.ts';
import { loadSettings } from '../storage/settings.ts';
import { detectAllHarnesses } from '../bots/adapters/index.ts';
import type { CommandProbe } from '../bots/adapters/types.ts';
import { resolveAppPaths } from '../paths.ts';
import { redactSecrets } from '../errors.ts';
import type { HarnessCatalogEntry } from '../../shared/protocol.ts';
import type { HarnessId } from '../../shared/storage-schemas.ts';

export type DoctorLevel = 'required' | 'warning' | 'info';

export interface DoctorCheckItem {
  code: string;
  level: DoctorLevel;
  ok: boolean;
  what: string;
  fix: string;
  context: string;
}

export interface DoctorCliFlags {
  json: boolean;
  noTunnel: boolean;
  publicUrl: string | null;
}

export function parseDoctorArgs(argv: readonly string[]): DoctorCliFlags {
  const flags: DoctorCliFlags = { json: false, noTunnel: false, publicUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--') continue;
    if (a === '--json') {
      flags.json = true;
    } else if (a === '--no-tunnel') {
      flags.noTunnel = true;
    } else if (a === '--public-url') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Флаг --public-url требует адрес https://...');
      }
      i += 1;
      flags.publicUrl = next.replace(/\/+$/, '');
    } else {
      throw new Error(`Неизвестный флаг doctor: ${a}`);
    }
  }
  if (flags.noTunnel && flags.publicUrl) {
    throw new Error('Флаги --no-tunnel и --public-url несовместимы');
  }
  return flags;
}

export function classifyMapsJsErrorCode(errorCode: string): string {
  const clean = errorCode.trim();
  const map: Record<string, string> = {
    RefererNotAllowedMapError:
      'Добавьте *.trycloudflare.com/*, http://localhost:*/* (и адрес из --public-url) в HTTP referrers браузерного ключа в Cloud Console -> Credentials.',
    ApiNotActivatedMapError:
      'Включите Maps JavaScript API в Google Cloud Console -> APIs & Services -> Library.',
    InvalidKeyMapError:
      'Проверьте значение GOOGLE_MAPS_BROWSER_KEY в .env — ключ недействителен или скопирован с пробелом.',
    BillingNotEnabledMapError:
      'Подключите биллинг в Google Cloud Console -> Billing (бесплатный лимит не срабатывает без привязанной карты).',
    OverQuotaMapError:
      'Превышена суточная или месячная квота Maps JavaScript API; проверьте Cloud Console -> Quotas.',
  };
  return (
    map[clean] ??
    `Ошибка Google Maps JS (${clean || 'unknown'}): проверьте ключ GOOGLE_MAPS_BROWSER_KEY, включённый Maps JavaScript API, биллинг и список referrer в Cloud Console.`
  );
}

export function interpretMetadataProbeResponse(
  statusText: string,
  errorMessage: string | undefined,
  serverKey: string,
): { ok: boolean; code: string; what: string; fix: string } {
  const safeErr = redactSecrets(errorMessage ?? '', [serverKey]);
  if (statusText === 'OK' || statusText === 'ZERO_RESULTS') {
    return {
      ok: true,
      code: 'GOOGLE_SERVER_KEY_OK',
      what: `Серверный ключ Google прошёл metadata-проверку (${statusText})`,
      fix: '',
    };
  }
  if (statusText === 'OVER_QUERY_LIMIT') {
    return {
      ok: false,
      code: 'GEO_GOOGLE_QUOTA',
      what: `Серверный ключ достиг лимита квоты (OVER_QUERY_LIMIT${safeErr ? `: ${safeErr}` : ''})`,
      fix: 'Проверьте суточную квоту Street View Static API в Cloud Console -> Quotas (рекомендуется 500 req/day).',
    };
  }
  const lower = safeErr.toLowerCase();
  if (lower.includes('not activated') || lower.includes('not authorized')) {
    return {
      ok: false,
      code: 'GEO_GOOGLE_KEY_DENIED',
      what: `Street View Static API не активирован (${safeErr})`,
      fix: 'Включите Street View Static API в Cloud Console -> APIs & Services -> Library и повторите `bun run doctor`.',
    };
  }
  if (lower.includes('billing')) {
    return {
      ok: false,
      code: 'GEO_GOOGLE_KEY_DENIED',
      what: `Не подключён биллинг Cloud Console (${safeErr})`,
      fix: 'Привяжите платёжный аккаунт в Cloud Console -> Billing (бесплатный лимит 10 000 запросов/мес действует только с биллингом).',
    };
  }
  if (lower.includes('expired') || lower.includes('invalid')) {
    return {
      ok: false,
      code: 'GEO_GOOGLE_KEY_DENIED',
      what: `Некорректный серверный ключ Google (${safeErr})`,
      fix: 'Проверьте GOOGLE_MAPS_SERVER_KEY в .env (без кавычек и лишних пробелов) или создайте новый ключ.',
    };
  }
  if (lower.includes('referer') || lower.includes('restriction') || lower.includes('ip')) {
    return {
      ok: false,
      code: 'GEO_GOOGLE_KEY_DENIED',
      what: `Ограничения серверного ключа блокируют запрос (${safeErr})`,
      fix: 'На серверном ключе оставьте только API-ограничение Street View Static API и уберите ограничение HTTP referrer.',
    };
  }
  return {
    ok: false,
    code: 'GEO_GOOGLE_KEY_DENIED',
    what: `Серверный ключ отклонён (${statusText || 'REQUEST_DENIED'}${safeErr ? `: ${safeErr}` : ''})`,
    fix: 'Проверьте по порядку: 1) ключ скопирован целиком, 2) включён Street View Static API, 3) подключён биллинг, 4) API-ограничение разрешает Street View Static API.',
  };
}

export interface DoctorDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  probe?: CommandProbe;
  which?: (bin: string) => string | null;
  bunVersion?: string;
}

function checkBunAndKeys(
  flags: DoctorCliFlags,
  env: Record<string, string | undefined>,
  bunVersion: string,
): DoctorCheckItem[] {
  const checks: DoctorCheckItem[] = [];
  const [maj, min, patch] = bunVersion.split('.').map((p) => Number.parseInt(p, 10));
  const bunOk =
    (maj ?? 0) > 1 ||
    ((maj ?? 0) === 1 && ((min ?? 0) > 4 || ((min ?? 0) === 4 && (patch ?? 0) >= 2)));
  checks.push({
    code: 'BUN_VERSION',
    level: 'required',
    ok: bunOk,
    what: `Bun ${bunVersion}`,
    fix: bunOk ? '' : 'Обновите Bun до >= 1.4.2 (`curl -fsSL https://bun.sh/install | bash`)',
    context: `required>=1.4.2, current=${bunVersion}`,
  });

  const browserKey = env.GOOGLE_MAPS_BROWSER_KEY?.trim() ?? '';
  const serverKey = env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  checks.push({
    code: 'GEO_ENV_KEY_MISSING',
    level: 'required',
    ok: Boolean(browserKey && serverKey),
    what:
      browserKey && serverKey
        ? 'Ключи Google заданы в окружении / .env'
        : 'Отсутствуют GOOGLE_MAPS_BROWSER_KEY или GOOGLE_MAPS_SERVER_KEY',
    fix:
      browserKey && serverKey
        ? ''
        : 'Скопируйте .env.example в .env и заполните оба ключа по инструкции README «Как получить ключи»',
    context: `browserKey=${browserKey ? 'set' : 'missing'}, serverKey=${serverKey ? 'set' : 'missing'}`,
  });

  const refRule = flags.publicUrl
    ? `${flags.publicUrl}/*`
    : '*.trycloudflare.com/* и http://localhost:*/*';
  checks.push({
    code: 'BROWSER_KEY_GUIDANCE',
    level: 'info',
    ok: true,
    what: `Ограничение referrer для браузерного ключа: ${refRule}`,
    fix: `Cloud Console -> Credentials -> браузерный ключ -> HTTP referrers: добавьте ${refRule}; дневные лимиты: Maps JS 500/день, Dynamic Pano 250/день, Static 500/день`,
    context: `monthlyFree: static=${QUOTA_FREE_MONTHLY.staticRequests}, pano=${QUOTA_FREE_MONTHLY.panoLoads}, map=${QUOTA_FREE_MONTHLY.mapLoads}`,
  });
  return checks;
}

async function checkServerKeyLive(
  serverKey: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<DoctorCheckItem> {
  if (!serverKey) {
    return {
      code: 'GEO_GOOGLE_KEY_DENIED',
      level: 'required',
      ok: false,
      what: 'Проверка серверного ключа пропущена (ключ не задан)',
      fix: 'Укажите GOOGLE_MAPS_SERVER_KEY в .env',
      context: 'metadata=skipped',
    };
  }
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=55.7558,37.6173&key=${encodeURIComponent(serverKey)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(6_000) });
    const data = (await res.json()) as { status?: string; error_message?: string };
    const interpreted = interpretMetadataProbeResponse(
      data.status ?? `HTTP_${res.status}`,
      data.error_message,
      serverKey,
    );
    return {
      code: interpreted.code,
      level: 'required',
      ok: interpreted.ok,
      what: interpreted.what,
      fix: interpreted.fix,
      context: `httpStatus=${res.status}, apiStatus=${data.status ?? 'unknown'}`,
    };
  } catch (err) {
    const safeMsg = redactSecrets(err instanceof Error ? err.message : String(err), [serverKey]);
    return {
      code: 'GEO_GOOGLE_KEY_DENIED',
      level: 'required',
      ok: false,
      what: `Сетевая ошибка при проверке серверного ключа (${safeMsg})`,
      fix: 'Проверьте доступность maps.googleapis.com и повторите `bun run doctor`',
      context: 'network_error',
    };
  }
}

function readHarnessVersion(probe: CommandProbe | undefined, id: HarnessId): string | null {
  if (probe) {
    const r = probe(id, ['--version'], 4_000);
    if (r.found && r.status === 0) return r.stdout.trim().split(/\r?\n/)[0] ?? null;
    return null;
  }
  const res = Bun.spawnSync([id, '--version'], { stdout: 'pipe', stderr: 'ignore' });
  if (res.exitCode !== 0) return null;
  return new TextDecoder().decode(res.stdout).trim().split(/\r?\n/)[0] ?? null;
}

function checkHarnesses(
  harnesses: readonly HarnessCatalogEntry[],
  verifiedFile: string,
  probe?: CommandProbe,
): DoctorCheckItem[] {
  const verified = loadHarnessVerified(verifiedFile).harnesses;
  const anyOk = harnesses.some((h) => h.available);
  const items: DoctorCheckItem[] = [
    {
      code: 'GEO_HARNESS_NOT_LOGGED_IN',
      level: 'required',
      ok: anyOk,
      what: anyOk
        ? `Доступные харнессы ИИ: ${harnesses
            .filter((h) => h.available)
            .map((h) => h.id)
            .join(', ')}`
        : 'Ни один ИИ-харнесс не установлен и не вошёл в подписку',
      fix: anyOk
        ? ''
        : 'Установите и войдите хотя бы в один CLI: `claude auth login`, `codex login` или `agy`',
      context: `available=${harnesses.filter((h) => h.available).length}/3`,
    },
  ];
  for (const h of harnesses) {
    const curVer = h.available ? readHarnessVersion(probe, h.id) : null;
    const prevVer = verified[h.id]?.cliVersion;
    const mismatch = Boolean(curVer && prevVer && curVer !== prevVer);
    const privacyNote = h.readsOwnerFiles ? '; читает файлы владельца' : '';
    const modelsNote = `модели: ${h.models.slice(0, 4).join(', ')}`;
    items.push({
      code: `HARNESS_${h.id.toUpperCase()}`,
      level: 'warning',
      ok: h.available && !mismatch,
      what: h.available
        ? `${h.id}: готов (${curVer ?? 'версия неизвестна'}${privacyNote}, ${modelsNote})${mismatch ? ` — расхождение с проверенной версией ${prevVer}` : ''}`
        : `${h.id}: ${h.reason ?? 'недоступен'}`,
      fix: !h.available
        ? (h.fixCommand ?? `Установите/войдите в ${h.id}`)
        : mismatch
          ? 'Запустите `bun run test:harness` после обновления CLI'
          : '',
      context: `available=${h.available}, readsOwnerFiles=${h.readsOwnerFiles}`,
    });
  }
  return items;
}

export function pickDoctorExitCode(checks: readonly DoctorCheckItem[]): 0 | 2 | 3 {
  const failed = checks.filter((c) => c.level === 'required' && !c.ok);
  if (failed.length === 0) return 0;
  const envCodes = new Set([
    'BUN_VERSION',
    'GEO_ENV_KEY_MISSING',
    'GEO_CLOUDFLARED_MISSING',
    'GEO_QUOTA_NEWER',
  ]);
  return failed.some((c) => envCodes.has(c.code)) ? 2 : 3;
}

function isPlaywrightInstalled(env: Record<string, string | undefined>): boolean {
  const cacheDir = env.PLAYWRIGHT_BROWSERS_PATH || `${env.HOME ?? ''}/.cache/ms-playwright`;
  return Boolean(cacheDir && existsSync(cacheDir));
}

function checkDevTools(
  env: Record<string, string | undefined>,
  which: (b: string) => string | null,
): DoctorCheckItem[] {
  const sc = which('shellcheck');
  const pwOk = isPlaywrightInstalled(env);
  return [
    {
      code: 'DEV_SHELLCHECK',
      level: 'warning',
      ok: Boolean(sc),
      what: sc ? `shellcheck найден (${sc})` : 'shellcheck не найден (нужен только для разработки)',
      fix: sc ? '' : 'Для разработки: `sudo apt install shellcheck` или `brew install shellcheck`',
      context: 'devOnly=true',
    },
    {
      code: 'DEV_PLAYWRIGHT',
      level: 'warning',
      ok: pwOk,
      what: pwOk
        ? 'Браузеры Playwright найдены'
        : 'Браузеры Playwright не найдены (нужны только для E2E)',
      fix: pwOk ? '' : 'Для разработки: `bunx playwright install chromium`',
      context: 'devOnly=true',
    },
  ];
}

function checkStorageAndDevTools(
  env: Record<string, string | undefined>,
  which: (b: string) => string | null,
  flags: DoctorCliFlags,
): DoctorCheckItem[] {
  const paths = resolveAppPaths(env);
  const items: DoctorCheckItem[] = [];
  const cfPath = which('cloudflared');
  const skipTunnel = flags.noTunnel || Boolean(flags.publicUrl);
  items.push({
    code: 'GEO_CLOUDFLARED_MISSING',
    level: 'required',
    ok: skipTunnel || Boolean(cfPath),
    what: skipTunnel
      ? 'cloudflared (пропущено из-за --no-tunnel / --public-url)'
      : cfPath
        ? `cloudflared найден (${cfPath})`
        : 'cloudflared не найден в PATH',
    fix:
      skipTunnel || cfPath
        ? ''
        : 'Установите cloudflared или запускайте с `--no-tunnel` / `--public-url`',
    context: `path=${cfPath ?? 'missing'}`,
  });

  const sOutcome = loadSettings(paths.settingsFile);
  items.push({
    code: 'SETTINGS_STATUS',
    level: 'warning',
    ok: sOutcome.status === 'ok' || sOutcome.status === 'missing',
    what:
      sOutcome.status === 'ok' || sOutcome.status === 'missing'
        ? `Настройки: OK (${paths.settingsFile})`
        : `Настройки (${sOutcome.status}): будут использованы значения по умолчанию`,
    fix: sOutcome.status === 'newer_version' ? 'Обновите geoaissr (`git pull && bun install`)' : '',
    context: `status=${sOutcome.status}`,
  });

  try {
    const qm = createQuotaManager(paths.quotaFile);
    const q = qm.getState();
    items.push({
      code: 'QUOTA_STATUS',
      level: 'warning',
      ok: !qm.needsResetConfirm(),
      what: `Квота за ${q.month} (UTC): Static ${q.staticRequests}/${QUOTA_CEILINGS.staticRequests}, Pano ${q.panoLoads}/${QUOTA_CEILINGS.panoLoads}, Карты ${q.mapLoads}/${QUOTA_CEILINGS.mapLoads}`,
      fix: qm.needsResetConfirm() ? 'Подтвердите сброс счётчика квоты в лобби хоста' : '',
      context: `resetNeeded=${qm.needsResetConfirm()}`,
    });
  } catch (err) {
    items.push({
      code: 'GEO_QUOTA_NEWER',
      level: 'required',
      ok: false,
      what: err instanceof Error ? err.message : 'Ошибка чтения quota.json',
      fix: 'Обновите geoaissr до новой версии',
      context: 'quota=error',
    });
  }

  return [...items, ...checkDevTools(env, which)];
}

export async function runDoctorChecks(
  flags: DoctorCliFlags,
  deps: DoctorDependencies = {},
): Promise<{ ok: boolean; checks: DoctorCheckItem[] }> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? ((u, i) => fetch(u, i));
  const which = deps.which ?? ((b) => Bun.which(b));
  const paths = resolveAppPaths(env);

  const checks: DoctorCheckItem[] = [
    ...checkBunAndKeys(flags, env, deps.bunVersion ?? Bun.version),
  ];
  const serverKey = env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  checks.push(await checkServerKeyLive(serverKey, fetchImpl));
  checks.push(...checkStorageAndDevTools(env, which, flags));

  const harnesses = detectAllHarnesses(deps.probe);
  checks.push(...checkHarnesses(harnesses, paths.harnessVerifiedFile, deps.probe));

  const ok = checks.every((c) => c.level !== 'required' || c.ok);
  return { ok, checks };
}

function printHumanReport(checks: readonly DoctorCheckItem[], ok: boolean): void {
  for (const c of checks) {
    const mark = c.ok ? '[OK]' : c.level === 'required' ? '[FAIL]' : '[WARN]';
    console.log(`${mark} ${c.what}`);
    if (c.fix) console.log(`       -> ${c.fix}`);
  }
  console.log(
    ok ? '\ndoctor: все обязательные проверки пройдены.' : '\ndoctor: есть критические проблемы.',
  );
}

async function main(): Promise<void> {
  let flags: DoctorCliFlags;
  try {
    flags = parseDoctorArgs(Bun.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const result = await runDoctorChecks(flags);
  if (flags.json) {
    console.log(JSON.stringify(result.checks, null, 2));
  } else {
    printHumanReport(result.checks, result.ok);
  }
  process.exit(pickDoctorExitCode(result.checks));
}

if (import.meta.main) {
  await main();
}
