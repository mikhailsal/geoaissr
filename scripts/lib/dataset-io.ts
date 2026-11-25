import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reads a dataset from a local file when the maintainer passed one, otherwise downloads it.
 * A builder never keeps its own cache: a copy in a shared temp folder could be stale or planted.
 */
export async function loadDatasetBytes(opts: {
  localPath: string | undefined;
  url: string;
  label: string;
}): Promise<Uint8Array> {
  if (opts.localPath) return new Uint8Array(readFileSync(opts.localPath));
  const res = await fetch(opts.url);
  if (!res.ok) throw new Error(`Failed to fetch ${opts.label}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Writes through a temporary file, so a failed write never leaves half a dataset behind. */
export function writeDatasetFile(outPath: string, data: unknown): void {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(data)}\n`);
  renameSync(tmpPath, outPath);
}

/** `--name value` pairs of a builder's command line; an unknown flag is an error. */
export function parseBuilderArgs(
  argv: readonly string[],
  known: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1];
    if (!flag.startsWith('--') || !known.includes(flag.slice(2)) || value === undefined) {
      throw new Error(
        `Unknown or incomplete flag "${flag}". Known flags: ${known.map((k) => `--${k} <value>`).join(', ')}`,
      );
    }
    values[flag.slice(2)] = value;
  }
  return values;
}
