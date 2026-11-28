import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';

function main(): void {
  const rootDir = process.cwd();
  const hooksDir = path.join(rootDir, '.githooks');
  for (const hook of ['pre-push']) {
    const p = path.join(hooksDir, hook);
    if (existsSync(p)) {
      chmodSync(p, 0o755);
    }
  }
  const res = Bun.spawnSync(['git', 'config', 'core.hooksPath', '.githooks'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (res.exitCode !== 0) {
    console.error('Failed to configure git core.hooksPath');
    process.exit(res.exitCode);
  }
  console.log('Git hook installed (.githooks/pre-push).');
}

main();
