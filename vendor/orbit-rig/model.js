import {
  THREE, PI, TAU, INK, CREAM, ORANGE, commonGeometry, group, mesh, oval, profile, patch, strand, cord, ellipseLine, emblem,
  geometryGrid, signedPow, splineValue, tint, dark, pale, vector, combine, disposeObject,
  FACE, FACE_POW, faceSection, faceZ, faceStroke
} from './model-kit.js';

import {defaultLook,slots,validLook,pigment} from './catalog.js';
import {drawTop,drawSleeves} from './wardrobe-styles.js';
import {drawHairStyle,applyHairDye} from './hair-styles.js';
import {drawEye,drawBrow,drawNose,drawFreckles,drawMark} from './face-styles.js';
import {drawMustache,drawBeard} from './facial-hair.js';
import {drawWaist,drawLeg,drawShoe} from './lower-styles.js';
import {drawHeadwear,drawEyewear,drawEarrings,drawNeckwear} from './accessory-styles.js';
import {shapeBody,shapeHead} from './proportions.js';

const originalTops=new Set(['bomber','hoodie','vest','tech']);
const originalHair=new Set(['swoop','curls','bob','buns']);

function face(head,cfg) {
  // The blush is painted onto the vinyl surface, so it follows the face in
  // profile and never catches a separate rim or highlights from the stage.
  const sections=[];
  for(let i=1;i<FACE.length;i++) {
    const a=FACE[i-1], b=FACE[i], steps=Math.max(1,Math.ceil((b[0]-a[0])/.041));
    for(let j=0;j<steps;j++) sections.push(faceSection(a[0]+(b[0]-a[0])*j/steps));
  }
  sections.push(FACE[FACE.length-1]);
  const faceMesh=profile(head,sections,cfg.skin,{segments:72,power:FACE_POW});
  const positions=faceMesh.geometry.attributes.position;
  const paints=new Float32Array(positions.count*3);
  const base=new THREE.Color(cfg.skin), warmRGB=base.clone().convertLinearToSRGB();
  const blush=new THREE.Color().setRGB(Math.min(1,warmRGB.r*1.045),warmRGB.g*.84,warmRGB.b*.89,THREE.SRGBColorSpace);
  const color=new THREE.Color();
  for(let i=0;i<positions.count;i++) {
    const dx=(Math.abs(positions.getX(i))-.424)/.118;
    const dy=(positions.getY(i)-.386)/.075;
    const weight=Math.exp(-.70*(dx*dx+dy*dy))*.66*Math.max(0,Math.min(1,positions.getZ(i)*4));
    color.copy(base).lerp(blush,weight).toArray(paints,i*3);
  }
  faceMesh.geometry.setAttribute('color',new THREE.BufferAttribute(paints,3));
  const warm = tint(cfg.skin, '#bd6855', .31);
  for (const s of [-1,1]) {
    oval(head,cfg.skin,[s*.642,.48,.005],[.123,.162,.097],[.025,0,s*-.17]);
    oval(head,warm,[s*.678,.486,.068],[.061,.094,.029],[.03,s*.3,s*-.14], 'soft',true);
  }
  const eyes = [], brows = [];
  for (const s of [-1,1]) {
    const ex = s*.257, ey=.573;
    const eye = group(head, ex, ey, faceZ(ex,ey)+.006, true);
    eye.rotation.y=s*.29;
    eye.rotation.z=-s*.025;
    drawEye(eye,s,cfg.eyeStyle,cfg.eyeColor);
    eyes.push({s,eye,x:ex,y:ey,z:eye.position.z});
    const brow=group(head,0,0,0,true);
    drawBrow(brow,s,cfg.brow,pigment(cfg,'browColor'));brows.push(brow);
  }
  drawFreckles(head,cfg.freckles,cfg.skin);
  drawMark(head,cfg.mark,cfg.skin);
  drawNose(head,cfg.nose,cfg.skin);
  const lip=dark(tint(cfg.skin,'#9a4d47',.74),.24);
  const smile=group(head,0,0,0,true);
  faceStroke(smile,[[-.154,.279],[-.109,.251],[-.041,.232],[.024,.231],[.094,.246],[.158,.287]], [.003,.010,.0125,.013,.010,.0025],[.003,.008,.010,.010,.007,.002],lip,.016);
  const mouth=group(head,0,.252,faceZ(0,.252)+.028,true);
  oval(mouth,'#773d3d',[0,0,0],[.111,.049,.015],[0,0,.045],'soft',true);
  oval(mouth,'#d88880',[.007,-.023,.009],[.065,.017,.011],[0,0,.045],'soft',true);
  oval(mouth,'#fff0d7',[0,.024,.007],[.072,.013,.008],[0,0,.045],'soft',true);
  return {eyes,brows,smile,mouth};
}

function hairCap(parent,col,style) {
  const geom = geometryGrid(52,18,(u,v)=>{
    const a=u*TAU, front=Math.cos(a), side=Math.sin(a);
    const temple=style==='swoop'?.45:.28;
    const bound=style==='bob' ? 2.16-1.19*Math.pow(Math.max(0,front),3)
      : 1.78-.55*front-temple*Math.pow(Math.max(0,front),2)+.030*Math.cos(3*a);
    const theta = (1-v)*bound+.003;
    const st=Math.sin(theta), y=.614+.735*Math.cos(theta);
    const [,skinX,skinZ,offset]=faceSection(y);
    const rx=Math.max(.699*st,(skinX+.029)*Math.min(1,st*8));
    const rz=Math.max(.599*st,(skinZ+.027)*Math.min(1,st*8));
    return [rx*signedPow(side,FACE_POW),y,offset+rz*signedPow(front,FACE_POW)];
  });
  mesh(parent,geom,col);
}

const HEAD_CENTER=[0,.65,-.026];
function lock(parent,points,w,d,col,ridge=false,center=HEAD_CENTER) {
  strand(parent,points,w,d,col,{center,sides:12,steps:20});
  if (!ridge) return;
  const r=[];
  for (let i=1;i<points.length;i++) {
    const p=vector(points[i]), n=p.clone().sub(vector(center)).normalize();
    p.addScaledVector(n, splineValue(d, i/(points.length-1))*.89);
    r.push(p.toArray());
  }
  if(r.length>2) strand(parent,r,[.002,.009,.006,.001],[.001,.004,.003,.0005],pale(col,.036),{center,sides:6,steps:15});
}

function addSwoop(parent,c) {
  const main = [
    [[.20,1.15,-.23],[.11,1.35,-.08],[-.16,1.408,.135],[-.46,1.245,.307],[-.657,.933,.308],[-.660,.741,.199]],
    [[.245,1.22,-.18],[.154,1.405,.043],[-.092,1.412,.226],[-.351,1.235,.425],[-.53,.986,.445],[-.625,.798,.336]],
    [[.291,1.215,-.093],[.212,1.398,.098],[.042,1.383,.314],[-.226,1.197,.484],[-.405,1.022,.516],[-.502,.899,.443]],
    [[.344,1.199,-.018],[.301,1.356,.177],[.18,1.335,.368],[-.041,1.169,.526],[-.196,1.039,.565],[-.315,.964,.533]],
    [[.330,1.172,.059],[.375,1.256,.227],[.300,1.258,.402],[.165,1.152,.515],[.041,1.078,.558],[-.018,1.036,.550]]
  ];
  main.forEach((pts,i)=>lock(parent,pts,[.027,.151-i*.007,.161-i*.006,.139-i*.005,.087,.004],[.018,.069,.079,.070,.052,.003],i%2?pale(c,.014):c,true));
  const other = [
    [[.282,1.218,-.153],[.423,1.284,.014],[.530,1.178,.238],[.591,1.020,.334],[.595,.885,.373]],
    [[.290,1.241,-.069],[.430,1.248,.139],[.482,1.129,.347],[.471,1.015,.440],[.420,.922,.467]],
    [[.267,1.211,.007],[.361,1.214,.212],[.385,1.133,.395],[.343,1.045,.482],[.288,.993,.517]],
  ];
  other.forEach((pts,i)=>lock(parent,pts,[.041,.109,.122,.088,.003],[.018,.057,.064,.047,.002],i===1?pale(c,.012):c,i===0));
}

function backLocks(parent,c,style) {
  for(let i=0;i<11;i++) {
    const a=1.20+i*(TAU-2.4)/10, sn=Math.sin(a), cs=Math.cos(a);
    const long=style==='bob' ? .17 : .37;
    const end=long + (1+Math.cos(a))*.07+.037*Math.sin(i*2);
    const pts=[
      [.39*sn,.995+.19*Math.sin(a*.55),-.02+.34*cs],
      [.57*Math.sin(a+.04),1.020,-.026+.48*Math.cos(a+.04)],
      [.674*Math.sin(a+.05),.825,-.034+.58*Math.cos(a+.05)],
      [(.699+(style==='bob'?.022:0))*Math.sin(a+.065),.574,-.031+.589*Math.cos(a+.065)],
      [(style==='bob'?.697:.664)*Math.sin(a+.08),end+.075,-.033+(style==='bob'?.59:.54)*Math.cos(a+.08)],
      [(style==='bob'?.638:.612)*Math.sin(a+.1),end,-.018+.52*Math.cos(a+.1)]
    ];
    lock(parent,pts,[.025,.13,.161,.164,.098,.005],[.025,.046,.061,.055,.042,.003],i%3===0?pale(c,.012):c,style==='bob'&&i%3===0);
  }
}

function hair(parent,style,col) {
  hairCap(parent,col,style);
  if(style==='swoop') {
    backLocks(parent,col,style); addSwoop(parent,col);
    for(const s of [-1,1]) {
      lock(parent,[[s*.535,1.06,.196],[s*.61,.883,.245],[s*.639,.679,.229],[s*.625,.522,.210],[s*.605,.431,.189]],[.040,.103,.105,.068,.004],[.023,.053,.055,.039,.002],dark(col,.07));
    }
  } else if(style==='curls') {
    for(let i=0;i<15;i++) {
      const a=(i/15)*TAU, sn=Math.sin(a), cs=Math.cos(a), front=Math.max(0,cs);
      const y=.76+.33*front+.049*Math.sin(i*1.6);
      const pts=[];
      for(let j=0;j<=8;j++) {
        const t=j/8, ang=(-.45+t*1.63)*PI;
        const dx=Math.cos(ang)*(.133+.016*Math.sin(i)), dy=Math.sin(ang)*.146;
        const rad=.551+.071*t+.022*Math.sin(ang);
        pts.push([sn*((rad+.069)) + dx*cs, y+dy, cs*(rad-.032)-dx*sn-.015]);
      }
      lock(parent,pts,[.048,.079,.085,.076,.026],[.042,.070,.078,.067,.024],i%3===0?pale(col,.026):col,false);
    }
    for(let i=0;i<8;i++) {
      const a=i/8*TAU, pts=[];
      for(let j=0;j<=7;j++) {
        const q=(j/7)*PI*1.35;
        pts.push([.321*Math.sin(a)+.170*Math.cos(q)*Math.cos(a),1.215+.154*Math.sin(q),.277*Math.cos(a)-.12*Math.cos(q)*Math.sin(a)]);
      }
      lock(parent,pts,[.027,.097,.107,.071,.011],[.020,.066,.078,.052,.008],i%2?col:pale(col,.024));
    }
  } else if(style==='bob') {
    backLocks(parent,col,style);
    for(const s of [-1,1]) {
      lock(parent,[[s*.036,1.30,.101],[s*.21,1.276,.367],[s*.415,1.102,.49],[s*.563,.812,.405],[s*.633,.498,.324],[s*.614,.238,.312],[s*.548,.166,.330]],[.031,.131,.161,.153,.142,.102,.004],[.014,.060,.060,.053,.060,.054,.003],pale(col,.012),true);
      lock(parent,[[s*.068,1.281,.112],[s*.183,1.241,.400],[s*.278,1.081,.528],[s*.373,.929,.536],[s*.410,.849,.494]],[.035,.116,.132,.085,.006],[.015,.046,.055,.044,.004],col);
    }
  } else {
    for(const s of [-1,1]) {
      const ctr=[s*.522,1.183,-.084];
      oval(parent,col,ctr,[.303,.297,.266],[.16,0,s*.13]);
      for(let i=0;i<5;i++) {
        const a=.14+i*.55, pts=[];
        for(let j=0;j<=6;j++) {
          const t=j/6, b=-1.17+2.93*t;
          pts.push([ctr[0]+s*.283*Math.sin(b)*Math.cos(a),ctr[1]+.273*Math.cos(b),ctr[2]+.255*Math.sin(b)*Math.sin(a)]);
        }
        lock(parent,pts,[.012,.047,.053,.048,.008],[.010,.033,.042,.031,.006],i%2?col:pale(col,.022),false,ctr);
      }
      lock(parent,[[s*.075,1.259,.210],[s*.245,1.222,.399],[s*.402,1.068,.48],[s*.514,.916,.449],[s*.522,.779,.393]],[.031,.124,.137,.081,.005],[.019,.049,.061,.041,.003],col,true);
      lock(parent,[[s*.546,.862,.239],[s*.618,.721,.273],[s*.64,.518,.253],[s*.625,.404,.202]],[.052,.086,.067,.004],[.023,.041,.038,.002],col);
    }
  }
}

// Fit the crown in head space, including styles made from nested or mirrored pieces.
function tuckUnderHat(hairGroup,brim) {
  hairGroup.updateWorldMatrix(true,true);
  const pieces=[],toRoot=hairGroup.matrixWorld.clone().invert(),matrix=new THREE.Matrix4(),inverse=new THREE.Matrix4(),point=new THREE.Vector3();
  hairGroup.traverse(node=>{if(node.isMesh)pieces.push(node);});
  for(const piece of pieces) {
    const original=piece.geometry,pos=original.attributes.position,heights=new Float32Array(pos.count);
    matrix.multiplyMatrices(toRoot,piece.matrixWorld);
    let min=Infinity,max=-Infinity;
    for(let i=0;i<pos.count;i++){
      const y=point.fromBufferAttribute(pos,i).applyMatrix4(matrix).y;
      heights[i]=y;min=Math.min(min,y);max=Math.max(max,y);
    }
    if(max<=brim)continue;
    if(min>brim){piece.removeFromParent();if(!commonGeometry.has(original))original.dispose();continue;}
    const geom=commonGeometry.has(original)?original.clone():original,coords=geom.attributes.position,indices=geom.index?.array;
    const count=indices?indices.length:coords.count,kept=[];inverse.copy(matrix).invert();
    for(let i=0;i<count;i+=3) {
      const a=indices?indices[i]:i,b=indices?indices[i+1]:i+1,c=indices?indices[i+2]:i+2;
      if(Math.min(heights[a],heights[b],heights[c])<=brim)kept.push(a,b,c);
    }
    for(let i=0;i<coords.count;i++) {
      if(heights[i]<=brim)continue;
      point.fromBufferAttribute(coords,i).applyMatrix4(matrix);point.y=brim;
      const e=Math.hypot(point.x/.697,(point.z+.024)/.569);
      if(e>1){point.x/=e;point.z=(point.z+.024)/e-.024;}
      point.applyMatrix4(inverse);coords.setXYZ(i,point.x,point.y,point.z);
    }
    geom.setIndex(kept);piece.geometry=geom;
  }
}
function fitHair(parent,cfg,brim=null) {
  const g=group(parent);
  if(originalHair.has(cfg.hair))hair(g,cfg.hair,cfg.hairColor);
  else drawHairStyle(g,cfg.hair,cfg.hairColor);
  if(cfg.dye!=='solid')applyHairDye(g,cfg.dye,cfg.dyeColor);
  if(Number.isFinite(brim))tuckUnderHat(g,brim);
}
function legacyTint(original,base,chosen) {
  if(!chosen||chosen===base)return original;
  const sample=new THREE.Color(original).getHSL({}),ref=new THREE.Color(base).getHSL({});
  const c=new THREE.Color(chosen);c.offsetHSL(0,(sample.s-ref.s)*.26,(sample.l-ref.l)*.85);
  return '#'+c.getHexString();
}

function headset(parent,col='#e88a48') {
  const dye=raw=>legacyTint(raw,'#e88a48',col);
  const band=(rx,ry,y,z)=>{
    const pts=[];
    for(let i=0;i<=18;i++) {const a=PI*i/18; pts.push([rx*Math.cos(a),y+ry*Math.sin(a),z+.014*Math.sin(a)]);}
    return pts;
  };
  strand(parent,band(.752,.865,.549,-.041),[.035,.055,.061,.055,.035],[.061,.086,.091,.086,.061],INK,{sides:12,steps:42});
  strand(parent,band(.789,.914,.549,-.041),[.024,.030,.034,.030,.024],[.044,.065,.068,.065,.044], dye('#f19b46'),{sides:12,steps:42});
  for(const s of [-1,1]) {
    const ear=group(parent,s*.696,.525,-.012);
    ear.rotation.z=s*-.057;
    oval(ear,'#292834',[s*.022,0,0],[.095,.206,.157]);
    oval(ear,'#453e43',[s*.080,0,0],[.083,.204,.156]);
    oval(ear,dye('#e99843'),[s*.121,0,0],[.077,.184,.138]);
    oval(ear,dye('#f8b366'),[s*.169,.004,.003],[.036,.151,.110]);
    const side=group(ear,s*.195,.010,.004);
    side.rotation.y=s*PI/2;
    oval(side,dye('#ce792e'),[0,0,0],[.078,.100,.012],null,'soft',true);
    oval(side,dye('#f8b767'),[0,0,.009],[.071,.092,.009],null,'soft',true);
    for(let k=-1;k<=1;k++) patch(side,dye('#84522f'),[k*.025,k*.010,.018],[.009,.041,.005],.004,[0,0,-.24]);
    patch(ear,'#505064',[s*.088,.165,-.030],[.067,.129,.067],.021,[0,0,s*.06],'metal');
    oval(ear,'#c5ad87',[s*.126,.178,-.022],[.012,.025,.025],null,'metal',true);
  }
}
function shades(parent,col='#444859') {
  const frame=col==='#444859'?'#252432':dark(col,.12);
  for(const s of [-1,1]) {
    const lens=group(parent,s*.264,.573,faceZ(.264,.573)+.062);
    lens.rotation.y=s*.28; lens.rotation.z=s*.035;
    patch(lens,frame,[0,0,0],[.383,.206,.045],.064);
    patch(lens,'#534f63',[0,-.009,.045],[.342,.158,.015],.049,null,'gloss');
    strand(lens,[[-.117,.022,.060],[-.078,.051,.060],[-.043,.052,.060]],[.003,.008,.001],[.002,.004,.001],'#a29da7');
    cord(parent,[[s*.41,.607,.49],[s*.551,.617,.404],[s*.64,.596,.210],[s*.68,.536,.005]],.022,frame);
  }
  cord(parent,[[-.103,.603,.607],[0,.628,.626],[.103,.603,.607]],.024,frame);
}
function beanie(parent,knit='#a494ce') {
  const rib=legacyTint('#8273ab','#a494ce',knit);
  profile(parent,[[.757,.663,.543,-.025],[.789,.711,.584,-.025],[.904,.724,.602,-.024],[1.03,.676,.562,-.026],[1.177,.594,.496,-.022],[1.307,.456,.389,-.019],[1.414,.293,.249,-.032],[1.463,.118,.109,-.070],[1.466,.013,.012,-.088]],knit,{segments:44});
  profile(parent,[[.773,.671,.548,-.025],[.789,.725,.602,-.024],[.817,.746,.612,-.024],[.964,.722,.599,-.024],[.981,.698,.568,-.024]],rib,{segments:50});
  for(let i=0;i<46;i++) {
    const a=i/46*TAU, sn=Math.sin(a), cs=Math.cos(a);
    cord(parent,[[.728*sn,.808,.604*cs-.024],[.740*sn,.849,.611*cs-.024],[.722*sn,.956,.599*cs-.024]],[.002,.006,.002],pale(rib,.079),{sides:5,steps:5,center:[0,.84,-.02]});
  }
  patch(parent,CREAM,[-.359,.869,.516],[.108,.074,.010],.009,[0,-.36,.02]);
  patch(parent,'#796e88',[-.362,.866,.524],[.044,.015,.003],.002,[0,-.36,-.25]);
}
function headwear(parent,cfg) {
  if(cfg.gear==='headset')headset(parent,cfg.gearColor);
  else if(cfg.gear==='beanie')beanie(parent,cfg.gearColor);
  else if(cfg.gear!=='none')drawHeadwear(parent,cfg.gear,cfg.gearColor,cfg.hair);
}
function glasses(parent,cfg) {
  if(cfg.eyewear==='shades')shades(parent,cfg.eyewearColor);
  else if(cfg.eyewear!=='none')drawEyewear(parent,cfg.eyewear,cfg.eyewearColor);
}
function top(parent,cfg) {
  if(originalTops.has(cfg.outfit))torso(parent,cfg.outfit,cfg.color);
  else drawTop(parent,cfg.outfit,cfg.color);
}

const TORSO_ROWS=[
  [-.022,.304,.192],[.003,.340,.211],[.083,.364,.225],[.211,.384,.238],
  [.437,.402,.243],[.617,.404,.235],[.720,.378,.219],[.795,.323,.199],
  [.855,.202,.157],[.861,.166,.135]
];
const TORSO_GAP=[.40,.42,.42,.39,.32,.33,.39,.53,.70,.73];

function torso(parent,id,col) {
  const trim=dark(col,.64);
  if(id==='bomber') {
    profile(parent,[[-.011,.005,.005],[-.007,.320,.202],[.038,.332,.213],[.226,.345,.208],[.511,.350,.212],[.712,.341,.204],[.809,.254,.165],[.848,.171,.135],[.837,.138,.109]],CREAM,{power:.89});
    profile(parent,[[.804,.182,.143],[.816,.191,.151],[.850,.178,.140],[.857,.151,.122]],'#e5cdb0');
    profile(parent,TORSO_ROWS,col,{segments:38,gap:TORSO_GAP,power:.86});
    profile(parent,[[.001,.331,.204],[.011,.351,.217],[.055,.366,.230],[.077,.366,.229],[.085,.354,.219]],trim,{power:.86,gap:[.40,.40,.41,.42,.42]});
    const collarShade=tint(col,'#332d34',.83);
    profile(parent,[[.779,.333,.206],[.800,.315,.208],[.847,.268,.194],[.912,.222,.178],[.942,.203,.162],[.935,.178,.144]],collarShade,
      {gap:[.67,.68,.72,.74,.76,.76],power:.92});
    profile(parent,[[.904,.229,.180],[.913,.225,.178],[.922,.215,.172]],tint(col,'#3c3439',.68),{gap:[.74,.75,.76],power:.92});
    for(const s of [-1,1]) {
      const outline=TORSO_ROWS.map(([y,rx,rz],i)=>{
        const a=TORSO_GAP[i]; return [s*(rx*signedPow(Math.sin(a),.86)-.002),y,rz*signedPow(Math.cos(a),.86)+.003];
      });
      strand(parent,outline,[.012,.014,.015,.016,.012],[.007,.009,.008,.010,.006],'#4c3b37',{steps:25});
      const zip=outline.map(([x,y,z])=>[x-s*.002,y,z+.008]);
      cord(parent,zip,.0042,'#ebcca1',{steps:26,sides:6,surface:'metal'});
      const p=group(parent,s*.246,.241,.195);
      p.rotation.y=s*.47;p.rotation.z=s*-.34;
      patch(p,dark(col,.48),[0,0,.001],[.045,.196,.010],.014);
      patch(p,pale(col,.07),[s*.008,0,.007],[.022,.173,.009],.008);
    }
    const chest=group(parent,-.234,.554,.216);
    chest.rotation.y=-.40;
    emblem(chest,[0,0,0],.90);
    const name=group(parent,.229,.534,.213);
    name.rotation.y=.39;
    patch(name,trim,[0,0,0],[.116,.038,.012],.006);
    for(let j=0;j<3;j++) patch(name,'#f6d9a2',[-.034+j*.021,.0005,.009],[.011,.012,.004],.002);
    patch(parent,'#c5b1a0',[-.128,.175,.227],[.026,.058,.011],.006,[0,-.16,-.13],'metal');
    cord(parent,[[-.32,.682,-.143],[-.16,.659,-.224],[0,.651,-.239],[.16,.659,-.224],[.32,.682,-.143]],.006,dark(col,.30),{out:[0,0,-1]});
    const badge=group(parent,0,.480,-.245);
    badge.rotation.y=PI;
    ellipseLine(badge,0,0,.002,.125,.054,.38,pale(col,.29),.0055);
    oval(badge,pale(col,.25),[0,0,.002],[.060,.060,.008],null,'soft',true);
  } else if(id==='hoodie') {
    const rows=[[-.034,.235,.142],[-.023,.344,.216],[.026,.372,.235],[.126,.400,.247],[.265,.406,.250],[.488,.411,.251],[.641,.415,.240],[.760,.372,.215],[.818,.257,.177],[.825,.155,.121]];
    profile(parent,rows,col,{power:.88});
    profile(parent,[[-.028,.327,.203],[-.016,.366,.229],[.052,.377,.235],[.068,.371,.23]],dark(col,.25),{power:.86});
    const hood=group(parent,0,0,-.026);
    oval(hood,dark(col,.24),[0,.744,-.131],[.310,.241,.185],[.23,0,0]);
    profile(hood,[[.696,.306,.213],[.727,.337,.234],[.830,.314,.225],[.902,.263,.195],[.929,.209,.167],[.899,.166,.143]],col,{gap:[.36,.34,.37,.43,.54,.62]});
    for(const s of [-1,1]) {
      const x=s*.108;
      oval(parent,trim,[x,.763,.194],[.018,.020,.008],null,'metal',true);
      cord(parent,[[x,.762,.198],[s*.119,.690,.223],[s*.116,.617,.249],[s*(s>0?.128:.113),s>0?.567:.535,.251]],.009,CREAM);
      patch(parent,'#aa96ad',[s*(s>0?.128:.113),s>0?.565:.534,.253],[.015,.030,.010],.005,null,'metal');
    }
    patch(parent,dark(col,.17),[0,.204,.241],[.419,.198,.020],.063);
    patch(parent,col,[0,.212,.250],[.398,.177,.015],.053);
    for(const s of [-1,1]) cord(parent,[[s*.197,.256,.248],[s*.168,.232,.261],[s*.137,.191,.267]],.007,dark(col,.30),{steps:7});
    emblem(parent,[-.239,.573,.225],.67,-.45);
  } else if(id==='vest') {
    profile(parent,[[-.017,.320,.201],[.009,.355,.227],[.229,.368,.226],[.602,.371,.215],[.756,.334,.206],[.813,.197,.151],[.860,.162,.131],[.868,.139,.116]],'#e8dfc5',{power:.9});
    const puffs=[[-.005,.183,.367,.233],[.171,.365,.395,.245],[.354,.556,.410,.251],[.547,.707,.405,.237]];
    puffs.forEach(([low,high,rx,rz],i)=>{
      profile(parent,[[low,rx-.029,rz-.021],[low+.018,rx-.007,rz-.003],[low+.053,rx+.006,rz+.006],[high-.032,rx+.005,rz+.006],[high-.006,rx-.010,rz-.004],[high,rx-.026,rz-.015]],i%2?col:pale(col,.015),{gap:[.049,.048,.045,.045,.048,.049],power:.85});
    });
    profile(parent,[[.695,.374,.222],[.720,.392,.228],[.779,.344,.207],[.838,.224,.162],[.863,.178,.141]],col,{gap:[.06,.06,.08,.17,.27]});
    profile(parent,[[.819,.211,.161],[.860,.203,.157],[.912,.179,.145],[.919,.162,.129]],dark(col,.23),{gap:[.20,.24,.33,.38]});
    cord(parent,[[0,.007,.236],[0,.196,.253],[0,.455,.263],[0,.659,.247],[0,.788,.198]],.009,'#59564f');
    patch(parent,'#c6c2a4',[0,.670,.247],[.022,.044,.014],.006,null,'metal');
    for (const s of [-1,1]) {
      const p=group(parent,s*.231,.244,.205);
      p.rotation.y=s*.47;
      patch(p,dark(col,.23),[0,0,0],[.175,.158,.023],.023);
      patch(p,pale(col,.048),[0,.042,.016],[.177,.070,.018],.015);
      oval(p,'#d3ccb0',[0,.026,.030],[.012,.012,.006],null,'metal',true);
    }
    emblem(parent,[-.226,.582,.219],.72,-.40);
  } else {
    profile(parent,TORSO_ROWS,col,{power:.82});
    profile(parent,[[.003,.331,.211],[.013,.350,.220],[.068,.361,.227],[.075,.353,.218]],INK,{power:.83});
    profile(parent,[[.794,.272,.183],[.825,.242,.178],[.914,.196,.163],[.929,.174,.141],[.908,.154,.121]],dark(col,.38),{gap:[.08,.08,.11,.17,.2]});
    const slash=[[-.112,.041,.218],[-.097,.211,.248],[-.054,.406,.252],[.010,.604,.245],[.079,.753,.211],[.108,.866,.157]];
    cord(parent,slash,.012,'#343443');
    cord(parent,slash.map(([x,y,z])=>[x+.005,y,z+.009]),.0046,'#c3dccf',{sides:6});
    for (const s of [-1,1]) {
      const p=group(parent,s*.242,.242,.197);
      p.rotation.y=s*.43;p.rotation.z=-s*.20;
      patch(p,dark(col,.46),[0,0,0],[.125,.169,.011],.027);
      patch(p,'#a5c9bf',[0,.050,.010],[.083,.012,.004],.004);
    }
    patch(parent,'#b6dace',[-.202,.588,.226],[.112,.022,.009],.005,[0,-.36,.12]);
    patch(parent,'#b6dace',[-.183,.555,.234],[.073,.014,.008],.004,[0,-.33,.12]);
    cord(parent,[[-.322,.611,-.175],[-.142,.656,-.231],[0,.685,-.225],[.147,.651,-.231],[.322,.610,-.174]],.010,'#9dbdb6',{out:[0,0,-1]});
  }
}

function sleeve(upper,lower,s,id,col) {
  const isVest=id==='vest', tech=id==='tech', hoodie=id==='hoodie';
  const main=isVest?'#e9dec4':col, cuff=isVest?'#cdc3ae':tech?'#353545':dark(col,hoodie?.26:.60);
  const volume=isVest?.91:hoodie?1.055:1;
  const rows=[[-.433,.004,.005],[-.420,.055,.059],[-.397,.101,.108],[-.363,.121,.128],[-.327,.133,.140],[-.223,.146,.147],[-.106,.157,.163],[-.028,.157,.156],[.029,.138,.136],[.077,.103,.105],[.099,.052,.055],[.102,.002,.003]];
  profile(upper,rows.map(([y,x,z])=>[y,x*volume,z*volume]),main,{segments:24});
  profile(lower,[[-.338,.090,.091],[-.311,.107,.106],[-.240,.121,.119],[-.100,.133,.135],[-.020,.136,.140],[.025,.129,.133],[.065,.108,.108],[.083,.035,.037]],main,{segments:24});
  profile(lower,[[-.340,.087,.089],[-.332,.113,.111],[-.307,.119,.115],[-.261,.117,.114],[-.250,.110,.110]],cuff,{segments:24});
  if(id==='bomber') {
    profile(lower,[[-.236,.119,.119],[-.224,.124,.122],[-.204,.125,.126],[-.198,.124,.124]],pale(col,.45),{segments:22});
    if(s<0) {
      const p=group(upper,s*.147,-.135,.016);p.rotation.y=s*PI/2;
      patch(p,INK,[0,0,0],[.121,.105,.009],.018);
      patch(p,'#e9d6b3',[0,.023,.009],[.083,.019,.003],.003);
      patch(p,'#b97e55',[0,-.006,.009],[.082,.016,.003],.003);
    } else {
      const pocket=group(upper,s*.134,-.138,.004);pocket.rotation.y=s*PI/2;
      patch(pocket,dark(col,.12),[0,0,0],[.104,.140,.024],.018);
      patch(pocket,'#765238',[-.013,0,.016],[.011,.093,.007],.004);
    }
  } else if(tech) {
    const p=group(upper,s*.135,-.076,.005);p.rotation.y=s*PI/2;p.rotation.z=s*.067;
    patch(p,dark(col,.48),[0,0,0],[.171,.124,.022],.045);
    for(let k=0;k<2;k++) patch(p,'#bbd9cc',[0,.021-k*.035,.016],[.073+k*.033,.010,.005],.003);
    profile(lower,[[-.230,.123,.120],[-.222,.126,.122],[-.193,.128,.126]],'#a5c8bd',{segments:22});
  } else if(isVest) {
    for(const y of [-.181,-.146]) {
      profile(lower,[[y,.132,.132],[y+.012,.132,.134]],'#c2bba7',{segments:20});
    }
  }
}

function hand(wrist,s,skin) {
  oval(wrist,skin,[0,-.078,.014],[.102,.125,.080],[.03,0,-s*.045]);
  const fingers=group(wrist,0,-.112,.011,true);
  const lengths=[.082,.106,.110,.086];
  for(let i=0;i<4;i++) {
    const x=s*(-.069+i*.047),l=lengths[i];
    oval(fingers,skin,[x,-l*.54,.004+Math.sin(i*.8)*.009],[.031,l,.047],[.11,0,s*(i-1.5)*.046],'soft',true);
  }
  const thumb=group(wrist,-s*.061,-.026,.043,true);
  oval(thumb,skin,[-s*.029,-.065,.032],[.047,.087,.047],[-.22,0,-s*.22],'soft',true);
  return {fingers,thumb};
}

const smooth = n => { n = Math.max(0,Math.min(1,n)); return n*n*(3-2*n); };
const approach = (a,b,k) => a+(b-a)*k;

function rigArm(parent,s,cfg,articulated) {
  const upper=group(parent,s*.370,.725,0,articulated);
  const lower=group(upper,0,-.351,0,articulated);
  if(originalTops.has(cfg.outfit))sleeve(upper,lower,s,cfg.outfit,cfg.color);
  else drawSleeves(upper,lower,s,cfg.outfit,cfg.color,cfg.skin,!articulated);
  upper.rotation.set(s<0?-.080:-.080,0,s*.165,'ZXY');
  lower.rotation.set(s<0?-.180:-.25,0,0,'ZXY');
  if (!articulated) return null;
  const wrist=group(lower,0,-.311,.002,true);
  const {fingers,thumb}=hand(wrist,s,cfg.skin);
  return {s,upper,lower,wrist,fingers,thumb};
}

export function createAvatar(config = {}, decorateHead) {
  const cfg=validLook(config);
  const root=group(null), movement=group(root,0,0,0,true);
  root.name='Orbit avatar';
  const chest=group(movement,0,.916,0,true);
  top(chest,cfg);
  drawNeckwear(chest,cfg.neckwear,cfg.neckColor);
  profile(chest,[[.707,.135,.122,.002],[.753,.150,.127,.004],[.891,.156,.135,.009],[1.027,.164,.146,.022],[1.085,.147,.134,.016]],cfg.skin,{segments:28});
  const head=group(chest,0,.991,.017,true);
  const {eyes,brows,smile,mouth}=face(head,cfg);
  drawMustache(head,cfg.mustache,pigment(cfg,'mustacheColor'));
  drawBeard(head,cfg.beard,pigment(cfg,'beardColor'),cfg.skin);
  fitHair(head,cfg,slots.gear.items.find(i=>i.id===cfg.gear)?.brim);
  headwear(head,cfg);glasses(head,cfg);drawEarrings(head,cfg.earrings,cfg.earringColor);
  const performanceShades=cfg.eyewear==='none' ? group(head,0,0,0,true) : null;
  if(performanceShades) shades(performanceShades);
  const arms=[-1,1].map(s=>rigArm(chest,s,cfg,true));

  const pelvis=group(movement,0,.836,0,true);
  drawWaist(pelvis,cfg.bottom,cfg.bottomColor,cfg.skin);
  const legs=[-1,1].map(s=>{
    const upper=group(pelvis,s*.181,0,0,true);
    const knee=group(upper,0,-.351,0,true);
    const ankle=group(knee,0,-.287,0,true);
    drawLeg(upper,knee,s,cfg.bottom,cfg.bottomColor,cfg.skin);
    drawShoe(ankle,s,cfg.shoe,cfg.shoeColor,cfg.color,cfg.skin);
    return {s,upper,knee,ankle};
  });
  decorateHead?.(head, faceZ);
  combine(root);
  shapeHead(head,cfg.faceShape);shapeBody(movement,head,cfg.build);
  return bindAvatar(root,{movement,chest,head,eyes,brows,smile,mouth,performanceShades,arms,pelvis,legs});
}

export function bindAvatar(root,bindings) {
  const {movement,chest,head,eyes,brows,smile,mouth,performanceShades,arms,pelvis,legs}=bindings;
  let lastT=null, gazeH=0, gazeV=0, expression=0;
  const update=(t,state={})=>{
    const {gesture=null, progress=0, gazeX=0, gazeY=0}=state;
    const p=Math.max(0,Math.min(1,progress));
    const blend = gesture === 'spin' ? 1 : gesture ? smooth(p / .15) * smooth((1 - p) / .19) : 0;
    const { spinWindup = 0, spinDrive = 0 } = state;
    const k=lastT===null || Math.abs(t-lastT)>.35 ? 1 : 1-Math.exp(-Math.max(0,t-lastT)*29);
    lastT=t;
    const breath=Math.sin(t*1.74+.52), sway=Math.sin(t*.88), nod=Math.sin(t*1.14+.16);
    gazeH=approach(gazeH,THREE.MathUtils.clamp(gazeX,-1,1),k*.70);
    gazeV=approach(gazeV,THREE.MathUtils.clamp(gazeY,-1,1),k*.70);
    const wave=Math.sin(p*PI*8), bounce=Math.sin(p*PI*6);
    let rise=0, bodyLean=0, bodyPitch=0, bodyYaw=0, headRoll=0, headYaw=0, headPitch=0;
    let happy=0, squint=0, raised=0;
    switch(gesture) {
      case 'spin':
        rise = -0.096 * spinWindup + 0.038 * spinDrive;
        bodyPitch = 0.13 * spinWindup - 0.035 * spinDrive;
        bodyYaw = -0.48 * spinWindup + 0.15 * spinDrive;
        bodyLean = 0.055 * spinWindup - 0.060 * spinDrive;
        headYaw = 0.20 * spinWindup + 0.24 * spinDrive;
        headRoll = -0.045 * spinDrive;
        break;
      case 'gg':
        headPitch=.05-.098*bounce;bodyPitch=-.031;headRoll=-.05;happy=.16;raised=.013;break;
      case 'laugh':
        bodyPitch=.08+bounce*.077;headPitch=-.107+bounce*.043;headRoll=.067;rise=.027*(1+bounce);happy=.91;squint=.70;break;
      case 'cheer':
        rise=.235*Math.abs(Math.sin(p*PI*2.45));bodyLean=.029*Math.sin(p*PI*5);headPitch=-.105;happy=.79;squint=.13;raised=.020;break;
      case 'wave':
        bodyLean=.056;bodyYaw=-.081;headRoll=-.082;headYaw=.072;happy=.20;raised=.014;break;
      case 'think':
        bodyLean=-.037;headRoll=.103;headYaw=-.12;headPitch=-.046;raised=.018;break;
      case 'joy':
        rise=.051*Math.abs(bounce);headRoll=-.078+.060*bounce;bodyLean=-.047+.031*bounce;headPitch=-.063;happy=1;squint=.87;break;
      case 'cool':
        bodyLean=-.060;bodyYaw=.153;headYaw=-.105;headRoll=.089;headPitch=.056+.071*bounce;raised=.010;break;
    }
    movement.position.y=approach(movement.position.y,rise*blend,k);
    chest.position.x=approach(chest.position.x,.009*sway,k);
    chest.position.y=approach(chest.position.y,.916+.006*breath,k);
    chest.rotation.set(approach(chest.rotation.x,.004*breath+bodyPitch*blend,k),approach(chest.rotation.y,-.027+.023*nod+bodyYaw*blend,k),approach(chest.rotation.z,-.013+.010*sway+bodyLean*blend,k));
    chest.scale.y=1+.0045*breath;
    head.rotation.set(
      approach(head.rotation.x, .009 * breath - .10 * gazeV + headPitch * blend, k),
      approach(head.rotation.y, .047 + .024 * nod + .24 * gazeH + headYaw * blend, k),
      approach(head.rotation.z, .027 + .012 * Math.sin(t * .79 + .32) + headRoll * blend, k),
    );
    const eyelid=(x,center,width)=>Math.exp(-Math.pow((x-center)/width,2));
    const tick=(t+1.22)%8.67;
    const blink=Math.max(eyelid(tick,2.29,.074),eyelid(tick,6.25,.079),eyelid(tick,6.55,.064));
    const gazeDrift=.013*Math.tanh(Math.sin(t*.94+.69)*4.8)+.008*Math.sin(t*.55);
    const lookUp=.005*Math.tanh(Math.sin(t*.76+.26)*4.8)+.011*gazeV+(gesture==='think'?.031*blend:0);
    for(let i=0;i<eyes.length;i++) {
      const {s,eye,x,y,z}=eyes[i];
      const glance=gazeDrift+.021*gazeH+(gesture==='think'?-.027*blend:0);
      eye.position.set(x+glance,y+lookUp,z-s*.22*glance);
      const eyeHeight=Math.max(.055,(1-.94*blink)*(1-squint*blend));
      eye.scale.y=approach(eye.scale.y,eyeHeight,k);
      brows[i].position.y=approach(brows[i].position.y,raised*blend+((gesture==='think'&&s>0)?-.034*blend:0),k);
    }
    expression=approach(expression,happy*blend,k);
    mouth.visible=expression>.23;
    mouth.scale.set(.72+.35*expression,Math.max(.04,expression),1);
    smile.visible=expression<.44;
    if (performanceShades) {
      performanceShades.visible=gesture==='cool' && blend>.06;
      performanceShades.position.y=(1-blend)*.17;
      performanceShades.position.z=(1-blend)*.10;
      performanceShades.scale.setScalar(.86+.14*blend);
    }

    for(const arm of arms) {
      const {s,upper,lower,wrist,fingers,thumb}=arm;
      const handOnHip=s>0;
      let ax=(handOnHip?-.091:-.068)+.018*Math.sin(1.28*t+s);
      let ay=handOnHip?-1.07:.035, az=handOnHip?.778+.010*breath:-.179-.018*breath;
      let ex=handOnHip?-1.27:-.205, ez=handOnHip?0:-.029, ey=0;
      let wx=handOnHip?.08:-.036, wy=handOnHip?.18:-.105, wz=handOnHip?-.13:.05;
      let fist=handOnHip?.19:.14, thumbAngle=0;
      const target=(a,b)=>a+(b-a)*blend;
      switch(gesture) {
        case 'spin':
          // Open the arms to wind up, then draw them across the chest for the pivot.
          ax -= 0.35 * spinWindup + 0.51 * spinDrive;
          ay += s * (0.55 * spinWindup + 0.85 * spinDrive);
          az += s * (1.12 * spinWindup + 0.16 * spinDrive);
          ex -= 0.15 * spinWindup + 1.08 * spinDrive;
          wy += s * 0.30 * spinDrive;
          fist += 0.28 * spinDrive;
          break;
        case 'gg':
          ax=target(ax,-.27);ay=target(ay,-s*.114);az=target(az,s*.374);ex=target(ex,-2.011);ez=target(ez,0);
          wy=target(wy,s*.38);wz=target(wz,-s*.05);fist=target(fist,.87);thumbAngle=target(0,-.82);break;
        case 'laugh':
          ax=target(ax,-.249);ay=target(ay,-s*.920);az=target(az,s*(.434+.028*bounce));ex=target(ex,-1.841);ez=target(ez,0);wy=target(wy,s*.35);break;
        case 'cheer':
          ax=target(ax,-.13);ay=target(ay,-s*.03);az=target(az,s*(2.26+.14*bounce));ex=target(ex,-.28);ez=target(ez,s*.39);wz=target(wz,s*.10*bounce);fist=target(fist,.20);break;
        case 'wave':
          if(s>0) {
            ax=target(ax,-.18);ay=target(ay,-.03);az=target(az,1.99+.055*wave);ex=target(ex,-.32);ez=target(ez,.80+.20*wave);
            wy=target(wy,.05);wx=target(wx,-.10);wz=target(wz,.23*wave);fist=target(fist,0);
          } else {az=target(az,-.20);ex=target(ex,-.29);}
          break;
        case 'think':
          if(s>0) {
            ax=target(ax,-1.298);ay=target(ay,1.527);az=target(az,2.363);ex=target(ex,-1.445);ez=target(ez,0);
            wy=target(wy,.16);wx=target(wx,.18);fist=target(fist,.49);
          } else {
            ax=target(ax,-.430);ay=target(ay,1.371);az=target(az,.521);ex=target(ex,-1.263);ez=target(ez,0);wy=target(wy,-.15);
          }
          break;
        case 'joy':
          ax=target(ax,-.786+.035*bounce);ay=target(ay,s*1.720);az=target(az,s*2.587);ex=target(ex,-.793);ez=target(ez,0);
          wy=target(wy,s*.40);wx=target(wx,-.08);fist=target(fist,.32);break;
        case 'cool':
          if(s<0) {
            ax=target(ax,-.510);ay=target(ay,-1.366);az=target(az,-2.247);ex=target(ex,-1.067);ez=target(ez,0);wx=target(wx,.11);wy=target(wy,-.20);fist=target(fist,.36);
          } else {
            ax=target(ax,-.415);ay=target(ay,-1.250);az=target(az,-.358);ex=target(ex,-1.112);ez=target(ez,0);wy=target(wy,.24);
          }
          break;
      }
      upper.rotation.set(approach(upper.rotation.x,ax,k),approach(upper.rotation.y,ay,k),approach(upper.rotation.z,az,k),'ZXY');
      lower.rotation.set(approach(lower.rotation.x,ex,k),approach(lower.rotation.y,ey,k),approach(lower.rotation.z,ez,k),'ZXY');
      wrist.rotation.set(approach(wrist.rotation.x,wx,k),approach(wrist.rotation.y,wy,k),approach(wrist.rotation.z,wz,k),'ZXY');
      fingers.scale.y=approach(fingers.scale.y,1-fist*.57,k);
      fingers.rotation.x=approach(fingers.rotation.x,-fist*.66,k);
      thumb.rotation.x=approach(thumb.rotation.x,thumbAngle,k);
    }
    pelvis.rotation.y = 0.009 * nod + (gesture === 'spin' ? -0.17 * spinWindup + 0.08 * spinDrive : 0);
    for(const {s,upper,knee,ankle} of legs) {
      let legX=s<0?-.055:.024, legZ=s*.058, kneeX=s<0?.082:-.029, footX=s<0?-.024:0;
      if (gesture === 'spin') {
        // Push off the bent knees and lift one foot while the other carries the turn.
        legX -= 0.39 * spinWindup + (s < 0 ? 0.48 : 0.035) * spinDrive;
        kneeX += 0.77 * spinWindup + (s < 0 ? 0.95 : 0.12) * spinDrive;
        footX -= 0.34 * spinWindup + 0.18 * spinDrive;
        legZ += s * (0.12 * spinWindup - 0.055 * spinDrive);
      } else if(gesture==='cheer') {
        const kick=Math.abs(Math.sin(p*PI*2.45))*blend;
        legX-=kick*(s>0?.29:.12);kneeX+=kick*(s>0?.71:.49);legZ+=s*kick*.10;footX-=kick*.20;
      } else if(gesture==='joy'&&s<0) {
        legX-=.20*blend;kneeX+=.51*blend;footX-=.12*blend;
      }
      upper.rotation.set(approach(upper.rotation.x,legX,k),s*.023,approach(upper.rotation.z,legZ,k));
      knee.rotation.x=approach(knee.rotation.x,kneeX,k);
      ankle.rotation.set(approach(ankle.rotation.x,footX,k),s*.105,-legZ*.78);
    }
  };
  update(0);
  return {root,bindings,update,dispose:()=>disposeObject(root)};
}

// Catalog and saved portraits share the same meshes as the live character.
export function createItem(kind,id,color,appearance={}) {
  if(kind==='outfits'||kind==='clothing')kind='outfit';
  if(kind==='hairstyle')kind='hair';
  if(kind==='accessory')kind='gear';
  if(kind==='gear'&&id==='shades')kind='eyewear';
  const slot=slots[kind];
  const values={...defaultLook,...appearance,[kind]:id};
  if(slot?.colorField && color)values[slot.colorField]=color;
  const cfg=validLook(values),model=group(null);
  let headShape=null;
  if(kind==='build') {
    const rig=createAvatar(cfg);rig.update(2.05,{});
    rig.root.userData.dispose=rig.dispose;return rig.root;
  }
  if(kind==='outfit'){
    top(model,cfg);for(const s of [-1,1])rigArm(model,s,cfg,false);
  }else if(kind==='bottom'){
    drawWaist(model,id,cfg.bottomColor,cfg.skin);
    for(const s of [-1,1]){
      const upper=group(model,s*.181,0,0),knee=group(upper,0,-.351,0);
      upper.rotation.z=s*.04;
      drawLeg(upper,knee,s,id,cfg.bottomColor,cfg.skin);
    }
  }else if(kind==='shoe'){
    for(const s of [-1,1]) {
      const foot=group(model,s*.20,0,s*.075);foot.rotation.y=s*.12;
      drawShoe(foot,s,id,cfg.shoeColor,cfg.color,cfg.skin);
    }
  }else if(kind==='gear')headwear(model,cfg);
  else if(kind==='eyewear')glasses(model,cfg);
  else if(kind==='earrings'){
    drawEarrings(model,id,cfg.earringColor);
    for(const ear of model.children)ear.position.x*=.20;
  }
  else if(kind==='neckwear')drawNeckwear(model,id,cfg.neckColor);
  else {
    const {mouth}=face(model,cfg);mouth.visible=false;
    if(kind==='hair'||kind==='dye')fitHair(model,cfg);
    if(kind==='mustache')drawMustache(model,id,pigment(cfg,'mustacheColor'));
    if(kind==='beard')drawBeard(model,id,pigment(cfg,'beardColor'),cfg.skin);
    if(kind==='faceShape')headShape=id;
  }
  combine(model);
  if(headShape)shapeHead(model,headShape);
  model.name=kind+' '+id;model.userData.dispose=()=>disposeObject(model);
  return model;
}
