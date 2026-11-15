import { randomBytes } from 'node:crypto';

export type ThumbTier = 'thumb' | 'full';

export interface ThumbStore {
  put: (jpegBuffer: Buffer, tier?: ThumbTier) => string;
  get: (id: string) => Buffer | null;
  clear: () => void;
  size: () => number;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

function evictOldest(map: Map<string, Buffer>): number {
  const oldestKey = map.keys().next().value;
  if (oldestKey === undefined) return 0;
  const oldest = map.get(oldestKey);
  map.delete(oldestKey);
  return oldest ? oldest.byteLength : 0;
}

export function createThumbStore(maxBytes: number = DEFAULT_MAX_BYTES): ThumbStore {
  const thumbMap = new Map<string, Buffer>();
  const fullMap = new Map<string, Buffer>();
  let totalBytes = 0;
  let thumbBytes = 0;

  return {
    put(jpegBuffer: Buffer, tier: ThumbTier = 'thumb'): string {
      const id = randomBytes(16).toString('hex');
      if (maxBytes > 0) {
        if (jpegBuffer.byteLength > maxBytes) return id;
        if (tier === 'full' && thumbBytes + jpegBuffer.byteLength > maxBytes) return id;
        while (
          (fullMap.size > 0 || thumbMap.size > 0) &&
          totalBytes + jpegBuffer.byteLength > maxBytes
        ) {
          // Evict heavy full-size frames globally before dropping strip thumbnails.
          const evictFull = fullMap.size > 0;
          const evictedBytes = evictOldest(evictFull ? fullMap : thumbMap);
          totalBytes -= evictedBytes;
          if (!evictFull) thumbBytes -= evictedBytes;
        }
      }
      const target = tier === 'full' ? fullMap : thumbMap;
      target.set(id, jpegBuffer);
      totalBytes += jpegBuffer.byteLength;
      if (tier === 'thumb') thumbBytes += jpegBuffer.byteLength;
      return id;
    },
    get(id: string): Buffer | null {
      if (!/^[a-f0-9]{32}$/.test(id)) return null;
      const target = thumbMap.has(id) ? thumbMap : fullMap.has(id) ? fullMap : null;
      if (!target) return null;
      const buf = target.get(id);
      if (!buf) return null;
      // Refresh insertion order for LRU eviction.
      target.delete(id);
      target.set(id, buf);
      return buf;
    },
    clear(): void {
      thumbMap.clear();
      fullMap.clear();
      totalBytes = 0;
      thumbBytes = 0;
    },
    size(): number {
      return thumbMap.size + fullMap.size;
    },
  };
}
