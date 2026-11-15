import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { saveHarnessVerifiedEntry } from '../storage/harness-verified.ts';
import type { CommandProbe } from '../bots/adapters/types.ts';
import {
  classifyMapsJsErrorCode,
  interpretMetadataProbeResponse,
  parseDoctorArgs,
  pickDoctorExitCode,
  runDoctorChecks,
} from './doctor.ts';

function makeOkProbe(cliVersion = '2.1.323'): CommandProbe {
  return (bin, args) => {
    if (args.includes('--version'))
      return { found: true, status: 0, stdout: `${cliVersion}\n`, stderr: '' };
    if (bin === 'claude')
      return { found: true, status: 0, stdout: '{"loggedIn":true}', stderr: '' };
    if (bin === 'codex')
      return { found: true, status: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
    if (bin === 'agy') return { found: true, status: 1, stdout: '', stderr: 'Please sign in' };
    return { found: false, status: 1, stdout: '', stderr: '' };
  };
}

test('interpretMetadataProbeResponse classifies OK, ZERO_RESULTS, REQUEST_DENIED and OVER_QUERY_LIMIT without leaking key', () => {
  const secret = 'AIzaSyFakeSecretServerKey123456';
  expect(interpretMetadataProbeResponse('OK', undefined, secret).ok).toBe(true);
  expect(interpretMetadataProbeResponse('ZERO_RESULTS', undefined, secret).ok).toBe(true);

  const notActivated = interpretMetadataProbeResponse(
    'REQUEST_DENIED',
    `This API is not activated on your API project for key ${secret}`,
    secret,
  );
  expect(notActivated.ok).toBe(false);
  expect(notActivated.code).toBe('GEO_GOOGLE_KEY_DENIED');
  expect(notActivated.what).not.toContain(secret);
  expect(notActivated.fix).toContain('Street View Static API');

  const quotaErr = interpretMetadataProbeResponse('OVER_QUERY_LIMIT', 'quota exceeded', secret);
  expect(quotaErr.ok).toBe(false);
  expect(quotaErr.code).toBe('GEO_GOOGLE_QUOTA');

  const unknownErr = interpretMetadataProbeResponse(
    'REQUEST_DENIED',
    'Mystery custom failure',
    secret,
  );
  expect(unknownErr.fix).toContain('1)');
  expect(unknownErr.fix).toContain('4)');
});

test('classifyMapsJsErrorCode maps known Google Maps JS error codes to instructions', () => {
  expect(classifyMapsJsErrorCode('RefererNotAllowedMapError')).toContain('trycloudflare');
  expect(classifyMapsJsErrorCode('ApiNotActivatedMapError')).toContain('Maps JavaScript API');
  expect(classifyMapsJsErrorCode('InvalidKeyMapError')).toContain('GOOGLE_MAPS_BROWSER_KEY');
  expect(classifyMapsJsErrorCode('SomeOtherError')).toContain('SomeOtherError');
});

test('runDoctorChecks returns structured JSON checks, flags harness version mismatch, and masks secrets', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-doc-'));
  try {
    const configDir = path.join(dir, 'config');
    const dataDir = path.join(dir, 'data');
    saveHarnessVerifiedEntry(path.join(configDir, 'harness-verified.json'), 'claude', {
      cliVersion: '2.0.0-old',
      verifiedAt: '2026-11-12T00:00:00Z',
      deliveryMode: 'mcp',
    });

    const serverSecret = 'AIzaSyTestServerSecret987654';
    const browserSecret = 'AIzaSyTestBrowserSecret123456';
    const result = await runDoctorChecks(
      parseDoctorArgs(['--json', '--public-url', 'https://geo.example.com/']),
      {
        env: {
          HOME: dir,
          GEOAISSR_CONFIG_DIR: configDir,
          GEOAISSR_DATA_DIR: dataDir,
          GOOGLE_MAPS_BROWSER_KEY: browserSecret,
          GOOGLE_MAPS_SERVER_KEY: serverSecret,
        },
        fetchImpl: () => Promise.resolve(Response.json({ status: 'OK' })),
        probe: makeOkProbe('2.1.323'),
        which: (bin) => `/usr/bin/${bin}`,
        bunVersion: '1.4.2',
      },
    );

    expect(result.ok).toBe(true);
    expect(pickDoctorExitCode(result.checks)).toBe(0);

    const textBlob = JSON.stringify(result.checks);
    expect(textBlob).not.toContain(serverSecret);
    expect(textBlob).not.toContain(browserSecret);

    const claudeWarn = result.checks.find((c) => c.code === 'HARNESS_CLAUDE');
    expect(claudeWarn?.ok).toBe(false);
    expect(claudeWarn?.fix).toContain('bun run test:harness');

    const refInfo = result.checks.find((c) => c.code === 'BROWSER_KEY_GUIDANCE');
    expect(refInfo?.what).toContain('https://geo.example.com/*');
    expect(refInfo?.fix).toContain('Maps JS 500/день');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickDoctorExitCode returns 2 for env/config missing and 3 for external dependency denial', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-doc-exit-'));
  try {
    const missingKeys = await runDoctorChecks(parseDoctorArgs(['--no-tunnel']), {
      env: {
        HOME: dir,
        GEOAISSR_CONFIG_DIR: path.join(dir, 'c'),
        GEOAISSR_DATA_DIR: path.join(dir, 'd'),
      },
      fetchImpl: () => Promise.resolve(Response.json({ status: 'OK' })),
      probe: makeOkProbe(),
      which: () => '/usr/bin/cloudflared',
    });
    expect(missingKeys.ok).toBe(false);
    expect(pickDoctorExitCode(missingKeys.checks)).toBe(2);

    const badGoogle = await runDoctorChecks(parseDoctorArgs(['--no-tunnel']), {
      env: {
        HOME: dir,
        GEOAISSR_CONFIG_DIR: path.join(dir, 'c2'),
        GEOAISSR_DATA_DIR: path.join(dir, 'd2'),
        GOOGLE_MAPS_BROWSER_KEY: 'bkey',
        GOOGLE_MAPS_SERVER_KEY: 'skey',
      },
      fetchImpl: () =>
        Promise.resolve(
          Response.json({ status: 'REQUEST_DENIED', error_message: 'billing needed' }),
        ),
      probe: makeOkProbe(),
      which: () => '/usr/bin/cloudflared',
    });
    expect(badGoogle.ok).toBe(false);
    expect(pickDoctorExitCode(badGoogle.checks)).toBe(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
