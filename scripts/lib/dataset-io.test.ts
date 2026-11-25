import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDatasetBytes, parseBuilderArgs, writeDatasetFile } from './dataset-io.ts';

// Value: protects=a builder command line accepts only known --name value pairs and names the known flags in its error; fails_when=an unknown flag, a bare word or a flag without a value is accepted;
// why_new=dataset-io.ts had no direct test; seam=none; no_claim=how each builder uses the values (parser only)
test('parseBuilderArgs reads known flags and rejects unknown or incomplete ones', () => {
  expect(parseBuilderArgs(['--input', 'a.zip', '--out', 'b.json'], ['input', 'out'])).toEqual({
    input: 'a.zip',
    out: 'b.json',
  });
  expect(parseBuilderArgs([], ['input'])).toEqual({});
  expect(() => parseBuilderArgs(['--bogus', 'x'], ['input', 'out'])).toThrow(
    'Unknown or incomplete flag "--bogus". Known flags: --input <value>, --out <value>',
  );
  expect(() => parseBuilderArgs(['input', 'x'], ['input'])).toThrow('Unknown or incomplete flag');
  expect(() => parseBuilderArgs(['--input'], ['input'])).toThrow('"--input"');
});

// Value: protects=a dataset file is the same bytes for the same input, ends with one newline and leaves no temporary file; fails_when=the output is pretty-printed, loses its newline or the temporary file stays;
// why_new=dataset-io.ts had no direct test; seam=none; no_claim=atomicity under a crash (no failure injected); network download (local path only)
test('writeDatasetFile is byte-stable and loadDatasetBytes reads a local file back', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-dataset-io-'));
  try {
    const out = path.join(dir, 'nested', 'data.json');
    const data = { b: [1, 2], a: 'x' };
    writeDatasetFile(out, data);
    const first = readFileSync(out, 'utf8');
    expect(first).toBe('{"b":[1,2],"a":"x"}\n');
    writeDatasetFile(out, data);
    expect(readFileSync(out, 'utf8')).toBe(first);
    expect(readdirSync(path.dirname(out))).toEqual(['data.json']);

    const raw = path.join(dir, 'raw.bin');
    writeFileSync(raw, Buffer.from([1, 2, 3]));
    const bytes = await loadDatasetBytes({
      localPath: raw,
      url: 'http://invalid.test',
      label: 'x',
    });
    expect([...bytes]).toEqual([1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Value: protects=a dataset write does not go through a link left under an old staging name; fails_when=the staging file has a name that can be guessed and is opened for truncation, so a link in a shared folder sends the bytes into another file;
// why_new=the staging name was the output path plus the process id; seam=none; no_claim=a race against a live attacker (a planted link only)
test('writeDatasetFile leaves a file linked under the old staging name alone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-dataset-io-'));
  try {
    const out = path.join(dir, 'data.json');
    const victim = path.join(dir, 'victim.txt');
    writeFileSync(victim, 'keep me');
    symlinkSync(victim, `${out}.tmp-${process.pid}`);
    writeDatasetFile(out, { a: 1 });
    expect(readFileSync(victim, 'utf8')).toBe('keep me');
    expect(readFileSync(out, 'utf8')).toBe('{"a":1}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
