import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { RoomShell } from '../engine/shell.ts';
import { GeoError } from '../errors.ts';
import type { ThumbStore } from '../http/thumbs.ts';
import type { WsClientData, WsRoomCoordinator } from './ws.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg',
};

function resolveStaticAsset(
  staticDir: string,
  reqPath: string,
): { filePath: string; mime: string } | null {
  if (!existsSync(staticDir)) return null;
  const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const safePath = path.resolve(staticDir, rel);
  const rootWithSep = path.resolve(staticDir) + path.sep;
  if (safePath !== path.resolve(staticDir, 'index.html') && !safePath.startsWith(rootWithSep)) {
    return null;
  }
  if (existsSync(safePath) && statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    return { filePath: safePath, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
  }
  const indexHtml = path.resolve(staticDir, 'index.html');
  if (!path.extname(rel) && existsSync(indexHtml)) {
    return { filePath: indexHtml, mime: 'text/html; charset=utf-8' };
  }
  return null;
}

export interface HttpServerHandle {
  port: number;
  baseUrl: string;
  stop: () => void;
}

export interface HttpServerOptions {
  port: number;
  staticDir: string;
  shell: RoomShell;
  thumbStore: ThumbStore;
  wsCoordinator: WsRoomCoordinator;
  rateLimiter: { extractClientIp: (req: Request, socketIp?: string) => string };
}

function handleHttpFetch(
  req: Request,
  srv: {
    requestIP: (r: Request) => { address: string } | null;
    upgrade: (r: Request, opts: { data: WsClientData }) => boolean;
  },
  opts: HttpServerOptions,
): Response | undefined {
  const url = new URL(req.url);

  if (url.pathname === '/healthz') {
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  }

  if (url.pathname.startsWith('/thumb/')) {
    const id = url.pathname.slice('/thumb/'.length);
    const buf = opts.thumbStore.get(id);
    if (!buf) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(buf), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
    });
  }

  if (url.pathname === '/ws') {
    const socketAddr = srv.requestIP(req)?.address ?? '127.0.0.1';
    const ip = opts.rateLimiter.extractClientIp(req, socketAddr);
    const gate = opts.wsCoordinator.canAcceptUpgrade(ip);
    if (!gate.ok) {
      return new Response(gate.message, { status: gate.status });
    }
    const upgraded = srv.upgrade(req, {
      data: {
        connId: randomBytes(8).toString('hex'),
        ip,
        authenticated: false,
        role: null,
        playerId: null,
        profileId: null,
        authTimer: null,
        authenticatedAt: null,
        lastSeqByPlayer: new Map(),
        countedPanoRounds: new Set(),
      },
    });
    return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
  }

  if (url.pathname.startsWith('/fake-pano')) {
    const label = url.pathname.replace(/^\/fake-pano\/?/, '') || '0';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="240" fill="#314969"/><rect y="240" width="800" height="210" fill="#4C5447"/><polygon points="350,240 450,240 660,450 140,450" fill="#34383F"/><text x="400" y="210" text-anchor="middle" fill="#F4F1EA" font-family="sans-serif" font-size="22">FAKE PANO ${label.replace(/[^a-zA-Z0-9_-]/g, '')}</text></svg>`;
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const asset = resolveStaticAsset(opts.staticDir, url.pathname);
  if (asset) {
    const cache = asset.filePath.endsWith('index.html')
      ? 'no-store'
      : 'public, max-age=31536000, immutable';
    return new Response(Bun.file(asset.filePath), {
      headers: { 'content-type': asset.mime, 'cache-control': cache },
    });
  }
  return new Response('Not found', { status: 404 });
}

export function startAppHttpServer(opts: HttpServerOptions): HttpServerHandle {
  let server: ReturnType<typeof Bun.serve<WsClientData>>;
  try {
    server = Bun.serve<WsClientData>({
      hostname: '127.0.0.1',
      port: opts.port,
      fetch: (req, srv) => handleHttpFetch(req, srv, opts),
      websocket: {
        maxPayloadLength: 32 * 1024,
        open(ws) {
          opts.wsCoordinator.openSocket(ws);
        },
        message(ws, msg) {
          const data = typeof msg === 'string' ? msg : Buffer.from(msg);
          opts.wsCoordinator.handleRawMessage(ws, data);
        },
        close(ws) {
          opts.wsCoordinator.closeSocket(ws);
        },
      },
    });
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 'EADDRINUSE' || /in use|EADDRINUSE|failed to start server/i.test(msg)) {
      throw new GeoError({
        code: 'GEO_PORT_BUSY',
        causeDetail: `Порт 127.0.0.1:${opts.port} уже занят (${msg})`,
      });
    }
    throw err;
  }

  const boundPort = server.port ?? opts.port;
  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    stop() {
      opts.wsCoordinator.closeAll();
      void server.stop(true);
    },
  };
}
