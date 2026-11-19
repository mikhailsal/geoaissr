// Accessories are built in head or chest space and are batched into the existing rig.
import {
  THREE, PI, TAU, INK, CREAM, group, mesh, oval, profile, patch,
  cord, geometryGrid, signedPow, tint, dark, pale, faceZ
} from './model-kit.js';

export const extraHeadwear = [
  {id:'club-cap', name:'Club cap', color:'#526fa0', brim:.85},
  {id:'bucket', name:'Bucket hat', color:'#86ab98', brim:.84},
  {id:'trail-hat', name:'Trail hat', color:'#ad7750', brim:.86},
  {id:'beret', name:'Artist beret', color:'#af577e', brim:.85},
  {id:'spellhat', name:'Stargazer hat', color:'#765898', brim:.86},
  {id:'toadstool', name:'Mushroom cap', color:'#cf6854', brim:.85},
  {id:'crown', name:'Prism crown', color:'#d9ad5f'},
  {id:'cat-ears', name:'Cat ears', color:'#7e6792'},
  {id:'sun-visor', name:'Sun visor', color:'#dd8871'},
  {id:'flowers', name:'Daisy wreath', color:'#cda0d0'},
  {id:'halo', name:'Nimbus halo', color:'#f1cd76'},
  {id:'aviator-cap', name:'Flight cap', color:'#976851', brim:.83},
  {id:'silk-bow', name:'Ribbon bow', color:'#c86e85'},
  {id:'horns', name:'Little horns', color:'#a06d9b'}
];
export const extraEyewear = [
  {id:'round', name:'Round readers', color:'#bb9969'},
  {id:'square', name:'Square frames', color:'#655166'},
  {id:'cat-eye', name:'Cat-eye frames', color:'#aa647d'},
  {id:'aviators', name:'Aviators', color:'#c5a671'},
  {id:'star-glasses', name:'Star shades', color:'#d5ae64'},
  {id:'heart-glasses', name:'Heart shades', color:'#cd758e'},
  {id:'wrap-visor', name:'Laser visor', color:'#83bcca'},
  {id:'eye-patch', name:'Eye patch', color:'#544453'},
  {id:'monocle', name:'Monocle', color:'#c8a76e'},
  {id:'goggles', name:'Workshop goggles', color:'#9d7258'},
  {id:'cinema', name:'Cinema specs', color:'#ede4d6'}
];
export const earrings = [
  {id:'none', name:'Bare ears', color:'#ada6b1'},
  {id:'studs', name:'Gem studs', color:'#64bcb6'},
  {id:'hoops', name:'Classic hoops', color:'#dcb96d'},
  {id:'star-drops', name:'Star drops', color:'#eaaa5b'},
  {id:'pearl-drops', name:'Pearl drops', color:'#e1c9dc'},
  {id:'bolts', name:'Lightning drops', color:'#dba64c'},
  {id:'tassels', name:'Silk tassels', color:'#a878ba'},
  {id:'cuffs', name:'Ear cuffs', color:'#bac6d1'},
  {id:'crescents', name:'Crescent drops', color:'#bc9fd9'}
];
export const neckwear = [
  {id:'none', name:'Bare neck', color:'#ada6b1'},
  {id:'bandana', name:'Trail bandana', color:'#c77768'},
  {id:'scarf', name:'Wrapped scarf', color:'#839bcb'},
  {id:'bow-tie', name:'Bow tie', color:'#aa6f9a'},
  {id:'tie', name:'Silk tie', color:'#688eb0'},
  {id:'tags', name:'Dog tags', color:'#a2b3bf'},
  {id:'crystal', name:'Crystal pendant', color:'#88b5c4'},
  {id:'beads', name:'Bead collar', color:'#c9919e'},
  {id:'compass', name:'Compass locket', color:'#c4a26b'}
];

const GOLD='#c8a568';
const SILVER='#b9c2cd';
const at=(parent,x,y,z,rx=0,ry=0,rz=0)=>{
  const node=group(parent,x,y,z);
  node.rotation.set(rx,ry,rz);
  return node;
};

function loop(parent,points,radius,color,surface='soft',segments=40) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),true,'catmullrom',.42);
  return mesh(parent,new THREE.TubeGeometry(curve,segments,radius,6,true),color,surface);
}
function ringXY(parent,rx,ry,radius,color,surface='metal') {
  const p=[];
  for(let i=0;i<24;i++) {const a=TAU*i/24;p.push([rx*Math.cos(a),ry*Math.sin(a),0]);}
  return loop(parent,p,radius,color,surface,36);
}
function ringAround(parent,rx,rz,y,width,color,z=-.025,surface='soft',rise=()=>0) {
  const p=[];
  for(let i=0;i<40;i++) {const a=TAU*i/40;p.push([rx*Math.sin(a),y+rise(a),z+rz*Math.cos(a)]);}
  return loop(parent,p,width,color,surface,64);
}
function path2D(points) {
  const shape=new THREE.Shape();
  shape.moveTo(...points[0]);
  for(const point of points.slice(1))shape.lineTo(...point);
  shape.closePath();
  return shape;
}
function plate(parent,points,depth,color,{bevel=.005,surface='soft',hole=null}={}) {
  const shape=path2D(points);
  if(hole)shape.holes.push(path2D(hole.slice().reverse()));
  const geom=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:1,curveSegments:3});
  geom.translate(0,0,-depth*.5);
  return mesh(parent,geom,color,surface);
}
function starPoints(r,inner=0.46,n=5) {
  return Array.from({length:n*2},(_,i)=>{
    const a=PI/2+i*PI/n,t=r*(i%2?inner:1);return [t*Math.cos(a),t*Math.sin(a)];
  });
}
function ellipsePoints(rx,ry,power=1,count=40) {
  return Array.from({length:count},(_,i)=>{
    const a=i/count*TAU;
    return [rx*signedPow(Math.cos(a),power),ry*signedPow(Math.sin(a),power)];
  });
}

// A closed rolled cloth brim has a separately lit underside when seen from below.
function brim(parent,inside,outside,y,color,lift=()=>0,thin=.038) {
  const sections=[[0,-.46],[.91,-.46],[.985,-.29],[1,0],[.979,.34],[.92,.50],[0,.50]];
  return mesh(parent,geometryGrid(56,sections.length-1,(u,v,j)=>{
    const [t,edge]=sections[j], a=u*TAU;
    const rx=inside[0]+(outside[0]-inside[0])*t,rz=inside[1]+(outside[1]-inside[1])*t;
    return [rx*Math.sin(a),y+lift(a,t)+edge*thin,-.026+rz*Math.cos(a)];
  }),color);
}
function hatband(parent,y,rx,rz,height,color) {
  profile(parent,[[y,rx*.989,rz*.988,-.025],[y+.008,rx,rz,-.025],[y+height-.008,rx*.99,rz*.992,-.025],[y+height,rx*.978,rz*.983,-.025]],color,{segments:44});
}
function capBill(parent,color,y=.866) {
  // A curved, forward-projecting brim: the back edge is buried in the band's front.
  const W=.603, nx=30, ny=6;
  function position(t,s,off) {
    const x=(t*2-1)*W, u=x/W;
    const z=.24+.16*(1-u*u)+s*(.046+.425*(1-u*u));
    return [x,y-.032*u*u-.073*s+.021*Math.cos(PI*u)*s+off,z];
  }
  for(const [off,bottom] of [[.012,false],[-.012,true]]) {
    const g=geometryGrid(nx,ny,(u,v)=>position(u,bottom?v:1-v,off),false);
    mesh(parent,g,bottom?dark(color,.32):color);
  }
  const stitches=[];
  for(let i=0;i<=26;i++) stitches.push(position(i/26,1,0));
  cord(parent,stitches,.013,pale(color,.16),{steps:40,sides:6});
  for(const s of [0,1]) {
    const edge=[position(s,0,0),position(s,.5,0),position(s,1,0)];
    cord(parent,edge,.012,color,{steps:5,sides:6});
  }
}
function capShell(parent,color,base=.83) {
  profile(parent,[[base-.015,.678,.562,-.025],[base+.02,.713,.595,-.025],[.985,.689,.577,-.024],[1.125,.620,.531,-.020],[1.235,.507,.448,-.023],[1.334,.349,.319,-.024],[1.397,.158,.157,-.024],[1.409,.007,.007,-.024]],color,{segments:46});
}
function capSeams(parent,color) {
  for(const a of [-2.73,-1.57,-.48,.48,1.57,2.73]) {
    const rows=[[.702,.588,.889],[.667,.566,1.026],[.585,.513,1.16],[.464,.418,1.266],[.300,.275,1.361],[.08,.08,1.41]];
    const pts=rows.map(([rx,rz,y])=>[rx*Math.sin(a),y,rz*Math.cos(a)-.023]);
    cord(parent,pts,.007,color,{steps:14,sides:5});
  }
}
function baseball(parent,c) {
  capShell(parent,c);
  hatband(parent,.824,.718,.598,.076,dark(c,.16));
  capBill(parent,c,.88);
  capSeams(parent,dark(c,.27));
  oval(parent,pale(c,.25),[0,1.417,-.024],[.050,.024,.050],null,'soft',true);
  const badge=at(parent,0,1.069,.534,-.27);
  patch(badge,pale(c,.54),[0,0,0],[.155,.105,.016],.033);
  const star=plate(badge,starPoints(.041),.007,c,{bevel:.0015});star.position.z=.014;
}
function bucket(parent,c) {
  profile(parent,[[.854,.699,.594,-.025],[.921,.709,.602,-.025],[1.073,.687,.571,-.024],[1.225,.602,.508,-.017],[1.308,.529,.454,-.022],[1.322,.385,.338,-.023],[1.32,.004,.003,-.023]],c,{segments:42});
  brim(parent,[.696,.585],[.878,.743],.914,c,(a,t)=>-.169*t+.015*Math.cos(2*a+.3)*t);
  hatband(parent,.908,.718,.606,.083,dark(c,.31));
  for(const t of [.46,.76])ringAround(parent,.696+.182*t,.585+.158*t,.934-.169*t,.006,pale(c,.21),-.026,'soft',a=>.015*Math.cos(2*a+.3)*t);
  const label=at(parent,-.34,.952,.503,0,-.47);
  patch(label,CREAM,[0,0,0],[.123,.059,.011],.011);patch(label,c,[0,0,.008],[.065,.013,.004],.002);
}
function trail(parent,c) {
  const tilt=(a,t)=>(.135*Math.pow(Math.abs(Math.sin(a)),3)-.039*Math.cos(a))*(t*t);
  brim(parent,[.670,.549],[.990,.765],.902,c,tilt,.050);
  const rows=[[.875,.691,.580],[.911,.704,.589],[1.019,.686,.563],[1.205,.608,.507],[1.354,.494,.421],[1.403,.351,.315],[1.376,.221,.177],[1.342,.065,.056],[1.34,.004,.004]];
  mesh(parent,geometryGrid(48,rows.length-1,(u,v,j)=>{
    const a=u*TAU,[y,rx,rz]=rows[j], pinch=j>=4 ? .057*Math.cos(a)**2 : 0;
    return [(rx-pinch)*Math.sin(a),y+.031*Math.sin(a)**2*(j>=4?1:0),-.032+rz*Math.cos(a)];
  }),c);
  hatband(parent,.912,.706,.595,.087,dark(c,.66));
  ringAround(parent,.704,.59,1.002,.010,pale(c,.26));
  const buckle=at(parent,-.297,.959,.514,0,-.42);
  patch(buckle,GOLD,[0,0,0],[.101,.066,.012],.014,null,'metal');patch(buckle,dark(c,.56),[0,0,.009],[.065,.034,.005],.006);
}
function beret(parent,c) {
  hatband(parent,.820,.712,.590,.113,dark(c,.44));
  profile(parent,[[.878,.681,.555,-.016],[.921,.728,.603,-.023,-.007],[1.04,.780,.649,-.026,-.049],[1.175,.764,.653,-.047,-.106],[1.252,.664,.590,-.070,-.144],[1.315,.458,.429,-.058,-.143],[1.350,.236,.221,-.038,-.139],[1.362,.010,.008,-.024,-.139]],c,{segments:52});
  cord(parent,[[-.14,1.345,-.028],[-.136,1.403,-.030],[-.174,1.422,-.044]],[.026,.026,.017],dark(c,.24),{sides:8,steps:7});
  const pin=at(parent,.467,1.105,.491,0,.67,-.10);
  plate(pin,starPoints(.063,0.45,4),.010,'#e4ca91',{bevel:.002,surface:'metal'});
}
function sorcerer(parent,c) {
  brim(parent,[.660,.556],[.962,.772],.897,c,(a,t)=>(.055*Math.sin(2*a+.7)-.029*Math.cos(a))*t*t,.047);
  profile(parent,[[.865,.686,.572,-.024],[.932,.702,.593,-.024],[1.10,.607,.525,-.025],[1.288,.493,.448,-.027,.037],[1.461,.377,.340,-.035,.081],[1.634,.243,.235,-.044,.121],[1.787,.142,.140,-.041,.061],[1.879,.078,.078,-.040,-.067],[1.884,.045,.047,-.032,-.195],[1.844,.005,.005,-.026,-.319]],c,{segments:42});
  hatband(parent,.914,.711,.598,.090,dark(c,.58));
  const buckle=at(parent,0,.963,.576);
  patch(buckle,GOLD,[0,0,0],[.158,.094,.024],.016,null,'metal');patch(buckle,dark(c,.58),[0,0,.017],[.105,.050,.008],.008);
  for(const [x,y,z,s,ry] of [[-.34,1.085,.421,.048,-.54],[.254,1.295,.369,.062,.41],[.099,1.516,.252,.039,.16],[-.105,1.368,.344,.027,-.25],[.48,1.155,-.21,.048,1.96]]) {
    const token=at(parent,x,y,z,-.31,ry,.16);plate(token,starPoints(s,.34,4),.008,'#e6cabb',{bevel:.0015});
  }
}
function mushroom(parent,c) {
  // The lower lip sweeps upward from the forehead, keeping the eyes clear.
  const rows=[[.855,.659,.547],[.842,.710,.588],[.818,.801,.661],[.824,.882,.736],[.852,.928,.786],[.879,.938,.799]];
  profile(parent,rows.map(([y,x,z])=>[y,x,z,-.034]),'#efdec0',{segments:64});
  profile(parent,[[.860,.924,.782,-.034],[.882,.950,.809,-.034],[.946,.931,.795,-.034],[1.051,.884,.755,-.036],[1.218,.767,.675,-.044],[1.376,.590,.549,-.051],[1.501,.382,.366,-.066],[1.552,.185,.185,-.071],[1.559,.007,.006,-.071]],c,{segments:58});
  for(let k=0;k<24;k++){
    const a=TAU*k/24,q=a+.03*(k%2?1:-1),s=Math.sin(a),z=Math.cos(a);
    cord(parent,[[.711*s,.834,.587*z-.034],[.797*Math.sin(q),.817,.665*Math.cos(q)-.034],[.89*s,.830,.746*z-.034]],[.004,.008,.003], '#ceb899',{steps:6,sides:5});
  }
  const line=[[.965,.921,.788],[1.128,.842,.724],[1.262,.718,.635],[1.394,.558,.522],[1.488,.414,.395],[1.525,.303,.294]];
  for(const [i,[y,rx,rz]] of line.entries()){
    const count=[8,6,5,4,3,2][i];
    for(let j=0;j<count;j++){
      const a=TAU*(j+.32*(i%2)+.085*i)/count;
      const r=(i<2 ? .079 : .07)*(1+.24*Math.sin(i*4+j*5));
      const normal=new THREE.Vector3(Math.sin(a)/rx,.53+i*.28,Math.cos(a)/rz).normalize();
      const spot=oval(parent,'#fae7c8',[(rx+.002)*Math.sin(a),y,(rz+.003)*Math.cos(a)-.034-.006*i],[r,r*(.83+.13*Math.cos(a)),.012],null,'soft',true);
      spot.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
    }
  }
}
function crown(parent,c) {
  const n=8;
  function edgeHeight(a) {
    const phase=(a/TAU*n)%1;
    return .185*Math.pow(Math.abs(2*phase-1),1.18);
  }
  const rows=[[.969,.651,.549,0],[.989,.688,.587,0],[1.112,.661,.566,0],[1.138,.663,.57,.82],[1.156,.678,.574,1],[1.158,.651,.552,1],[1.122,.640,.543,.69],[.996,.647,.543,0]];
  mesh(parent,geometryGrid(n*12,rows.length-1,(u,v,j)=>{
    const a=u*TAU,[y,rx,rz,w]=rows[j],h=edgeHeight(a);
    return [rx*Math.sin(a),y+w*h,rz*Math.cos(a)-.021];
  }),c,'metal');
  ringAround(parent,.683,.585,1.017,.016,pale(c,.40),-.021,'metal');
  for(let i=0;i<n;i++){
    const a=TAU*i/n, gem=at(parent,.683*Math.sin(a),1.109,.581*Math.cos(a)-.021,0,a);
    const jewel=plate(gem,[[0,.061],[.042,0],[0,-.061],[-.042,0]],.021,i%2?'#8c80bf':'#6ab4b4',{bevel:.006,surface:'gloss'});
    jewel.rotation.z=.025;
  }
}
function headband(parent,c,width=.031) {
  const points=[];
  for(let i=0;i<=28;i++){
    const a=PI*i/28;
    points.push([.702*Math.cos(a),.527+.872*Math.sin(a),-.055+.042*Math.sin(a)]);
  }
  cord(parent,points,width,c,{steps:40,sides:7});
}
function ears(parent,c) {
  headband(parent,dark(c,.24),.029);
  for(const s of [-1,1]){
    const ear=at(parent,s*.451,1.297,-.008,0,s*.12,-s*.17);
    const shape=[[-.175,-.095],[.138,-.119],[.157,-.057],[.125,.318],[.096,.340],[-.165,.029]];
    const mirrored=shape.map(([x,y])=>[s*x,y]);
    plate(ear,mirrored,.103,c,{bevel:.025});
    const inner=plate(ear,shape.map(([x,y])=>[s*(x*.65),y*.7+.015]),.013,tint(c,'#f3c0b4',.63),{bevel:.009});
    inner.position.z=.065;
  }
}
function visor(parent,c) {
  hatband(parent,.831,.707,.592,.112,c);
  ringAround(parent,.710,.593,.849,.009,pale(c,.38));
  capBill(parent,c,.857);
  for(const s of [-1,1]) {
    const button=at(parent,s*.680,.884,.170,0,s*1.33);
    oval(button,GOLD,[0,0,.015],[.027,.027,.011],null,'metal',true);
  }
}
function wreath(parent,c) {
  function petal(cluster,color,x,y,z,rx,ry,rz,angle=0) {
    const leaf=mesh(cluster,new THREE.SphereGeometry(1,8,5),color);
    leaf.position.set(x,y,z);leaf.scale.set(rx,ry,rz);leaf.rotation.z=angle;
  }
  ringAround(parent,.726,.613,.983,.021,'#678862',-.025,'soft',a=>.038*Math.sin(a-.5));
  for(let i=0;i<13;i++){
    const a=TAU*i/13, z=.612*Math.cos(a)-.025, y=.974+.042*Math.sin(a-.5);
    const flower=at(parent,.726*Math.sin(a),y,z,-.16,a,.25*Math.sin(2*a));
    const size=.056+(i%4===0 ? .016 : 0);
    for(let j=0;j<5;j++){
      const q=TAU*j/5;
      petal(flower,i%3===0?CREAM:pale(c,(i%2)*.16),size*.62*Math.cos(q),size*.62*Math.sin(q),.012,size*.65,size*.48,.016,q);
    }
    petal(flower,'#e8af55',0,0,.032,size*.42,size*.42,.018);
    petal(flower,'#7ea27b',.054,-.024,-.006,.047,.019,.011,-.45);
  }
}
function halo(parent,c) {
  const ring=at(parent,0,1.723,-.035,.20,0,-.035);
  ringAround(ring,.526,.399,0,.030,c,0,'metal');
  ringAround(ring,.513,.385,.014,.009,pale(c,.62),0,'metal');
  for(const [x,y,z,r] of [[-.519,.044,.132,.060],[.384,-.038,.286,.039],[.506,.036,-.069,.028]]){
    const glint=at(ring,x,y,z,-.17,0);plate(glint,starPoints(r,.30,4),.012,pale(c,.64),{bevel:.001,surface:'gloss'});
  }
}
function flight(parent,c) {
  capShell(parent,c,.826);
  capSeams(parent,pale(c,.27));
  hatband(parent,.803,.718,.598,.079,dark(c,.43));
  for(const s of [-1,1]){
    const flap=at(parent,s*.672,.646,-.013,.05,s*1.37,-s*.079);
    const outline=[[-.207,.251],[.171,.237],[.151,.119],[.109,-.106],[.086,-.225],[.029,-.267],[-.067,-.244],[-.126,-.143],[-.179,.011]];
    plate(flap,outline,.067,'#dfc6a3',{bevel:.025});
    const cover=plate(flap,outline.map(([x,y])=>[x*.90,y*.925]),.057,c,{bevel:.017});
    cover.position.z=.031;
    const disc=oval(flap,dark(c,.56),[.012,-.164,.072],[.035,.035,.013],null,'metal',true);
    disc.rotation.z=.17;
  }
  const front=at(parent,0,.922,.575,-.13);
  patch(front,pale(c,.33),[0,0,0],[.235,.090,.020],.025);
  for(const s of [-1,1])cord(front,[[0,.004,.014],[s*.04,.014,.018],[s*.080,.023,.014]],.007,'#e4cfaa',{steps:5,sides:5});
}
function bowMesh(parent,c,size=1) {
  const bow=group(parent);bow.scale.setScalar(size);
  for(const s of [-1,1]){
    const wing=at(bow,s*.121,.018,-.004,0,s*.17,s*.11);
    const shape=[[-.125,-.018],[-.092,-.085],[.085,-.123],[.118,-.086],[.126,.100],[.106,.131],[-.084,.069]];
    plate(wing,shape.map(([x,y])=>[s*x,y]),.055,c,{bevel:.020});
    cord(wing,[[-s*.083,.001,.041],[s*.002,.013,.043],[s*.074,.046,.038]],[.004,.010,.002],dark(c,.27),{steps:6,sides:5});
  }
  patch(bow,dark(c,.16),[0,.021,.022],[.098,.126,.077],.037,[0,0,-.035]);
  return bow;
}
function ribbon(parent,c) {
  headband(parent,dark(c,.27),.021);
  const knot=at(parent,-.425,1.341,.102,-.1,-.28,.40);
  bowMesh(knot,c,1.25);
  for(const s of [-1,1]){
    const tail=plate(knot,[[0,.020],[s*.070,.009],[s*.159,-.184],[s*.094,-.158],[s*.077,-.216],[-s*.008,-.032]],.028,dark(c,.11),{bevel:.008});
    tail.position.z=-.030;
  }
}
function horns(parent,c) {
  headband(parent,dark(c,.53),.024);
  for(const s of [-1,1]){
    const horn=at(parent,s*.478,1.245,-.017,0,0,-s*.06);
    const rows=[[-.077,.137,.131,0,0],[0,.141,.137,0,0],[.097,.119,.117,-.009,s*.035],[.188,.087,.081,-.042,s*.093],[.260,.049,.048,-.088,s*.141],[.299,.020,.022,-.126,s*.163],[.305,.004,.005,-.155,s*.164]];
    profile(horn,rows,c,{segments:24});
    profile(horn,[[.009,.143,.138,.000,s*.002],[.022,.144,.139,-.002,s*.005],[.037,.137,.132,-.002,s*.009]],dark(c,.27),{segments:24});
    profile(horn,[[.082,.125,.124,-.007,s*.032],[.095,.124,.122,-.009,s*.036],[.103,.117,.116,-.012,s*.042]],pale(c,.16),{segments:24});
  }
}
const headwearBuilders={
  'club-cap':baseball,bucket,'trail-hat':trail,beret,spellhat:sorcerer,toadstool:mushroom,crown,
  'cat-ears':ears,'sun-visor':visor,flowers:wreath,halo,'aviator-cap':flight,'silk-bow':ribbon,horns
};
const shortHair=new Set(['bald','buzz','cornrows','chignon']);
const fullHair=new Set(['curls','coils','quiff','victory','puffs','buns']);
const bands=new Set(['cat-ears','silk-bow','horns']);
const crownFits={short:[-.012,.96,.95],medium:[.150,1.025,1.083],full:[.209,1.041,1.095],afro:[.375,1.120,1.138]};
const flowerFits={short:[0,.94,.93],medium:[.033,1.043,1.111],full:[.063,1.086,1.168],afro:[.095,1.224,1.225]};
export function drawHeadwear(head,id,color,hair='swoop') {
  const build=headwearBuilders[id];
  if(!build)return;
  let support=head;
  if(id==='crown' || id==='flowers') {
    let volume='medium';
    if(hair==='afro')volume='afro';
    else if(shortHair.has(hair))volume='short';
    else if(fullHair.has(hair))volume='full';
    const [rise,width,depth]=(id==='crown' ? crownFits : flowerFits)[volume];
    support=group(head,0,rise,0);support.scale.set(width,1,depth);
  } else if(id==='halo') {
    const rise=hair==='mohawk'||hair==='topknot' ? .31 : hair==='afro'||fullHair.has(hair) ? .16 : 0;
    support=group(head,0,rise,0);
  } else if(bands.has(id)) {
    if(hair==='afro') {
      support=group(head,0,.19,.014);support.scale.set(1.10,1,1.06);
    } else if(shortHair.has(hair)) {
      support=group(head,0,hair==='bald' ? -.088 : -.060,0);support.scale.x=.975;
    }
  }
  build(support,color);
}

function smoothOutline(points,steps=42) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],0)),true,'catmullrom',.35);
  return Array.from({length:steps},(_,i)=>{const p=curve.getPoint(i/steps);return [p.x,p.y];});
}
function eyewire(head,s,c,thickness=.014) {
  const pts=[[s*.450,.619,.540],[s*.544,.622,.451],[s*.644,.620,.294],[s*.697,.603,.085],[s*.684,.550,-.039]];
  cord(head,pts,thickness,c,{sides:7,steps:16,surface:'metal'});
  cord(head,pts.slice(-3),[thickness,thickness*1.32,thickness*.76],dark(c,.38),{sides:7,steps:9});
}
function noseBridge(head,c,high=false) {
  const h=high ? .040 : 0;
  cord(head,[[-.111,.589+h,.593],[-.067,.619+h,.625],[0,.637+h,.631],[.067,.619+h,.625],[.111,.589+h,.593]],.013,c,{steps:13,sides:7,surface:'metal'});
}
function lensAnchor(head,s) {
  return at(head,s*.258,.579,faceZ(.258,.579)+.090,0,s*.29,s*.015);
}
function lensFrame(anchor,outline,c,{openX=.85,openY=.81,tinted=null,wire=false}={}) {
  const hole=outline.map(([x,y])=>[x*openX,y*openY]);
  plate(anchor,outline,wire ? .014 : .025,c,{bevel:wire ? .002 : .0035,surface:wire?'metal':'gloss',hole});
  if(tinted) {
    const glass=plate(anchor,outline.map(([x,y])=>[x*.961,y*.957]),.010,tinted,{bevel:.002,surface:'gloss'});
    glass.position.z=-.008;
    cord(anchor,[[-.111,.034,.003],[-.087,.063,.008],[-.044,.076,.011]], [.002,.007,.001],
      tint(tinted,'#def5ef',.57),{steps:9,sides:5,surface:'gloss'});
  }
}
function heartPoints(w,h) {
  const out=[];
  for(let i=0;i<46;i++) {
    const t=TAU*i/46, sy=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);
    out.push([w*Math.sin(t)**3,h*(sy+2)/17]);
  }
  return out;
}
function traditionalGlasses(head,id,c) {
  const metal=id==='round'||id==='aviators';
  for(const side of [-1,1]) {
    const lens=lensAnchor(head,side);
    let shape,options;
    switch(id) {
      case 'round':
        shape=ellipsePoints(.174,.170);options={openX:.896,openY:.885,wire:true};break;
      case 'square':
        shape=ellipsePoints(.206,.142,.48,40);options={openX:.842,openY:.786};break;
      case 'cat-eye':
        shape=smoothOutline([[-.178,.010],[-.131,.085],[-.014,.119],[.102,.137],[.225,.180],[.215,.114],[.159,-.049],[.050,-.119],[-.075,-.109],[-.157,-.059]])
          .map(([x,y])=>[x*side,y]);
        options={openX:.805,openY:.750};break;
      case 'aviators':
        shape=smoothOutline([[-.159,.083],[-.125,.123],[-.035,.146],[.096,.140],[.185,.080],[.187,-.014],[.112,-.123],[.027,-.166],[-.063,-.162],[-.128,-.100]])
          .map(([x,y])=>[x*side,y]);
        options={openX:.91,openY:.903,tinted:tint('#464655',c,.11),wire:true};break;
      case 'star-glasses':
        shape=starPoints(.205,.55,5);options={openX:.79,openY:.79,tinted:tint('#534357',c,.12)};break;
      case 'heart-glasses':
        shape=heartPoints(.197,.151);options={openX:.79,openY:.78,tinted:tint('#694253',c,.14)};break;
      case 'cinema':
        shape=ellipsePoints(.196,.129,.49,36);options={openX:.807,openY:.758,tinted:side<0?'#bb5056':'#3f9caf'};break;
    }
    lensFrame(lens,shape,c,options);
    eyewire(head,side,metal?dark(c,.13):c,metal ? .014 : .019);
    if(!metal && id!=='star-glasses' && id!=='heart-glasses') {
      oval(lens,pale(c,.63),[side*.174,.050,.014],[.012,.010,.007],null,'metal',true);
    }
    if(id==='cat-eye'){
      const corner=at(lens,side*.163,.106,.015);
      plate(corner,starPoints(.027,.31,4),.004,pale(c,.65),{bevel:.001,surface:'metal'});
    }
  }
  noseBridge(head,c);
  if(id==='aviators')cord(head,[[-.13,.680,.592],[-.056,.694,.601],[.056,.694,.601],[.13,.680,.592]],.009,c,{steps:11,sides:7,surface:'metal'});
}
function strapAround(parent,color,height,width,tilt=0) {
  mesh(parent,geometryGrid(48,4,(u,v,j)=>{
    const a=u*TAU;
    const edge=[.004,.012,.014,.012,.004][j],dy=[-.50,-.40,0,.40,.50][j]*width;
    return [(.686+edge)*Math.sin(a),height+dy+tilt*Math.sin(a),(.584+edge)*Math.cos(a)-.005];
  }),color);
}
function wrapGlasses(parent,c) {
  strapAround(parent,dark(c,.58),.590,.085);
  const width=.560;
  function band(low,high,front,color,surface) {
    const g=geometryGrid(36,3,(u,v)=>{
      const x=(u*2-1)*width,bend=Math.abs(x/width);
      const y=.579+Math.sin(bend*PI*.60)*.042+low*(1-v)+high*v;
      return [x,y,faceZ(x,y)+.089+front+.014*Math.cos(bend*PI/2)];
    },false);
    return mesh(parent,g,color,surface);
  }
  band(-.105,.103,0,dark(c,.54),'gloss');
  band(.072,.117,.006,c,'metal');
  band(-.105,-.087,.005,pale(c,.24),'metal');
  for(const side of [-1,1]){
    const wing=at(parent,side*.540,.636,.452,0,side*.82,-side*.05);
    patch(wing,dark(c,.32),[0,-.016,0],[.116,.162,.048],.034);
    patch(wing,pale(c,.33),[0,0,.028],[.068,.020,.007],.006);
    eyewire(parent,side,dark(c,.42),.026);
  }
  cord(parent,[[-.378,.589,.582],[-.295,.610,.613],[-.194,.622,.636]],[.002,.010,.001],pale(c,.59),{steps:10,sides:6});
}
function onePatch(parent,c) {
  strapAround(parent,dark(c,.32),.690,.053,.158);
  const eye=lensAnchor(parent,-1);
  eye.rotation.z=-.1;
  const p=smoothOutline([[-.179,.074],[-.120,.125],[.015,.138],[.154,.091],[.171,.024],[.103,-.092],[0,-.139],[-.102,-.112],[-.166,-.047]],34);
  plate(eye,p,.036,c,{bevel:.012});
  const stitched=p.map(([x,y])=>[x*.84,y*.80,.029]);
  loop(eye,stitched,.004,pale(c,.28),'soft',36);
  oval(eye,pale(c,.32),[-.137,.069,.031],[.014,.014,.006],null,'metal',true);
}
function monocle(parent,c) {
  const eye=lensAnchor(parent,1);
  ringXY(eye,.157,.154,.014,c);
  const tab=at(eye,.122,-.108,.005);
  oval(tab,c,[0,0,0],[.033,.024,.021],null,'metal',true);
  cord(parent,[[.376,.466,.583],[.466,.385,.510],[.525,.272,.409],[.605,.252,.289],[.695,.341,.118],[.700,.466,.046]],
    .0065,c,{steps:25,sides:6,surface:'metal'});
  cord(eye,[[-.116,.064,0],[-.094,.096,.004],[-.061,.119,.003]],[.002,.005,.001],pale(c,.52),{steps:7,sides:5});
}
function workshopGoggles(parent,c) {
  strapAround(parent,dark(c,.47),.593,.111);
  for(const side of [-1,1]){
    const anchor=lensAnchor(parent,side);
    const outline=ellipsePoints(.211,.177,1,36);
    plate(anchor,outline,.055,dark(c,.44),{bevel:.014});
    const rim=at(anchor,0,0,.044);
    lensFrame(rim,ellipsePoints(.19,.163),c,{openX:.81,openY:.82,tinted:tint('#496776',c,.18),wire:false});
    for(const a of [.36,2.78,3.50,5.92]){
      oval(rim,pale(c,.62),[.169*Math.cos(a),.139*Math.sin(a),.017],[.012,.012,.007],null,'metal',true);
    }
    const clip=at(parent,side*.491,.590,.474,0,side*.55);
    patch(clip,c,[0,0,0],[.094,.139,.042],.026);
  }
  cord(parent,[[-.087,.609,.607],[-.04,.642,.648],[0,.650,.652],[.04,.642,.648],[.087,.609,.607]],.030,dark(c,.32),{steps:10,sides:7});
}
export function drawEyewear(head,id,color) {
  switch(id) {
    case 'wrap-visor': wrapGlasses(head,color);break;
    case 'eye-patch': onePatch(head,color);break;
    case 'monocle': monocle(head,color);break;
    case 'goggles': workshopGoggles(head,color);break;
    case 'round':case 'square':case 'cat-eye':case 'aviators':case 'star-glasses':case 'heart-glasses':case 'cinema':
      traditionalGlasses(head,id,color);break;
  }
}

function jewel(parent,color,pos,radius) {
  const gem=mesh(parent,new THREE.OctahedronGeometry(radius,0),color,'gloss');
  gem.scale.set(1,1.18,.66);gem.position.fromArray(pos);gem.rotation.y=PI/4;
  return gem;
}
function earPin(anchor,c) {
  oval(anchor,pale(c,.28),[0,0,.004],[.036,.036,.027],null,'metal',true);
  oval(anchor,c,[0,0,.025],[.023,.023,.014],null,'gloss',true);
}
function crescentPoints() {
  const shape=new THREE.Shape();
  shape.moveTo(.053,.091);
  shape.bezierCurveTo(-.069,.121,-.126,-.017,-.065,-.077);
  shape.bezierCurveTo(-.031,-.113,.044,-.109,.089,-.056);
  shape.bezierCurveTo(.018,-.093,-.047,-.032,-.039,.035);
  shape.bezierCurveTo(-.033,.067,.002,.095,.053,.091);
  return shape.getPoints(9).map(p=>[p.x,p.y]);
}
function drawEar(anchor,id,c,side) {
  if(id==='studs'){
    oval(anchor,pale(c,.59),[0,-.002,.006],[.066,.068,.027],null,'metal',true);
    jewel(anchor,c,[0,0,.023],.064);
    return;
  }
  if(id==='cuffs'){
    const pos=at(anchor,side*.002,.042,-.006,0,side*.58,side*.28);
    for(const [x,y,r] of [[0,.014,.062],[side*.014,.069,.054],[side*.015,.114,.043]]){
      const hoop=at(pos,x,y,0,.72,side*.18);
      ringXY(hoop,r,r*.70,.012,c);
    }
    earPin(anchor,c);
    return;
  }
  earPin(anchor,id==='pearl-drops'?GOLD:c);
  if(id==='hoops'){
    const hoop=at(anchor,side*.022,-.099,.008,0,side*.30,side*.09);ringXY(hoop,.067,.099,.015,c);
    return;
  }
  const metal=id==='bolts'||id==='star-drops'||id==='pearl-drops'?GOLD:SILVER;
  const jump=at(anchor,0,-.044,.017,0,side*.13);
  ringXY(jump,.020,.031,.007,metal);
  const drop=at(anchor,side*.008,-.143,.017,-.04,side*.10,side*.08);
  switch(id){
    case 'star-drops':
      plate(drop,starPoints(.089,.47),.020,c,{bevel:.005,surface:'metal'});
      plate(at(drop,0,0,.017),starPoints(.039,.45),.005,pale(c,.44),{bevel:.001,surface:'metal'});
      break;
    case 'pearl-drops':
      profile(drop,[[-.110,.003,.003],[-.098,.037,.030],[-.074,.055,.049],[-.027,.057,.051],[.025,.040,.033],[.069,.017,.016],[.078,.006,.006]],c,{segments:21,surface:'gloss'});
      oval(drop,GOLD,[0,.066,0],[.023,.023,.018],null,'metal',true);break;
    case 'bolts':
      plate(drop,[[-.014,.088],[.056,.085],[.017,.018],[.062,.018],[-.053,-.128],[-.019,-.028],[-.066,-.025]],.026,c,{bevel:.006,surface:'metal'});break;
    case 'tassels': {
      oval(drop,metal,[0,.060,0],[.037,.041,.029],null,'metal',true);
      for(let k=0;k<7;k++){
        const a=TAU*k/7;
        cord(drop,[[.018*Math.sin(a),.041,.015*Math.cos(a)],[.030*Math.sin(a),-.017,.023*Math.cos(a)],[.042*Math.sin(a),-.102-.020*Math.cos(a*2),.029*Math.cos(a)]],
          [.010,.014,.006],k%3===0?pale(c,.20):c,{steps:6,sides:5});
      }
      break;
    }
    case 'crescents': {
      const moon=plate(drop,crescentPoints(),.024,c,{bevel:.0035,surface:'metal'});
      moon.rotation.z=-side*.17;
      break;
    }
  }
}
export function drawEarrings(head,id,color) {
  if(!id||id==='none')return;
  for(const side of [-1,1]){
    const ear=at(head,side*.708,.395,.086,0,side*.34,-side*.035);
    drawEar(ear,id,color,side);
  }
}

function neckBand(chest,c,rx=.231,rz=.185) {
  profile(chest,[[.832,rx*.97,rz*.97,.008],[.850,rx,rz,.011],[.901,rx*.98,rz*.97,.008],[.911,rx*.93,rz*.91,.007]],c,{segments:36});
}
function necklacePoint(a,drop) {
  const front=Math.max(0,Math.cos(a)),s=Math.sin(a);
  return [(.257+.040*front)*s,.911-drop*(front**1.42)-.054*s*s,(.203+.064*front)*Math.cos(a)+.013];
}
function chain(chest,drop,c,width=.010) {
  const points=Array.from({length:40},(_,i)=>necklacePoint(TAU*i/40,drop));
  loop(chest,points,width,c,'metal',48);
  return [0,.911-drop,.280];
}
function bandana(chest,c) {
  const pleat=geometryGrid(48,6,(u,v)=>{
    const a=u*TAU,f=Math.max(0,Math.cos(a)),outer=.774-.251*f**7+.013*Math.cos(3*a);
    const rx=.253+(1-v)*(.054+.034*f),rz=.190+(1-v)*(.044+.060*f);
    return [rx*Math.sin(a),outer+( .941-outer)*v,(rz+.005*Math.sin(v*PI*2+2*a))*Math.cos(a)+.010];
  });
  mesh(chest,pleat,c);
  neckBand(chest,pale(c,.10),.253,.199);
  const hem=[];
  for(let i=0;i<44;i++){
    const a=TAU*i/44,f=Math.max(0,Math.cos(a));
    hem.push([(.308+.034*f)*Math.sin(a),.785-.238*f**7+.013*Math.cos(3*a),(.237+.060*f)*Math.cos(a)+.012]);
  }
  loop(chest,hem,.006,pale(c,.50),'soft',58);
  for(const [x,y,sz] of [[-.119,.75,.016],[.033,.665,.014],[.143,.808,.015],[-.045,.819,.014]]){
    const motif=at(chest,x,y,.287-.030*Math.abs(x/.15),-.20,x*.62);
    plate(motif,starPoints(sz,.44,4),.003,pale(c,.51),{bevel:0});
  }
  const knot=at(chest,-.114,.868,-.193,0,PI,-.30);
  bowMesh(knot,c,.41);
}
function scarf(chest,c) {
  const rows=[[.793,.230,.174],[.817,.272,.211],[.849,.280,.216],[.885,.264,.206],[.920,.258,.202],[.952,.224,.176],[.961,.190,.153]];
  profile(chest,rows.map(([y,x,z])=>[y,x,z,.007]),c,{segments:42});
  const seam=[];
  for(let i=0;i<40;i++){
    const a=TAU*i/40;seam.push([.270*Math.sin(a),.866+.027*Math.sin(a+.3),.211*Math.cos(a)+.009]);
  }
  loop(chest,seam,.009,dark(c,.27),'soft',46);
  const tail=(side,long)=>{
    const q=at(chest,side*.109,.813,.199,0,side*.23,side*.16);
    const outline=[[-.068,.035],[.075,.046],[.085,-.115],[.062,-long],[.016,-long-.024],[-.044,-long-.018],[-.083,-long+.007],[-.063,-.137]];
    const scarfTail=plate(q,outline,.042,c,{bevel:.009});scarfTail.rotation.x=-.24;
    const baseZ=.024+long*.230;
    patch(q,pale(c,.43),[.002,-long+.032,baseZ-.004],[.126,.022,.006],.003,[-.24,0,0]);
    for(const x of [-.043,-.015,.014,.042]){
      cord(q,[[x,-long+.002,baseZ-.017],[x+side*.005,-long-.034,baseZ-.013],[x+side*.008,-long-.050,baseZ-.012]],.008,pale(c,.28),{steps:5,sides:5});
    }
  };
  tail(-1,.365);tail(1,.214);
}
function bowTie(chest,c) {
  neckBand(chest,dark(c,.30));
  const bow=at(chest,0,.862,.218,-.13,0,-.035);bowMesh(bow,c,.82);
}
function silkTie(chest,c) {
  neckBand(chest,dark(c,.38));
  const path=[[.293,.012,.273],[.367,.064,.278],[.635,.041,.275],[.752,.032,.240],[.813,.030,.209]];
  // Each section lies at the depth of the upper garment, so the tie drapes against it.
  const g=geometryGrid(4,path.length-1,(u,v,j)=>{
    const [y,width,z]=path[j],x=(u*2-1)*width;
    return [x,y,z+.011*(1-Math.abs(2*u-1))];
  },false);
  mesh(chest,g,c);
  for(const side of [-1,1])cord(chest,path.map(([y,width,z])=>[side*width,y,z]),.0045,dark(c,.20),{steps:13,sides:5});
  const knot=at(chest,0,.839,.220,-.21);
  plate(knot,[[-.059,.042],[.057,.042],[.043,-.009],[.022,-.040],[-.019,-.040],[-.041,-.012]],.047,dark(c,.15),{bevel:.007});
  for(const y of [.424,.483]){
    const q=at(chest,0,y,.288);patch(q,pale(c,.32),[0,0,0],[.085,.015,.004],.002,[0,0,.32]);
  }
}
function dogTags(chest,c) {
  const pos=chain(chest,.359,pale(c,.28),.0095);
  const hanger=at(chest,pos[0],pos[1]-.014,pos[2],-.06);
  ringXY(hanger,.022,.026,.006,SILVER);
  for(const side of [-1,1]){
    const tag=at(hanger,side*.039,-.086,side*.013,0,side*.08,side*.25);
    patch(tag,side<0?dark(c,.24):c,[0,0,0],[.089,.147,.015],.021,null,'metal');
    oval(tag,INK,[0,.051,.012],[.008,.009,.004],null,'soft',true);
    for(let i=0;i<2;i++)patch(tag,pale(c,.50),[-.003,-.007-i*.019,.011],[.052-i*.012,.006,.003],.001);
  }
}
function pendant(chest,c) {
  const p=chain(chest,.324,GOLD,.008);
  const setting=at(chest,p[0],p[1]-.046,p[2]+.008);
  ringXY(at(setting,0,.026,0),.020,.030,.006,GOLD);
  const gem=jewel(setting,c,[0,-.068,.004],.080);gem.scale.set(.86,1.29,.50);
  const edge=plate(setting,[[0,.041],[.050,-.023],[.030,-.031],[0,-.005],[-.031,-.032],[-.051,-.023]],.018,GOLD,{bevel:.003,surface:'metal'});
  edge.position.set(0,-.011,.026);
}
function beadCollar(chest,c) {
  const drop=.181;
  chain(chest,drop,dark(c,.39),.007);
  for(let i=0;i<22;i++){
    const a=TAU*i/22,p=necklacePoint(a,drop),r=.026+.011*Math.max(0,Math.cos(a));
    const shade=i%5===0?CREAM:i%2===0?pale(c,.25):c;
    oval(chest,shade,p,[r,r*.95,r],null,'gloss',true);
  }
}
function locket(chest,c) {
  const p=chain(chest,.311,dark(c,.24),.009);
  const mount=at(chest,p[0],p[1]-.100,p[2]+.012,-.05);
  ringXY(at(mount,0,.079,0),.018,.028,.006,GOLD);
  oval(mount,c,[0,0,0],[.080,.080,.025],null,'metal');
  oval(mount,'#ece2c1',[0,0,.022],[.061,.061,.009],null,'soft',true);
  ringXY(at(mount,0,0,.023),.066,.066,.006,pale(c,.32));
  const needle=at(mount,0,0,.033,0,0,-.47);
  plate(needle,[[0,.050],[.017,0],[0,-.044],[-.016,0]],.006,dark(c,.57),{bevel:.001});
  plate(at(needle,0,.024,.004),[[0,.025],[.016,-.024],[-.016,-.024]],.003,'#c77a68',{bevel:.0005});
}
const neckwearBuilders={bandana,scarf,'bow-tie':bowTie,tie:silkTie,tags:dogTags,crystal:pendant,beads:beadCollar,compass:locket};
export function drawNeckwear(chest,id,color) {neckwearBuilders[id]?.(chest,color);}
