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
}

/** One GPU context serves every visible participant and the wardrobe preview. */
export class StageEngine {
  private readonly actors = new Map<number, Actor>();
  private readonly painter;
  private frame = 0;

  constructor(
    makeSurface: () => Surface,
    private readonly paint: Paint,
  ) {
    this.painter = new Painter(makeSurface);
  }

  update({ id, state }: StageMessage): void {
    const actor = this.actors.get(id);
    if (!state || !state.visible) {
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
      this.actors.set(id, { state, look, dirty: true, animating: false });
    }
    this.schedule();
  }

  private schedule(): void {
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

  private draw(): void {
    this.frame = 0;
    const now = Date.now();
    let again = false;
    let built = false;
    for (const [id, actor] of this.actors) {
      const g = actor.state.gesture;
      const animating = Boolean(g && !actor.state.reduced && now < g.at + gestureDuration[g.kind]);
      if (!actor.dirty && !animating && !actor.animating) continue;
      // Stage initial construction over successive callbacks; gestures stay responsive in large rooms.
      if (!actor.model && built) {
        again = true;
        continue;
      }
      if (!actor.model) {
        actor.model = buildRig(actor.state);
        built = true;
      }
      const image = this.painter.paint(actor.model, actor.state, now);
      this.paint(id, image, this.painter.mode);
      actor.dirty = false;
      actor.animating = animating;
      again ||= animating;
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
