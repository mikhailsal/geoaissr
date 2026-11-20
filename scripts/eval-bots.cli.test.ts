import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const SCRIPT = path.resolve(import.meta.dir, 'eval-bots.ts');

function runCli(args: string[], env: Record<string, string> = {}) {
  const res = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
    env: { ...process.env, ...env },
    cwd: path.resolve(import.meta.dir, '..'),
  });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}

test('an unknown flag exits 2 with one stderr line, a suggestion and the code', () => {
  const res = runCli(['--dyr']);
  expect(res.code).toBe(2);
  expect(res.out).toBe('');
  const lines = res.err.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('did you mean --dry?');
  expect(lines[0]).toContain('GEO_INVALID_ARGS');
});

test('duplicate flags and unknown spots exit 2 before any launch', () => {
  expect(runCli(['--repeats', '1', '--repeats=2']).code).toBe(2);
  const res = runCli(['--dry', '--spot', 'no-such-spot']);
  expect(res.code).toBe(2);
  expect(res.err).toContain('GEO_INVALID_ARGS');
});

test('--help prints every flag with its default and exits 0', () => {
  const res = runCli(['--help']);
  expect(res.code).toBe(0);
  expect(res.out).toContain('--spot');
  expect(res.out).toContain('default: 3');
});

test('--dry with --spot runs only the selected spot and writes a dry summary', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-cli-'));
  try {
    const res = runCli(['--dry', '--repeats', '1', '--spot', 'sample-tokyo', '--out', dir]);
    expect(res.code).toBe(0);
    const summary = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(summary).toMatchObject({
      dry: true,
      plannedRounds: 1,
      completedRounds: 1,
      complete: true,
    });
    expect(summary.concurrency).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing harness CLI is an infra error: exit 1, GEO_EVAL_HARNESS_FAILED, not a timeout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-cli-'));
  try {
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const names = ['0.jpg', '1.jpg', '2.jpg', '3.jpg'];
    for (const name of names) writeFileSync(path.join(dir, name), jpeg);
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([
        {
          id: 'spot-a',
          countryNameRu: 'Польша',
          lat: 1,
          lng: 2,
          imagePaths: names,
          source: {
            pageUrl: 'https://example.org/p',
            author: 'A',
            license: 'CC0',
            licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          },
        },
      ]),
    );
    const out = path.join(dir, 'out');
    const res = runCli(['--dataset', dir, '--repeats', '1', '--out', out], {
      PATH: path.dirname(process.execPath),
    });
    expect(res.code).toBe(1);
    expect(res.err).toContain('GEO_EVAL_HARNESS_FAILED');
    expect(res.err).toContain('spot spot-a attempt 1');
    expect(res.err).toContain('bun run doctor');
    expect(res.err).toContain(path.join(out, 'rounds.jsonl'));
    const summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(summary).toMatchObject({ infraErrorRounds: 1, measuredRounds: 0, finishRate: null });
    const round = JSON.parse(readFileSync(path.join(out, 'rounds.jsonl'), 'utf8').trim()) as Record<
      string,
      unknown
    >;
    expect(round.timedOut).toBe(false);
    expect(typeof round.infraError).toBe('string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
