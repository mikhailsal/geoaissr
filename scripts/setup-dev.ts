function runOrExit(cmd: string[], label: string): void {
  console.log(`==> ${label}`);
  const res = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if (res.exitCode !== 0) {
    console.error(`Failed step: ${label}`);
    process.exit(res.exitCode);
  }
}

function checkShellcheck(): void {
  if (Bun.which('shellcheck')) {
    console.log('shellcheck: found');
    return;
  }
  const platform = process.platform;
  console.warn('WARNING: shellcheck is not installed.');
  if (platform === 'darwin') {
    console.warn('  Install on macOS: brew install shellcheck');
  } else {
    console.warn('  Install on Debian/Ubuntu: sudo apt-get install -y shellcheck');
  }
}

function main(): void {
  runOrExit(['bun', 'install'], 'bun install');
  runOrExit(['bun', 'run', 'hooks:install'], 'bun run hooks:install');
  runOrExit(['bunx', 'playwright', 'install', 'chromium'], 'playwright install chromium');
  checkShellcheck();
  console.log('setup:dev completed!');
}

main();
