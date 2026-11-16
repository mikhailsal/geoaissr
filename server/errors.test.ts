import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatCliError } from './cli/report-error.ts';
import appPackage from '../package.json';
import { ERROR_CODES, ERROR_REGISTRY, maskToken, redactSecrets } from './errors.ts';

test('every error code in ERROR_REGISTRY has a matching section in docs/errors.md', () => {
  const docsPath = path.resolve(import.meta.dir, '../docs/errors.md');
  const docs = readFileSync(docsPath, 'utf8');
  for (const code of ERROR_CODES) {
    expect(docs).toContain(`## ${code}`);
    expect(ERROR_REGISTRY[code].docAnchor).toBe(`docs/errors.md#${code}`);
  }
});

test('error registry templates never interpolate env key values or secrets', () => {
  for (const entry of Object.values(ERROR_REGISTRY)) {
    expect(entry.whatTemplate).not.toMatch(/\$\{.*KEY/i);
    expect(entry.fixTemplate).not.toMatch(/\$\{.*KEY/i);
    expect([1, 2, 3, 70]).toContain(entry.exitCode);
  }
});

test('maskToken and redactSecrets strip keys and shorten tokens to 4 chars', () => {
  expect(maskToken('abcdef1234567890')).toBe('abcd…');
  expect(maskToken('ab')).toBe('****');
  const secret = 'AIzaSyFakeSecretValue123456';
  const token = 'HostToken998877665544';
  const redacted = redactSecrets(
    `key=${secret} AIzaSyAnotherKey_9988776655 url=#t=${token}`,
    [secret],
    [token],
  );
  expect(redacted).not.toContain(secret);
  expect(redacted).not.toContain(token);
  expect(redacted).not.toContain('AIzaSyAnotherKey');
  expect(redacted).toContain('[REDACTED]');
  expect(redacted).toContain('Host…');
});

// protects=registered profile credentials are masked in every accepted display spelling;
// fails_when=uppercase, hyphens or whitespace bypass masking, or arbitrary tokens become regex;
// why_new=profile login accepts normalized codes absent from prior error-format coverage;
// seam=none; no_claim=registered fixture strings only, not a claim about unknown secrets.
test('redactSecrets masks normalized profile code variants and keeps literal invitation matching', () => {
  const code = 'abcdef0123456789abcdef0123456789';
  const grouped = code.match(/.{4}/g) ?? [];
  const variants = [
    code,
    code.toUpperCase(),
    grouped.join('-'),
    grouped.join(' \t-').toUpperCase(),
  ];
  const input = variants.map((value) => `profile=${value}`).join(' | ');
  const redacted = redactSecrets(input, [], [code]);
  expect(variants.some((value) => redacted.includes(value))).toBe(false);
  expect(redacted.match(/abcd…/g)?.length).toBe(variants.length);
  const literal = 'invite.[a-z]+(token)';
  expect(redactSecrets(`${literal} inviteZa-token`, [], [literal])).toBe('invi… inviteZa-token');
});

// Protects the published version in CLI diagnostics; fails when a stale constant
// differs from package.json. Exercises formatted output, not a live tunnel.
test('formatCliError snapshot for GEO_TUNNEL_NOT_READY matches contract', () => {
  const out = formatCliError({
    command: 'start',
    code: 'GEO_TUNNEL_NOT_READY',
    what: 'публичная ссылка https://demo.trycloudflare.com не ответила за 60 с: DNS не разрешает имя',
    cause: 'DoH cloudflare-dns.com и dns.google вернули NXDOMAIN',
    context: 'cloudflared 2025.11.1; сервер работает на localhost:5174, партия не начата',
    fix: 'остановите start (Ctrl+C) и запустите снова `bun run start`; повторять можно, ничего не потеряется',
  });
  expect(out).toBe(
    [
      'start: публичная ссылка https://demo.trycloudflare.com не ответила за 60 с: DNS не разрешает имя (GEO_TUNNEL_NOT_READY)',
      '  причина: DoH cloudflare-dns.com и dns.google вернули NXDOMAIN',
      `  контекст: geoaissr ${appPackage.version}, bun ${Bun.version}; cloudflared 2025.11.1; сервер работает на localhost:5174, партия не начата`,
      '  исправить: остановите start (Ctrl+C) и запустите снова `bun run start`; повторять можно, ничего не потеряется (docs/errors.md#GEO_TUNNEL_NOT_READY)',
    ].join('\n'),
  );
});

test('formatCliError snapshot for GEO_GOOGLE_KEY_DENIED masks inline key', () => {
  const fakeKey = 'AIzaSyTestLeak9876543210';
  const out = formatCliError({
    command: 'doctor',
    code: 'GEO_GOOGLE_KEY_DENIED',
    cause: `Google returned REQUEST_DENIED for key=${fakeKey}`,
    knownSecrets: [fakeKey],
  });
  expect(out).not.toContain(fakeKey);
  expect(out).toContain(
    'doctor: серверный ключ Google отклонён (REQUEST_DENIED) (GEO_GOOGLE_KEY_DENIED)',
  );
  expect(out).toContain('  исправить: ');
  expect(out).toContain('(docs/errors.md#GEO_GOOGLE_KEY_DENIED)');
});

test('formatCliError snapshot for GEO_ENV_KEY_MISSING uses registry templates', () => {
  const out = formatCliError({
    command: 'start',
    code: 'GEO_ENV_KEY_MISSING',
    cause: 'отсутствует GOOGLE_MAPS_SERVER_KEY в .env',
  });
  expect(out).toBe(
    [
      'start: не задан ключ Google в .env (GEO_ENV_KEY_MISSING)',
      '  причина: отсутствует GOOGLE_MAPS_SERVER_KEY в .env',
      `  контекст: geoaissr ${appPackage.version}, bun ${Bun.version}`,
      '  исправить: скопируйте .env.example в .env и заполните GOOGLE_MAPS_BROWSER_KEY и GOOGLE_MAPS_SERVER_KEY по разделу README «How to get Google Maps Platform keys» (docs/errors.md#GEO_ENV_KEY_MISSING)',
    ].join('\n'),
  );
});
