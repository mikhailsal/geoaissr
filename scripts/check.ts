import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

interface Step {
  name: string;
  cmd: string[];
}

interface StepResult {
  step: Step;
  exitCode: number;
  output: string;
  seconds: number;
}

function collectShellFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === '.geoaissr-dev') continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectShellFiles(full, out);
    } else if (name.endsWith('.sh') || dir.endsWith('.githooks')) {
      out.push(path.relative(process.cwd(), full));
    }
  }
}

function checkEnvNotTracked(): void {
  const res = Bun.spawnSync(['git', 'ls-files', '--error-unmatch', '.env'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if (res.exitCode === 0) {
    console.error(
      'check failed at step: env-not-tracked\n' +
        '  .env is tracked by git! Remove it from index immediately: git rm --cached .env',
    );
    process.exit(1);
  }
  console.log('env-not-tracked: ok');
}

function runShellcheck(): void {
  const files: string[] = [];
  collectShellFiles(path.join(process.cwd(), '.githooks'), files);
  collectShellFiles(path.join(process.cwd(), 'scripts'), files);
  if (files.length === 0) {
    console.log('shellcheck: ok (no shell scripts found)');
    return;
  }
  const hasShellcheck = Bun.which('shellcheck');
  if (!hasShellcheck) {
    console.error(
      'check failed at step: shellcheck\n' +
        '  shellcheck not found in PATH. Install shellcheck (e.g. apt install shellcheck).',
    );
    process.exit(1);
  }
  const res = Bun.spawnSync(['shellcheck', ...files], { stdout: 'inherit', stderr: 'inherit' });
  if (res.exitCode !== 0) {
    console.error(`check failed at step: shellcheck\n  Repeat with: shellcheck ${files.join(' ')}`);
    process.exit(res.exitCode);
  }
  console.log(`shellcheck: ok (${files.length} scripts checked)`);
}

const CACHE_DIR = 'node_modules/.cache/geoaissr-check';

const STEPS: Step[] = [
  {
    name: 'eslint',
    // gstack-shortcut(dec-5a8d2e7c-940d-4ffe-bd04-38db264480b5): the content cache can keep a
    // stale pass for file B after a type change in file A; CI runs uncached and is the
    // authority. Upgrade (drop --cache here) when CI catches a lint error a green pre-push missed.
    cmd: [
      'bunx',
      'eslint',
      '.',
      '--max-warnings',
      '0',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      `${CACHE_DIR}/eslint`,
    ],
  },
  {
    name: 'prettier',
    cmd: [
      'bunx',
      'prettier',
      '--check',
      '.',
      '--cache',
      '--cache-location',
      `${CACHE_DIR}/prettier`,
    ],
  },
  { name: 'tsc-server', cmd: ['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.server.json'] },
  { name: 'tsc-web', cmd: ['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.web.json'] },
  { name: 'svelte-check', cmd: ['bunx', 'svelte-check', '--tsconfig', './tsconfig.web.json'] },
  { name: 'check-size', cmd: ['bun', 'run', 'scripts/check-size.ts'] },
  { name: 'check-colors', cmd: ['bun', 'run', 'scripts/check-colors.ts'] },
];

/** Runs one step with its output buffered, so parallel steps do not interleave. */
async function runStep(step: Step): Promise<StepResult> {
  const started = performance.now();
  const proc = Bun.spawn(step.cmd, { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const seconds = (performance.now() - started) / 1000;
  return { step, exitCode, output: stdout + stderr, seconds };
}

function report(results: StepResult[]): number {
  const failed = results.filter((r) => r.exitCode !== 0);
  for (const r of results) {
    const status = r.exitCode === 0 ? 'ok' : `FAILED (exit ${String(r.exitCode)})`;
    console.log(`==> ${r.step.name}: ${status} in ${r.seconds.toFixed(1)}s`);
    // Passing steps stay quiet; a failing step prints everything it said.
    if (r.exitCode !== 0 && r.output.trim() !== '') console.log(r.output.trimEnd());
  }
  for (const r of failed) {
    console.error(`\ncheck failed at step: ${r.step.name}\n  Repeat with: ${r.step.cmd.join(' ')}`);
  }
  return failed[0]?.exitCode ?? 0;
}

async function main(): Promise<void> {
  // The fast guards run first and stop the run on their own.
  checkEnvNotTracked();
  runShellcheck();
  const results = await Promise.all(STEPS.map(runStep));
  const exitCode = report(results);
  if (exitCode !== 0) process.exit(exitCode);
  console.log('All quality checks passed!');
}

await main();
