import { randomBytes } from 'node:crypto';

export interface ThumbStore {
  put: (jpegBuffer: Buffer) => string;
  get: (id: string) => Buffer | null;
  clear: () => void;
  size: () => number;
}

export function createThumbStore(): ThumbStore {
  const map = new Map<string, Buffer>();

  return {
    put(jpegBuffer: Buffer): string {
      const id = randomBytes(16).toString('hex');
      map.set(id, jpegBuffer);
      return id;
    },
    get(id: string): Buffer | null {
      if (!/^[a-f0-9]{32}$/.test(id)) return null;
      return map.get(id) ?? null;
    },
    clear(): void {
      map.clear();
    },
    size(): number {
      return map.size;
    },
  };
}
