import type { StageEngine } from './engine';
import type { StageMessage, StageState, Surface } from './types';

interface View {
  canvas: HTMLCanvasElement;
  target: CanvasRenderingContext2D | ImageBitmapRenderingContext | null;
  state: StageState | null;
  look: string;
  revision: number;
  slot?: WorkerSlot;
}

type Frame = { id: number; revision: number; image: ImageBitmap; renderer: string };
const views = new Map<number, View>();
interface WorkerSlot {
  worker: Worker;
  users: number;
}
const workers: WorkerSlot[] = [];
let nextId = 1;
let workerLimit = 0;
let engine: StageEngine | null = null;
let generation = 0;
let fallbackLoading = false;

function present(
  id: number,
  revision: number,
  image: Surface | ImageBitmap,
  renderer: string,
): void {
  const view = views.get(id);
  if (!view || !view.state?.visible || view.revision !== revision) return;
  const { canvas } = view;
  view.target ??=
    (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
      ? canvas.getContext('bitmaprenderer')
      : null) ?? canvas.getContext('2d');
  if (!view.target) return;
  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width;
    canvas.height = image.height;
  }
  if ('transferFromImageBitmap' in view.target) {
    if (image instanceof ImageBitmap) view.target.transferFromImageBitmap(image);
    else if ('transferToImageBitmap' in image)
      view.target.transferFromImageBitmap(image.transferToImageBitmap());
    else return;
  } else {
    view.target.globalCompositeOperation = 'copy';
    view.target.drawImage(image, 0, 0);
  }
  if (canvas.dataset.avatarRenderer !== renderer) canvas.dataset.avatarRenderer = renderer;
}

function stopWorkers(): void {
  for (const slot of workers) slot.worker.terminate();
  workers.length = 0;
  workerLimit = 0;
  for (const view of views.values()) delete view.slot;
}

async function fallback(): Promise<void> {
  stopWorkers();
  if (fallbackLoading || engine || !views.size) return;
  fallbackLoading = true;
  const version = generation;
  try {
    const { StageEngine } = await import('./engine');
    if (generation !== version || !views.size) return;
    engine = new StageEngine(
      () =>
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(1, 1)
          : document.createElement('canvas'),
      present,
      true,
    );
    for (const [id, view] of views)
      engine.update({ id, revision: view.revision, state: view.state });
  } finally {
    if (generation === version) fallbackLoading = false;
  }
}

function startWorker(): WorkerSlot {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const slot = { worker, users: 0 };
  workers.push(slot);
  worker.onmessage = ({ data }: MessageEvent<Frame | { ready: string }>) => {
    if ('ready' in data) {
      if (!workerLimit && workers[0] === slot) {
        // Hardware WebGL shares one context. CPU rasterizers work independently by avatar.
        workerLimit =
          data.ready === 'software'
            ? Math.max(1, Math.min(5, (navigator.hardwareConcurrency || 2) - 2))
            : 1;
        for (const [id, view] of views) send(id, view);
      }
      return;
    }
    try {
      if (views.get(data.id)?.slot === slot)
        present(data.id, data.revision, data.image, data.renderer);
    } finally {
      data.image.close();
    }
  };
  worker.onerror = () => {
    if (workers.includes(slot)) void fallback();
  };
  return slot;
}

function workerFor(view: View): Worker {
  if (!view.slot) {
    const lightest = workers.reduce((a, b) => (a.users <= b.users ? a : b));
    view.slot = lightest.users > 0 && workers.length < workerLimit ? startWorker() : lightest;
    view.slot.users++;
  }
  return view.slot.worker;
}

function send(id: number, view: View): void {
  const message: StageMessage = { id, revision: view.revision, state: view.state };
  if (engine) engine.update(message);
  else if (workerLimit && (view.state?.visible || view.slot)) {
    try {
      workerFor(view).postMessage(message);
    } catch {
      void fallback();
    }
  }
}

export function mountStage(canvas: HTMLCanvasElement) {
  const id = nextId++;
  const view: View = { canvas, target: null, state: null, look: '', revision: 0 };
  views.set(id, view);
  if (views.size === 1) {
    try {
      if (typeof OffscreenCanvas === 'function') startWorker();
      else void fallback();
    } catch {
      void fallback();
    }
  }
  return {
    update(state: StageState) {
      const look = JSON.stringify(state.appearance);
      if (look !== view.look) {
        view.look = look;
        view.revision++;
        delete canvas.dataset.avatarRenderer;
      }
      view.state = state;
      send(id, view);
    },
    destroy() {
      view.state = null;
      send(id, view);
      if (view.slot && --view.slot.users === 0 && workers.length > 1) {
        view.slot.worker.terminate();
        workers.splice(workers.indexOf(view.slot), 1);
      }
      views.delete(id);
      if (!views.size) {
        generation++;
        fallbackLoading = false;
        stopWorkers();
        engine?.dispose();
        engine = null;
      }
    },
  };
}
