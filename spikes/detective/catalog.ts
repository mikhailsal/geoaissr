import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * The closed feature catalog of the eval set (docs/evals/dataset/catalog.json). In the spike the
 * brain may only ask about these features and the eyes may only answer with one of their values,
 * so every answer maps to one human label.
 */
const catalogSchema = z.object({
  features: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z_]+$/),
        ru: z.string().min(1),
        values: z.array(z.object({ id: z.string().regex(/^[a-z_]+$/), ru: z.string().min(1) })),
      }),
    )
    .min(1),
});

export type CatalogFeature = z.infer<typeof catalogSchema>['features'][number];

/** Abstentions the eyes may give for any feature: «не видно» and «неразборчиво». */
export const ABSTAIN_VALUES = ['not_visible', 'unreadable'] as const;
export type AbstainValue = (typeof ABSTAIN_VALUES)[number];

export const ABSTAIN_RU: Record<AbstainValue, string> = {
  not_visible: 'не видно',
  unreadable: 'неразборчиво',
};

export const DEFAULT_CATALOG_PATH = path.resolve(
  import.meta.dir,
  '../../docs/evals/dataset/catalog.json',
);

export function parseCatalog(json: unknown): CatalogFeature[] {
  return catalogSchema.parse(json).features;
}

export function loadCatalog(file: string = DEFAULT_CATALOG_PATH): CatalogFeature[] {
  return parseCatalog(JSON.parse(readFileSync(file, 'utf8')) as unknown);
}

export function isAbstain(value: string): value is AbstainValue {
  return (ABSTAIN_VALUES as readonly string[]).includes(value);
}

/** Values the eyes may answer for one feature: its catalog values plus the two abstentions. */
export function allowedValues(feature: CatalogFeature): string[] {
  const ids = feature.values.map((v) => v.id);
  for (const extra of ABSTAIN_VALUES) if (!ids.includes(extra)) ids.push(extra);
  return ids;
}

/** Russian label of a value id, for the text the brain reads. */
export function valueLabelRu(feature: CatalogFeature, valueId: string): string {
  if (isAbstain(valueId)) return ABSTAIN_RU[valueId];
  return feature.values.find((v) => v.id === valueId)?.ru ?? valueId;
}

export function findFeature(
  catalog: readonly CatalogFeature[],
  id: string,
): CatalogFeature | undefined {
  return catalog.find((f) => f.id === id);
}
