import { inflateRawSync } from 'node:zlib';

/** A dataset archive bigger than this is not what the builders expect: refuse it. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of up to 65535 bytes, so scan back from the end.
  const lowest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new Error('Not a ZIP archive: no end of central directory record');
}

function readEntries(bytes: Uint8Array, view: DataView): ZipEntry[] {
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_FILE_HEADER) {
      throw new Error('ZIP archive is damaged: bad central directory entry');
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Reads one file out of a ZIP archive held in memory. Supports the two methods the dataset
 * publishers use (stored and deflate) and refuses an entry that claims an implausible size.
 */
export function readZipEntry(bytes: Uint8Array, wanted: (name: string) => boolean): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readEntries(bytes, view);
  const entry = entries.find((candidate) => wanted(candidate.name));
  if (!entry) {
    throw new Error(
      `ZIP archive has no matching file (it holds: ${entries.map((e) => e.name).join(', ')})`,
    );
  }
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`ZIP entry ${entry.name} is larger than ${MAX_ENTRY_BYTES} bytes`);
  }
  const header = entry.localHeaderOffset;
  if (header + 30 > view.byteLength || view.getUint32(header, true) !== LOCAL_FILE_HEADER) {
    throw new Error(`ZIP archive is damaged: bad local header of ${entry.name}`);
  }
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const packed = bytes.subarray(start, start + entry.compressedSize);
  if (packed.byteLength !== entry.compressedSize) {
    throw new Error(`ZIP archive is damaged: ${entry.name} is cut short`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`ZIP entry ${entry.name} uses unsupported compression method ${entry.method}`);
  }
  const unpacked =
    entry.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: MAX_ENTRY_BYTES });
  if (unpacked.byteLength !== entry.size) {
    throw new Error(
      `ZIP entry ${entry.name} unpacked to ${unpacked.byteLength} bytes, expected ${entry.size}`,
    );
  }
  return new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength);
}
