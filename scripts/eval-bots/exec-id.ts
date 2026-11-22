import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Opaque id for one round execution: first 10 hex of sha256(runName + spotId + attempt + random).
 * Every path and match id a bot can see is derived from it, never from the spot id or label,
 * because file-delivery harnesses can read their own paths.
 */
export function makeExecutionId(
  runName: string,
  spotId: string,
  attempt: number,
  random: string = randomBytes(8).toString('hex'),
): string {
  return createHash('sha256')
    .update(`${runName}\0${spotId}\0${attempt}\0${random}`)
    .digest('hex')
    .slice(0, 10);
}

export interface ExecutionPaths {
  dir: string;
  runDir: string;
  childrenFile: string;
  matchId: string;
}

/** Runtime paths and match id for one execution; they contain only the opaque id. */
export function executionPaths(root: string, executionId: string): ExecutionPaths {
  const dir = path.join(root, `x${executionId}`);
  return {
    dir,
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'children.json'),
    matchId: `x${executionId}`,
  };
}
