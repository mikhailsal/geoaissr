/** Reading polygon geometry out of an OGC GeoPackage and out of the Mollweide projection. */

export type XY = [number, number];
/** Polygons of one feature; each polygon is its rings, outer ring first. */
export type MultiPolygon = XY[][][];

const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;
/** Radius of the sphere ESRI:54009 (World Mollweide) is defined on, in metres. */
const MOLLWEIDE_RADIUS_M = 6_378_137;

class Cursor {
  private at: number;

  constructor(
    private readonly view: DataView,
    start: number,
  ) {
    this.at = start;
  }

  uint8(): number {
    const value = this.view.getUint8(this.at);
    this.at += 1;
    return value;
  }

  uint32(littleEndian: boolean): number {
    const value = this.view.getUint32(this.at, littleEndian);
    this.at += 4;
    return value;
  }

  float64(littleEndian: boolean): number {
    const value = this.view.getFloat64(this.at, littleEndian);
    this.at += 8;
    return value;
  }
}

/** Size of the optional envelope in a GeoPackage geometry header, by its 3-bit indicator. */
function envelopeBytes(indicator: number): number {
  if (indicator === 0) return 0;
  if (indicator === 1) return 32;
  if (indicator === 2 || indicator === 3) return 48;
  if (indicator === 4) return 64;
  throw new Error(`GeoPackage geometry has an invalid envelope indicator ${indicator}`);
}

/** WKB type code to its base type and coordinate count (ISO Z/M codes and EWKB flag bits). */
function decodeWkbType(raw: number): { base: number; coords: number } {
  const hasEwkbZ = (raw & 0x80000000) !== 0;
  const hasEwkbM = (raw & 0x40000000) !== 0;
  const plain = raw & 0x0fffffff;
  const isoDims = Math.floor(plain / 1000);
  const coords =
    2 + (hasEwkbZ || isoDims === 1 || isoDims === 3 ? 1 : 0) + (hasEwkbM || isoDims >= 2 ? 1 : 0);
  return { base: plain % 1000, coords };
}

function readPolygon(cursor: Cursor, littleEndian: boolean, coords: number): XY[][] {
  const ringCount = cursor.uint32(littleEndian);
  const rings: XY[][] = [];
  for (let r = 0; r < ringCount; r += 1) {
    const pointCount = cursor.uint32(littleEndian);
    const ring: XY[] = [];
    for (let p = 0; p < pointCount; p += 1) {
      const x = cursor.float64(littleEndian);
      const y = cursor.float64(littleEndian);
      for (let extra = 2; extra < coords; extra += 1) cursor.float64(littleEndian);
      ring.push([x, y]);
    }
    rings.push(ring);
  }
  return rings;
}

function readWkbGeometry(cursor: Cursor): MultiPolygon {
  const littleEndian = cursor.uint8() === 1;
  const { base, coords } = decodeWkbType(cursor.uint32(littleEndian));
  if (base === WKB_POLYGON) return [readPolygon(cursor, littleEndian, coords)];
  if (base !== WKB_MULTIPOLYGON) throw new Error(`Unsupported WKB geometry type ${base}`);
  const polygonCount = cursor.uint32(littleEndian);
  const polygons: MultiPolygon = [];
  for (let i = 0; i < polygonCount; i += 1) polygons.push(...readWkbGeometry(cursor));
  return polygons;
}

/** Parses a GeoPackage geometry blob (header, optional envelope, WKB) into its polygons. */
export function parseGpkgGeometry(blob: Uint8Array): MultiPolygon {
  if (blob.byteLength < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new Error('Not a GeoPackage geometry: the "GP" magic is missing');
  }
  const flags = blob[3] ?? 0;
  if ((flags & 0x10) !== 0) return [];
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const wkbStart = 8 + envelopeBytes((flags >> 1) & 0x07);
  try {
    return readWkbGeometry(new Cursor(view, wkbStart));
  } catch (err) {
    if (err instanceof RangeError) throw new Error('GeoPackage geometry is cut short');
    throw err;
  }
}

/** Mollweide metres (ESRI:54009) to latitude and longitude in degrees. */
export function mollweideToLatLng(x: number, y: number): { lat: number; lng: number } {
  const root2 = Math.SQRT2;
  const sinTheta = Math.max(-1, Math.min(1, y / (root2 * MOLLWEIDE_RADIUS_M)));
  const theta = Math.asin(sinTheta);
  const lat = Math.asin(Math.max(-1, Math.min(1, (2 * theta + Math.sin(2 * theta)) / Math.PI)));
  const cosTheta = Math.cos(theta);
  const lng = cosTheta < 1e-12 ? 0 : (Math.PI * x) / (2 * root2 * MOLLWEIDE_RADIUS_M * cosTheta);
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}
