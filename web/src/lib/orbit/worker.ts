import { StageEngine } from './engine';
import type { StageMessage } from './types';

const engine = new StageEngine(
  () => new OffscreenCanvas(1, 1),
  (id, surface, renderer) => {
    if (!(surface instanceof OffscreenCanvas)) return;
    const image = surface.transferToImageBitmap();
    self.postMessage({ id, image, renderer }, { transfer: [image] });
  },
);
self.onmessage = (event: MessageEvent<StageMessage>) => {
  engine.update(event.data);
};
