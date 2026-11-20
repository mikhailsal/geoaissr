import {THREE} from './model-kit.js';

export const builds = [
  {id:'classic',name:'Classic',body:[1,1,1],head:1},
  {id:'petite',name:'Petite',body:[.88,.87,.90],head:1.04},
  {id:'tall',name:'Tall',body:[.96,1.15,.98],head:.935},
  {id:'broad',name:'Broad',body:[1.20,1.03,1.13],head:.94},
  {id:'slender',name:'Slender',body:[.84,1.06,.88],head:1.025},
  {id:'compact',name:'Stocky',body:[1.15,.91,1.14],head:.965},
  {id:'chibi',name:'Chibi',body:[.96,.83,.96],head:1.17}
];
export const faceShapes = [
  {id:'classic',name:'Classic',scale:[1,1,1],jaw:0,cheek:0},
  {id:'round',name:'Round',scale:[1.07,.91,1.04],jaw:.06,cheek:.03},
  {id:'oval',name:'Oval',scale:[.90,1.09,1],jaw:0,cheek:.01},
  {id:'square',name:'Square',scale:[1.04,.96,1.04],jaw:.29,cheek:0},
  {id:'heart',name:'Heart',scale:[1.05,1.01,.97],jaw:-.23,cheek:-.01},
  {id:'diamond',name:'Diamond',scale:[.96,1.04,.99],jaw:-.14,cheek:.15},
  {id:'long',name:'Oblong',scale:[.90,1.15,.97],jaw:.16,cheek:-.04}
];

// Deform the assembled head so that the eyes, jaw hair and eyewear follow its
// contour. Meshes own their buffers after batching. Joint pivots remain animated.
export function shapeHead(head,id) {
  const shape=faceShapes.find(s=>s.id===id)||faceShapes[0];
  if(shape.id==='classic')return;
  if(shape.jaw || shape.cheek) {
    head.updateWorldMatrix(true,true);
    const inverse=head.matrixWorld.clone().invert(), toHead=new THREE.Matrix4(), toPiece=new THREE.Matrix4(), p=new THREE.Vector3();
    head.traverse(node=>{
      if(!node.isMesh)return;
      const g=node.geometry,coords=g.attributes.position;
      toHead.multiplyMatrices(inverse,node.matrixWorld);toPiece.copy(toHead).invert();
      for(let i=0;i<coords.count;i++) {
        p.fromBufferAttribute(coords,i).applyMatrix4(toHead);
        const jaw=Math.exp(-((p.y-.16)**2)/.060), cheek=Math.exp(-((p.y-.47)**2)/.045);
        p.x*=1+shape.jaw*jaw+shape.cheek*cheek;
        p.applyMatrix4(toPiece);coords.setXYZ(i,p.x,p.y,p.z);
      }
      g.computeVertexNormals();g.computeBoundingSphere();g.boundingBox=null;
    });
  }
  head.scale.multiply(new THREE.Vector3(...shape.scale));
}
export function shapeBody(movement,head,id) {
  const b=builds.find(s=>s.id===id)||builds[0];
  movement.scale.set(...b.body);head.scale.multiplyScalar(b.head);
}
