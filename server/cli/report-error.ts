import {
  ERROR_REGISTRY,
  GeoError,
  redactSecrets,
  type ErrorCode,
  type ExitCode,
} from '../errors.ts';

export const APP_VERSION = '0.1.0';

export interface FormatErrorOptions {
  command: string;
  code: ErrorCode;
  what?: string;
  cause: string;
  context?: string;
  fix?: string;
  knownSecrets?: readonly string[];
  knownTokens?: readonly string[];
}

export function formatCliError(opts: FormatErrorOptions): string {
  const entry = ERROR_REGISTRY[opts.code];
  const secrets = opts.knownSecrets ?? [
    process.env.GOOGLE_MAPS_BROWSER_KEY ?? '',
    process.env.GOOGLE_MAPS_SERVER_KEY ?? '',
    process.env.GOOGLE_API_KEY ?? '',
  ];
  const tokens = opts.knownTokens ?? [];

  const what = redactSecrets(opts.what ?? entry.whatTemplate, secrets, tokens);
  const cause = redactSecrets(opts.cause, secrets, tokens);
  const fix = redactSecrets(opts.fix ?? entry.fixTemplate, secrets, tokens);
  const extraCtx = opts.context ? `; ${redactSecrets(opts.context, secrets, tokens)}` : '';
  const contextLine = `geoaissr ${APP_VERSION}, bun ${Bun.version}${extraCtx}`;

  return [
    `${opts.command}: ${what} (${opts.code})`,
    `  причина: ${cause}`,
    `  контекст: ${contextLine}`,
    `  исправить: ${fix} (${entry.docAnchor})`,
  ].join('\n');
}

export function reportCliError(opts: FormatErrorOptions): ExitCode {
  console.error(formatCliError(opts));
  return ERROR_REGISTRY[opts.code].exitCode;
}

export function exitWithGeoError(
  command: string,
  err: unknown,
  context?: string,
  knownTokens: readonly string[] = [],
): never {
  if (err instanceof GeoError) {
    const code = reportCliError({
      command,
      code: err.code,
      what: err.whatOverride,
      cause: err.causeDetail,
      context: err.context || context,
      fix: err.fixOverride,
      knownTokens,
    });
    process.exit(code);
  }
  const msg = err instanceof Error ? err.message : String(err);
  const code = reportCliError({
    command,
    code: 'GEO_CRASH',
    cause: msg,
    context,
    knownTokens,
  });
  process.exit(code);
}
