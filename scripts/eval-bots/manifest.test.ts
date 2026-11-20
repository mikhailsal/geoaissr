import { expect, test } from 'bun:test';
import { evalDatasetManifestSchema } from './manifest.ts';

const OLD_ENTRY = {
  id: 'a',
  countryNameRu: 'Польша',
  lat: 1,
  lng: 2,
  imagePaths: ['0.jpg', '1.jpg', '2.jpg', '3.jpg'],
};

test('old manifests without the new fields still parse', () => {
  const parsed = evalDatasetManifestSchema.parse([OLD_ENTRY]);
  expect(parsed[0]?.headingDeg).toBeUndefined();
  expect(parsed[0]?.labels).toBeUndefined();
});

test('new optional fields parse, including a null heading and null label values', () => {
  const parsed = evalDatasetManifestSchema.parse([
    {
      ...OLD_ENTRY,
      headingDeg: null,
      source: {
        title: 'T',
        pageUrl: 'https://example.org/p',
        author: 'A',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      labels: { driving_side: 'right', script: null },
      signText: [{ frame: 2, text: 'STOP' }],
      labelledBy: 'agent',
    },
  ]);
  expect(parsed[0]?.headingDeg).toBeNull();
  expect(parsed[0]?.labels?.script).toBeNull();
  expect(parsed[0]?.signText?.[0]?.frame).toBe(2);
});

test('invalid entries are rejected', () => {
  expect(() => evalDatasetManifestSchema.parse([])).toThrow();
  expect(() => evalDatasetManifestSchema.parse([{ ...OLD_ENTRY, lat: 95 }])).toThrow();
  expect(() => evalDatasetManifestSchema.parse([{ ...OLD_ENTRY, headingDeg: 400 }])).toThrow();
  expect(() =>
    evalDatasetManifestSchema.parse([{ ...OLD_ENTRY, signText: [{ frame: 4, text: 'x' }] }]),
  ).toThrow();
});
