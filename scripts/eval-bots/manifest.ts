import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Spot ids end up in CLI flags and logs, so they are lowercase, path-safe and bounded. */
export const SPOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const evalSampleSchema = z.object({
  id: z.string().regex(SPOT_ID_PATTERN, 'spot id must match ^[a-z0-9][a-z0-9-]{0,63}$'),
  countryNameRu: z.string().trim().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  imagePaths: z
    .tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)])
    .optional(),
  /** Compass heading of frame 0, or null when unknown. */
  headingDeg: z.number().finite().min(0).max(360).nullable().optional(),
  source: z
    .object({
      title: z.string(),
      pageUrl: z.string(),
      author: z.string(),
      license: z.string(),
      licenseUrl: z.string(),
    })
    .partial()
    .optional(),
  /** Catalogue features (driving_side, script, ...) mapped to a value id or null. */
  labels: z.record(z.string(), z.string().nullable()).optional(),
  signText: z
    .array(z.object({ frame: z.number().int().min(0).max(3), text: z.string() }))
    .optional(),
  labelledBy: z.string().optional(),
});

/** Licences that allow committing the frames with attribution (docs/evals/README.md). */
export const ALLOWED_LICENSE_PATTERN = /^(?:CC0(?: 1\.0)?|public domain|CC BY(?:-SA)? [1-4]\.0)$/i;

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;

/** Names the missing or invalid attribution fields of an entry that ships frames. */
function frameLicenceProblems(item: z.infer<typeof evalSampleSchema>): string[] {
  if (!item.imagePaths) return [];
  const source = item.source ?? {};
  const problems: string[] = [];
  if (!ALLOWED_LICENSE_PATTERN.test(source.license ?? '')) {
    problems.push('source.license must be CC0, public domain, CC BY or CC BY-SA (1.0-4.0)');
  }
  if (!HTTP_URL_PATTERN.test(source.licenseUrl ?? '')) problems.push('source.licenseUrl');
  if (!HTTP_URL_PATTERN.test(source.pageUrl ?? '')) problems.push('source.pageUrl');
  if (!source.author?.trim()) problems.push('source.author');
  return problems;
}

export const evalDatasetManifestSchema = z
  .array(evalSampleSchema)
  .min(1)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate spot id "${item.id}"`,
        });
      }
      seen.add(item.id);
      const problems = frameLicenceProblems(item);
      if (problems.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'source'],
          message: `spot "${item.id}" has frames without a checked licence: ${problems.join('; ')}`,
        });
      }
    });
  });

export type EvalSampleItem = z.infer<typeof evalSampleSchema>;

/** A dataset the run refuses before any round: a missing file or a broken manifest rule. */
export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

function parseManifest(
  manifestPath: string,
  bytes: Buffer,
): z.infer<typeof evalDatasetManifestSchema> {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new DatasetError(`${manifestPath} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = evalDatasetManifestSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`);
  throw new DatasetError(`${manifestPath} is invalid: ${issues.join('; ')}`);
}

const BUILTIN_SAMPLES: EvalSampleItem[] = [
  { id: 'sample-warsaw', countryNameRu: 'Польша', lat: 52.2297, lng: 21.0122 },
  { id: 'sample-tokyo', countryNameRu: 'Япония', lat: 35.6762, lng: 139.6503 },
  { id: 'sample-milan', countryNameRu: 'Италия', lat: 45.4642, lng: 9.19 },
];

export interface LoadedDataset {
  samples: EvalSampleItem[];
  /** First 12 hex of the sha256 of manifest.json; null for the built-in dry spots. */
  datasetHash: string | null;
}

/** Loads and validates a dataset directory; without one, returns three frame-less dry samples. */
export function loadDatasetWithHash(datasetDir: string | null): LoadedDataset {
  if (datasetDir === null) return { samples: BUILTIN_SAMPLES, datasetHash: null };
  const absDir = path.resolve(datasetDir);
  const manifestPath = path.join(absDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new DatasetError(`Dataset manifest not found: ${manifestPath}`);
  }
  const bytes = readFileSync(manifestPath);
  const parsed = parseManifest(manifestPath, bytes);
  const samples = parsed.map((item) => {
    if (!item.imagePaths) return item;
    const resolved = item.imagePaths.map((p) => {
      const absImg = path.resolve(absDir, p);
      if (!existsSync(absImg)) {
        throw new DatasetError(`Dataset image not found (${item.id}): ${absImg}`);
      }
      return absImg;
    }) as [string, string, string, string];
    return { ...item, imagePaths: resolved };
  });
  return { samples, datasetHash: createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
}

export function loadDataset(datasetDir: string | null): EvalSampleItem[] {
  return loadDatasetWithHash(datasetDir).samples;
}
