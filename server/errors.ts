export type ErrorClass = 'usage' | 'environment' | 'dependency' | 'unexpected';
export type ExitCode = 1 | 2 | 3 | 70;

export interface ErrorRegistryEntry {
  code: ErrorCode;
  errorClass: ErrorClass;
  exitCode: ExitCode;
  whatTemplate: string;
  fixTemplate: string;
  docAnchor: string;
}

export const ERROR_CODES = [
  'GEO_INVALID_ARGS',
  'GEO_ENV_KEY_MISSING',
  'GEO_PORT_BUSY',
  'GEO_CLOUDFLARED_MISSING',
  'GEO_ALREADY_RUNNING',
  'GEO_SETTINGS_UNREADABLE',
  'GEO_SETTINGS_NEWER',
  'GEO_QUOTA_UNREADABLE',
  'GEO_QUOTA_NEWER',
  'GEO_TUNNEL_NOT_READY',
  'GEO_GOOGLE_KEY_DENIED',
  'GEO_GOOGLE_QUOTA',
  'GEO_HARNESS_NOT_LOGGED_IN',
  'GEO_HARNESS_HIDDEN',
  'GEO_QUOTA_CEILING',
  'GEO_CRASH',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_REGISTRY: Record<ErrorCode, ErrorRegistryEntry> = {
  GEO_INVALID_ARGS: {
    code: 'GEO_INVALID_ARGS',
    errorClass: 'usage',
    exitCode: 1,
    whatTemplate: 'неверные аргументы команды',
    fixTemplate: 'проверьте флаги запуска и повторите команду; повторять можно',
    docAnchor: 'docs/errors.md#GEO_INVALID_ARGS',
  },
  GEO_ENV_KEY_MISSING: {
    code: 'GEO_ENV_KEY_MISSING',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'не задан ключ Google в .env',
    fixTemplate:
      'скопируйте .env.example в .env и заполните GOOGLE_MAPS_BROWSER_KEY и GOOGLE_MAPS_SERVER_KEY по разделу README «How to get Google Maps Platform keys»',
    docAnchor: 'docs/errors.md#GEO_ENV_KEY_MISSING',
  },
  GEO_PORT_BUSY: {
    code: 'GEO_PORT_BUSY',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'порт уже занят другим процессом',
    fixTemplate: 'освободите порт или запустите с другим портом: `bun run start --port 5175`',
    docAnchor: 'docs/errors.md#GEO_PORT_BUSY',
  },
  GEO_CLOUDFLARED_MISSING: {
    code: 'GEO_CLOUDFLARED_MISSING',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'не найден cloudflared в PATH',
    fixTemplate:
      'установите cloudflared или запустите локально без туннеля: `bun run start --no-tunnel`',
    docAnchor: 'docs/errors.md#GEO_CLOUDFLARED_MISSING',
  },
  GEO_ALREADY_RUNNING: {
    code: 'GEO_ALREADY_RUNNING',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'сервер с тем же каталогом данных уже запущен',
    fixTemplate:
      'остановите запущенный сервер или задайте отдельный GEOAISSR_DATA_DIR; повторять можно',
    docAnchor: 'docs/errors.md#GEO_ALREADY_RUNNING',
  },
  GEO_SETTINGS_UNREADABLE: {
    code: 'GEO_SETTINGS_UNREADABLE',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'файл settings.json повреждён и переименован в .bad',
    fixTemplate: 'проверьте настройки в лобби; игра использует значения по умолчанию',
    docAnchor: 'docs/errors.md#GEO_SETTINGS_UNREADABLE',
  },
  GEO_SETTINGS_NEWER: {
    code: 'GEO_SETTINGS_NEWER',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'файл settings.json создан более новой версией geoaissr',
    fixTemplate:
      'обновите geoaissr (`git pull && bun install`) или используйте настройки по умолчанию',
    docAnchor: 'docs/errors.md#GEO_SETTINGS_NEWER',
  },
  GEO_QUOTA_UNREADABLE: {
    code: 'GEO_QUOTA_UNREADABLE',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'файл квоты quota.json повреждён и переименован в .bad',
    fixTemplate: 'сверьте расход в Cloud Console и подтвердите сброс в лобби хоста',
    docAnchor: 'docs/errors.md#GEO_QUOTA_UNREADABLE',
  },
  GEO_QUOTA_NEWER: {
    code: 'GEO_QUOTA_NEWER',
    errorClass: 'environment',
    exitCode: 2,
    whatTemplate: 'файл квоты quota.json создан более новой версией geoaissr',
    fixTemplate: 'обновите geoaissr (`git pull && bun install && bun run start`), файл не изменён',
    docAnchor: 'docs/errors.md#GEO_QUOTA_NEWER',
  },
  GEO_TUNNEL_NOT_READY: {
    code: 'GEO_TUNNEL_NOT_READY',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'публичная ссылка туннеля не ответила за 60 с',
    fixTemplate:
      'остановите start (Ctrl+C) и запустите снова `bun run start`; повторять можно, ничего не потеряется',
    docAnchor: 'docs/errors.md#GEO_TUNNEL_NOT_READY',
  },
  GEO_GOOGLE_KEY_DENIED: {
    code: 'GEO_GOOGLE_KEY_DENIED',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'серверный ключ Google отклонён (REQUEST_DENIED)',
    fixTemplate:
      'проверьте ключ, включённый Street View Static API и биллинг в Cloud Console, затем повторите `bun run doctor`',
    docAnchor: 'docs/errors.md#GEO_GOOGLE_KEY_DENIED',
  },
  GEO_GOOGLE_QUOTA: {
    code: 'GEO_GOOGLE_QUOTA',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'превышена квота Google Maps Platform (OVER_QUERY_LIMIT / 429)',
    fixTemplate:
      'проверьте дневные квоты в Cloud Console и текущий расход в quota.json; повторять после сброса квоты',
    docAnchor: 'docs/errors.md#GEO_GOOGLE_QUOTA',
  },
  GEO_HARNESS_NOT_LOGGED_IN: {
    code: 'GEO_HARNESS_NOT_LOGGED_IN',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'ни один допущенный ИИ-харнесс не вошёл в подписку',
    fixTemplate: 'выполните вход в codex, claude или agy и повторите `bun run doctor`',
    docAnchor: 'docs/errors.md#GEO_HARNESS_NOT_LOGGED_IN',
  },
  GEO_HARNESS_HIDDEN: {
    code: 'GEO_HARNESS_HIDDEN',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'харнесс недоступен или не прошёл критерий спайка S1',
    fixTemplate: 'выберите другой харнесс в лобби или проверьте вход командой `bun run doctor`',
    docAnchor: 'docs/errors.md#GEO_HARNESS_HIDDEN',
  },
  GEO_QUOTA_CEILING: {
    code: 'GEO_QUOTA_CEILING',
    errorClass: 'dependency',
    exitCode: 3,
    whatTemplate: 'достигнут месячный потолок расхода квоты приложения',
    fixTemplate: 'уменьшите число раундов, ботов или ходов в лобби и повторите запуск партии',
    docAnchor: 'docs/errors.md#GEO_QUOTA_CEILING',
  },
  GEO_CRASH: {
    code: 'GEO_CRASH',
    errorClass: 'unexpected',
    exitCode: 70,
    whatTemplate: 'непредвиденный сбой сервера',
    fixTemplate: 'запустите `bun run start` снова; партия потеряна, сыгранные раунды не записаны',
    docAnchor: 'docs/errors.md#GEO_CRASH',
  },
};

export class GeoError extends Error {
  readonly code: ErrorCode;
  readonly causeDetail: string;
  readonly context: string;
  readonly whatOverride?: string;
  readonly fixOverride?: string;

  constructor(params: {
    code: ErrorCode;
    causeDetail: string;
    context?: string;
    what?: string;
    fix?: string;
  }) {
    const entry = ERROR_REGISTRY[params.code];
    super(params.what ?? entry.whatTemplate);
    this.name = 'GeoError';
    this.code = params.code;
    this.causeDetail = params.causeDetail;
    this.context = params.context ?? '';
    this.whatOverride = params.what;
    this.fixOverride = params.fix;
  }
}

export function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return `${token.slice(0, 4)}…`;
}

export function redactSecrets(
  input: string,
  knownSecrets: readonly string[] = [],
  knownTokens: readonly string[] = [],
): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  for (const token of knownTokens) {
    if (/^[0-9a-f]{32}$/i.test(token)) {
      // Only hex credentials become patterns; invitation tokens otherwise stay literal.
      const spelling = new RegExp(token.split('').join('[\\s-]*'), 'gi');
      out = out.replace(spelling, maskToken(token));
    } else if (token && token.length >= 8) {
      out = out.split(token).join(maskToken(token));
    }
  }
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  out = out.replace(/(#t=)([^\s"']+)/gi, (_m, p1: string, tok: string) => `${p1}${maskToken(tok)}`);
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]');
  return out;
}
