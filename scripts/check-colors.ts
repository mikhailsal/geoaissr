import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_COLOR_RE = /\brgba?\s*\(/g;

function collectSvelteFiles(dir: string, out: string[]): void {
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
      collectSvelteFiles(full, out);
    } else if (name.endsWith('.svelte')) {
      out.push(full);
    }
  }
}

function scanFile(filePath: string, rootDir: string): string[] {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const issues: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const m of line.matchAll(HEX_COLOR_RE)) {
      issues.push(`${rel}:${i + 1}: literal color ${m[0]} (use tokens.css CSS variables)`);
    }
    for (const m of line.matchAll(RGB_COLOR_RE)) {
      issues.push(`${rel}:${i + 1}: literal color ${m[0]} (use tokens.css CSS variables)`);
    }
  }
  return issues;
}

function main(): void {
  const rootDir = process.cwd();
  const webSrc = path.join(rootDir, 'web', 'src');
  const files: string[] = [];
  collectSvelteFiles(webSrc, files);
  files.sort();

  const issues: string[] = [];
  for (const file of files) {
    issues.push(...scanFile(file, rootDir));
  }
  if (issues.length > 0) {
    console.error('Color literal violations in Svelte components:\n' + issues.join('\n'));
    process.exit(1);
  }
  console.log(`check-colors: ok (${files.length} .svelte files checked)`);
}

main();
