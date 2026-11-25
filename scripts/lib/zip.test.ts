import { expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { readZipEntry } from './zip.ts';

interface FileSpec {
  name: string;
  data: Uint8Array;
  method?: number;
  declaredSize?: number;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Builds a ZIP archive in memory: local headers, central directory, end record. */
function buildZip(files: FileSpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  for (const file of files) {
    const method = file.method ?? 8;
    const packed = method === 8 ? deflateRawSync(file.data) : file.data;
    const name = [...encoder.encode(file.name)];
    const size = file.declaredSize ?? file.data.byteLength;
    const offset = local.length;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u32(0), ...u32(0));
    local.push(...u32(packed.byteLength), ...u32(size), ...u16(name.length), ...u16(0));
    local.push(...name, ...packed);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method));
    central.push(...u32(0), ...u32(0), ...u32(packed.byteLength), ...u32(size));
    central.push(...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    central.push(...u32(0), ...u32(offset), ...name);
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const show = (b: Uint8Array): string => new TextDecoder().decode(b);

// Value: protects=a stored (method 0) entry is returned byte for byte; fails_when=the stored branch returns the wrong slice;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry reads a stored entry', () => {
  const zip = buildZip([{ name: 'a.txt', data: text('hello stored'), method: 0 }]);
  expect(show(readZipEntry(zip, () => true))).toBe('hello stored');
});

// Value: protects=a deflated (method 8) entry is inflated; fails_when=inflate is skipped or the size check misfires;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry reads a deflated entry', () => {
  const body = 'deflate me '.repeat(100);
  const zip = buildZip([{ name: 'a.txt', data: text(body) }]);
  expect(show(readZipEntry(zip, () => true))).toBe(body);
});

// Value: protects=the predicate selects the entry among several; fails_when=the first entry is always returned;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry picks the entry the predicate asks for', () => {
  const zip = buildZip([
    { name: 'one.txt', data: text('first'), method: 0 },
    { name: 'two.txt', data: text('second') },
    { name: 'three.txt', data: text('third'), method: 0 },
  ]);
  expect(show(readZipEntry(zip, (n) => n === 'two.txt'))).toBe('second');
  expect(show(readZipEntry(zip, (n) => n === 'three.txt'))).toBe('third');
});

// Value: protects=a missing entry fails with the list of names in the archive; fails_when=the message drops the names or no error is thrown;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry throws and lists the names when nothing matches', () => {
  const zip = buildZip([
    { name: 'one.txt', data: text('1'), method: 0 },
    { name: 'two.txt', data: text('2'), method: 0 },
  ]);
  expect(() => readZipEntry(zip, (n) => n === 'nope')).toThrow('one.txt, two.txt');
});

// Value: protects=bytes that are not a ZIP are rejected; fails_when=the end-record search accepts garbage;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry throws on bytes that are not a ZIP archive', () => {
  expect(() => readZipEntry(text('this is plainly not an archive at all'), () => true)).toThrow(
    'Not a ZIP archive',
  );
});

// Value: protects=an unknown compression method is refused; fails_when=such an entry is returned as raw bytes;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry throws on an unsupported compression method', () => {
  const zip = buildZip([{ name: 'a.txt', data: text('data'), method: 12 }]);
  expect(() => readZipEntry(zip, () => true)).toThrow('unsupported compression method 12');
});

// Value: protects=an entry whose unpacked size differs from the declared size is refused; fails_when=the size comparison is removed;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry throws when the unpacked size differs from the declared size', () => {
  const zip = buildZip([{ name: 'a.txt', data: text('twelve bytes'), declaredSize: 5 }]);
  expect(() => readZipEntry(zip, () => true)).toThrow('expected 5');
});

// Value: protects=a cut-short entry is reported; fails_when=the compressed-size check is removed;
// why_new=there was no ZIP reader test at all; seam=none; no_claim=real downloaded archives (in-memory fixture)
test('readZipEntry throws when the entry is cut short', () => {
  const zip = buildZip([{ name: 'a.txt', data: text('some stored content here'), method: 0 }]);
  // Raise the compressed size in the central directory beyond the end of the file.
  const view = new DataView(zip.buffer);
  const endAt = zip.byteLength - 22;
  const centralAt = view.getUint32(endAt + 16, true);
  view.setUint32(centralAt + 20, 100_000, true);
  expect(() => readZipEntry(zip, () => true)).toThrow('cut short');
});
