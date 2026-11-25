import { expect, test } from 'bun:test';
import { mollweideToLatLng, parseGpkgGeometry, type XY } from './gpkg.ts';

const R = 6_378_137;

/** Appends numbers to a byte list in the chosen byte order. */
class Bytes {
  private readonly out: number[] = [];

  constructor(private readonly little: boolean) {}

  u8(n: number): this {
    this.out.push(n);
    return this;
  }

  u32(n: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, n, this.little);
    this.out.push(...new Uint8Array(view.buffer));
    return this;
  }

  f64(n: number): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n, this.little);
    this.out.push(...new Uint8Array(view.buffer));
    return this;
  }

  raw(bytes: number[]): this {
    this.out.push(...bytes);
    return this;
  }

  done(): number[] {
    return this.out;
  }
}

function polygonBody(b: Bytes, rings: XY[][], z = false): void {
  b.u32(rings.length);
  for (const ring of rings) {
    b.u32(ring.length);
    for (const [x, y] of ring) {
      b.f64(x).f64(y);
      if (z) b.f64(99);
    }
  }
}

function wkbPolygon(rings: XY[][], little = true, type = 3): number[] {
  const b = new Bytes(little).u8(little ? 1 : 0).u32(type);
  polygonBody(b, rings, type === 1003);
  return b.done();
}

function wkbMulti(polygons: XY[][][], little = true): number[] {
  const b = new Bytes(little)
    .u8(little ? 1 : 0)
    .u32(6)
    .u32(polygons.length);
  for (const rings of polygons) b.raw(wkbPolygon(rings, little));
  return b.done();
}

function blob(wkb: number[], flags: number, envelope: number[] = []): Uint8Array {
  const header = new Bytes(true).u8(0x47).u8(0x50).u8(0).u8(flags).u32(4326).done();
  return new Uint8Array([...header, ...envelope, ...wkb]);
}

const square = (x: number, y: number, s: number): XY[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

// Value: protects=a MultiPolygon keeps every polygon with its rings in order (outer ring first); fails_when=polygons are merged or rings reordered;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry reads a little-endian MultiPolygon with a hole', () => {
  const withHole = [square(0, 0, 10), square(2, 2, 3)];
  const plain = [square(20, 20, 5)];
  const parsed = parseGpkgGeometry(blob(wkbMulti([withHole, plain]), 0x01));
  expect(parsed).toEqual([withHole, plain]);
  expect(parsed[0]?.[0]).toEqual(square(0, 0, 10));
});

// Value: protects=a single Polygon is wrapped as one polygon; fails_when=the Polygon branch is dropped;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry reads a single Polygon', () => {
  const rings = [square(1, 2, 3)];
  expect(parseGpkgGeometry(blob(wkbPolygon(rings), 0x01))).toEqual([rings]);
});

// Value: protects=a 32-byte envelope is skipped before the WKB starts; fails_when=the envelope size is wrong;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry skips a 32-byte envelope', () => {
  const rings = [square(5, 6, 1)];
  const envelope = new Bytes(true).f64(5).f64(6).f64(6).f64(7).done();
  expect(envelope.length).toBe(32);
  expect(parseGpkgGeometry(blob(wkbPolygon(rings), 0x03, envelope))).toEqual([rings]);
});

// Value: protects=the empty-geometry flag yields no polygons; fails_when=the flag is ignored and the body is parsed;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry returns nothing for the empty-geometry flag', () => {
  expect(parseGpkgGeometry(blob([], 0x11))).toEqual([]);
});

// Value: protects=big-endian WKB is decoded; fails_when=the byte order flag is ignored;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry reads big-endian WKB', () => {
  const rings = [square(7, 8, 2), square(8, 9, 0.5)];
  expect(parseGpkgGeometry(blob(wkbMulti([rings], false), 0x01))).toEqual([rings]);
  expect(parseGpkgGeometry(blob(wkbPolygon(rings, false), 0x01))).toEqual([rings]);
});

// Value: protects=the third coordinate of a Z geometry is dropped and the next point stays aligned; fails_when=Z values are read as x or y;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry drops the Z coordinate', () => {
  const rings = [square(1, 1, 4)];
  expect(parseGpkgGeometry(blob(wkbPolygon(rings, true, 1003), 0x01))).toEqual([rings]);
  const multiZ = new Bytes(true)
    .u8(1)
    .u32(1006)
    .u32(1)
    .raw(wkbPolygon(rings, true, 1003));
  expect(parseGpkgGeometry(blob(multiZ.done(), 0x01))).toEqual([rings]);
});

// Value: protects=a blob without the GP magic is rejected; fails_when=the magic check is removed;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry throws when the GP magic is missing', () => {
  const bad = blob(wkbPolygon([square(0, 0, 1)]), 0x01);
  bad[0] = 0x58;
  expect(() => parseGpkgGeometry(bad)).toThrow('"GP" magic');
  expect(() => parseGpkgGeometry(new Uint8Array([0x47, 0x50]))).toThrow('"GP" magic');
});

// Value: protects=a truncated blob gives a clear error instead of a RangeError; fails_when=the RangeError is not translated;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry throws on a truncated blob', () => {
  const whole = blob(wkbPolygon([square(0, 0, 1)]), 0x01);
  expect(() => parseGpkgGeometry(whole.subarray(0, whole.length - 5))).toThrow(
    'GeoPackage geometry is cut short',
  );
});

// Value: protects=a non-polygon geometry type is refused; fails_when=a Point is accepted or read as a polygon;
// why_new=there was no GeoPackage reader test at all; seam=none; no_claim=a real GHSL file (hand-built blob)
test('parseGpkgGeometry throws on an unsupported WKB type', () => {
  const point = new Bytes(true).u8(1).u32(1).f64(1).f64(2).done();
  expect(() => parseGpkgGeometry(blob(point, 0x01))).toThrow('Unsupported WKB geometry type 1');
});

// Value: protects=the projection origin maps to latitude 0 and longitude 0; fails_when=an offset is introduced;
// why_new=there was no Mollweide test at all; seam=none; no_claim=other ellipsoids (sphere only)
test('mollweideToLatLng maps the origin to (0, 0)', () => {
  const { lat, lng } = mollweideToLatLng(0, 0);
  expect(lat).toBeCloseTo(0, 9);
  expect(lng).toBeCloseTo(0, 9);
});

function forwardMollweide(latDeg: number, lngDeg: number): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lngDeg * Math.PI) / 180;
  let theta = phi;
  for (let i = 0; i < 100; i += 1) {
    const f = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi);
    const slope = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(slope) < 1e-12) break;
    theta -= f / slope;
  }
  return {
    x: ((2 * Math.SQRT2) / Math.PI) * R * lambda * Math.cos(theta),
    y: Math.SQRT2 * R * Math.sin(theta),
  };
}

// Value: protects=the inverse projection matches an independent forward Mollweide; fails_when=a constant or formula in the inverse is wrong;
// why_new=there was no Mollweide test at all; seam=none; no_claim=other ellipsoids (sphere only)
test('mollweideToLatLng inverts a forward Mollweide for several cities', () => {
  const points = [
    { lat: 55.7558, lng: 37.6173 },
    { lat: -33.8688, lng: 151.2093 },
    { lat: -0.1807, lng: -78.4678 },
    { lat: 64.1466, lng: -21.9426 },
  ];
  for (const point of points) {
    const { x, y } = forwardMollweide(point.lat, point.lng);
    const back = mollweideToLatLng(x, y);
    expect(Math.abs(back.lat - point.lat)).toBeLessThan(1e-6);
    expect(Math.abs(back.lng - point.lng)).toBeLessThan(1e-6);
  }
});
