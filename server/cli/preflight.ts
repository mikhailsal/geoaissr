import { REGION_IDS, type RegionId } from '../../shared/storage-schemas.ts';
import { GeoError } from '../errors.ts';

export interface StartCliOptions {
  fake: boolean;
  noTunnel: boolean;
  noOpen: boolean;
  port: number;
  publicUrl: string | null;
  roundsOverride?: number;
  regionOverride?: RegionId;
  durationOverride?: number;
  noMoveOverride?: boolean;
}

const VALUE_FLAGS = new Set(['--port', '--public-url', '--rounds', '--region', '--duration']);

function parsePositiveInt(val: string, flag: string, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new GeoError({
      code: 'GEO_INVALID_ARGS',
      causeDetail: `Флаг ${flag} требует целое число от ${min} до ${max} (получено «${val}»)`,
    });
  }
  return n;
}

function parseDefaultPort(env: Record<string, string | undefined>): number {
  const raw = env.PORT?.trim();
  if (!raw) return 5174;
  return parsePositiveInt(raw, 'PORT', 1, 65535);
}

function applyValueFlag(opts: StartCliOptions, arg: string, val: string): void {
  if (arg === '--port') {
    opts.port = parsePositiveInt(val, '--port', 1, 65535);
    return;
  }
  if (arg === '--rounds') {
    opts.roundsOverride = parsePositiveInt(val, '--rounds', 1, 20);
    return;
  }
  if (arg === '--duration') {
    opts.durationOverride = parsePositiveInt(val, '--duration', 30, 600);
    return;
  }
  if (arg === '--region') {
    if (!(REGION_IDS as readonly string[]).includes(val)) {
      throw new GeoError({
        code: 'GEO_INVALID_ARGS',
        causeDetail: `Неизвестный регион «${val}». Доступно: ${REGION_IDS.join(', ')}`,
      });
    }
    opts.regionOverride = val as RegionId;
    return;
  }
  if (arg === '--public-url') {
    let parsed: URL;
    try {
      parsed = new URL(val);
    } catch {
      throw new GeoError({
        code: 'GEO_INVALID_ARGS',
        causeDetail: `Некорректный URL для --public-url: «${val}»`,
      });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new GeoError({
        code: 'GEO_INVALID_ARGS',
        causeDetail: `--public-url должен начинаться с http:// или https://`,
      });
    }
    opts.publicUrl = val.replace(/\/+$/, '');
  }
}

export function parseStartArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): StartCliOptions {
  const opts: StartCliOptions = {
    fake: false,
    noTunnel: false,
    noOpen: false,
    port: parseDefaultPort(env),
    publicUrl: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (arg === '--fake') {
      opts.fake = true;
    } else if (arg === '--no-tunnel') {
      opts.noTunnel = true;
    } else if (arg === '--no-open') {
      opts.noOpen = true;
    } else if (arg === '--no-move') {
      opts.noMoveOverride = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        throw new GeoError({
          code: 'GEO_INVALID_ARGS',
          causeDetail: `Не задано значение для флага ${arg}`,
        });
      }
      i += 1;
      applyValueFlag(opts, arg, val);
    } else {
      throw new GeoError({
        code: 'GEO_INVALID_ARGS',
        causeDetail: `Неизвестный аргумент командной строки: «${arg}»`,
      });
    }
  }
  if (opts.noTunnel && opts.publicUrl) {
    throw new GeoError({
      code: 'GEO_INVALID_ARGS',
      causeDetail: 'Флаги --public-url и --no-tunnel несовместимы: выберите один режим',
      fix: 'уберите --no-tunnel для проверки собственного публичного адреса или уберите --public-url',
    });
  }
  return opts;
}

export function resolveGoogleEnvKeys(
  fakeMode: boolean,
  env: Record<string, string | undefined> = process.env,
): { browserKey: string | null; serverKey: string | null } {
  const browserKey = env.GOOGLE_MAPS_BROWSER_KEY?.trim() ?? '';
  const serverKey = env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? '';
  if (fakeMode) {
    return { browserKey: browserKey || null, serverKey: serverKey || null };
  }
  const missing: string[] = [];
  if (!browserKey) missing.push('GOOGLE_MAPS_BROWSER_KEY');
  if (!serverKey) missing.push('GOOGLE_MAPS_SERVER_KEY');
  if (missing.length > 0) {
    throw new GeoError({
      code: 'GEO_ENV_KEY_MISSING',
      causeDetail: `Не заданы ключи в .env / окружении: ${missing.join(', ')}`,
    });
  }
  return { browserKey, serverKey };
}

export async function assertPortAvailable(port: number): Promise<void> {
  if (port === 0) return;
  try {
    const srv = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('ok'),
    });
    await srv.stop(true);
  } catch (err) {
    throw new GeoError({
      code: 'GEO_PORT_BUSY',
      causeDetail: `Порт 127.0.0.1:${port} уже занят (${err instanceof Error ? err.message : String(err)})`,
    });
  }
}
