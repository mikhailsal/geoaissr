import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

interface Step {
  name: string;
  cmd: string[];
  displayCmd: string;
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

function runStep(step: Step): void {
  console.log(`==> Running ${step.name}...`);
  const res = Bun.spawnSync(step.cmd, { stdout: 'inherit', stderr: 'inherit' });
  if (res.exitCode !== 0) {
    console.error(`\ncheck failed at step: ${step.name}\n  Repeat with: ${step.displayCmd}`);
    process.exit(res.exitCode);
  }
}

function main(): void {
  checkEnvNotTracked();
  runShellcheck();

  const steps: Step[] = [
    {
      name: 'eslint',
      cmd: ['bunx', 'eslint', '.', '--max-warnings', '0'],
      displayCmd: 'bunx eslint . --max-warnings 0',
    },
    {
      name: 'prettier',
      cmd: ['bunx', 'prettier', '--check', '.'],
      displayCmd: 'bunx prettier --check .',
    },
    {
      name: 'tsc-server',
      cmd: ['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.server.json'],
      displayCmd: 'bunx tsc --noEmit -p tsconfig.server.json',
    },
    {
      name: 'tsc-web',
      cmd: ['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.web.json'],
      displayCmd: 'bunx tsc --noEmit -p tsconfig.web.json',
    },
    {
      name: 'svelte-check',
      cmd: ['bunx', 'svelte-check', '--tsconfig', './tsconfig.web.json'],
      displayCmd: 'bunx svelte-check --tsconfig ./tsconfig.web.json',
    },
    {
      name: 'check-size',
      cmd: ['bun', 'run', 'scripts/check-size.ts'],
      displayCmd: 'bun run scripts/check-size.ts',
    },
    {
      name: 'check-colors',
      cmd: ['bun', 'run', 'scripts/check-colors.ts'],
      displayCmd: 'bun run scripts/check-colors.ts',
    },
  ];

  for (const step of steps) {
    runStep(step);
  }
  console.log('All quality checks passed!');
}

main();
