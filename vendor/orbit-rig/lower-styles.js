import {
  THREE, PI, TAU, CREAM, group, mesh, oval, profile, patch, strand, cord,
  geometryGrid, signedPow, tint, dark, pale
} from './model-kit.js';

export const bottoms = [
  {id:'cargo',name:'Cargo pants',color:'#414351'},
  {id:'jeans',name:'Cuffed jeans',color:'#557998'},
  {id:'slacks',name:'Tailored slacks',color:'#695d70'},
  {id:'joggers',name:'Cloud joggers',color:'#9b91aa'},
  {id:'trackpants',name:'Track pants',color:'#2b6871'},
  {id:'wideleg',name:'Wide-leg denim',color:'#678ea8'},
  {id:'flares',name:'Bell-bottoms',color:'#94658d'},
  {id:'shorts',name:'Chino shorts',color:'#c09a69'},
  {id:'boardshorts',name:'Board shorts',color:'#599aaa'},
  {id:'pleats',name:'Tennis skirt',color:'#b59bc8'},
  {id:'kilt',name:'Tartan kilt',color:'#637f72'},
  {id:'leggings',name:'Studio leggings',color:'#705987'},
  {id:'bloomers',name:'Gathered bloomers',color:'#aa7f90'},
  {id:'wrapskirt',name:'Wrap skirt',color:'#b86968'},
  {id:'riding',name:'Riding breeches',color:'#aa8e6a'}
];
export const shoes = [
  {id:'sneakers',name:'Orbit sneakers',color:'#464554'},
  {id:'hightops',name:'Canvas high-tops',color:'#b55c62'},
  {id:'combat',name:'Lace-up boots',color:'#51494f'},
  {id:'loafers',name:'Penny loafers',color:'#80574b'},
  {id:'runners',name:'Retro runners',color:'#72979b'},
  {id:'sandals',name:'Strap sandals',color:'#ab7954'},
  {id:'skate',name:'Skate shoes',color:'#747396'},
  {id:'maryjanes',name:'Mary Janes',color:'#985d78'},
  {id:'chelsea',name:'Chelsea boots',color:'#6e5454'},
  {id:'moonboots',name:'Moon boots',color:'#aaaec8'},
  {id:'moccasins',name:'Moccasins',color:'#b18560'},
  {id:'ballet',name:'Bow flats',color:'#c48d97'},
  {id:'westernboots',name:'Western boots',color:'#92684f'}
];

const CARGO='#414351', SNEAKER='#464554', SKIN='#e5ac80';
const RUBBER='#ebe4d5', GOLD='#d5ad71', METAL='#bbc2c5';
const pantOptions={segments:28,power:.86};
const fine={sides:6,steps:8};
const skirtKinds=new Set(['pleats','kilt','wrapskirt']);

// A stripe uses the same section radii as the garment, so its ends stay
// attached to each animated thigh and calf when the knee bends.
function surfaceStrip(parent,rows,angle,angleWidth,color,power=.86) {
  const geom=geometryGrid(4,rows.length-1,(u,v,j)=>{
    const [y,rx,rz,cz=0,cx=0]=rows[j];
    const a=angle+(u-.5)*angleWidth;
    return [
      cx+(rx+.003)*signedPow(Math.sin(a),power),
      y,cz+(rz+.003)*signedPow(Math.cos(a),power)
    ];
  },false);
  mesh(parent,geom,color);
}

function waistband(pelvis,color) {
  profile(pelvis,[[.036,.299,.174],[.048,.316,.187],[.091,.319,.19],[.105,.307,.182]],
    color,{segments:32,power:.85});
}
function belt(pelvis,color,buckle=GOLD) {
  waistband(pelvis,color);
  patch(pelvis,buckle,[0,.068,.197],[.091,.049,.011],.009,null,'metal');
  patch(pelvis,color,[.003,.068,.206],[.059,.024,.004],.005);
  for(const side of [-1,1]) {
    patch(pelvis,dark(color,.10),[side*.219,.071,.148],[.028,.071,.019],.006,[0,side*.50,0]);
  }
}
function drawstring(pelvis,color) {
  for(const side of [-1,1]) {
    oval(pelvis,'#686065',[side*.039,.047,.19],[.013,.012,.006],null,'metal',true);
    cord(pelvis,[[side*.039,.05,.191],[side*.030,.016,.204],[side*.045,-.032,.19],[side*.061,-.060,.172]],
      [.006,.009,.008,.005],color,fine);
  }
}

function skirtPoint(id,u,v,offset=0) {
  const angle=u*TAU, isWrap=id==='wrapskirt', isTennis=id==='pleats';
  const lowerY=isWrap?-.43+.085*Math.sin(angle+.25):isTennis?-.36:-.43;
  const linearX=(isTennis ? .485:isWrap ? .449:.458)*(1-v)+.303*v;
  const linearZ=(isTennis ? .295:isWrap ? .302:.283)*(1-v)+.184*v;
  const folds=isTennis?18:id==='kilt'?14:7;
  const crest=(1+Math.cos(folds*angle+v*(isWrap ? .62:.14)))*.5;
  const fold=(isWrap ? .018:.036)*(1-v)**.78*crest;
  return [(linearX+fold+offset)*Math.sin(angle),lowerY*(1-v)+.110*v,
    (linearZ+fold*.74+offset)*Math.cos(angle)];
}
function skirtRibbon(pelvis,id,a0,a1,v0,v1,color,bump=.004) {
  const span=Math.abs(a1-a0);
  const n=Math.max(6,Math.ceil(span*105));
  mesh(pelvis,geometryGrid(n,2,(u,v)=>skirtPoint(id,a0+u*(a1-a0),v0+(v1-v0)*v,bump),span>=.999),color);
}
function drawSkirt(pelvis,id,col) {
  const detailed=id==='kilt', uCount=detailed?144:96, vCount=detailed?30:7;
  const geom=geometryGrid(uCount,vCount,(u,v)=>skirtPoint(id,u,v));
  if(detailed) {
    const rgb=new Float32Array((uCount+1)*(vCount+1)*3);
    const base=new THREE.Color(col), ink=new THREE.Color(dark(col,.58));
    const gold=new THREE.Color(tint(col,'#d7be8f',.36)), mixed=new THREE.Color();
    for(let j=0;j<=vCount;j++) for(let i=0;i<=uCount;i++) {
      const vertical=i%18, horizontal=j%10;
      const broad=(vertical<7 ? .46:0)+(horizontal<4 ? .30:0);
      mixed.copy(base).lerp(ink,broad);
      if(vertical===11||horizontal===6)mixed.lerp(gold,.65);
      mixed.toArray(rgb,3*(j*(uCount+1)+i));
    }
    geom.setAttribute('color',new THREE.BufferAttribute(rgb,3));
  }
  mesh(pelvis,geom,col);
  if(id==='pleats') {
    skirtRibbon(pelvis,id,0,1,.045,.080,CREAM);
    skirtRibbon(pelvis,id,0,1,.118,.145,pale(col,.48));
    waistband(pelvis,dark(col,.18));
  } else if(id==='kilt') {
    belt(pelvis,'#534842');
    // A curved front pouch and straps sit in front of the woven pleats.
    for(const s of [-1,1]) {
      cord(pelvis,[[s*.193,.038,.153],[s*.139,-.017,.207],[s*.074,-.076,.225]],.009,GOLD,fine);
    }
    oval(pelvis,'#745846',[0,-.121,.238],[.100,.097,.027],null,'soft',true);
    oval(pelvis,'#4d4040',[0,-.083,.256],[.1,.044,.018],null,'soft',true);
    for(const x of [-.045,0,.045]) {
      cord(pelvis,[[x,-.126,.264],[x,-.164,.267],[x,-.201,.26]],[.009,.014,.006],GOLD,fine);
    }
  } else {
    waistband(pelvis,dark(col,.26));
    const seam=[];
    for(let i=0;i<=8;i++) {
      const v=i/8, u=(-.105+.262*v);
      seam.push(skirtPoint(id,u,v,.008));
    }
    cord(pelvis,seam,[.007,.011,.008],pale(col,.25),{sides:6,steps:18});
    const bow=group(pelvis,.279,.03,.165);
    oval(bow,pale(col,.18),[.017,0,0],[.059,.023,.016],[0,0,.32],'soft',true);
    cord(bow,[[.016,0,0],[.03,-.04,.015],[.055,-.094,.030]],[.015,.017,.005],pale(col,.2),fine);
    cord(bow,[[.004,-.003,.005],[-.014,-.050,.021],[-.010,-.133,.043]],[.014,.016,.005],pale(col,.2),fine);
  }
}

export function drawWaist(pelvis,id,col=CARGO,skin=SKIN) {
  profile(pelvis,[[-.151,.110,.071],[-.120,.230,.132],[-.054,.287,.170],
    [.078,.310,.182],[.137,.295,.173],[.149,.176,.096]],skirtKinds.has(id)?dark(col,.40):col,{power:.87});
  if(skirtKinds.has(id)){drawSkirt(pelvis,id,col);return;}
  if(id==='cargo')return;
  if(['slacks','riding','shorts'].includes(id)) {
    belt(pelvis,id==='riding'?'#73543d':dark(col,.68),id==='slacks'?METAL:GOLD);
  } else {
    waistband(pelvis,dark(col,id==='jeans'||id==='wideleg' ? .13:.27));
    if(['joggers','boardshorts','trackpants','bloomers'].includes(id)) {
      drawstring(pelvis,id==='bloomers'?pale(col,.50):CREAM);
    } else if(['jeans','wideleg','flares'].includes(id)) {
      oval(pelvis,GOLD,[0,.061,.195],[.015,.015,.008],null,'metal',true);
      cord(pelvis,[[.010,.038,.183],[.023,.006,.179],[.011,-.043,.170]],.004,pale(col,.31),fine);
    }
  }
}

function cargoLeg(upper,knee,s,col) {
  const original=col.toLowerCase()===CARGO;
  const seam=original?'#555667':pale(col,.16);
  profile(upper,[[-.379,.131,.134],[-.341,.145,.144],[-.265,.158,.154],[-.158,.170,.165],[-.042,.172,.167],[.091,.151,.150],[.124,.050,.066]],col,{power:.83,segments:24});
  profile(knee,[[-.301,.109,.114],[-.274,.126,.131],[-.203,.132,.141],[-.110,.144,.147],[-.015,.146,.146],[.047,.135,.141],[.079,.106,.111]],col,{power:.85,segments:24});
  const p=group(upper,s*.146,-.180,.017);p.rotation.y=s*1.29;p.rotation.z=s*.036;
  patch(p,original?'#444753':pale(col,.035),[0,0,0],[.166,.144,.024],.020);
  patch(p,seam,[0,.036,.017],[.168,.060,.018],.011);
  cord(knee,[[s*.074,-.107,.133],[s*.025,-.126,.147],[-s*.064,-.14,.130]],
    [.002,.006,.001],seam,{sides:5,steps:8});
  profile(knee,[[-.289,.110,.113],[-.282,.129,.131],[-.224,.133,.136],[-.218,.122,.128]],
    original?'#353641':dark(col,.35),{segments:22});
}

function bareLeg(upper,knee,skin) {
  profile(upper,[[-.397,.084,.087],[-.363,.104,.106],[-.293,.122,.124],[-.17,.133,.134],
    [-.062,.144,.142],[.052,.128,.126],[.106,.046,.054]],skin,{segments:24});
  profile(knee,[[-.310,.083,.089],[-.272,.089,.091],[-.206,.102,.109,-.007],[-.124,.115,.122,-.013],
    [-.071,.111,.116,-.003],[-.008,.114,.116,.005],[.040,.10,.098],[.06,.076,.078]],skin,{segments:24});
}
function rolledHem(parent,y,rx,rz,col,depth=.038) {
  profile(parent,[[y-.004,rx*.88,rz*.88],[y,rx,rz],[y+.008,rx+.004,rz+.004],
    [y+depth,rx+.001,rz+.002],[y+depth+.004,rx*.95,rz*.95]],col,pantOptions);
}
function pocketArc(upper,s,col) {
  cord(upper,[[s*.016,-.016,.162],[s*.048,-.067,.165],[s*.092,-.096,.148],[s*.143,-.108,.108]],
    [.003,.007,.007,.002],col,{sides:5,steps:11});
}
function backPocket(upper,s,col,thread) {
  const p=group(upper,s*.021,-.111,-.158);
  p.rotation.y=PI-s*.18;
  patch(p,dark(col,.08),[0,0,.003],[.147,.122,.012],.015);
  cord(p,[[-.063,.035,.012],[-.062,-.029,.014],[0,-.051,.015],[.063,-.029,.014],[.063,.035,.012]],
    .004,thread,{sides:5,steps:11});
}
function shorts(upper,knee,s,id,color,skin) {
  bareLeg(upper,knee,skin);
  const board=id==='boardshorts', hem=board?-.363:-.267;
  const r=board ? .170:.159;
  const rows=[[hem,.143,.139],[hem+.009,r,.163],[hem+.045,r+.002,.164],
    [-.142,.173,.166],[-.026,.170,.168],[.082,.151,.146],[.116,.064,.067]];
  profile(upper,rows,color,pantOptions);
  if(board){
    surfaceStrip(upper,rows,s*1.22,.48,pale(color,.51));
    surfaceStrip(upper,rows,s*1.025,.075,dark(color,.31));
    rolledHem(upper,hem,r+.001,.164,dark(color,.17),.016);
    const label=group(upper,s*.130,hem+.073,.110);label.rotation.y=s*.72;
    patch(label,CREAM,[0,0,0],[.057,.029,.007],.006);
  }else{
    rolledHem(upper,hem,r+.006,.167,pale(color,.13),.047);
    pocketArc(upper,s,dark(color,.32));
    backPocket(upper,s,color,pale(color,.16));
  }
}
function kneeBloomers(upper,knee,s,col,skin) {
  bareLeg(upper,knee,skin);
  const rows=[[-.375,.123,.127],[-.344,.152,.151],[-.302,.171,.170],
    [-.229,.186,.184,0,s*.012],[-.13,.191,.182,0,s*.014],[-.045,.175,.167],[.078,.146,.146],[.11,.072,.075]];
  profile(upper,rows,col,pantOptions);
  profile(knee,[[-.071,.105,.106],[-.053,.136,.135],[-.011,.151,.151],[.046,.142,.146],[.08,.124,.127]],col,pantOptions);
  rolledHem(knee,-.076,.125,.128,dark(col,.25),.043);
  for(const a of [.46,.84,1.23]) {
    const ang=s*a;
    cord(upper,[[.164*Math.sin(ang),-.327,.159*Math.cos(ang)],[.180*Math.sin(ang),-.263,.178*Math.cos(ang)],
      [.184*Math.sin(ang),-.195,.184*Math.cos(ang)]],[.003,.006,.001],pale(col,.13),fine);
  }
  oval(knee,pale(col,.35),[s*.122,-.047,.033],[.027,.022,.014],null,'soft',true);
}

const fit = {
  jeans:      {hip:.169, knee:.15,  calf:.137, hem:.130,length:-.286},
  slacks:    {hip:.172, knee:.148, calf:.137, hem:.125,length:-.290},
  joggers:   {hip:.180, knee:.162, calf:.157, hem:.114,length:-.279},
  trackpants:{hip:.176, knee:.162, calf:.154, hem:.136,length:-.278},
  wideleg:   {hip:.182, knee:.182, calf:.187, hem:.191,length:-.314,spread:.018},
  flares:    {hip:.160, knee:.131, calf:.161, hem:.211,length:-.323,spread:.025},
  leggings:  {hip:.152, knee:.119, calf:.120, hem:.095,length:-.258},
  riding:    {hip:.200, knee:.137, calf:.121, hem:.107,length:-.282,spread:.008}
};
function pantsSections(shape,s) {
  const {hip,knee,calf,hem,length,spread=0}=shape;
  const upper=[[-.385,knee*.88,knee*.87,0,s*spread*.3],[-.348,knee,knee*.99,0,s*spread*.3],
    [-.254,hip*.94,hip*.92,0,s*spread*.55],[-.150,hip,hip*.98,0,s*spread*.62],
    [-.046,hip*.99,hip*.97,0,s*spread*.30],[.071,.152,.147],[.115,.078,.082]];
  const lower=[[length,.94*hem,.92*hem,0,s*spread],[length+.012,hem,hem*.98,0,s*spread],
    [length+.061,(hem+calf)*.5,(hem+calf)*.49,0,s*spread*.85],[-.120,calf,calf*1.02,-.006,s*spread*.48],
    [-.022,knee,knee*1.01,0,s*spread*.30],[.043,knee*.95,knee*.98,0,s*spread*.26],[.071,knee*.75,knee*.77]];
  return {upper,lower};
}
export function drawLeg(upper,knee,side,id,col=CARGO,skin=SKIN) {
  if(id==='cargo'){cargoLeg(upper,knee,side,col);return;}
  if(skirtKinds.has(id)){bareLeg(upper,knee,skin);return;}
  if(id==='shorts'||id==='boardshorts'){shorts(upper,knee,side,id,col,skin);return;}
  if(id==='bloomers'){kneeBloomers(upper,knee,side,col,skin);return;}
  const shape=fit[id];
  if(!shape){cargoLeg(upper,knee,side,col);return;}
  const rows=pantsSections(shape,side);
  profile(upper,rows.upper,col,pantOptions);profile(knee,rows.lower,col,pantOptions);
  const {length,hem}=shape;
  if(id==='jeans'||id==='wideleg') {
    const thread=tint(col,'#d7ac78',id==='jeans' ? .52:.29);
    pocketArc(upper,side,thread);backPocket(upper,side,col,thread);
    surfaceStrip(upper,rows.upper,side*1.27,.034,thread);
    surfaceStrip(knee,rows.lower,side*1.27,.034,thread);
    if(id==='jeans'){
      rolledHem(knee,length,hem+.007,hem+.004,pale(col,.22),.045);
      oval(upper,GOLD,[side*.112,-.084,.137],[.008,.008,.004],null,'metal',true);
    }else{
      surfaceStrip(knee,rows.lower,side*.51,.045,pale(col,.12));
    }
  } else if(id==='joggers') {
    rolledHem(knee,length-.001,.119,.120,dark(col,.29),.058);
    for(const y of [length+.010,length+.028])rolledHem(knee,y,.122,.122,pale(col,.08),.004);
    pocketArc(upper,side,dark(col,.3));
  } else if(id==='trackpants') {
    for(const [parent,section] of [[upper,rows.upper],[knee,rows.lower]]) {
      surfaceStrip(parent,section,side*1.10,.18,CREAM);
      surfaceStrip(parent,section,side*1.34,.083,pale(col,.64));
    }
    rolledHem(knee,length,.142,.136,dark(col,.25),.025);
  } else if(id==='slacks') {
    surfaceStrip(upper,rows.upper,side*.042,.057,pale(col,.095));
    surfaceStrip(knee,rows.lower,side*.042,.054,pale(col,.095));
    const p=group(upper,side*.049,-.06,-.158);p.rotation.y=PI-side*.25;
    patch(p,dark(col,.37),[0,0,0],[.145,.017,.006],.004);
    cord(upper,[[side*.071,-.018,.150],[side*.115,-.085,.131],[side*.146,-.133,.104]],
      [.003,.007,.002],dark(col,.27),fine);
  } else if(id==='flares') {
    const g=geometryGrid(4,rows.lower.length-1,(u,v,j)=>{
      const r=rows.lower[j], a=side*1.06+(u-.5)*(.02+.88*(1-v)**2);
      return [(r[4]||0)+(r[1]+.004)*signedPow(Math.sin(a),.86),r[0],(r[3]||0)+(r[2]+.004)*signedPow(Math.cos(a),.86)];
    },false);
    mesh(knee,g,tint(col,'#c4a695',.34));pocketArc(upper,side,pale(col,.27));
  } else if(id==='leggings') {
    surfaceStrip(upper,rows.upper,side*1.11,.54,dark(col,.29));
    surfaceStrip(knee,rows.lower,side*1.09,.56,dark(col,.29));
    for(const y of [-.214,-.177]) {
      cord(knee,[[side*.110,y,.030],[side*.086,y+.018,.086],[side*.045,y+.032,.110]],
        [.003,.007,.002],pale(col,.43),fine);
    }
  } else if(id==='riding') {
    oval(upper,tint(col,'#704737',.61),[side*.023,-.283,.126],[.097,.108,.021],[-.13,side*.09,side*.12],'soft',true);
    oval(knee,tint(col,'#704737',.56),[side*.022,-.035,.123],[.088,.076,.016],[.08,side*.1,side*.12],'soft',true);
    pocketArc(upper,side,dark(col,.40));
    rolledHem(knee,length,.111,.111,dark(col,.31),.035);
  }
}

function legacyShoe(ankle,s,col,accent) {
  const sole=[[-.198,.145,.205,.049],[-.191,.166,.232,.070],[-.173,.177,.246,.078],
    [-.117,.180,.251,.082],[-.097,.175,.243,.080]];
  profile(ankle,sole,'#ecdfc6',{power:.75,segments:32});
  profile(ankle,[[-.199,.001,.001,.056],[-.199,.144,.211,.063],[-.194,.166,.236,.071],
    [-.178,.173,.242,.075]],'#554f50',{power:.76,segments:30});
  profile(ankle,[[-.115,.175,.245,.080],[-.090,.177,.243,.079],[-.051,.170,.227,.072],
    [-.006,.160,.202,.060],[.050,.145,.159,.010],[.087,.127,.128,-.016],[.093,.099,.100,-.019]],
    col,{power:.82,segments:32});
  oval(ankle,'#d4c5b2',[0,-.075,.226],[.158,.053,.096],[.09,0,0]);
  patch(ankle,col.toLowerCase()===SNEAKER?'#6b6265':pale(col,.14),[0,-.018,.195],[.174,.135,.022],.045,[-.65,0,0]);
  for(let k=0;k<3;k++) {
    const y=-.053+k*.025,z=.230-k*.017;
    cord(ankle,[[-.066,y,z],[0,y+.008,z+.011],[.066,y,z]],[.006,.009,.006],CREAM,fine);
  }
  const side=group(ankle,s*.158,-.048,.061);side.rotation.y=s*PI/2;
  strand(side,[[-s*.082,-.025,.005],[-s*.032,-.007,.009],[s*.030,.024,.011],[s*.078,.035,.010]],
    [.007,.019,.018,.006],[.002,.007,.006,.002],pale(accent,.15),{steps:10});
  patch(ankle,pale(accent,.11),[0,.069,-.123],[.054,.071,.014],.008,[.10,0,0]);
}

const shoeOptions={power:.82,segments:32};
function sole(ankle,rx,rz,cz,top,color,edge,opts={}) {
  const power=opts.power||.78, edgeTop=opts.edgeTop||-.177;
  profile(ankle,[[-.198,.001,.001,cz],[-.198,rx*.88,rz*.89,cz],
    [-.191,rx*.95,rz*.96,cz], [edgeTop,rx,rz,cz],[top-.008,rx*1.008,rz,cz],
    [top,rx*.985,rz*.991,cz],[top,.004,.004,cz]],color,{segments:32,power});
  if(edge) profile(ankle,[[-.197,rx*.905,rz*.912,cz],[-.191,rx*.961,rz*.972,cz],
    [edgeTop+.001,rx*1.004,rz*1.004,cz]],edge,{segments:32,power});
}
function shell(ankle,rows,col,surface='soft') {
  profile(ankle,rows,col,{...shoeOptions,surface});return rows;
}
function radiusAt(rows,y) {
  if(y<=rows[0][0])return rows[0];
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1],b=rows[i];
    if(y>b[0])continue;
    const v=(y-a[0])/(b[0]-a[0]||1);
    return [y,a[1]+(b[1]-a[1])*v,a[2]+(b[2]-a[2])*v,
      (a[3]||0)+((b[3]||0)-(a[3]||0))*v];
  }
  return rows[rows.length-1];
}
function frontZ(rows,x,y,offset=.006) {
  const [,rx,rz,cz=0]=radiusAt(rows,y);
  const power=2/shoeOptions.power;
  return cz+rz*Math.max(.0001,1-Math.pow(Math.abs(x)/rx,power))**(1/power)+offset;
}
function onVamp(rows,xy,bump=.007) {
  return xy.map(([x,y])=>[x,y,frontZ(rows,x,y,bump)]);
}
function arcBand(ankle,rows,angle0,angle1,minY,maxY,col,offset=.004) {
  const geom=geometryGrid(24,4,(u,v)=>{
    const a=angle0+(angle1-angle0)*u;
    const y=minY+(maxY-minY)*v;
    const [,rx,rz,cz=0]=radiusAt(rows,y);
    return [(rx+offset)*signedPow(Math.sin(a),shoeOptions.power),y,
      cz+(rz+offset)*signedPow(Math.cos(a),shoeOptions.power)];
  },false);
  mesh(ankle,geom,col);
}
function laces(ankle,rows,low,high,count,width,color,{flat=false,eyelets=false}={}) {
  const step=(high-low)/count,rad=flat ? .011:.006;
  for(let k=0;k<count;k++) {
    const lo=low+k*step,hi=lo+step*.80;
    const w=width*(1-.11*k/count);
    if(flat){
      strand(ankle,onVamp(rows,[[-w,lo],[0,(lo+hi)/2+.004],[w,hi]],.012),
        [.009,.013,.009],[.005,.006,.004],color,fine);
    }else{
      for(const side of [-1,1]) {
        cord(ankle,onVamp(rows,[[side*-w,lo],[0,(lo+hi)/2], [side*w,hi]],side>0 ? .016:.008),
          [rad,rad*1.2,rad],color,fine);
      }
    }
    if(eyelets) for(const side of [-1,1]){
      const x=side*w, z=frontZ(rows,x,lo,.004);
      oval(ankle,METAL,[x,lo,z],[.012,.010,.005],[0,side*.24,0],'metal',true);
    }
  }
}
function vampStitch(ankle,rows,color,width=.108) {
  const line=[[-width,-.040],[-width*1.08,-.060],[-width*.86,-.083],[-width*.43,-.098],
    [0,-.104],[width*.43,-.098],[width*.86,-.083],[width*1.08,-.060],[width,-.040]];
  cord(ankle,onVamp(rows,line),.005,color,{sides:5,steps:20});
}
function backTab(ankle,y,z,color) {
  strand(ankle,[[0,y-.066,z],[0,y-.010,z-.018],[0,y+.022,z-.011],[0,y+.027,z+.009],[0,y-.005,z+.018]],
    [.016,.020,.020,.020,.016],[.006,.007,.007,.007,.006],color,{out:[0,0,-1],sides:6,steps:12});
}
function clothShoe(ankle,s,id,col,accent) {
  const tall=id==='hightops', chunky=id==='skate', rx=chunky ? .184:tall ? .172:.175;
  const bottom=tall?-.128:chunky?-.122:-.125;
  sole(ankle,rx,.245,.071,bottom,id==='runners'?'#e8e3d7':RUBBER,chunky?'#947a61':dark(col,.52));
  const rows=[ [bottom-.001,rx*.96,.238,.071],[-.095,rx,.231,.067],
    [-.061,rx*.98,.219,.056],[-.022,rx*.92,.183,.035],[.012,rx*.83,.150,.012],
    [.058,rx*.75,.128,-.010]];
  if(tall) rows.push([.136,.136,.130,-.013],[.166,.143,.136,-.012],[.173,.122,.113,-.012]);
  else if(chunky) rows.push([.084,.139,.136,-.012],[.091,.116,.109,-.014]);
  else rows.push([.071,.121,.115,-.012],[.079,.108,.103,-.012]);
  shell(ankle,rows,col);
  if(tall) {
    oval(ankle,CREAM,[0,-.076,.207],[.147,.047,.104],[.075,0,0]);
    arcBand(ankle,rows,-1.24,1.24,-.103,-.096,dark(col,.4));
    arcBand(ankle,rows,-PI,PI,.145,.161,pale(col,.25));
    laces(ankle,rows,-.038,.142,5,.070,CREAM,{eyelets:true});
    const p=group(ankle,s*.139,.077,-.040);p.rotation.y=s*PI/2;
    oval(p,CREAM,[0,0,0],[.048,.049,.008],null,'soft',true);
    patch(p,dark(col,.23),[0,0,.009],[.031,.031,.005],.004,[0,0,PI*.25]);
    backTab(ankle,.172,-.145,pale(col,.22));
  }else if(chunky){
    // The contrasting upper panels use the actual shoe surface.
    for(let row=0;row<2;row++){
      for(let k=0;k<5;k++) {
        if((row+k)%2)continue;
        const a=s>0 ? .69+k*.24:-1.89+k*.24;
        arcBand(ankle,rows,a,a+.24,-.09+row*.041,-.049+row*.041,CREAM);
      }
    }
    arcBand(ankle,rows,-1.12,1.12,-.11,-.10,dark(col,.26));
    laces(ankle,rows,-.052,.050,3,.083,CREAM,{flat:true});
    const tongue=group(ankle,0,.061,.115);
    patch(tongue,dark(col,.27),[0,0,0],[.118,.055,.012],.011,[-.31,0,0]);
    patch(tongue,pale(col,.35),[0,.008,.010],[.065,.011,.004],.003,[-.31,0,0]);
    backTab(ankle,.087,-.144,dark(col,.20));
  }else{
    arcBand(ankle,rows,-1.2,1.2,-.108,-.088,pale(col,.29));
    arcBand(ankle,rows,PI-.76,PI+.76,-.075,.026,dark(col,.36));
    const clip=group(ankle,s*.157,-.047,-.006);clip.rotation.y=s*1.32;
    strand(clip,[[-s*.109,-.036,.001],[-s*.048,-.008,.009],[s*.008,.016,.012],[s*.086,.004,0]],
      [.007,.025,.018,.003],[.003,.007,.007,.002],pale(col,.61),{steps:12,sides:7});
    strand(clip,[[-s*.073,-.041,.006],[-s*.016,-.019,.012],[s*.041,-.007,.011]],
      [.004,.011,.002],[.002,.004,.002],tint(col,accent,.55),fine);
    laces(ankle,rows,-.039,.054,4,.061,CREAM);
    for(const x of [-.047,0,.047]) {
      const y=-.061;
      oval(ankle,dark(col,.25),[x,y,frontZ(rows,x,y,.006)],[.006,.006,.003],null,'soft',true);
    }
    backTab(ankle,.076,-.130,pale(col,.51));
  }
}

function lugTread(ankle,s,col) {
  // Set into the edge of the sole, clear of the turntable.
  for(const z of [-.092,-.015,.066,.145,.212]) {
    const x=s*(.167-.04*Math.abs(z-.055)/.17);
    patch(ankle,col,[x,-.172,z],[.034,.033,.051],.007,[0,s*.05,0]);
  }
}
function boots(ankle,s,id,col,accent) {
  const ice=id==='moonboots', western=id==='westernboots', chelsea=id==='chelsea';
  const w=ice ? .194:western ? .159:.174;
  const z=western ? .250:ice ? .259:.239, cz=western ? .091:.067;
  const base=ice?-.114:western?-.15:-.143;
  const tread=ice?'#62647b':western?'#74533e':chelsea?'#4b4142':'#33313a';
  sole(ankle,w,z,cz,base,western?'#987350':ice?'#bcbac9':tread,dark(tread,.50));
  if(!western&&!chelsea)lugTread(ankle,s,dark(tread,.33));
  const rows=[
    [base-.002,w*.975,z*.98,cz],[-.10,w,z*.96,cz*.93],[-.065,w*.965,z*.91,cz*.84],
    [-.013,w*.89,z*.72,cz*.48],[.036,w*.81,z*.570,0],
    [.093,w*(ice ? .89:.83),ice ? .153:.136,-.009]
  ];
  if(ice) rows.push([.141,.181,.174,-.009],[.188,.184,.174,-.010],[.212,.165,.153,-.012],[.213,.127,.118,-.012]);
  else if(western) rows.push([.132,.145,.143,-.010],[.174,.157,.149,-.009]);
  else if(chelsea) rows.push([.128,.145,.140,-.008],[.153,.143,.139,-.010],[.156,.116,.112,-.010]);
  else rows.push([.153,.154,.150,-.011],[.182,.157,.15,-.011],[.187,.129,.121,-.011]);
  shell(ankle,rows,col,chelsea?'gloss':'soft');
  if(ice){
    for(const [lo,hi] of [[.047,.068],[.122,.148],[.169,.194]]) {
      const [,rx,rz,c]=radiusAt(rows,(lo+hi)/2);
      profile(ankle,[[lo,rx*.99,rz*.99,c],[lo+.006,rx+.008,rz+.008,c],
        [hi-.005,rx+.008,rz+.008,c],[hi,rx,rz,c]],pale(col,.12),shoeOptions);
    }
    for(const [low,high] of [[-.04,-.015],[.079,.105]])arcBand(ankle,rows,-1.60,1.60,low,high,dark(col,.37),.009);
    const tag=group(ankle,s*.169,.094,.028);tag.rotation.y=s*1.39;
    patch(tag,pale(accent,.20),[0,0,.008],[.085,.063,.019],.013);
    patch(tag,CREAM,[0,0,.020],[.050,.015,.004],.004);
  }else if(western){
    const crown=geometryGrid(48,5,(u,v)=>{
      const a=u*TAU,r=.154+.007*v;
      return [r*Math.sin(a),.168+v*(.041+.070*Math.abs(Math.sin(a))**2),-.009+(r-.008)*Math.cos(a)];
    });
    mesh(ankle,crown,col);
    const piping=pale(col,.36);
    for(const side of [-1,1]){
      cord(ankle,[[side*.109,.195,.103],[side*.076,.142,.126],[side*.066,.128,.132],[side*.031,.154,.141],
        [0,.122,.145]],[.004,.007,.006,.006,.003],piping,{sides:6,steps:12});
    }
    const p=group(ankle,s*.143,.181,.005);p.rotation.y=s*PI/2;
    patch(p,dark(col,.21),[0,.016,.006],[.037,.105,.013],.008);
    oval(p,GOLD,[0,.031,.017],[.009,.01,.004],null,'metal',true);
    vampStitch(ankle,rows,piping,.097);
  }else if(chelsea){
    const panel=group(ankle,s*.139,.075,-.015);panel.rotation.y=s*PI/2;
    patch(panel,dark(col,.59),[0,0,.003],[.126,.129,.013],.023,[0,0,s*.10]);
    for(const dy of [-.034,-.012,.010,.032])patch(panel,pale(dark(col,.55),.06),[0,dy,.011],[.091,.006,.003],.002);
    arcBand(ankle,rows,PI-.76,PI+.76,-.062,.073,dark(col,.21));
    arcBand(ankle,rows,-1.23,1.23,-.086,-.079,pale(col,.12));
    backTab(ankle,.159,-.142,pale(col,.24));
  }else{
    laces(ankle,rows,-.041,.151,6,.077,'#c9b79c',{eyelets:true});
    arcBand(ankle,rows,-1.20,1.20,-.090,-.081,dark(col,.30));
    arcBand(ankle,rows,PI-.98,PI+.98,.135,.161,pale(col,.12));
    backTab(ankle,.191,-.156,pale(col,.21));
  }
}

function bareFoot(ankle,skin) {
  const rows=[[-.164,.103,.174,.067],[-.146,.143,.212,.070],[-.108,.151,.217,.066],[-.077,.143,.193,.054],
    [-.048,.128,.157,.038],[-.012,.110,.12,.018],[.043,.094,.094,0],[.093,.092,.092,-.008]];
  shell(ankle,rows,skin);
  return rows;
}
function footSurface(rows,angle,y,clearance=0) {
  const [,rx,rz,cz=0]=radiusAt(rows,y);
  return [(rx+clearance)*signedPow(Math.sin(angle),shoeOptions.power),y,
    cz+(rz+clearance)*signedPow(Math.cos(angle),shoeOptions.power)];
}
function instepStrap(ankle,foot,frontY,sideY,height,skew,col) {
  const geom=geometryGrid(30,4,(u,v)=>{
    const angle=-1.58+u*3.16;
    const y=frontY+(sideY-frontY)*Math.sin(angle)**2+
      skew*Math.sin(angle)+(v-.5)*height;
    return footSurface(foot,angle,y,.010);
  },false);
  mesh(ankle,geom,col);
}
function flatUpper(ankle,foot,col,isBallet) {
  const point=(u,v)=>{
    const angle=u*TAU, sn=Math.sin(angle), cs=Math.cos(angle);
    const front=Math.max(0,cs), heel=Math.max(0,-cs);
    const edgeY=-.065+(isBallet?.026:.032)*front+.039*heel;
    const y=-.150+v*(edgeY+.150);
    const pos=footSurface(foot,angle,y,.010+.003*(1-v));
    // Match the outsole at the bottom; ease into a rounded leather toe.
    const baseX=.162*signedPow(sn,.8),baseZ=.067+.225*signedPow(cs,.8);
    const skirt=Math.max(0,1-v/.40)**2;
    pos[0]+=skirt*(baseX-pos[0]);
    pos[2]+=skirt*(baseZ-pos[2])+.014*front*(1-v)**1.7;
    return pos;
  };
  mesh(ankle,geometryGrid(48,14,point),col,isBallet?'soft':'gloss');
  const edge=Array.from({length:41},(_,i)=>point(i/40,1));
  cord(ankle,edge,.004,pale(col,.14),{center:[0,-.082,.04],sides:6,steps:48});
  return point(0,1);
}
function bow(ankle,center,col) {
  const p=group(ankle,...center);p.rotation.x=-.64;
  for(const s of [-1,1]){
    cord(p,[[0,0,0],[s*.044,.028,.002],[s*.071,.026,.003],[s*.068,.009,.004],[s*.045,0,.004],[0,0,.006]],
      .006,col,{sides:6,steps:11});
    cord(p,[[0,0,.007],[s*.026,-.018,.009],[s*.056,-.038,.012]],[.006,.007,.003],col,fine);
  }
  oval(p,pale(col,.13),[0,0,.008],[.016,.013,.009],null,'soft',true);
}
function openShoe(ankle,s,id,col,skin) {
  const sandal=id==='sandals',flat=id==='ballet';
  sole(ankle,.167,.231,.067,sandal?-.150:-.152,sandal?'#c09971':dark(col,.34),sandal?'#825f4d':'#705f5e');
  const base=bareFoot(ankle,skin);
  if(sandal){
    for(let i=0;i<5;i++){
      const dx=s*(.085-i*.039),z=.242+(4-Math.abs(i-1))*.009;
      oval(ankle,skin,[dx,-.104+i*.001,z],
        [.035-i*.003,.025,.043-i*.002],[.13,0,-s*.04],'soft',true);
    }
    instepStrap(ankle,base,-.068,-.109,.031,.010,col);
    instepStrap(ankle,base,-.003,-.066,.032,-.014,col);
    arcBand(ankle,base,PI-.96,PI+.96,-.062,-.026,col,.009);
    const clip=group(ankle,s*.128,-.047,.074);clip.rotation.y=s*1.20;
    patch(clip,GOLD,[0,0,.006],[.050,.034,.008],.007,null,'metal');
    patch(clip,col,[0,0,.012],[.031,.017,.004],.003);
    return;
  }
  const rim=flatUpper(ankle,base,col,flat);
  if(flat) {
    bow(ankle,[0,rim[1]+.003,rim[2]+.006],pale(col,.37));
    for(const side of [-1,1]) {
      const pts=[];
      for(let i=0;i<=15;i++) {
        const u=i/15,a=side*(u*TAU*.81-.9);
        pts.push(footSurface(base,a,-.028+.105*u,.006));
      }
      strand(ankle,pts,[.009,.012,.009],[.004,.004,.003],pale(col,.29),{center:[0,.02,-.008],sides:6,steps:18});
    }
  }else{
    instepStrap(ankle,base,.012,-.048,.024,.003,dark(col,.13));
    const clip=group(ankle,s*.137,-.037,.042);clip.rotation.y=s*1.28;
    patch(clip,GOLD,[0,0,0],[.050,.035,.009],.006,null,'metal');
    patch(clip,col,[0,0,.006],[.031,.016,.004],.003);

  }
}

function slipOn(ankle,s,id,col) {
  const loafer=id==='loafers';
  sole(ankle,.167,.235,.073,loafer?-.152:-.148,loafer?'#635454':'#9c785b',loafer?'#483d42':'#805f4d');
  const rows=[[-.152,.158,.227,.073],[-.116,.163,.231,.070],[-.086,.161,.220,.067],
    [-.056,.151,.195,.057],[-.022,.140,.163,.037],[.012,.13,.128,.005],[.039,.119,.114,-.010],[.043,.098,.097,-.011]];
  shell(ankle,rows,col,loafer?'gloss':'soft');
  vampStitch(ankle,rows,loafer?pale(col,.19):CREAM,loafer ? .111:.119);
  if(loafer){
    arcBand(ankle,rows,-1.22,1.22,-.046,-.013,dark(col,.23),.009);
    const z=frontZ(rows,0,-.024,.018);
    patch(ankle,GOLD,[0,-.024,z],[.095,.023,.008],.008,[-.56,0,0],'metal');
    patch(ankle,dark(col,.35),[0,-.023,z+.007],[.040,.009,.003],.003,[-.56,0,0]);
  }else{
    arcBand(ankle,rows,PI-1.23,PI+1.23,-.073,-.031,pale(col,.17),.007);
    bow(ankle,[0,-.015,frontZ(rows,0,-.015,.016)],'#826044');
    const p=group(ankle,s*.145,-.065,-.002);p.rotation.y=s*1.40;
    for(const z of [-.045,0,.045])cord(p,[[z-.008,.015,0],[z+.008,-.006,.005]],
      .005,CREAM,{sides:5,steps:4});
  }
}

export function drawShoe(ankle,side,id,color=SNEAKER,accent='#ec813f',skin=SKIN) {
  switch(id) {
    case 'hightops':case 'runners':case 'skate':
      clothShoe(ankle,side,id,color,accent);break;
    case 'combat':case 'chelsea':case 'moonboots':case 'westernboots':
      boots(ankle,side,id,color,accent);break;
    case 'sandals':case 'maryjanes':case 'ballet':
      openShoe(ankle,side,id,color,skin);break;
    case 'loafers':case 'moccasins':
      slipOn(ankle,side,id,color);break;
    default:
      legacyShoe(ankle,side,color,accent);
  }
}
