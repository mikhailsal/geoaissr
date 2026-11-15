import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT_DIRS = ['shared', 'server', 'web', 'bot-tools', 'scripts', 'spikes', 'test'];
const EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.svelte']);
const SOURCE_LIMIT = 500;
const TEST_LIMIT = 1000;

interface Allowlist {
  [filePath: string]: number;
}

function isTestFile(relPath: string): boolean {
  return relPath.endsWith('.test.ts') || relPath.endsWith('.spec.ts');
}

function collectFiles(dir: string, rootDir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, rootDir, out);
    } else if (EXTENSIONS.has(path.extname(name))) {
      out.push(path.relative(rootDir, full).replace(/\\/g, '/'));
    }
  }
}

function countLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) return 0;
  return content.split('\n').length;
}

function loadAllowlist(rootDir: string): Allowlist {
  const allowPath = path.join(rootDir, 'size-allowlist.json');
  const raw = readFileSync(allowPath, 'utf8');
  return JSON.parse(raw) as Allowlist;
}

function main(): void {
  const rootDir = process.cwd();
  const allowlist = loadAllowlist(rootDir);
  const files: string[] = [];
  for (const dir of ROOT_DIRS) {
    collectFiles(path.join(rootDir, dir), rootDir, files);
  }
  files.sort();

  const errors: string[] = [];
  const seen = new Set<string>();

  for (const rel of files) {
    seen.add(rel);
    const lines = countLines(path.join(rootDir, rel));
    const limit = isTestFile(rel) ? TEST_LIMIT : SOURCE_LIMIT;
    const allowed = allowlist[rel];
    if (allowed !== undefined) {
      if (lines > allowed) {
        errors.push(`${rel}: ${lines} lines exceeds allowlist cap ${allowed}`);
      }
    } else if (lines > limit) {
      errors.push(`${rel}: ${lines} lines exceeds limit ${limit}`);
    }
  }

  for (const key of Object.keys(allowlist)) {
    if (!seen.has(key)) {
      errors.push(`size-allowlist.json contains missing file: ${key}`);
    }
  }

  if (errors.length > 0) {
    console.error('Size limit violations:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`check-size: ok (${files.length} files checked)`);
}

main();
