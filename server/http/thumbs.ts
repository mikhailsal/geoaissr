import { randomBytes } from 'node:crypto';

export interface ThumbStore {
  put: (jpegBuffer: Buffer) => string;
  get: (id: string) => Buffer | null;
  clear: () => void;
  size: () => number;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export function createThumbStore(maxBytes: number = DEFAULT_MAX_BYTES): ThumbStore {
  const map = new Map<string, Buffer>();
  let totalBytes = 0;

  return {
    put(jpegBuffer: Buffer): string {
      const id = randomBytes(16).toString('hex');
      if (maxBytes > 0) {
        if (jpegBuffer.byteLength > maxBytes) return id;
        while (map.size > 0 && totalBytes + jpegBuffer.byteLength > maxBytes) {
          const oldestKey = map.keys().next().value;
          if (oldestKey === undefined) break;
          const oldest = map.get(oldestKey);
          map.delete(oldestKey);
          if (oldest) totalBytes -= oldest.byteLength;
        }
      }
      map.set(id, jpegBuffer);
      totalBytes += jpegBuffer.byteLength;
      return id;
    },
    get(id: string): Buffer | null {
      if (!/^[a-f0-9]{32}$/.test(id)) return null;
      const buf = map.get(id);
      if (!buf) return null;
      // Refresh insertion order for LRU eviction.
      map.delete(id);
      map.set(id, buf);
      return buf;
    },
    clear(): void {
      map.clear();
      totalBytes = 0;
    },
    size(): number {
      return map.size;
    },
  };
}
