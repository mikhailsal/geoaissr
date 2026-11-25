import rawData from './airports.data.json' with { type: 'json' };

/** A round on the airports map starts within this distance of an airport's reference point. */
export const AIRPORT_ZONE_KM = 5;
/** Search radius around the probe point; keeps the found panorama close to where we aimed. */
export const AIRPORT_SNAP_RADIUS_M = 600;

interface RawAirportsDataset {
  version: number;
  source: string;
  airports: Record<string, number[][]>;
}

/** Large and medium airports with scheduled service, as `[lat, lng]` per ISO country code. */
export const AIRPORTS_BY_ISO: Readonly<Record<string, readonly (readonly [number, number])[]>> =
  Object.fromEntries(
    Object.entries((rawData as RawAirportsDataset).airports).map(([iso, list]) => [
      iso,
      list.map(([lat = 0, lng = 0]) => [lat, lng] as const),
    ]),
  );
