import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseStartArgs } from './preflight.ts';
import { startGeoServer } from './start.ts';

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const wantsFake = argv.includes('--fake') || !process.env.GOOGLE_MAPS_SERVER_KEY;
  const filtered = argv.filter((a) => a !== '--fake');
  const cli = parseStartArgs(
    ['--no-tunnel', '--no-open', ...(wantsFake ? ['--fake'] : []), ...filtered],
    process.env,
  );

  if (wantsFake && !process.env.GEOAISSR_DATA_DIR && !process.env.GEOAISSR_CONFIG_DIR) {
    const devRoot = path.resolve(import.meta.dir, '../../.geoaissr-dev');
    const cfg = path.join(devRoot, 'config');
    const data = path.join(devRoot, 'data');
    mkdirSync(cfg, { recursive: true });
    mkdirSync(data, { recursive: true });
    process.env.GEOAISSR_CONFIG_DIR = cfg;
    process.env.GEOAISSR_DATA_DIR = data;
  }

  const running = await startGeoServer(cli, {
    skipClientBuild: true,
    installProcessHandlers: false,
  });

  const bunExe = process.execPath || 'bun';
  const viteProc = Bun.spawn([bunExe, 'x', 'vite', '--port', '5173'], {
    cwd: path.resolve(import.meta.dir, '../..'),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: {
      ...process.env,
      GEOAISSR_BACKEND_PORT: String(running.port),
    },
  });

  const devHostUrl = `http://localhost:5173/#t=${running.hostToken}`;
  const devGuestUrl = `http://localhost:5173/#t=${running.guestToken}`;
  console.log(`\n[dev] Vite UI хост:  ${devHostUrl}`);
  console.log(`[dev] Vite UI гость: ${devGuestUrl}\n`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      viteProc.kill('SIGTERM');
    } catch {
      // already exited
    }
    await running.stop();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  const code = await viteProc.exited;
  await shutdown();
  process.exit(code);
}

if (import.meta.main) {
  await main();
}
