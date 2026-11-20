import * as THREE from 'three';

const PI = Math.PI;
const TAU = PI * 2;
const INK = '#272533';
const CREAM = '#ffedcb';
const ORANGE = '#ed812e';
const sphereGeometry = new THREE.SphereGeometry(1, 22, 15);
const detailGeometry = new THREE.SphereGeometry(1, 12, 8);
const commonGeometry = new Set([sphereGeometry, detailGeometry]);
const sourceMaterial = new THREE.MeshBasicMaterial();
const vector = (v) => new THREE.Vector3(...v);

function tint(c, toward, amt) {
  const col = new THREE.Color(c);
  return '#' + col.lerp(new THREE.Color(toward), amt).getHexString();
}
function dark(c, amount = .25) { return tint(c, '#181320', amount); }
function pale(c, amount = .2) { return tint(c, '#fff3d8', amount); }

function group(parent, x = 0, y = 0, z = 0, joint = false) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.joint = joint;
  if (parent) parent.add(g);
  return g;
}

function mesh(parent, geom, col, surface = 'soft') {
  const m = new THREE.Mesh(geom, sourceMaterial);
  m.userData.paint = new THREE.Color(col);
  m.userData.surface = surface;
  parent.add(m);
  return m;
}

function oval(parent, col, pos, radii, rotation = null, surface = 'soft', small = false) {
  const m = mesh(parent, small ? detailGeometry : sphereGeometry, col, surface);
  m.position.fromArray(pos);
  m.scale.fromArray(radii);
  if (rotation) m.rotation.set(...rotation);
  return m;
}

function geometryGrid(n, rows, point, wrap = true) {
  const stride=n+1, count=(rows+1)*stride;
  const vertices=new Float32Array(count*3);
  const indices=new Uint16Array(n*rows*6);
  for (let j=0; j<=rows; j++) {
    for (let i=0; i<=n; i++) vertices.set(point(i/n,j/rows,j),(j*stride+i)*3);
  }
  let k=0;
  for (let j=0; j<rows; j++) {
    for (let i=0; i<n; i++) {
      const a=j*stride+i, b=a+1, c=b+stride, d=a+stride;
      indices[k++]=a; indices[k++]=b; indices[k++]=c;
      indices[k++]=a; indices[k++]=c; indices[k++]=d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(indices,1));
  g.setAttribute('position', new THREE.BufferAttribute(vertices,3));
  g.computeVertexNormals();
  if (wrap) {
    const normals = g.getAttribute('normal');
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let j = 0; j <= rows; j++) {
      const a = j * stride, b = a + n;
      v.fromBufferAttribute(normals, a).add(w.fromBufferAttribute(normals, b)).normalize();
      normals.setXYZ(a, v.x, v.y, v.z);
      normals.setXYZ(b, v.x, v.y, v.z);
    }
  }
  return g;
}
function signedPow(v, power) { return Math.sign(v) * Math.pow(Math.abs(v), power); }

// Elliptical sections are ordered from the bottom to the top. A variable front
// opening gives jackets a genuine raised placket and an open neckline.
function profile(parent, rows, col, { segments = 28, power = 1, gap = null, surface = 'soft' } = {}) {
  const g = geometryGrid(segments, rows.length - 1, (u, v, j) => {
    const opening = gap ? gap[j] : 0;
    const a = opening + u * (TAU - 2 * opening);
    const [y, rx, rz, cz = 0, cx = 0] = rows[j];
    return [cx + rx * signedPow(Math.sin(a), power), y, cz + rz * signedPow(Math.cos(a), power)];
  }, !gap);
  return mesh(parent, g, col, surface);
}

function splineValue(values, t) {
  if (values.length === 1) return values[0];
  const k = Math.min(t * (values.length - 1), values.length - 1);
  const i = Math.min(Math.floor(k), values.length - 2), f = k - i;
  const a = values[Math.max(0, i - 1)], b = values[i], c = values[i + 1];
  const d = values[Math.min(values.length - 1, i + 2)];
  return Math.max(.0001, .5 * ((2 * b) + (-a + c) * f + (2*a - 5*b + 4*c - d)*f*f + (-a + 3*b - 3*c + d)*f*f*f));
}

// Flowing, tapered elliptical sections make hair locks, knit piping, laces,
// and facial features. The optional radial center keeps a lock lying on a head.
function strand(parent, points, widths, depths, col, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(vector), false, 'catmullrom', .43);
  const n = opts.sides || 8, rows = opts.steps || Math.max(8, points.length * 3);
  const center = opts.center && vector(opts.center);
  const normal = vector(opts.out || [0, 0, 1]);
  const frames = [];
  let lastSide = null;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, p = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
    const out = center ? p.clone().sub(center).normalize() : normal.clone();
    let side = out.cross(tangent);
    if (side.lengthSq() < .003) side = (lastSide || new THREE.Vector3(1, 0, 0)).clone().addScaledVector(tangent, -(lastSide || new THREE.Vector3(1, 0, 0)).dot(tangent));
    side.normalize();
    const front = new THREE.Vector3().crossVectors(tangent, side).normalize();
    frames.push([p, side, front, splineValue(widths, t), splineValue(depths, t)]);
    lastSide = side;
  }
  const geom = geometryGrid(n, rows, (u, v, j) => {
    const [p, side, front, w, d] = frames[j];
    const a = u * TAU, s = Math.cos(a)*w, f = Math.sin(a)*d;
    return [p.x + side.x*s + front.x*f, p.y + side.y*s + front.y*f, p.z + side.z*s + front.z*f];
  });
  return mesh(parent, geom, col, opts.surface || 'soft');
}
function cord(parent, points, radius, col, opts = {}) {
  const r = Array.isArray(radius) ? radius : [radius];
  return strand(parent, points, r, r, col, opts);
}

function patch(parent, col, pos, size, radius = .025, rotation = null, surface = 'soft') {
  const [w, h, d] = size, l = -w/2, r = w/2, b = -h/2, t = h/2;
  const a = Math.min(radius, w*.48, h*.48);
  const shape = new THREE.Shape();
  shape.moveTo(l+a,b); shape.lineTo(r-a,b); shape.quadraticCurveTo(r,b,r,b+a);
  shape.lineTo(r,t-a); shape.quadraticCurveTo(r,t,r-a,t); shape.lineTo(l+a,t);
  shape.quadraticCurveTo(l,t,l,t-a); shape.lineTo(l,b+a); shape.quadraticCurveTo(l,b,l+a,b);
  const bevel = Math.min(d*.35, a*.32);
  const geom = new THREE.ExtrudeGeometry(shape, { depth:d, bevelEnabled:bevel>.0001, bevelThickness:bevel, bevelSize:bevel, bevelSegments:2, curveSegments:4 });
  geom.translate(0,0,-d/2);
  const m = mesh(parent, geom, col, surface);
  m.position.fromArray(pos);
  if (rotation) m.rotation.set(...rotation);
  return m;
}

function ellipseLine(parent, x, y, z, rx, ry, angle, color, radius, facing = 1) {
  const points = [];
  for (let i = 0; i <= 16; i++) {
    const a = TAU*i/16, dx = rx*Math.cos(a), dy = ry*Math.sin(a);
    points.push([x + dx*Math.cos(angle)-dy*Math.sin(angle), y + dx*Math.sin(angle)+dy*Math.cos(angle), z]);
  }
  cord(parent, points, radius, color, { steps:30, sides:6, out:[0,0,facing] });
}

function emblem(parent, pos, scale = 1, rotationY = 0) {
  const logo = group(parent, ...pos);
  logo.scale.setScalar(scale);
  logo.rotation.y = rotationY;
  oval(logo, '#f8e9bf', [0,0,0], [.077,.077,.011], null, 'soft', true);
  oval(logo, '#41414f', [0,0,.010], [.065,.065,.009], null, 'soft', true);
  oval(logo, '#f7c980', [-.001,0,.020], [.027,.028,.007], null, 'soft', true);
  ellipseLine(logo,0,0,.027,.050,.017,.39,'#ffdab1',.004);
  oval(logo,'#f7f0d3',[.030,.033,.025],[.006,.006,.003],null,'soft',true);
}

function combine(parent) {
  const pooledMaterials = new Map();
  const getMaterial = key => {
    if (!pooledMaterials.has(key)) {
      pooledMaterials.set(key, new THREE.MeshStandardMaterial({
        vertexColors:true, color:0xffffff,
        roughness: key === 'gloss' ? .23 : key === 'metal' ? .36 : .68,
        metalness: key === 'metal' ? .44 : key === 'gloss' ? .035 : 0
      }));
    }
    return pooledMaterials.get(key);
  };
  parent.updateMatrixWorld(true);
  function flatten(anchor) {
    const sources = [], joints = [], remove = [];
    const scan = (node, removable) => {
      if (node.userData.joint) { joints.push(node); return; }
      if (removable) remove.push(node);
      if (node.isMesh) sources.push(node);
      else node.children.forEach(child => scan(child, false));
    };
    anchor.children.slice().forEach(child => scan(child,true));
    joints.forEach(flatten);
    const buckets = new Map(), inverse = anchor.matrixWorld.clone().invert();
    for (const source of sources) {
      const key=source.userData.surface;
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(source);
    }
    remove.forEach(child => anchor.remove(child));
    for (const [key,parts] of buckets) {
      let vertexCount=0, indexCount=0;
      for (const part of parts) {
        const g=part.geometry, count=g.attributes.position.count;
        vertexCount+=count;
        indexCount+=g.index ? g.index.count : count;
      }
      const positions=new Float32Array(vertexCount*3), normals=new Float32Array(vertexCount*3);
      const colors=new Float32Array(vertexCount*3);
      const indices=vertexCount>65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
      let vertexOffset=0, indexOffset=0;
      const transform=new THREE.Matrix4(), normalTransform=new THREE.Matrix3();
      const vertex=new THREE.Vector3(), norm=new THREE.Vector3();
      for (const source of parts) {
        const geometry=source.geometry, {position,normal}=geometry.attributes;
        const col=source.userData.paint, paint=geometry.attributes.color;
        transform.multiplyMatrices(inverse,source.matrixWorld);
        normalTransform.getNormalMatrix(transform);
        for (let i=0;i<position.count;i++) {
          const k=(vertexOffset+i)*3;
          vertex.fromBufferAttribute(position,i).applyMatrix4(transform).toArray(positions,k);
          norm.fromBufferAttribute(normal,i).applyNormalMatrix(normalTransform).toArray(normals,k);
          colors[k]=paint ? paint.getX(i) : col.r;
          colors[k+1]=paint ? paint.getY(i) : col.g;
          colors[k+2]=paint ? paint.getZ(i) : col.b;
        }
        const index=geometry.index, n=index?index.count:position.count;
        for (let i=0;i<n;i++) indices[indexOffset++]=vertexOffset+(index?index.array[i]:i);
        vertexOffset+=position.count;
        if (!commonGeometry.has(geometry)) geometry.dispose();
      }
      const geom=new THREE.BufferGeometry();
      geom.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geom.setAttribute('normal',new THREE.BufferAttribute(normals,3));
      geom.setAttribute('color',new THREE.BufferAttribute(colors,3));
      geom.setIndex(new THREE.BufferAttribute(indices,1));
      geom.computeBoundingSphere();
      const part = new THREE.Mesh(geom, getMaterial(key));
      part.castShadow = true;
      part.receiveShadow = false;
      anchor.add(part);
    }
  }
  flatten(parent);
  return parent;
}

function disposeObject(root) {
  const mats = new Set();
  root.traverse(obj => {
    if (obj.isMesh) { obj.geometry.dispose(); mats.add(obj.material); }
  });
  mats.forEach(m => m.dispose());
}

const FACE = [
  [-.018,.025,.026,.09],[.005,.184,.157,.088],[.043,.312,.266,.083],
  [.099,.425,.363,.067],[.177,.527,.432,.052],[.291,.609,.497,.032],
  [.43,.657,.538,.013],[.58,.676,.559,.001],[.76,.674,.56,-.008],
  [.916,.648,.552,-.014],[1.055,.588,.506,-.021],[1.164,.482,.430,-.025],
  [1.241,.319,.294,-.028],[1.284,.147,.136,-.029],[1.294,.006,.006,-.029]
];
const FACE_POW = .88;
function faceSection(y) {
  if(y<=FACE[0][0]) return FACE[0];
  if(y>=FACE[FACE.length-1][0]) return FACE[FACE.length-1];
  let i=1;
  while(i<FACE.length-1 && FACE[i][0]<y) i++;
  const a=FACE[i-1], b=FACE[i], prev=FACE[Math.max(0,i-2)], next=FACE[Math.min(FACE.length-1,i+1)];
  const h=b[0]-a[0], t=(y-a[0])/h, t2=t*t, t3=t2*t;
  const result=[y];
  for(let k=1;k<4;k++) {
    const da=(b[k]-prev[k])/(b[0]-prev[0]), db=(next[k]-a[k])/(next[0]-a[0]);
    result.push((2*t3-3*t2+1)*a[k]+(t3-2*t2+t)*h*da+(-2*t3+3*t2)*b[k]+(t3-t2)*h*db);
  }
  return result;
}
function faceZ(x,y) {
  const [,rx,rz,offset]=faceSection(y), p=2/FACE_POW;
  return offset+rz*Math.pow(Math.max(.001,1-Math.pow(Math.abs(x)/rx,p)),1/p);
}
function faceStroke(parent, points, widths, depths, col, extra=.012) {
  return strand(parent, points.map(([x,y])=>[x,y,faceZ(x,y)+extra]),widths,depths,col,{steps:17,sides:8});
}


export {
  THREE, PI, TAU, INK, CREAM, ORANGE, commonGeometry, group, mesh, oval, profile, patch, strand, cord, ellipseLine, emblem,
  geometryGrid, signedPow, splineValue, tint, dark, pale, vector, combine, disposeObject,
  FACE, FACE_POW, faceSection, faceZ, faceStroke
};
