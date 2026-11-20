import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const evalSampleSchema = z.object({
  id: z.string().trim().min(1),
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

export const evalDatasetManifestSchema = z.array(evalSampleSchema).min(1);

export type EvalSampleItem = z.infer<typeof evalSampleSchema>;

const BUILTIN_SAMPLES: EvalSampleItem[] = [
  { id: 'sample-warsaw', countryNameRu: 'Польша', lat: 52.2297, lng: 21.0122 },
  { id: 'sample-tokyo', countryNameRu: 'Япония', lat: 35.6762, lng: 139.6503 },
  { id: 'sample-milan', countryNameRu: 'Италия', lat: 45.4642, lng: 9.19 },
];

/** Loads and validates a dataset directory; without one, returns three frame-less dry samples. */
export function loadDataset(datasetDir: string | null): EvalSampleItem[] {
  if (datasetDir === null) return BUILTIN_SAMPLES;
  const absDir = path.resolve(datasetDir);
  const manifestPath = path.join(absDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found: ${manifestPath}`);
  }
  const parsed = evalDatasetManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  return parsed.map((item) => {
    if (!item.imagePaths) return item;
    const resolved = item.imagePaths.map((p) => {
      const absImg = path.resolve(absDir, p);
      if (!existsSync(absImg)) {
        throw new Error(`Dataset image not found (${item.id}): ${absImg}`);
      }
      return absImg;
    }) as [string, string, string, string];
    return { ...item, imagePaths: resolved };
  });
}
