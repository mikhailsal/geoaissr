import type { StageEngine } from './engine';
import type { StageMessage, StageState, Surface } from './types';

interface View {
  context: CanvasRenderingContext2D;
  state: StageState | null;
}

type Frame = { id: number; image: ImageBitmap; renderer: string };
const views = new Map<number, View>();
let nextId = 1;
let worker: Worker | null = null;
let engine: StageEngine | null = null;
let generation = 0;
let fallbackLoading = false;

function present(id: number, image: Surface | ImageBitmap, renderer: string): void {
  const view = views.get(id);
  if (!view || !view.state?.visible) return;
  const canvas = view.context.canvas;
  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width;
    canvas.height = image.height;
  }
  view.context.clearRect(0, 0, canvas.width, canvas.height);
  view.context.drawImage(image, 0, 0);
  canvas.dataset.avatarRenderer = renderer;
}

async function fallback(): Promise<void> {
  worker?.terminate();
  worker = null;
  if (fallbackLoading || !views.size) return;
  fallbackLoading = true;
  const version = generation;
  try {
    const { StageEngine } = await import('./engine');
    if (generation !== version || !views.size) return;
    engine = new StageEngine(() => document.createElement('canvas'), present);
    for (const [id, view] of views) engine.update({ id, state: view.state });
  } finally {
    if (generation === version) fallbackLoading = false;
  }
}

function start(): void {
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<Frame>) => {
        try {
          present(data.id, data.image, data.renderer);
        } finally {
          data.image.close();
        }
      };
      worker.onerror = () => void fallback();
      return;
    } catch {
      // A browser policy can disable workers independently of WebGL.
    }
  }
  void fallback();
}

function send(message: StageMessage): void {
  if (worker) worker.postMessage(message);
  else engine?.update(message);
}

export function mountStage(canvas: HTMLCanvasElement) {
  const id = nextId++;
  const context = canvas.getContext('2d');
  if (!context) return;
  const view: View = { context, state: null };
  views.set(id, view);
  if (views.size === 1) start();
  return {
    update(state: StageState) {
      view.state = state;
      send({ id, state });
    },
    destroy() {
      send({ id, state: null });
      views.delete(id);
      if (!views.size) {
        generation++;
        fallbackLoading = false;
        worker?.terminate();
        worker = null;
        engine?.dispose();
        engine = null;
      }
    },
  };
}
