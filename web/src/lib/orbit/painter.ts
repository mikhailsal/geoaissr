import { createAvatar, type OrbitRig } from '@geoaissr/orbit-rig';
import { Rasterizer } from '@geoaissr/orbit-rig/raster';
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { addRobotDetails } from './robot';
import { IdleFrames } from './idle-frames';
import { spinDuration, spinMotion } from './spin';
import { gestureDuration, type StageState, type Surface } from './types';

export function buildRig(state: StageState) {
  const look = state.appearance;
  const rig = createAvatar(
    look,
    look.base === 'robot'
      ? (head, faceZ) => {
          addRobotDetails(head, look, faceZ);
        }
      : undefined,
  );
  const bounds = new Box3().setFromObject(rig.root);
  return { rig, height: bounds.max.y - bounds.min.y, bottom: bounds.min.y };
}

function poseRig(rig: OrbitRig, state: StageState, now: number, seconds: number): void {
  const gesture = state.gesture;
  const duration =
    gesture?.kind === 'spin' ? spinDuration(gesture) : gesture ? gestureDuration[gesture.kind] : 1;
  const progress = gesture && Math.max(0, (now - gesture.at) / duration);
  const active = gesture !== null && progress !== null && progress < 1;
  const pose = active && state.reduced ? 0.45 : (progress ?? 0);
  const spin = active && gesture.kind === 'spin' ? spinMotion(gesture, now) : undefined;
  rig.root.rotation.y = state.yaw + (state.reduced ? 0 : (spin?.angle ?? 0));
  const expression = {
    gazeX: state.gazeX,
    gazeY: state.gazeY,
    ...(active
      ? {
          gesture: gesture.kind,
          progress: pose,
          spinDrive: state.reduced ? 0.6 : spin?.drive,
          spinWindup: state.reduced ? 0 : spin?.windup,
        }
      : {}),
  };
  // A still pose has no subsequent frames for the Studio animator to ease toward it.
  if (state.reduced) {
    seconds = 1.9 + (active ? (pose * duration) / 1000 : 0);
    rig.update(seconds - 1, expression);
  }
  rig.update(seconds, expression);
}

function lighting(scene: Scene): void {
  scene.add(new HemisphereLight(0xfff1e8, 0xb2a6cc, 1.3));
  for (const [color, strength, x, y, z] of [
    [0xffeee2, 2.55, -3.5, 6, 4.8],
    [0xdcdcff, 0.95, 4, 1.6, 3.6],
    [0xc7a5ff, 2.65, 2.2, 3.9, -4],
  ] as const) {
    const light = new DirectionalLight(color, strength);
    light.position.set(x, y, z);
    scene.add(light);
  }
}

function makeWebGL(surface: Surface): WebGLRenderer | null {
  try {
    const attributes: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    };
    const context = surface.getContext('webgl2', attributes);
    if (!context) return null;
    // Some browsers accept the performance hint even when all shaders execute on the CPU.
    // The rig's orthographic rasterizer avoids the driver/readback overhead in that case.
    const info = context.getExtension('WEBGL_debug_renderer_info');
    const device: unknown = info && context.getParameter(info.UNMASKED_RENDERER_WEBGL);
    if (
      typeof device === 'string' &&
      /swiftshader|llvmpipe|lavapipe|software rasterizer/i.test(device)
    ) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    const renderer = new WebGLRenderer({
      context,
      canvas: surface,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.setClearColor(0, 0);
    return renderer;
  } catch {
    return null;
  }
}

interface SoftwareFrame {
  raster: Rasterizer;
  surface: Surface;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  idle?: IdleFrames;
  yaw?: number;
}

export class Painter {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
  // Switching between differently sized canvases preserves each rig's projected vertex cache.
  private readonly rasters = new WeakMap<OrbitRig, SoftwareFrame>();
  private readonly surface: Surface;
  private readonly renderer;
  readonly mode;

  constructor(private readonly makeSurface: () => Surface) {
    this.surface = this.makeSurface();
    this.renderer = makeWebGL(this.surface);
    this.mode = this.renderer ? 'webgl' : 'software';
    lighting(this.scene);
  }

  paint(
    model: ReturnType<typeof buildRig>,
    state: StageState,
    now: number,
    seconds: number,
    idleInterval: number,
  ): Surface {
    const scale = Math.min(1, (this.renderer ? 960 : 320) / Math.max(state.width, state.height));
    const w = Math.max(1, Math.round(state.width * scale));
    const h = Math.max(1, Math.round(state.height * scale));
    const aspect = w / h;
    const span = Math.max(model.height * 1.13, 2.6 / aspect);
    // Anchor feet to the CSS plinth, even in narrow cards and for petite builds.
    const focus = model.bottom + span * 0.45;
    this.camera.left = -span * aspect * 0.5;
    this.camera.right = -this.camera.left;
    this.camera.top = span * 0.5;
    this.camera.bottom = -this.camera.top;
    this.camera.position.set(0, focus + 1.03, 9.3);
    this.camera.lookAt(0, focus, 0);
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      poseRig(model.rig, state, now, seconds);
      if (this.surface.width !== w || this.surface.height !== h) this.renderer.setSize(w, h, false);
      this.scene.add(model.rig.root);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(model.rig.root);
      return this.surface;
    }
    let frame = this.rasters.get(model.rig);
    if (!frame) {
      const surface = this.makeSurface();
      const context = surface.getContext('2d');
      if (!context) throw new Error('Orbit renderer could not create a 2D canvas.');
      frame = { surface, context, raster: new Rasterizer() };
      this.rasters.set(model.rig, frame);
    }
    if (frame.surface.width !== w || frame.surface.height !== h) {
      frame.surface.width = w;
      frame.surface.height = h;
    }
    const { raster } = frame;
    raster.setSize(w, h);
    const render = (time: number, context: SoftwareFrame['context']): void => {
      poseRig(model.rig, state, now, time);
      const rgba = raster.render(model.rig.root, this.camera);
      context.putImageData(new ImageData(rgba, w, h), 0, 0);
    };
    if (frame.yaw !== state.yaw) {
      frame.idle?.reset();
      frame.yaw = state.yaw;
    }
    if (state.reduced || state.gesture) {
      frame.idle?.reset();
      render(seconds, frame.context);
    } else {
      frame.idle ??= new IdleFrames(this.makeSurface);
      frame.idle.draw(frame.context, seconds, idleInterval, render);
    }
    return frame.surface;
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }
}
