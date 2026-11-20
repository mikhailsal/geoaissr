import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseStartArgs } from '../../server/cli/preflight.ts';
import { startGeoServer } from '../../server/cli/start.ts';

// This entrypoint is exclusively for startIsolatedFakeServer's owned test directories.
const port = Bun.argv[2];
if (!process.env.GEOAISSR_CONFIG_DIR || !process.env.GEOAISSR_DATA_DIR || !port) {
  throw new Error('Browser fixture requires explicit config/data directories and a port.');
}
if (!existsSync(path.resolve(import.meta.dir, '../../web/dist/index.html'))) {
  throw new Error('Build the browser client before starting the fixture server.');
}
const flags = ['--fake', '--no-tunnel', '--no-open'];
const cli =
  port === '0' ? { ...parseStartArgs(flags), port: 0 } : parseStartArgs([...flags, '--port', port]);
// The same production startup API is used by dev.ts; globalSetup has already built assets.
await startGeoServer(cli, { skipClientBuild: true });
