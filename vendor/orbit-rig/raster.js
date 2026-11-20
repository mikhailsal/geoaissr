import * as THREE from 'three';

// A small orthographic software renderer keeps the same rig interactive on
// machines where WebGL is disabled. The wardrobe thumbnails use this path too.
const sRGB = Uint8ClampedArray.from({length:4096}, (_, i) => {
  const linear = i / 2048;
  const toned = linear > .83 ? .83 + .17 * (1 - Math.exp(-(linear - .83) / .17)) : linear;
  return 255 * (toned <= .0031308 ? 12.92 * toned : 1.055 * Math.pow(toned, 1 / 2.4) - .055);
});
const softHighlight=Float32Array.from({length:1025},(_,i)=>(i/1024)**24*.030);
const glossHighlight=Float32Array.from({length:1025},(_,i)=>(i/1024)**44*.16);
const clampColor = x => sRGB[Math.min(4095,Math.max(0,x*2048|0))];

export class Rasterizer {
  constructor() {
    this.cache = new WeakMap();
    this.projectionView = new THREE.Matrix4();
    this.transform = new THREE.Matrix4();
    this.normal = new THREE.Matrix3();
  }
  setSize(w,h) {
    const width=Math.max(1,Math.round(w)), height=Math.max(1,Math.round(h));
    if(width===this.width && height===this.height) return;
    this.width=width; this.height=height;
    this.pixels=new Uint8ClampedArray(width*height*4);
    this.depth=new Float32Array(width*height);
    this.cache=new WeakMap();
  }
  render(root,camera,backdrop=null) {
    if(backdrop) {
      this.pixels.set(backdrop.pixels);this.depth.set(backdrop.depth);
    }else {
      this.pixels.fill(0);this.depth.fill(Infinity);
    }
    root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    this.projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    root.traverseVisible(node => {
      if(!node.isMesh || !node.material.visible)return;
      if(node.userData.radial)this.radial(node);else this.draw(node);
    });
    return this.pixels;
  }
  radial(mesh) {
    const {width,depth,opacity,color}=mesh.userData.radial;
    const e=this.transform.multiplyMatrices(this.projectionView,mesh.matrixWorld).elements;
    const w=this.width,h=this.height,cx=(e[12]+1)*w*.5,cy=(1-e[13])*h*.5;
    const rx=Math.abs(e[0]*width*w*.25),ry=Math.abs(e[5]*depth*h*.25);
    if(rx<1||ry<1)return;
    const xmin=Math.max(0,Math.floor(cx-rx)),xmax=Math.min(w-1,Math.ceil(cx+rx));
    const ymin=Math.max(0,Math.floor(cy-ry)),ymax=Math.min(h-1,Math.ceil(cy+ry));
    for(let y=ymin;y<=ymax;y++) {
      const dy=(y+.5-cy)/ry;
      const z=e[14]+dy*Math.sign(-e[5])*depth*.5*e[6];
      for(let x=xmin;x<=xmax;x++){
        const i=y*w+x,dx=(x+.5-cx)/rx,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>=1||z>this.depth[i]+.00002)continue;
        const k=i*4,a=opacity*(1-dist),bg=this.pixels[k+3]/255,alpha=a+bg*(1-a);
        const prev=bg*(1-a)/alpha,mix=a/alpha;
        this.pixels[k]=this.pixels[k]*prev+color[0]*mix;
        this.pixels[k+1]=this.pixels[k+1]*prev+color[1]*mix;
        this.pixels[k+2]=this.pixels[k+2]*prev+color[2]*mix;
        this.pixels[k+3]=255*alpha;
      }
    }
  }
  draw(mesh) {
    const {geometry,material}=mesh;
    const p=geometry.attributes.position, n=geometry.attributes.normal;
    const c=geometry.attributes.color;
    if(!p || !n || material.opacity<.05) return;
    const m=this.transform.multiplyMatrices(this.projectionView,mesh.matrixWorld);
    let cache=this.cache.get(mesh);
    if(!cache) {
      cache={matrix:new THREE.Matrix4().makeScale(0,0,0), vertices:new Float32Array(p.count*6)};
      this.cache.set(mesh,cache);
    }
    const vertices=cache.vertices, w=this.width, h=this.height;
    if(!cache.matrix.equals(m)) {
      cache.matrix.copy(m);
      const e=m.elements, normal=this.normal.getNormalMatrix(mesh.matrixWorld).elements;
      const pos=p.array, normals=n.array, colors=c?.array;
      const base=material.color, highlights=material.roughness<.45?glossHighlight:softHighlight;
      const basic=material.isMeshBasicMaterial;
      // Rigid joints preserve normal length. Non-uniformly scaled joints,
      // including blinking eyelids and alternate builds, need normalization.
      const world=mesh.matrixWorld.elements;
      const l0=world[0]**2+world[1]**2+world[2]**2;
      const l1=world[4]**2+world[5]**2+world[6]**2;
      const l2=world[8]**2+world[9]**2+world[10]**2;
      const orthogonal=Math.abs(world[0]*world[4]+world[1]*world[5]+world[2]*world[6])+
        Math.abs(world[0]*world[8]+world[1]*world[9]+world[2]*world[10])+
        Math.abs(world[4]*world[8]+world[5]*world[9]+world[6]*world[10]);
      const uniform=Math.abs(l0-l1)+Math.abs(l0-l2)+orthogonal<.000001*l0?Math.sqrt(l0):0;
      for(let i=0,at=0,src=0;i<p.count;i++,at+=6,src+=3) {
        const x=pos[src],y=pos[src+1],z=pos[src+2];
        vertices[at]=(e[0]*x+e[4]*y+e[8]*z+e[12]+1)*w*.5;
        vertices[at+1]=(1-e[1]*x-e[5]*y-e[9]*z-e[13])*h*.5;
        vertices[at+2]=e[2]*x+e[6]*y+e[10]*z+e[14];
        let r=base.r*(colors?colors[src]:1),g=base.g*(colors?colors[src+1]:1),b=base.b*(colors?colors[src+2]:1);
        if(!basic) {
          const a=normals[src], v=normals[src+1], d=normals[src+2];
          let nx=normal[0]*a+normal[3]*v+normal[6]*d, ny=normal[1]*a+normal[4]*v+normal[7]*d, nz=normal[2]*a+normal[5]*v+normal[8]*d;
          const il=uniform || 1/Math.sqrt(nx*nx+ny*ny+nz*nz || 1);
          nx*=il;ny*=il;nz*=il;
          const ambient=.42+ny*.13;
          const key=Math.max(0,-nx*.55+ny*.65+nz*.53)*.81;
          const rimDot=Math.max(0,nx*.41+ny*.33-nz*.84),rim=rimDot*rimDot*rimDot;
          const halfDot=Math.min(1,Math.max(0,-nx*.31+ny*.49+nz*.815));
          const shine=highlights[halfDot*1024|0];
          r=r*(ambient+key+rim*.28)+shine;
          g=g*(ambient*.96+key*.95+rim*.23)+shine*.94;
          b=b*(ambient*1.07+key*.90+rim*.69)+shine*1.04;
        }
        vertices[at+3]=clampColor(r);
        vertices[at+4]=clampColor(g);
        vertices[at+5]=clampColor(b);
      }
    }
    const index=geometry.index?.array, limit=index?index.length:p.count, rgba=this.pixels, depth=this.depth;
    for(let i=0;i<limit;i+=3) {
      const a=(index?index[i]:i)*6, b=(index?index[i+1]:i+1)*6, c=(index?index[i+2]:i+2)*6;
      const ax=vertices[a], ay=vertices[a+1], bx=vertices[b], by=vertices[b+1], cx=vertices[c], cy=vertices[c+1];
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
      if(Math.abs(den)<.017 || (den>=0 && material.side===THREE.FrontSide)) continue;
      const minX=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)),maxX=Math.min(w-1,Math.floor(Math.max(ax,bx,cx)-.5));
      const minY=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)),maxY=Math.min(h-1,Math.floor(Math.max(ay,by,cy)-.5));
      if(minX>maxX || minY>maxY) continue;
      const inv=1/den, dax=(by-cy)*inv, day=(cx-bx)*inv, dbx=(cy-ay)*inv, dby=(ax-cx)*inv;
      const zc=vertices[c+2], za=vertices[a+2]-zc, zb=vertices[b+2]-zc;
      let waRow=dax*(minX+.5-cx)+day*(minY+.5-cy);
      let wbRow=dbx*(minX+.5-cx)+dby*(minY+.5-cy);
      for(let y=minY;y<=maxY;y++,waRow+=day,wbRow+=dby) {
        let wa=waRow,wb=wbRow,j=y*w+minX;
        for(let x=minX;x<=maxX;x++,j++,wa+=dax,wb+=dbx) {
          const wc=1-wa-wb;
          if(wa<-.00002||wb<-.00002||wc<-.00002) continue;
          const z=zc+za*wa+zb*wb;
          if(z>=depth[j]) continue;
          depth[j]=z;
          const k=j*4;
          rgba[k]=vertices[a+3]*wa+vertices[b+3]*wb+vertices[c+3]*wc;
          rgba[k+1]=vertices[a+4]*wa+vertices[b+4]*wb+vertices[c+4]*wc;
          rgba[k+2]=vertices[a+5]*wa+vertices[b+5]*wb+vertices[c+5]*wc;
          rgba[k+3]=255;
        }
      }
    }
  }
}

export function fitCamera(object,aspect,{fill=.88,yaw=0,pitch=.08}={}) {
  object.updateMatrixWorld(true);
  const bound=new THREE.Box3().setFromObject(object);
  const center=bound.getCenter(new THREE.Vector3());
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,60);
  camera.position.copy(center).add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch)*9,Math.sin(pitch)*9,Math.cos(yaw)*Math.cos(pitch)*9));
  camera.lookAt(center);camera.updateMatrixWorld(true);
  const view=new THREE.Box3(), worldToView=new THREE.Matrix4(), pt=new THREE.Vector3();
  object.traverseVisible(child=>{
    if(!child.isMesh) return;
    worldToView.multiplyMatrices(camera.matrixWorldInverse,child.matrixWorld);
    const attr=child.geometry.attributes.position;
    for(let v=0;v<attr.count;v++) view.expandByPoint(pt.fromBufferAttribute(attr,v).applyMatrix4(worldToView));
  });
  if(view.isEmpty()) return camera;
  const size=view.getSize(pt);
  const height=Math.max(size.y,size.x/aspect)/fill;
  const mid=view.getCenter(new THREE.Vector3());
  camera.left=mid.x-height*aspect/2;camera.right=mid.x+height*aspect/2;
  camera.top=mid.y+height/2;camera.bottom=mid.y-height/2;camera.updateProjectionMatrix();
  return camera;
}
