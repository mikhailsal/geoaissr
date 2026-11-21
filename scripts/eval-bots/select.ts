import { EvalArgsError, type EvalArgs } from './args.ts';
import type { EvalSampleItem } from './manifest.ts';

/** Applies `--spot` (by manifest id) and `--limit` to the loaded spots, keeping manifest order. */
export function selectSamples(
  samples: readonly EvalSampleItem[],
  args: Pick<EvalArgs, 'spotIds' | 'limit' | 'dry'>,
): EvalSampleItem[] {
  const known = new Set(samples.map((s) => s.id));
  for (const id of args.spotIds) {
    if (!known.has(id)) {
      throw new EvalArgsError(
        `unknown spot id "${id}"`,
        `known spots: ${[...known].slice(0, 8).join(', ')}${known.size > 8 ? ', ...' : ''}`,
      );
    }
  }
  const picked =
    args.spotIds.length === 0 ? [...samples] : samples.filter((s) => args.spotIds.includes(s.id));
  if (!args.dry && picked.some((s) => !s.imagePaths)) {
    throw new EvalArgsError(
      'live runs need --dataset with a manifest.json where every spot has 4 imagePaths',
      'use --dry for the built-in fake spots',
    );
  }
  return args.limit === null ? picked : picked.slice(0, args.limit);
}
