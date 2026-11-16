import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build the shared, immutable browser assets before any individual test's deadline. */
export default function globalSetup(): void {
  const result = spawnSync('bun', ['run', 'build'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Browser test client build failed.');
}
