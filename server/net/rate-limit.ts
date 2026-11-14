export interface RateLimiter {
  extractClientIp: (req: Request, socketIp?: string) => string;
  isBlocked: (ip: string, nowMs?: number) => boolean;
  /** Per-IP block only (tunnel mode), without the room-wide global brake. */
  isIpBlocked: (ip: string, nowMs?: number) => boolean;
  recordAuthFailure: (ip: string, nowMs?: number) => void;
}

const WINDOW_MS = 60_000;
const PER_IP_LIMIT = 10;
const GLOBAL_LIMIT = 30;

function pruneWindow(timestamps: number[], cutoff: number): number[] {
  let start = 0;
  while (start < timestamps.length && (timestamps[start] ?? 0) <= cutoff) {
    start += 1;
  }
  return start > 0 ? timestamps.slice(start) : timestamps;
}

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function createAuthRateLimiter(mode: 'tunnel' | 'local' | 'public_url'): RateLimiter {
  const perIp = new Map<string, number[]>();
  let globalFailures: number[] = [];

  function extractClientIp(req: Request, socketIp = '127.0.0.1'): string {
    const normalizedSocket = socketIp || '127.0.0.1';
    if (mode === 'tunnel' && isLoopbackIp(normalizedSocket)) {
      const cfIp = req.headers.get('cf-connecting-ip')?.trim();
      if (cfIp) return cfIp;
    }
    return normalizedSocket;
  }

  function isBlocked(ip: string, nowMs = Date.now()): boolean {
    const cutoff = nowMs - WINDOW_MS;
    globalFailures = pruneWindow(globalFailures, cutoff);
    if (globalFailures.length > GLOBAL_LIMIT) {
      return true;
    }
    return isIpBlocked(ip, nowMs);
  }

  function isIpBlocked(ip: string, nowMs = Date.now()): boolean {
    if (mode !== 'tunnel') {
      return false;
    }
    const cutoff = nowMs - WINDOW_MS;
    const curIp = pruneWindow(perIp.get(ip) ?? [], cutoff);
    if (curIp.length === 0) {
      perIp.delete(ip);
      return false;
    }
    perIp.set(ip, curIp);
    return curIp.length > PER_IP_LIMIT;
  }

  function recordAuthFailure(ip: string, nowMs = Date.now()): void {
    const cutoff = nowMs - WINDOW_MS;
    globalFailures = pruneWindow(globalFailures, cutoff);
    globalFailures.push(nowMs);
    if (mode !== 'tunnel') return;
    if (perIp.size > 2_000) {
      for (const [k, ts] of perIp) {
        if (pruneWindow(ts, cutoff).length === 0) perIp.delete(k);
      }
    }
    const curIp = pruneWindow(perIp.get(ip) ?? [], cutoff);
    curIp.push(nowMs);
    perIp.set(ip, curIp);
  }

  return { extractClientIp, isBlocked, isIpBlocked, recordAuthFailure };
}
