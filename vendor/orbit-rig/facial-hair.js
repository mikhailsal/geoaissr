import {THREE, PI, mesh, strand, profile, geometryGrid, signedPow, tint, pale, dark, faceSection, faceZ} from './model-kit.js';

const brown = '#483029';
const auburn = '#734832';
const black = '#39303e';
const ash = '#786865';

export const mustaches = [
  {id:'none',name:'Clean upper lip',color:brown},
  {id:'chevron',name:'Chevron',color:auburn},
  {id:'handlebar',name:'Handlebar',color:brown},
  {id:'pencil',name:'Pencil',color:black},
  {id:'horseshoe',name:'Horseshoe',color:brown},
  {id:'walrus',name:'Walrus',color:ash},
  {id:'dali',name:'Dalí',color:black},
  {id:'english',name:'English',color:brown},
  {id:'imperial',name:'Imperial',color:auburn},
  {id:'lampshade',name:'Lampshade',color:brown},
  {id:'brush',name:'Painter’s brush',color:auburn},
  {id:'hungarian',name:'Hungarian',color:brown},
  {id:'whiskers',name:'Long whiskers',color:black},
  {id:'pyramid',name:'Pyramid',color:auburn},
  {id:'natural',name:'Natural sweep',color:brown}
];

export const beards = [
  {id:'none',name:'Clean shaven',color:brown},
  {id:'stubble',name:'Five o’clock',color:black},
  {id:'boxed',name:'Short boxed',color:brown},
  {id:'goatee',name:'Goatee',color:auburn},
  {id:'chinstrap',name:'Chin strap',color:black},
  {id:'full',name:'Full beard',color:brown},
  {id:'ducktail',name:'Ducktail',color:auburn},
  {id:'chops',name:'Mutton chops',color:brown},
  {id:'anchor',name:'Anchor',color:black},
  {id:'soulpatch',name:'Soul patch',color:brown},
  {id:'garibaldi',name:'Garibaldi',color:auburn},
  {id:'forked',name:'Forked beard',color:brown},
  {id:'braided',name:'Braided beard',color:auburn},
  {id:'balbo',name:'Balbo',color:black},
  {id:'sage',name:'Sage beard',color:'#bab4b2'},
  {id:'curly',name:'Curly beard',color:brown}
];

const clamp = n => Math.min(1,Math.max(0,n));
function smooth(x) {
  const t=clamp(x);
  return t*t*(3-2*t);
}

// Long waxed tips leave the cheek below the jaw. Keep the free ends in
// front of the collar while the section above them follows the actual skin.
function whiskerZ(x,y) {
  if(y>=.135)return faceZ(x,y);
  return faceZ(x,.135)+.13*(y-.135);
}

// Each control point sets x, y, cross-section width, depth and optional lift.
function whiskerPair(head,samples,color,surfaceZ=whiskerZ) {
  for(const side of [-1,1]) {
    const points=[],widths=[],depths=[];
    for(const [x,y,width,depth,lift] of samples) {
      points.push([side*x,y,surfaceZ(x,y)+(lift??(.010+.47*depth))]);
      widths.push(width);
      depths.push(depth);
    }
    strand(head,points,widths,depths,color,{steps:Math.max(20,samples.length*4),sides:10});
  }
}

const whiskerShapes = {
  pencil:[
    [.019,.348,.006,.010],[.064,.354,.014,.015],[.142,.346,.015,.017],
    [.213,.328,.012,.015],[.269,.321,.002,.003]
  ],
  handlebar:[
    [.006,.352,.014,.015],[.075,.350,.034,.037],[.166,.337,.042,.048],
    [.265,.333,.038,.044],[.338,.363,.030,.036,.050],[.377,.418,.022,.030,.065],
    [.361,.454,.015,.020,.079],[.329,.461,.008,.013,.085],[.315,.445,.002,.003,.087]
  ],
  horseshoe:[
    [.001,.355,.019,.021],[.081,.353,.035,.038],[.177,.340,.040,.043],
    [.244,.304,.038,.038],[.269,.241,.036,.035],[.273,.163,.033,.031],
    [.268,.099,.029,.027],[.260,.079,.018,.019]
  ],
  walrus:[
    [.002,.370,.026,.027],[.068,.367,.050,.050],[.151,.349,.054,.056],
    [.224,.315,.054,.055],[.269,.265,.045,.049],[.292,.225,.034,.037],[.308,.199,.007,.011]
  ],
  dali:[
    [.010,.351,.013,.018],[.071,.349,.020,.025],[.159,.340,.018,.021],
    [.256,.358,.013,.016],[.343,.415,.011,.014,.061],[.412,.504,.010,.012,.101],
    [.458,.597,.007,.009,.124],[.474,.655,.0015,.003,.131]
  ],
  english:[
    [.025,.355,.009,.012],[.076,.353,.026,.032],[.159,.350,.028,.034],
    [.257,.357,.018,.022],[.363,.377,.011,.015,.049],[.500,.411,.0015,.003,.096]
  ],
  imperial:[
    [.009,.359,.022,.024],[.078,.354,.041,.044],[.162,.344,.044,.048],
    [.239,.350,.040,.045],[.304,.396,.040,.045,.051],[.318,.451,.026,.035,.073],
    [.299,.480,.018,.025,.084],[.272,.469,.012,.016,.092],[.278,.448,.002,.004,.096]
  ],
  hungarian:[
    [.002,.363,.025,.035],[.089,.354,.047,.057],[.200,.341,.050,.068],
    [.293,.355,.042,.053,.053],[.382,.400,.033,.043,.078],
    [.457,.448,.019,.029,.098],[.508,.465,.002,.005,.108]
  ],
  whiskers:[
    [.013,.355,.013,.018],[.095,.347,.025,.030],[.186,.328,.026,.032],
    [.243,.294,.025,.028],[.268,.217,.024,.028],[.275,.125,.022,.025],
    [.282,.037,.020,.023],[.302,-.035,.015,.019],[.327,-.073,.003,.006]
  ],
  natural:[
    [.010,.360,.009,.016],[.061,.355,.030,.032],[.124,.345,.034,.040],
    [.188,.335,.028,.032],[.235,.318,.016,.019],[.254,.299,.002,.004]
  ]
};

// These three close-trimmed styles have a cut lower edge. A beveled
// outline follows the changing depth of the muzzle along its entire width.
const clipperShapes = {
  chevron:[[0,.348],[.047,.378],[.119,.373],[.201,.348],[.273,.299],[.283,.280],
    [.231,.295],[.156,.323],[.081,.326],[.028,.320],[0,.327]],
  lampshade:[[0,.369],[.116,.373],[.182,.352],[.238,.312],[.242,.293],
    [.174,.299],[.098,.313],[.040,.315],[0,.312]],
  brush:[[0,.367],[.052,.380],[.123,.375],[.169,.362],[.174,.306],[.154,.309],
    [.139,.304],[.124,.310],[.109,.306],[.091,.312],[.067,.308],[.044,.313],[0,.316]],
  pyramid:[[0,.392],[.036,.382],[.115,.359],[.196,.332],[.231,.309],
    [.165,.308],[.087,.322],[.023,.331],[0,.332]]
};

function relief(head,outline,color,{lift=.012,thickness=.025,bevel=.006,surfaceZ=whiskerZ}={}) {
  const shape=new THREE.Shape();
  const n=outline.length;
  for(let i=0;i<n;i++) {
    const prev=outline[(i+n-1)%n],current=outline[i],next=outline[(i+1)%n];
    const before=[current[0]+.17*(prev[0]-current[0]),current[1]+.17*(prev[1]-current[1])];
    const after=[current[0]+.17*(next[0]-current[0]),current[1]+.17*(next[1]-current[1])];
    if(i===0) shape.moveTo(...before);
    else shape.lineTo(...before);
    shape.quadraticCurveTo(...current,...after);
  }
  shape.closePath();
  const surface=new THREE.ExtrudeGeometry(shape,{
    depth:thickness,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:3
  });
  const p=surface.attributes.position;
  for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)+surfaceZ(p.getX(i),p.getY(i))+lift);
  surface.computeVertexNormals();
  mesh(head,surface,color);
}

function foldedTrim(head,outline,color) {
  const right=outline.slice(1,-1);
  const full=[...outline,...right.slice().reverse().map(([x,y])=>[-x,y])];
  relief(head,full,color);
}

export function drawMustache(head,id,color=brown) {
  const shape=clipperShapes[id];
  if(shape){foldedTrim(head,shape,color);return;}
  const samples=whiskerShapes[id];
  if(!samples)return;
  whiskerPair(head,samples,color);
  if(id==='imperial') {
    whiskerPair(head,[[.160,.344,.013,.015,.035],[.245,.351,.028,.031,.048],
      [.324,.386,.033,.034,.057],[.372,.438,.016,.021,.078],[.368,.475,.002,.004,.097]],pale(color,.025));
  } else if(id==='walrus') {
    whiskerPair(head,[[.120,.365,.008,.014,.049],[.177,.340,.012,.016,.057],
      [.219,.299,.012,.016,.057],[.253,.247,.004,.007,.049]],pale(color,.035));
  }
}

// One continuous cheek-to-chin shell keeps the hair flush with the face
// as it turns. Different cuts each control the upper line, lower contour,
// projection and growth direction. The underside returns to the neck.
const cuts = {
  stubble:{span:1.90,top:'high',drop:.033,bulk:.005,bottom:.026,ribs:0},
  boxed:{span:1.93,top:'boxed',drop:.076,bulk:.044,bottom:.044,ribs:11},
  goatee:{span:.71,top:'goatee',drop:.178,bulk:.063,bottom:.045,ribs:6,taper:.30},
  chinstrap:{span:1.88,top:'strap',drop:.059,bulk:.026,bottom:.033,ribs:0},
  full:{span:1.92,top:'high',drop:.195,bulk:.078,bottom:.064,ribs:12,taper:.09},
  ducktail:{span:1.86,top:'high',drop:.336,bulk:.092,bottom:.057,ribs:11,taper:.34,tip:'point'},
  chops:{span:1.91,top:'chops',drop:.069,bulk:.085,bottom:.079,ribs:7,gap:.47},
  garibaldi:{span:1.97,top:'high',drop:.256,bulk:.111,bottom:.083,ribs:13,tip:'round'},
  forked:{span:1.90,top:'boxed',drop:.287,bulk:.087,bottom:.055,ribs:10,tip:'fork',taper:.16},
  braided:{span:1.83,top:'high',drop:.174,bulk:.086,bottom:.058,ribs:10,taper:.23,tip:'point'},
  balbo:{span:1.19,top:'balbo',drop:.115,bulk:.054,bottom:.041,ribs:8,taper:.17},
  sage:{span:1.88,top:'high',drop:.445,bulk:.114,bottom:.064,ribs:12,tip:'swept',taper:.48},
  curly:{span:1.94,top:'high',drop:.178,bulk:.097,bottom:.061,ribs:13,tip:'round'}
};

function topLine(type,a) {
  const side=smooth((a-.25)/1.20);
  const ear=smooth((a-1.53)/.47);
  switch(type) {
    case 'strap': return .084+.081*side+.305*smooth((a-.98)/.54)-.225*ear;
    case 'goatee': return .166-.038*smooth(a/.62);
    case 'balbo': return .133+.048*smooth((a-.23)/.79);
    case 'boxed': return .157+.050*smooth((a-.20)/.34)+.245*smooth((a-.62)/.88)-.235*ear;
    case 'chops': return .170+.095*smooth((a-.48)/.42)+.264*smooth((a-.87)/.65)-.231*ear;
    default: return .167+.300*side+.034*smooth((a-1.1)/.36)-.238*ear;
  }
}

function jawPoint(theta,y) {
  const [,rx,rz,cz]=faceSection(y);
  return [rx*signedPow(Math.sin(theta),.88),y,cz+rz*signedPow(Math.cos(theta),.88)];
}

function edgeWeight(cut,a) {
  const side=smooth((cut.span-a)/.145);
  return cut.gap?side*smooth((a-cut.gap)/.13):side;
}

function outer(cut,theta,v) {
  const a=Math.abs(theta), across=a/cut.span, edge=edgeWeight(cut,a);
  const top=topLine(cut.top,a);
  const jaw=Math.min(top-.027,cut.bottom+.121*Math.pow(across,1.8));
  const base=top-(top-jaw)*edge*(1-v);
  const p=jawPoint(theta,base);
  const front=Math.max(0,Math.cos(across*PI/2));
  let length=.28+.72*front;
  if(cut.tip==='point')length=.17+.83*Math.exp(-2.60*across);
  if(cut.tip==='swept')length=.17+.83*Math.exp(-3.05*Math.abs(theta-.12)/cut.span);
  if(cut.tip==='round')length=.43+.57*Math.pow(front,.7);
  if(cut.tip==='fork')length=.33+front*.65-.62*Math.exp(-theta*theta/.043);
  const lower=Math.pow(1-v,1.55)*edge;
  const body=Math.sin(PI*(.22+.78*v))**.64;
  const grain=cut.ribs?Math.cos(theta*cut.ribs+Math.sin(theta*2.6)*(1-v)*1.35):0;
  const puff=.006+cut.bulk*edge*(body+.60*lower)*(.94+.15*grain);
  p[0]=p[0]*(1-(cut.taper||0)*lower*front)+Math.sin(theta)*puff;
  if(cut.tip==='swept')p[0]+=.055*lower*front;
  p[1]-=cut.drop*length*lower;
  p[2]+=Math.cos(theta)*puff+cut.drop*.17*lower*front;
  return p;
}
function shellPoint(cut,theta,v) {
  const underside=.19;
  if(v>=underside)return outer(cut,theta,(v-underside)/(1-underside));
  const f=v/underside, a=Math.abs(theta), apron=edgeWeight(cut,a);
  const lip=outer(cut,theta,0);
  const neck=[lip[0]*(1-.67*apron),lip[1]+(cut.drop*.73+.07)*apron,
    lip[2]*(1-.84*apron)+.048*apron];
  const bend=Math.sin(PI*f)*.016*apron;
  return [neck[0]*(1-f)+lip[0]*f,neck[1]*(1-f)+lip[1]*f-bend,neck[2]*(1-f)+lip[2]*f];
}
function beardShell(head,cut,from,to,color,skin,stubble) {
  const columns=Math.ceil((to-from)*18),rows=20;
  const geo=geometryGrid(columns,rows,(u,v)=>shellPoint(cut,from+(to-from)*u,v),false);
  const colors=new Float32Array(geo.attributes.position.count*3);
  const base=new THREE.Color(color),face=new THREE.Color(skin),paint=new THREE.Color();
  let index=0;
  for(let j=0;j<=rows;j++) {
    const v=j/rows;
    for(let i=0;i<=columns;i++){
      const theta=from+(to-from)*i/columns;
      const grain=cut.ribs?Math.cos(cut.ribs*theta+Math.sin(theta*2.6)*(1-v)*1.35):0;
      const warmth=.91+.11*v+.063*grain;
      if(stubble){
        const density=(.37+.11*Math.cos(theta*2.3)) * smooth((1-v)/.23) * edgeWeight(cut,Math.abs(theta));
        paint.copy(face).lerp(base,density);
      }else paint.copy(base).multiplyScalar(warmth);
      paint.toArray(colors,index);index+=3;
    }
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  mesh(head,geo,color);
}

// Fine stubble is one small mesh. A fixed integer sequence keeps skin detail
// stable when an avatar is recolored, reloaded or rotated.
function stipple(head,cut,color,skin) {
  const coords=[],indices=[];
  let seed=0x12bc71;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<280;i++) {
    const theta=(random()*2-1)*(cut.span-.065);
    const v=.08+.83*random();
    const middle=outer(cut,theta,v);
    const wide=.0016+.0025*random(),long=.0032+.004*random();
    const shift=.0038;
    const sn=Math.sin(theta),cs=Math.cos(theta),x=middle[0]+sn*shift,y=middle[1],z=middle[2]+cs*shift;
    const k=coords.length/3;
    coords.push(x-cs*wide,y,z+sn*wide,x,y-long,z,x+cs*wide,y+.001,z-sn*wide,x+.001,y+long,z);
    indices.push(k,k+1,k+2,k,k+2,k+3);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));geo.setIndex(indices);geo.computeVertexNormals();
  mesh(head,geo,tint(skin,color,.70));
}

function strandsOfGrowth(head,cut,color,count) {
  for(const side of [-1,1]){
    for(let i=0;i<count;i++) {
      const theta=(.22+i*(cut.span-.52)/Math.max(1,count-1))*side;
      const pts=[];
      for(let j=0;j<6;j++){
        const v=.06+.74*j/5;
        const angle=theta*(.88+.12*v)+.04*side*Math.sin(v*PI);
        const p=outer(cut,angle,v);
        const lift=.006;
        p[0]+=Math.sin(angle)*lift;p[2]+=Math.cos(angle)*lift;
        pts.push(p);
      }
      strand(head,pts,[.002,.012,.018,.014,.006,.001],[.001,.007,.008,.007,.003,.001],
        i%2?pale(color,.020):dark(color,.050),{steps:12,sides:6,out:[Math.sin(theta),0,Math.cos(theta)]});
    }
  }
}
function soulPatch(head,color) {
  const outline=[[0,.174],[.039,.165],[.044,.154],[.028,.133],[.007,.111],[0,.106],
    [-.009,.116],[-.026,.137],[-.043,.154],[-.037,.167]];
  relief(head,outline,color,{lift:.011,thickness:.015,bevel:.004,surfaceZ:faceZ});
}
function anchor(head,color) {
  whiskerPair(head,[[.000,.086,.029,.033],[.074,.084,.028,.033],[.162,.103,.027,.029],
    [.244,.140,.023,.025],[.301,.177,.019,.020],[.331,.200,.002,.004]],color,faceZ);
  relief(head,[[0,.179],[.035,.172],[.025,.149],[.025,.111],[.054,.084],
    [0,.067],[-.054,.084],[-.025,.111],[-.025,.149],[-.035,.172]],color,{lift:.014,thickness:.019,bevel:.005,surfaceZ:faceZ});
}
function braid(head,color) {
  const copies=3;
  for(let k=0;k<copies;k++) {
    const phase=k*2*PI/copies,points=[],width=[],depth=[];
    for(let j=0;j<=13;j++) {
      const t=j/13,turn=phase+t*PI*3.2;
      const r=.062*(1-.50*t);
      points.push([r*Math.cos(turn),-.057-.267*t,.405+.044*Math.sin(turn)-.018*t]);
      width.push(.038-.018*t);depth.push(.031-.013*t);
    }
    strand(head,points,width,depth,k===1?pale(color,.032):color,{steps:24,sides:8});
  }
  const band=profile(head,[[-.332,.043,.048,.386],[-.329,.052,.048,.386],[-.297,.053,.050,.386],[-.292,.043,.045,.386]],'#cab077',{segments:16,surface:'metal'});
  band.rotation.z=.045;
  strand(head,[[0,-.318,.383],[-.001,-.349,.383],[.008,-.377,.376],[.019,-.391,.369]],
    [.031,.036,.020,.002],[.029,.032,.019,.002],color,{steps:12,sides:8});
}
function curlTexture(head,cut,color) {
  for(let row=0;row<3;row++) {
    const places=8+row*2;
    for(let i=0;i<places;i++) {
      const center=-1.57+3.14*(i+(row%2?.72:.5))/places;
      const centerV=.17+row*.25;
      const pts=[];
      for(let j=0;j<9;j++) {
        const t=j/8,phase=(-.60+1.63*t)*PI;
        const theta=center+Math.cos(phase)*.100, v=centerV+Math.sin(phase)*.110;
        const p=outer(cut,theta,v);
        const relief=Math.sin(PI*t)*.013;
        p[0]+=Math.sin(theta)*relief;p[2]+=Math.cos(theta)*relief;
        pts.push(p);
      }
      strand(head,pts,[.003,.014,.019,.017,.005],[.002,.011,.016,.014,.003],
        (i+row)%3?color:pale(color,.032),{steps:11,sides:6,out:[Math.sin(center),0,Math.cos(center)]});
    }
  }
}

export function drawBeard(head,id,color=brown,skin='#e5ac80') {
  if(id==='soulpatch'){soulPatch(head,color);return;}
  if(id==='anchor'){anchor(head,color);return;}
  const cut=cuts[id];
  if(!cut)return;
  if(cut.gap) {
    beardShell(head,cut,-cut.span,-cut.gap,color,skin,false);
    beardShell(head,cut,cut.gap,cut.span,color,skin,false);
  }else beardShell(head,cut,-cut.span,cut.span,color,skin,id==='stubble');
  if(id==='stubble')stipple(head,cut,color,skin);
  if(['full','ducktail','garibaldi','forked','sage','braided'].includes(id)) strandsOfGrowth(head,cut,color,id==='sage'?7:4);
  if(id==='braided')braid(head,color);
  if(id==='curly')curlTexture(head,cut,color);
  if(id==='goatee'||id==='balbo')soulPatch(head,color);
}
