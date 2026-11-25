import path from 'node:path';
import { computeMapAvailability } from '../server/maps/availability.ts';
import { writeDatasetFile } from './lib/dataset-io.ts';

/**
 * Rebuilds the table the lobby uses to grey out a map that has no places in a region. Run it
 * after any dataset changes (`build:regions`, `build:airports`, `build:places`, `build:cities`);
 * `bun run test` fails while the table is out of date.
 */
if (import.meta.main) {
  const data = computeMapAvailability();
  const outPath = path.resolve(import.meta.dir, '../shared/map-availability.data.json');
  writeDatasetFile(outPath, data);
  for (const [map, table] of Object.entries(data.maps)) {
    console.log(map, 'regions with places:', Object.keys(table).length, 'world:', table.world ?? 0);
  }
}
