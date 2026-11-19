import { buildRig, Painter } from './painter';
import {
  gestureDuration,
  type Paint,
  type StageMessage,
  type StageState,
  type Surface,
} from './types';

interface Actor {
  state: StageState;
  model?: ReturnType<typeof buildRig>;
  look: string;
  dirty: boolean;
  animating: boolean;
  paintedAt: number;
}

/** One GPU context serves every visible participant and the wardrobe preview. */
export class StageEngine {
  private readonly actors = new Map<number, Actor>();
  private readonly painter;
  private frame = 0;
  private idleTimer = 0;
  private lastIdlePaint = 0;

  constructor(
    makeSurface: () => Surface,
    private readonly paint: Paint,
  ) {
    this.painter = new Painter(makeSurface);
  }

  update({ id, state }: StageMessage): void {
    const actor = this.actors.get(id);
    if (!state) {
      actor?.model?.rig.dispose();
      this.actors.delete(id);
      return;
    }
    const look = JSON.stringify(state.appearance);
    if (actor) {
      if (actor.look !== look) {
        actor.model?.rig.dispose();
        delete actor.model;
      }
      Object.assign(actor, { state, look, dirty: true });
    } else {
      this.actors.set(id, { state, look, dirty: true, animating: false, paintedAt: 0 });
    }
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.idleTimer);
    if (this.frame) return;
    this.frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => {
            this.draw();
          })
        : setTimeout(() => {
            this.draw();
          }, 16);
  }

  private oldestIdle(): Actor | undefined {
    let oldest: Actor | undefined;
    for (const actor of this.actors.values()) {
      if (!actor.state.visible || actor.state.reduced || actor.dirty || actor.animating) continue;
      if (!oldest || actor.paintedAt < oldest.paintedAt) oldest = actor;
    }
    return oldest;
  }

  private idleDue(actor: Actor): number {
    // Stagger idle work across the room, giving the CPU renderer a smaller total budget.
    const software = this.painter.mode === 'software';
    return Math.max(
      actor.paintedAt + 1000 / (software ? 12 : 20),
      this.lastIdlePaint + 1000 / (software ? 24 : 48),
    );
  }

  private draw(): void {
    this.frame = 0;
    const now = Date.now();
    const clock = performance.now();
    const oldest = this.oldestIdle();
    const idle = oldest && this.idleDue(oldest) <= clock ? oldest : undefined;
    let again = false;
    let built = false;
    for (const [id, actor] of this.actors) {
      if (!actor.state.visible) continue;
      const g = actor.state.gesture;
      const animating = Boolean(g && !actor.state.reduced && now < g.at + gestureDuration[g.kind]);
      if (!actor.dirty && !animating && !actor.animating && actor !== idle) continue;
      // Stage initial construction over successive callbacks; gestures stay responsive in large rooms.
      if (!actor.model && built) {
        again = true;
        continue;
      }
      if (!actor.model) {
        actor.model = buildRig(actor.state);
        built = true;
      }
      // Offset the Studio animation clock so the lineup breathes and blinks independently.
      const image = this.painter.paint(actor.model, actor.state, now, clock / 1000 + id * 1.7);
      this.paint(id, image, this.painter.mode);
      actor.dirty = false;
      actor.animating = animating;
      actor.paintedAt = performance.now();
      if (actor === idle) this.lastIdlePaint = actor.paintedAt;
      again ||= animating;
    }
    if (again) {
      this.schedule();
      return;
    }
    const next = this.oldestIdle();
    if (next) {
      const delay = this.idleDue(next) - performance.now();
      this.idleTimer = setTimeout(() => {
        this.schedule();
      }, delay);
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    else clearTimeout(this.frame);
    for (const actor of this.actors.values()) actor.model?.rig.dispose();
    this.actors.clear();
    this.painter.dispose();
  }
}
