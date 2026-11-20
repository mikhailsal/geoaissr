import { buildRig, Painter } from './painter';
import type { Paint, StageMessage, StageState, Surface } from './types';

interface Actor {
  id: number;
  revision: number;
  state: StageState;
  model?: ReturnType<typeof buildRig>;
  dirty: boolean;
  paintedAt: number;
}

export class StageEngine {
  private readonly actors = new Map<number, Actor>();
  private readonly painter;
  private frame = 0;
  private lastAnimationTick = -1;

  constructor(
    makeSurface: () => Surface,
    private readonly paint: Paint,
    private readonly onMainThread = false,
  ) {
    this.painter = new Painter(makeSurface);
  }

  get mode(): string {
    return this.painter.mode;
  }

  update({ id, revision, state }: StageMessage): void {
    const actor = this.actors.get(id);
    if (!state) {
      actor?.model?.rig.dispose();
      this.actors.delete(id);
      return;
    }
    if (actor) {
      if (actor.revision !== revision) {
        actor.model?.rig.dispose();
        delete actor.model;
      }
      Object.assign(actor, { state, revision, dirty: true });
    } else {
      this.actors.set(id, { id, state, revision, dirty: true, paintedAt: -Infinity });
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    const draw = (time: number): void => {
      this.draw(time);
    };
    this.frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(draw)
        : setTimeout(() => {
            draw(performance.now());
          }, 16);
  }

  private draw(frameTime: number): void {
    this.frame = 0;
    const clock = performance.now();
    const now = Date.now();
    const tick = Math.floor((frameTime * 60) / 1000);
    const advance = tick !== this.lastAnimationTick;
    this.lastAnimationTick = tick;
    const actors = [...this.actors.values()].filter((actor) => actor.state.visible);
    const idleInterval = this.onMainThread ? Math.max(1 / 30, actors.length / 50) : 1 / 30;
    // Fresh looks take priority. On the main-thread fallback, round-robin the remainder
    // so a slow raster cannot hold input handling for an entire lineup.
    actors.sort((a, b) => Number(b.dirty) - Number(a.dirty) || a.paintedAt - b.paintedAt);
    let built = false;
    let painted = false;
    let again = false;
    for (const actor of actors) {
      again ||= !actor.state.reduced;
      if (!actor.dirty && (actor.state.reduced || !advance)) continue;
      if (
        (!actor.model && built) ||
        (this.onMainThread && painted && performance.now() - clock >= 7)
      ) {
        again = true;
        continue;
      }
      if (!actor.model) {
        actor.model = buildRig(actor.state);
        built = true;
      }
      const image = this.painter.paint(
        actor.model,
        actor.state,
        now,
        clock / 1000 + actor.id * 1.7,
        idleInterval,
      );
      this.paint(actor.id, actor.revision, image, this.painter.mode);
      actor.dirty = false;
      actor.paintedAt = clock;
      painted = true;
    }
    if (again) this.schedule();
  }

  dispose(): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    else clearTimeout(this.frame);
    for (const actor of this.actors.values()) actor.model?.rig.dispose();
    this.actors.clear();
    this.painter.dispose();
  }
}
