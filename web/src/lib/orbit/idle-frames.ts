import type { Surface } from './types';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function snapshot(makeSurface: () => Surface): Context {
  const context = makeSurface().getContext('2d');
  if (!context) throw new Error('Orbit renderer could not create an idle snapshot.');
  return context;
}

/** Two nearby articulated poses bracket display time. Interpolating their premultiplied
 * pixels costs much less than repeatedly rasterizing every visible mesh on the CPU. */
export class IdleFrames {
  private from: Context;
  private to: Context;
  private fromTime = 0;
  private toTime = -Infinity;

  constructor(makeSurface: () => Surface) {
    this.from = snapshot(makeSurface);
    this.to = snapshot(makeSurface);
  }

  reset(): void {
    this.toTime = -Infinity;
  }

  draw(
    output: Context,
    time: number,
    interval: number,
    render: (seconds: number, target: Context) => void,
  ): void {
    const { width, height } = output.canvas;
    if (this.from.canvas.width !== width || this.from.canvas.height !== height) {
      for (const context of [this.from, this.to]) {
        context.canvas.width = width;
        context.canvas.height = height;
      }
      this.reset();
    }
    if (time > this.toTime + interval * 2 || time < this.fromTime) {
      // Show the first pose immediately; generate the next sample on a later frame.
      render(time, this.from);
      this.fromTime = this.toTime = time;
    } else if (time >= this.toTime) {
      if (this.toTime > this.fromTime) {
        [this.from, this.to] = [this.to, this.from];
        this.fromTime = this.toTime;
      }
      this.toTime = Math.max(time, this.fromTime) + interval;
      render(this.toTime, this.to);
    }
    const blend =
      this.toTime > this.fromTime ? (time - this.fromTime) / (this.toTime - this.fromTime) : 0;
    output.globalCompositeOperation = 'copy';
    output.globalAlpha = 1 - blend;
    output.drawImage(this.from.canvas, 0, 0);
    if (blend > 0) {
      output.globalCompositeOperation = 'lighter';
      output.globalAlpha = blend;
      output.drawImage(this.to.canvas, 0, 0);
    }
    output.globalAlpha = 1;
  }
}
