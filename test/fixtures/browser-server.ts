import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseStartArgs } from '../../server/cli/preflight.ts';
import { startGeoServer } from '../../server/cli/start.ts';

// This entrypoint is exclusively for startIsolatedFakeServer's owned test directories.
if (!process.env.GEOAISSR_CONFIG_DIR || !process.env.GEOAISSR_DATA_DIR || !Bun.argv[2]) {
  throw new Error('Browser fixture requires explicit config/data directories and a port.');
}
if (!existsSync(path.resolve(import.meta.dir, '../../web/dist/index.html'))) {
  throw new Error('Build the browser client before starting the fixture server.');
}
const cli = parseStartArgs(['--fake', '--no-tunnel', '--no-open', '--port', Bun.argv[2]]);
// The same production startup API is used by dev.ts; globalSetup has already built assets.
await startGeoServer(cli, { skipClientBuild: true });
