import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, SphereGeometry } from 'three';
import type { AvatarAppearance } from '$shared/avatar';

// These parts go through the same vertex-color batching and head-shape deformation as the face.
function shell(
  head: Group,
  color: string,
  x: number,
  y: number,
  z: number,
  scale: [number, number, number],
  tilt = 0,
) {
  const part = new Mesh(new SphereGeometry(1, 18, 12));
  part.userData.paint = new Color(color);
  part.userData.surface = 'metal';
  part.position.set(x, y, z);
  part.scale.set(...scale);
  part.rotation.z = tilt;
  head.add(part);
}

type FaceDepth = (x: number, y: number) => number;

// A curved enamel display sits just above the face mesh, behind the eyes and eyebrows.
function faceplate(head: Group, faceZ: FaceDepth, shade: string): void {
  const vertices: number[] = [];
  const triangles: number[] = [];
  const cols = 32;
  const rows = 10;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const t = (2 * col) / cols - 1;
      const x = t * 0.634;
      const radius = 0.182 * Math.pow(Math.max(0.001, 1 - Math.pow(Math.abs(t), 8)), 0.42);
      const y = 0.583 + ((2 * row) / rows - 1) * radius + 0.038 * t * t;
      vertices.push(x, y, faceZ(x, y) + 0.009);
      if (row < rows && col < cols) {
        const a = row * (cols + 1) + col;
        triangles.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  const part = new Mesh(geometry);
  part.userData.paint = new Color(shade);
  part.userData.surface = 'gloss';
  head.add(part);
}

export function addRobotDetails(head: Group, look: AvatarAppearance, faceZ: FaceDepth): void {
  const steel = new Color(look.skin).lerp(new Color('#a2b8cc'), 0.65);
  const panel = '#' + steel.getHexString();
  const gasket = '#' + steel.clone().multiplyScalar(0.17).getHexString();
  const light = '#' + new Color(look.eyeColor).lerp(new Color('#a8f7ff'), 0.6).getHexString();
  faceplate(head, faceZ, '#26394c');
  for (const side of [-1, 1]) {
    shell(head, gasket, side * 0.665, 0.49, 0.006, [0.118, 0.198, 0.16]);
    shell(head, panel, side * 0.722, 0.49, 0.006, [0.087, 0.151, 0.119]);
    shell(head, light, side * 0.791, 0.49, 0.008, [0.027, 0.077, 0.064]);
    // Luminous status strips follow the faceplate curvature, outside the animated eyes.
    for (const [x, y] of [
      [0.507, 0.587],
      [0.525, 0.55],
    ] as const) {
      shell(head, light, side * x, y, faceZ(side * x, y) + 0.019, [0.032, 0.012, 0.015]);
    }
    // Angled cheek armor stays below the eyes and clears hats and eyewear.
    shell(head, gasket, side * 0.459, 0.297, 0.391, [0.141, 0.104, 0.062], side * 0.37);
    shell(head, panel, side * 0.462, 0.307, 0.409, [0.134, 0.096, 0.058], side * 0.37);
    shell(head, light, side * 0.439, 0.311, 0.467, [0.071, 0.013, 0.012], side * 0.37);
  }
  shell(head, gasket, -0.57, 1.33, -0.02, [0.045, 0.31, 0.045], 0.31);
  shell(head, panel, -0.647, 1.585, -0.02, [0.089, 0.09, 0.091]);
  shell(head, light, -0.647, 1.6, 0.028, [0.064, 0.061, 0.064]);
}
