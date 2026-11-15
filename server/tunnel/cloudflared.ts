import type { TunnelStatusView } from '../../shared/protocol.ts';
import { GeoError } from '../errors.ts';
import { spawnManaged, type ManagedProcess } from '../proc/spawn.ts';

export type TunnelStatus = TunnelStatusView['status'];

export interface TunnelManager {
  start: () => void;
  stop: () => Promise<void>;
}

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;
const RESTART_BACKOFFS_MS = [2_000, 5_000, 10_000] as const;

export function extractTryCloudflareUrl(text: string): string | null {
  const m = URL_REGEX.exec(text);
  return m ? m[0] : null;
}

export interface PublicReadinessProbe {
  ok: boolean;
  stage: 'ok' | 'dns' | 'http';
  detail: string;
}

export async function probePublicReadiness(
  inviteUrl: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<PublicReadinessProbe> {
  const host = new URL(inviteUrl).hostname;
  const dohEndpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
  ];

  let resolvedDns = false;
  for (const endpoint of dohEndpoints) {
    try {
      const res = await fetchImpl(endpoint, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { Answer?: Array<{ data?: string }> };
      if (
        Array.isArray(body.Answer) &&
        body.Answer.some((a) => typeof a.data === 'string' && a.data.length > 0)
      ) {
        resolvedDns = true;
        break;
      }
    } catch {
      // Try secondary DoH resolver.
    }
  }
  if (!resolvedDns) {
    return {
      ok: false,
      stage: 'dns',
      detail: 'DNS не разрешает имя: DoH cloudflare-dns.com и dns.google не вернули A-запись',
    };
  }

  try {
    const hz = await fetchImpl(`${inviteUrl}/healthz`, { signal: AbortSignal.timeout(4_000) });
    if (hz.status === 200) {
      return { ok: true, stage: 'ok', detail: 'ok' };
    }
    return { ok: false, stage: 'http', detail: `GET /healthz вернул HTTP ${hz.status}` };
  } catch (err) {
    return {
      ok: false,
      stage: 'http',
      detail: `GET /healthz ошибка: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function checkDohAndHealthz(
  inviteUrl: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<boolean> {
  const probe = await probePublicReadiness(inviteUrl, fetchImpl);
  return probe.ok;
}

export interface CloudflaredDependencies {
  localPort: number;
  guestToken: string;
  childrenFile?: string;
  onStatus: (status: TunnelStatusView) => void;
  whichCloudflared?: () => string | null;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  spawnFn?: typeof spawnManaged;
}

interface TunnelRuntime {
  deps: CloudflaredDependencies;
  stopping: boolean;
  restarts: number;
  proc: ManagedProcess | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  lastReadyUrl: string | null;
}

async function waitForWarmup(
  rt: TunnelRuntime,
  baseUrl: string,
  generationProc: ManagedProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  const guestUrl = `${baseUrl}/#t=${rt.deps.guestToken}`;
  const isStale = (): boolean => rt.stopping || rt.proc !== generationProc;
  let lastDetail = 'DNS не разрешает имя';
  while (!isStale() && Date.now() < deadline) {
    const probe = await probePublicReadiness(baseUrl, rt.deps.fetchImpl);
    if (isStale()) return;
    if (probe.ok) {
      const changedSinceStart = Boolean(rt.lastReadyUrl && rt.lastReadyUrl !== guestUrl);
      rt.lastReadyUrl = guestUrl;
      rt.deps.onStatus({
        mode: 'tunnel',
        status: 'ready',
        inviteUrl: guestUrl,
        changedSinceStart,
      });
      return;
    }
    lastDetail = probe.detail;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!isStale()) {
    rt.deps.onStatus({
      mode: 'tunnel',
      status: 'error',
      inviteUrl: guestUrl,
      errorReason: `Публичная ссылка не ответила за 60 с (${lastDetail}); остановите start и запустите снова`,
      changedSinceStart: false,
    });
  }
}

function launchCloudflared(rt: TunnelRuntime): void {
  if (rt.stopping) return;
  const spawnImpl = rt.deps.spawnFn ?? spawnManaged;
  let capturedUrl: string | null = null;
  let stdoutTail = '';
  let stderrTail = '';

  const inspectChunk = (chunk: string, isStderr: boolean): void => {
    if (capturedUrl) return;
    const prev = isStderr ? stderrTail : stdoutTail;
    const combined = `${prev}${chunk}`;
    const trimmed = combined.length > 512 ? combined.slice(-512) : combined;
    if (isStderr) stderrTail = trimmed;
    else stdoutTail = trimmed;
    const found = extractTryCloudflareUrl(combined);
    if (found) {
      capturedUrl = found;
      void waitForWarmup(rt, found, proc);
    }
  };

  rt.deps.onStatus({
    mode: 'tunnel',
    status: 'checking',
    inviteUrl: null,
    changedSinceStart: false,
  });

  const proc = spawnImpl({
    cmd: [
      'cloudflared',
      'tunnel',
      '--url',
      `http://127.0.0.1:${rt.deps.localPort}`,
      '--no-autoupdate',
    ],
    cwd: process.cwd(),
    kind: 'tunnel',
    childrenFile: rt.deps.childrenFile,
    onStdoutChunk: (chunk) => {
      inspectChunk(chunk, false);
    },
    onStderrChunk: (chunk) => {
      inspectChunk(chunk, true);
    },
  });
  rt.proc = proc;

  void proc.exited.then((info) => {
    if (rt.stopping || rt.proc !== proc) return;
    if (rt.restarts >= RESTART_BACKOFFS_MS.length) {
      rt.deps.onStatus({
        mode: 'tunnel',
        status: 'error',
        inviteUrl: null,
        errorReason: `cloudflared завершился (${info.code ?? info.signal ?? 'unknown'}) после 3 перезапусков`,
        changedSinceStart: false,
      });
      return;
    }
    const backoff = RESTART_BACKOFFS_MS[rt.restarts] ?? 10_000;
    rt.restarts += 1;
    rt.deps.onStatus({
      mode: 'tunnel',
      status: 'checking',
      inviteUrl: null,
      errorReason: `Перезапуск туннеля через ${Math.round(backoff / 1000)} с...`,
      changedSinceStart: false,
    });
    rt.retryTimer = setTimeout(() => {
      launchCloudflared(rt);
    }, backoff);
  });
}

export function createCloudflaredManager(deps: CloudflaredDependencies): TunnelManager {
  const which = deps.whichCloudflared ?? (() => Bun.which('cloudflared'));
  if (!which()) {
    throw new GeoError({
      code: 'GEO_CLOUDFLARED_MISSING',
      causeDetail: 'cloudflared binary not found in PATH',
    });
  }

  const rt: TunnelRuntime = {
    deps,
    stopping: false,
    restarts: 0,
    proc: null,
    retryTimer: null,
    lastReadyUrl: null,
  };

  return {
    start() {
      rt.stopping = false;
      launchCloudflared(rt);
    },
    async stop() {
      rt.stopping = true;
      if (rt.retryTimer) {
        clearTimeout(rt.retryTimer);
        rt.retryTimer = null;
      }
      if (rt.proc) {
        const p = rt.proc;
        rt.proc = null;
        await p.stop(2_000);
      }
    },
  };
}
