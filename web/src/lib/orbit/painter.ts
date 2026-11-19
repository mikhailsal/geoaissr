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

function poseRig(rig: OrbitRig, state: StageState, now: number): void {
  const gesture = state.gesture;
  const progress = gesture && Math.max(0, (now - gesture.at) / gestureDuration[gesture.kind]);
  const active = gesture !== null && progress !== null && progress < 1;
  const pose = active && state.reduced ? 0.45 : (progress ?? 0);
  const turning = active && gesture.kind === 'spin' && !state.reduced;
  rig.root.rotation.y = -0.23 + (turning ? Math.PI * 2 * pose * pose * (3 - 2 * pose) : 0);
  const seconds = active ? (pose * gestureDuration[gesture.kind]) / 1000 + 1.9 : 1.9;
  const expression = active ? { gesture: gesture.kind, progress: pose } : {};
  // A still pose has no subsequent frames for the Studio animator to ease toward it.
  if (state.reduced) rig.update(seconds - 1, expression);
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

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export class Painter {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
  private readonly raster = new Rasterizer();
  private readonly surface: Surface;
  private readonly renderer;
  private readonly ctx: Context2D | null;
  readonly mode;

  constructor(makeSurface: () => Surface) {
    this.surface = makeSurface();
    this.renderer = makeWebGL(this.surface);
    // A canvas that has claimed WebGL cannot subsequently acquire a 2D context.
    if (!this.renderer) this.surface = makeSurface();
    this.ctx = this.renderer ? null : this.surface.getContext('2d');
    this.mode = this.renderer ? 'webgl' : 'software';
    lighting(this.scene);
  }

  paint(model: ReturnType<typeof buildRig>, state: StageState, now: number): Surface {
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
    poseRig(model.rig, state, now);
    if (this.renderer) {
      if (this.surface.width !== w || this.surface.height !== h) this.renderer.setSize(w, h, false);
      this.scene.add(model.rig.root);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(model.rig.root);
    } else if (this.ctx) {
      if (this.surface.width !== w || this.surface.height !== h) {
        this.surface.width = w;
        this.surface.height = h;
      }
      this.raster.setSize(w, h);
      const rgba = this.raster.render(model.rig.root, this.camera);
      this.ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    }
    return this.surface;
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }
}
