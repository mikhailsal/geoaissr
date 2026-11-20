import {
  THREE, PI, TAU, mesh, oval, strand, cord, geometryGrid, signedPow, faceSection, tint, dark, pale
} from './model-kit.js';

export const extraHairs = [
  {id:'pixie',name:'Asymmetric pixie',color:'#aa7291'},
  {id:'cornrows',name:'Cornrows',color:'#483029'},
  {id:'longwaves',name:'Mermaid waves',color:'#a46353'},
  {id:'afro',name:'Cloud afro',color:'#483029'},
  {id:'curtains',name:'Curtain part',color:'#d3a467'},
  {id:'ponytail',name:'High ponytail',color:'#734832'},
  {id:'buzz',name:'Buzz fade',color:'#39303e'},
  {id:'twinbraids',name:'Twin braids',color:'#a16b46'},
  {id:'mohawk',name:'Liberty hawk',color:'#ab6987'},
  {id:'hime',name:'Hime cut',color:'#39303e'},
  {id:'locs',name:'Shoulder locs',color:'#69503c'},
  {id:'puffs',name:'Afro puffs',color:'#4f3430'},
  {id:'quiff',name:'Rockabilly quiff',color:'#583c36'},
  {id:'crown',name:'Braided crown',color:'#c99563'},
  {id:'shag',name:'Feathered shag',color:'#aa7766'},
  {id:'bubble',name:'Bubble ponytail',color:'#a18cb2'},
  {id:'crop',name:'French crop',color:'#724c40'},
  {id:'coils',name:'Coil halo',color:'#624235'},
  {id:'pigtails',name:'High pigtails',color:'#a86556'},
  {id:'mullet',name:'Modern mullet',color:'#b09372'},
  {id:'topknot',name:'Topknot',color:'#635050'},
  {id:'victory',name:'Victory rolls',color:'#b36e59'},
  {id:'chignon',name:'Low chignon',color:'#6f4736'},
  {id:'bald',name:'Clean shave',color:'#483029'}
];

const crownCenter = [0,.63,-.02];
const clip = (value,low,high) => Math.min(high,Math.max(low,value));
function smooth(low,high,value) {
  const u=clip((value-low)/(high-low),0,1);
  return u*u*(3-2*u);
}
const mix=(a,b,t)=>a+(b-a)*t;

// Use the same skull surface for the hairline, fringe and crown.
function scalp(angle,theta,lift=.07,padding=.025) {
  const y=.63+.664*Math.cos(theta);
  const [,rx,rz,z]=faceSection(y);
  const round=Math.min(1,Math.sin(theta)*4);
  return [
    (rx+round*padding)*signedPow(Math.sin(angle),.88),
    y+lift*Math.max(0,Math.cos(theta)),
    z+(rz+round*padding)*signedPow(Math.cos(angle),.88)
  ];
}
function cap(parent,c,{front=.97,back=.40,temple=.11,lift=.062,pad=.025,
  waves=.006,edge=.013,lean=0}={}) {
  const geom=geometryGrid(52,20,(u,v)=>{
    const a=u*TAU,cs=Math.cos(a),sn=Math.sin(a);
    const hairline=back+(front-back)*Math.pow((1+cs)*.5,2.35)
      +temple*Math.pow(Math.abs(sn),5)+edge*(Math.sin(5*a+.4)+.55*Math.sin(8*a));
    const end=Math.acos(clip((hairline-.63)/.664,-1,1));
    const theta=end*(1-v)+.003;
    const ribs=waves*(.55+.45*Math.cos(a*12+theta*1.4))*Math.sin(theta);
    const p=scalp(a,theta,lift,pad+ribs);
    p[0]+=lean*v*v;return p;
  });
  return mesh(parent,geom,c);
}
function lock(parent,c,points,width,depth,opts={}) {
  const widths=Array.isArray(width)?width:[.015,width*.85,width,width*.79,width*.26,.003];
  const depths=Array.isArray(depth)?depth:[.012,depth*.85,depth,depth*.81,depth*.34,.002];
  return strand(parent,points,widths,depths,c,{
    center:opts.out?undefined:(opts.center||crownCenter),
    out:opts.out,sides:opts.sides||9,steps:opts.steps||18
  });
}
function scalpLock(parent,c,a0,a1,t0,t1,width,depth,{lift=.08,pad=.042,curve=0}={}) {
  const pts=[];
  for(let i=0;i<=6;i++) {
    const f=i/6;
    pts.push(scalp(mix(a0,a1,f)+curve*Math.sin(PI*f),mix(t0,t1,f),lift,pad));
  }
  lock(parent,c,pts,width,depth);
}
function trim(piece) {piece.userData.hairTrim=true;return piece;}
function ribbon(parent,pos,radii,color='#9a7257',rot=null) {
  return trim(oval(parent,color,pos,radii,rot,'soft',true));
}
function shortSides(parent,c) {
  cap(parent,dark(c,.09),{front:1.01,back:.46,temple:.22,lift:.035,pad:.018,edge:.008});
}
function fringe(parent,c,{count=7,part=0,depth=.066,long=false}={}) {
  for(let i=0;i<count;i++) {
    const u=count===1?0:i/(count-1)*2-1;
    const a=u*.91+part;
    const tip=long?1.18+.24*Math.abs(u):1.09+.13*Math.cos(i*1.8);
    scalpLock(parent,i%3===1?pale(c,.018):c,a*.60+.12,a,.22+.05*Math.cos(i),tip,
      .140-.023*Math.abs(u),depth,{lift:.08,pad:.064,curve:.13});
  }
}
function combBack(parent,c,{count=11,top=.06}={}) {
  const back=new THREE.Vector3(.025,.763,-.646).normalize();
  for(let i=0;i<count;i++) {
    const a=(i/(count-1)*2-1)*2.83,t0=.99+.51*(1-Math.cos(a))*.5;
    const from=new THREE.Vector3(Math.sin(t0)*Math.sin(a),Math.cos(t0),Math.sin(t0)*Math.cos(a));
    const path=[];
    for(let j=0;j<=7;j++){
      const f=j/7,v=from.clone().lerp(back,f).normalize();
      path.push(scalp(Math.atan2(v.x,v.z),Math.acos(clip(v.y,-1,1)),top+.008,.039));
    }
    lock(parent,i%3===0?pale(c,.030):c,path,[.003,.023,.031,.025,.004],[.002,.010,.014,.010,.002],
      {sides:6,steps:15});
  }
}
function curtainFringe(parent,c,short=false) {
  for(const s of [-1,1]) {
    for(let n=0;n<3;n++) {
      const k=n*.15;
      const pts=[scalp(s*(.19+k),.13,.095,.041),
        [s*(.135+k*.30),1.325-n*.008,.267+n*.03],
        [s*(.28+k*.42),1.212-n*.044,.467],
        [s*(.47+k*.19),1.025-n*.044,.488-n*.005],
        [s*(.564+k*.23),short?.842:.702+n*.047,.400-n*.041],
        [s*(.615+k*.25),short?.807:.605+n*.061,.297-n*.032]];
      lock(parent,n===1?pale(c,.022):c,pts,.133-n*.017,.075-n*.007);
    }
  }
}
function french(parent,c) {
  shortSides(parent,c);
  cap(parent,c,{front:.995,back:.67,temple:.075,lift:.096,pad:.031,edge:.012});
  for(let i=0;i<9;i++) {
    const a=(i-4)*.213;
    scalpLock(parent,i%3===1?pale(c,.017):c,a-.22,a,.18,1.235+.042*Math.sin(i*1.6),
      .121,.040,{lift:.109,pad:.035,curve:.10});
  }
  for(let i=0;i<8;i++) {
    const a=1.21+i*.54;
    scalpLock(parent,c,a-.18,a,.44,1.54+.07*Math.sin(i),.103,.038,{lift:.077,pad:.031});
  }
}
function pixie(parent,c) {
  shortSides(parent,c);
  for(let i=0;i<8;i++) {
    const f=i/7;
    const pts=[scalp(.68+.75*f,.27+.12*f,.09,.037),
      scalp(.47+.5*f,.42,.135,.063),scalp(.07+.53*f,.76,.142,.075),
      scalp(-.35+.43*f,1.01,.12,.072),scalp(-.80+.53*f,1.26+.22*f,.093,.066),
      scalp(-1.04+.54*f,1.50-.29*f,.06,.043)];
    lock(parent,i%3===1?pale(c,.021):c,pts,.134-.028*f,.067);
  }
  for(let i=0;i<11;i++){
    const a=1.12+i*.386;
    scalpLock(parent,c,a+.37,a,.35,1.63+.22*Math.cos(a+1.1),.128,.052,{lift:.073,pad:.045,curve:-.12});
  }
}
function quiff(parent,c) {
  shortSides(parent,c);
  for(let i=0;i<9;i++) {
    const f=(i-4)/4, x=f*.476,arc=1-f*f;
    const pts=[[x*1.10,.92+arc*.088,.408+arc*.139],
      [x*1.08,1.147+arc*.098,.409+arc*.176],
      [x*.98+.067,1.356+arc*.133,.32+arc*.105],
      [x*.89+.094,1.382+arc*.146,.115],
      [x*.75+.06,1.288+arc*.107,-.153],[x*.57,1.203,-.411]];
    lock(parent,i%3===0?pale(c,.018):c,pts,[.019,.100,.122,.119,.081,.006],[.018,.075,.092,.077,.044,.004]);
  }
  for(const s of [-1,1])for(let i=0;i<4;i++) {
    scalpLock(parent,c,s*(1.15+i*.29),s*(2.12+i*.23),.67,1.83,.084,.031,{lift:.052,pad:.030,curve:s*.17});
  }
}
function curtains(parent,c) {
  cap(parent,c,{front:1.014,back:.335,temple:.087,lift:.096});
  curtainFringe(parent,c);
  for(let i=0;i<14;i++) {
    const a=1.03+i*(TAU-2.06)/13, s=Math.sin(a);
    scalpLock(parent,i%4===2?pale(c,.016):c,a-.18,a+.14,.31,1.82+.22*Math.abs(s),
      .133,.057,{lift:.09,pad:.048,curve:.16*s});
  }
}
function buzz(parent,c) {
  const geom=cap(parent,c,{front:.946,back:.39,temple:.24,lift:.025,pad:.016,waves:.002,edge:.003}).geometry;
  const pos=geom.attributes.position,colors=new Float32Array(pos.count*3);
  const base=new THREE.Color(c),fade=base.clone().lerp(new THREE.Color('#a89883'),.14);
  const paint=new THREE.Color();
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),noise=Math.sin(x*74+z*61)*Math.cos(y*68-z*43);
    const fall=(1-smooth(.51,1.08,y))*(1-.46*Math.max(0,z));
    paint.copy(base).lerp(fade,fall*.86).multiplyScalar(.98+.035*noise).toArray(colors,i*3);
  }
  geom.setAttribute('color',new THREE.BufferAttribute(colors,3));
}

function mantleShape(a,v,settings) {
  const {end,amount,width,wave,drop}=settings;
  const f=1-v,cs=Math.cos(a),sn=Math.sin(a);
  const hem=end+amount*(.52+.48*Math.cos(7*a+.6))+.10*Math.max(0,cs);
  const y=mix(hem,1.02,v);
  const wavePhase=f*TAU*1.19+a*.79, ripple=wave*Math.sin(wavePhase)*Math.sin(PI*clip(v/.96,0,1));
  const wind=a+ripple*.57;
  const rx=.626+.054*Math.sin(PI*f)+f*width+ripple*.43;
  const rz=.512+.060*Math.sin(PI*f)+.04*f+ripple*.31;
  const tuck=v<.052 ? .049*(1-v/.052) : 0;
  return [(rx-tuck)*signedPow(Math.sin(wind),.93)+sn*drop*f*f,y,
    -.049-.096*f+(rz-tuck)*signedPow(Math.cos(wind),.93)];
}
function mantle(parent,c,settings) {
  const border=settings.border, span=TAU-2*border;
  const shell=geometryGrid(52,21,(u,v)=>mantleShape(border+span*u,v,settings),false);
  mesh(parent,shell,dark(c,.08));
  // Looking up underneath a long cut reveals its inner surface; close the
  // back curtain and its side edges so the wearer can turn through 360°.
  const lining=(a,v)=>{
    const p=mantleShape(a,v,settings);
    p[0]-=.047*Math.sin(a);p[2]-=.046*Math.cos(a);p[1]+=.011*(1-v);
    return p;
  };
  const inner=geometryGrid(42,15,(u,v)=>lining(border+span*(1-u),v),false);
  mesh(parent,inner,dark(c,.27));
  const hem=geometryGrid(48,2,(u,v)=>{
    const a=border+span*u,inside=lining(a,0),outside=mantleShape(a,0,settings);
    return outside.map((x,k)=>mix(inside[k],x,v));
  },false);
  mesh(parent,hem,dark(c,.15));
  for(const side of [-1,1]){
    const a=side>0?border:TAU-border;
    const edge=geometryGrid(2,16,(u,v)=>{
      const f=side>0?u:1-u,inside=lining(a,v),outside=mantleShape(a,v,settings);
      return outside.map((x,k)=>mix(inside[k],x,f));
    },false);
    mesh(parent,edge,c);
  }
  const count=settings.count||15;
  for(let i=0;i<count;i++) {
    const a=border+span*i/(count-1),path=[];
    path.push(scalp(a-.12,.70,.09,.041));
    for(let j=0;j<=6;j++) {
      const v=1-j/6,p=mantleShape(a,v,settings);
      p[0]+=.023*Math.sin(a);p[2]+=.030*Math.cos(a);
      if(j===6)p[1]-=.027;
      path.push(p);
    }
    const width=settings.blunt?.092:.128;
    const widths=settings.blunt?[.019,width*.84,width,width,width*.88,.063,.011]:
      [.016,width*.86,width,width*.96,width*.83,width*.46,.003];
    lock(parent,i%3===0?pale(c,.028):c,path,widths,[.012,.034,.048,.055,.054,.032,.003],
      {out:[Math.sin(a),0,Math.cos(a)],steps:23});
  }
}
function waves(parent,c) {
  cap(parent,c,{front:1.065,back:.35,temple:.11,lift:.112,pad:.036});
  mantle(parent,c,{border:.86,end:-.65,amount:.20,width:.065,wave:.235,drop:.052,count:16});
  curtainFringe(parent,c);
  for(const s of [-1,1]){
    const path=[[s*.31,1.235,.366],[s*.531,.977,.455],[s*.636,.726,.363],
      [s*.588,.429,.395],[s*.678,.121,.322],[s*.659,-.19,.279],[s*.555,-.404,.281]];
    lock(parent,pale(c,.02),path,[.024,.113,.128,.137,.119,.085,.007],[.018,.062,.073,.074,.072,.050,.004],
      {out:[s*.66,0,.78],steps:25});
  }
}
function hime(parent,c) {
  cap(parent,c,{front:.897,back:.32,temple:.06,lift:.055,pad:.038,edge:.002});
  mantle(parent,c,{border:.83,end:-.64,amount:.045,width:-.008,wave:.033,drop:.003,blunt:true,count:13});
  // The detached, blunt cheek-length panels give the hime its double hem.
  for(const s of [-1,1]) {
    const panel=geometryGrid(17,12,(u,v)=>{
      const a=s>0?(.74+.48*u):(-1.22+.48*u),p=mantleShape(a,v,
        {end:.196,amount:.018,width:-.015,wave:.012,drop:0});
      p[0]+=.035*Math.sin(a);p[2]+=.075*Math.cos(a);return p;
    },false);
    mesh(parent,panel,pale(c,.018));
  }
  const bangs=geometryGrid(35,12,(u,v)=>{
    const a=(u-.5)*1.75,theta=mix(1.21+.009*Math.cos(a*9),.37,v);
    return scalp(a,theta,.058,.060+.008*Math.cos(a*10));
  },false);
  mesh(parent,bangs,c);
}
function shag(parent,c) {
  cap(parent,c,{front:.99,back:.35,lift:.12,pad:.035});
  mantle(parent,c,{border:1.03,end:-.215,amount:.23,width:.008,wave:.19,drop:.07,count:15});
  fringe(parent,c,{count:7,depth:.067,long:true});
  for(let i=0;i<15;i++){
    const a=.90+i*(TAU-1.8)/14,s=Math.sin(a),end=.22+.18*Math.cos(a*2.6);
    const path=[scalp(a-.25,.40,.13,.042),scalp(a-.11,.88,.12,.077),scalp(a,1.36,.08,.073),
      [.703*s,.62,.585*Math.cos(a)-.018],[.742*Math.sin(a+.08),end+.16,.626*Math.cos(a+.08)-.018],
      [.775*Math.sin(a+.13),end+.08,.638*Math.cos(a+.13)-.01]];
    lock(parent,i%3===0?pale(c,.031):c,path,.124,.060);
  }
}
function mullet(parent,c) {
  shortSides(parent,c);
  mantle(parent,c,{border:1.83,end:-.53,amount:.26,width:-.075,wave:.18,drop:0,count:10});
  cap(parent,c,{front:1.04,back:.62,temple:.11,lift:.077,pad:.026});
  for(let i=0;i<10;i++) {
    const a=(i-4.5)*.229, lean=.11+.071*Math.sin(i*1.71);
    const points=[scalp(a-.53,.27,.115,.049),scalp(a-.46,.49,.122+.018*Math.sin(i),.073),
      scalp(a-.25,.72,.098,.089),scalp(a+lean,.92,.099,.085),
      scalp(a+lean+.085,1.06+.075*Math.sin(i*1.67),.078,.068),
      scalp(a+lean+.16,1.18+.073*Math.sin(i*1.47),.073,.047)];
    lock(parent,i%3===1?pale(c,.026):c,points,.117,.053);
  }
}

function rosette(parent,c,center,radii,{lower=()=>PI-.003,texture=.075,frequency=7}={}) {
  const g=geometryGrid(44,24,(u,v)=>{
    const a=u*TAU,t=(1-v)*lower(a)+.002;
    const x=Math.sin(t)*Math.sin(a),y=Math.cos(t),z=Math.sin(t)*Math.cos(a);
    const bumps=(Math.sin(frequency*x+2.1*z)*Math.cos(frequency*y-3.3*z)
      +.63*Math.cos((frequency+2)*z-.7*x)*Math.sin(frequency*y+2.4*x))/1.63;
    const growth=1+texture*bumps;
    return [center[0]+radii[0]*x*growth,center[1]+radii[1]*y*growth,center[2]+radii[2]*z*growth];
  });
  return mesh(parent,g,c);
}
function cloud(parent,c) {
  cap(parent,dark(c,.08),{front:1.02,back:.39,temple:.09,lift:.04});
  rosette(parent,c,[0,1.03,-.057],[.861,.612,.679],{
    lower:a=>2.14-.37*Math.cos(a)+.023*Math.sin(7*a),texture:.108,frequency:8
  });
  // Draw tiny intersecting curl ridges directly along the surface. Their roots
  // share the shell and their tips soften its edge without separate ball shapes.
  const center=[0,1.03,-.057];
  for(let j=0;j<3;j++) {
    const count=[25,20,11][j];
    for(let i=0;i<count;i++){
      const a=TAU*(i+.42*j)/count;
      const theta=[1.99-.33*Math.cos(a),1.41,.78][j]+.047*Math.sin(i*2.5);
      const path=[];
      for(let k=0;k<=6;k++) {
        const t=k/6,phase=(.06+1.33*t)*PI,az=a+.085*Math.cos(phase),th=theta+.100*Math.sin(phase);
        const x=Math.sin(th)*Math.sin(az),y=Math.cos(th),z=Math.sin(th)*Math.cos(az);
        const noise=(Math.sin(8*x+2.1*z)*Math.cos(8*y-3.3*z)+.63*Math.cos(10*z-.7*x)*Math.sin(8*y+2.4*x))/1.63;
        const r=1+.108*noise;
        path.push([.861*x*r,1.03+.612*y*r,-.057+.679*z*r]);
      }
      lock(parent,i%4===0?pale(c,.019):c,path,[.010,.032,.040,.030,.006],[.007,.021,.027,.021,.004],
        {center,sides:6,steps:8});
    }
  }
}
function curlsRing(parent,c) {
  cap(parent,dark(c,.08),{front:1.01,back:.415,temple:.08,lift:.119,pad:.052});
  for(let j=0;j<2;j++){
    const n=j===0?17:11;
    for(let i=0;i<n;i++){
      const a=TAU*(i+.43*j)/n, t=j===0?1.51-.46*Math.cos(a):.69+.06*Math.sin(3*a);
      const p=scalp(a,t,.108,.079),rad=.098+.021*(1+Math.sin(i*6.72+j)),path=[];
      const normal=new THREE.Vector3(Math.sin(t)*Math.sin(a),Math.cos(t),Math.sin(t)*Math.cos(a));
      const h=new THREE.Vector3(Math.cos(a),0,-Math.sin(a));
      const v=new THREE.Vector3().crossVectors(normal,h);
      for(let k=0;k<=13;k++) {
        const q=k/13,angle=(.2+q*2.42)*PI,rr=rad*(1-.47*q);
        const point=new THREE.Vector3(...p).addScaledVector(h,rr*Math.cos(angle))
          .addScaledVector(v,rr*Math.sin(angle)).addScaledVector(normal,.034+.032*q);
        path.push(point.toArray());
      }
      lock(parent,i%3===0?pale(c,.024):c,path,[.031,.047,.047,.043,.037,.019],
        [.030,.045,.047,.043,.038,.019],{out:normal.toArray(),sides:7,steps:21});
    }
  }
}
function braid(parent,c,path,{width=.13,depth=width*.67,turns=3.4,taper=.64,out=[0,0,1]}={}) {
  const spine=new THREE.CatmullRomCurve3(path.map(p=>new THREE.Vector3(...p)));
  const n=Math.ceil(turns*8),axes=[],front=new THREE.Vector3(...out).normalize();
  let previous=null;
  for(let i=0;i<=n;i++){
    const t=i/n,dir=spine.getTangent(t).normalize();
    let right=new THREE.Vector3().crossVectors(front,dir);
    if(right.lengthSq()<.02)right=previous?previous.clone():new THREE.Vector3(1,0,0);
    right.addScaledVector(dir,-right.dot(dir)).normalize();
    if(previous && right.dot(previous)<0)right.negate();
    const facing=new THREE.Vector3().crossVectors(dir,right).normalize();
    axes.push({point:spine.getPoint(t),right,facing});previous=right;
  }
  for(let j=0;j<3;j++){
    const points=[];
    for(let i=0;i<=n;i++){
      const t=i/n,{point,right,facing}=axes[i],a=t*TAU*turns+j*TAU/3;
      const fall=mix(1,taper,t);
      points.push(point.clone().addScaledVector(right,Math.sin(a)*width*.52*fall)
        .addScaledVector(facing,Math.cos(a)*depth*.38*fall).toArray());
    }
    const thread=width*.48,end=thread*taper;
    lock(parent,j===0?pale(c,.022):j===1?c:dark(c,.095),points,
      [thread*.65,thread,thread*.96,(thread+end)/2,end,end*.66],
      [thread*.52,thread*.83,thread*.82,(thread+end)*.41,end*.8,end*.55],
      {out,sides:6,steps:n+2});
  }
}
function rowPoint(q,phi,lift,raise) {
  const free=Math.sqrt(Math.max(0,1-q*q));
  return scalp(Math.atan2(q,Math.sin(phi)*free),Math.acos(clip(Math.cos(phi)*free,-1,1)),lift,raise);
}
function cornrows(parent,c) {
  cap(parent,pale(c,.047),{front:.928,back:.437,temple:.13,lift:.027,pad:.020,edge:.005,waves:.002});
  for(let row=-4;row<=4;row++){
    const q=row*.199, start=1.095-.09*Math.abs(q), end=-1.785+.09*Math.abs(q);
    const path=[];
    for(let i=0;i<=10;i++){
      const t=i/10;
      path.push(rowPoint(q*(.98-.21*t)+.035*Math.sin(t*PI*1.2),mix(start,end,t),.060,.042));
    }
    // Raised, interlocking plaits and narrow partings follow the skull.
    braid(parent,c,path,{width:.047,depth:.071,turns:6.2,taper:.79,out:[1,0,0]});
    if(row%2===0) {
      const tip=path[path.length-1];
      const end=[tip[0]*.90,.259+.06*Math.abs(q),tip[2]-.032];
      cord(parent,[tip,[tip[0],.44,tip[2]-.047],end],[.025,.039,.019],c,{sides:7,steps:8});
    }
  }
}
function locs(parent,c) {
  cap(parent,dark(c,.11),{front:.987,back:.406,temple:.084,lift:.10,pad:.033});
  for(let i=0;i<21;i++){
    const a=TAU*(i+.12)/21,s=Math.sin(a),f=Math.cos(a);
    const front=smooth(.43,.99,f),lengthEnd=-.43+.19*Math.sin(i*2.17)+1.33*front;
    const az=a+.055*Math.sin(i), width=.062+.014*(.5+.5*Math.sin(i*3.71));
    const p0=scalp(a+.31,.35+.055*Math.sin(i),.136,.087);
    const p1=scalp(a+.15,.77,.120,.089),p2=scalp(a,1.12,.102,.087);
    const x=.690*Math.sin(az),z=.584*Math.cos(az)-.012;
    const transitions=[
      p0,p1,p2,
      [x,.801+.17*front,z+.014],
      [x+.028*Math.sin(i),mix(.768,lengthEnd,.51),z-.025+.041*Math.sin(i*2.3)],
      [x+.041*s+.061*Math.cos(i*2.1),lengthEnd+.070,z-.055+.032*Math.cos(i)],
      [x+.046*s+.058*Math.cos(i*2.1),lengthEnd,z-.055+.041*Math.cos(i)]
    ];
    // Front locs fall sideways into the temples instead of curling across the eyes.
    if(front>.58){
      const side=s<0?-1:1;
      transitions[3]=[x+.03*side,.973+.058*front,z+.018];
      transitions[4]=[x+.052*side,.929+.028*front,z+.025];
      transitions[5]=[x+.061*side,.891+.018*Math.cos(i),z+.022];
      transitions[6]=[x+.065*side,.856+.023*Math.cos(i),z+.013];
    }
    const tone=i%4===1?pale(c,.020):c;
    lock(parent,tone,transitions,[width*.6,width,width*1.10,width,width*.91,width*.83,width*.15],
      [width*.59,width*.95,width,width*.99,width*.90,width*.80,width*.15],
      {out:[s,.15,f],sides:8,steps:21});
    if([2,5,12,18].includes(i)){
      const end=transitions[5];
      trim(cord(parent,[[end[0],end[1]-.02,end[2]],[end[0],end[1]+.004,end[2]],
        [end[0],end[1]+.037,end[2]]],[width*.88,width*.99,width*.93],'#c59560',
        {out:[s,0,f],sides:9,steps:5,surface:'metal'}));
    }
  }
}
function twinBraids(parent,c) {
  cap(parent,c,{front:1.036,back:.428,temple:.124,lift:.057});
  combBack(parent,c,{count:11,top:.06});curtainFringe(parent,c,true);
  for(const s of [-1,1]){
    const path=[[s*.531,.842,-.297],[s*.645,.608,-.217],[s*.692,.385,-.047],
      [s*.641,.134,.110],[s*.566,-.112,.204],[s*.521,-.369,.245]];
    braid(parent,c,path,{width:.142,turns:4.25,taper:.54});
    ribbon(parent,[s*.521,-.363,.245],[.067,.033,.061],'#bd926d',[0,0,s*.08]);
    lock(parent,c,[[s*.519,-.374,.245],[s*.511,-.446,.242],[s*.506,-.510,.255],[s*.548,-.584,.281]],
      [.040,.071,.047,.004],[.032,.046,.033,.003],{out:[s*.44,0,1],steps:12});
  }
}
function circlet(parent,c) {
  cap(parent,c,{front:1.02,back:.406,temple:.08,lift:.073});
  combBack(parent,c,{count:13});
  const path=[];
  for(let i=0;i<=24;i++){
    const a=-PI/2+TAU*i/24;
    const theta=1.49-.46*Math.cos(a)-.068*Math.sin(a);
    path.push(scalp(a,theta,.077,.083));
  }
  braid(parent,c,path,{width:.119,depth:.128,turns:12.5,taper:.99,out:[0,1,0]});
  oval(parent,c,[-.18,.393,-.494],[.268,.175,.162],[.02,0,-.14]);
  for(const s of [-1,1]){
    scalpLock(parent,pale(c,.018),s*.73,s*1.20,.55,1.71,.059,.039,{lift:.073,pad:.036});
  }
}
function tailVolume(parent,c,path,width,depth,{sweep=0,out=[0,0,-1]}={}) {
  const spine=new THREE.CatmullRomCurve3(path.map(p=>new THREE.Vector3(...p)));
  const fall=[.28,.72,1,.88,.51,.04],steps=18,shape=[];
  const radii=t=>{
    const n=t*(fall.length-1),i=Math.min(fall.length-2,Math.floor(n));
    return mix(fall[i],fall[i+1],n-i);
  };
  for(let i=0;i<=steps;i++){
    const t=i/steps,axis=spine.getTangent(t).normalize();
    const right=new THREE.Vector3(1,0,0).addScaledVector(axis,-axis.x).normalize();
    const front=new THREE.Vector3().crossVectors(axis,right).normalize();
    shape.push({point:spine.getPoint(t),right,front});
  }
  const g=geometryGrid(22,steps,(u,v,j)=>{
    const a=u*TAU,r=radii(v),f=shape[j],bend=a+sweep*v;
    const ridge=1+.068*Math.cos(7*bend+.8*v);
    return f.point.clone().addScaledVector(f.right,r*width*Math.cos(bend)*ridge)
      .addScaledVector(f.front,r*depth*Math.sin(bend)*ridge).toArray();
  });
  mesh(parent,g,c);
  for(let i=0;i<7;i++){
    const path=[];
    for(let j=0;j<=steps;j+=3){
      const t=j/steps,f=shape[j],a=i*TAU/7+sweep*t+.11*Math.sin(t*PI),r=radii(t);
      path.push(f.point.clone().addScaledVector(f.right,r*width*.99*Math.cos(a))
        .addScaledVector(f.front,r*depth*1.005*Math.sin(a)).toArray());
    }
    lock(parent,i%3===0?pale(c,.030):c,path,[.013,.048,.055,.054,.034,.003],[.009,.028,.031,.029,.018,.002],
      {out,sides:7,steps:16});
  }
}
function pony(parent,c) {
  cap(parent,c,{front:1.014,back:.418,temple:.103,lift:.072});combBack(parent,c);
  const anchor=[.03,1.271,-.389];
  ribbon(parent,anchor,[.166,.142,.141],'#c58a60',[.49,0,.08]);
  tailVolume(parent,c,[anchor,[.136,1.449,-.490],[.255,1.427,-.674],[.307,1.138,-.790],
    [.328,.779,-.777],[.315,.429,-.704],[.213,.114,-.629],[.051,-.119,-.713]],
    .199,.143,{sweep:.48});
  scalpLock(parent,pale(c,.019),-.16,-.99,.23,1.57,.111,.061,{curve:.21,lift:.083,pad:.044});
}
function bubble(parent,c) {
  cap(parent,c,{front:1.01,back:.415,temple:.086,lift:.083});combBack(parent,c);
  curtainFringe(parent,c,true);
  const spine=[[.404,1.328,-.338],[.652,1.320,-.492],[.822,.997,-.570],
    [.857,.593,-.575],[.781,.287,-.607]];
  cord(parent,spine,[.071,.087,.089,.071,.034],c,{sides:8,steps:17,out:[0,0,1]});
  const puff=[
    [.404,1.328,-.338,.154,.152,.138,.41],
    [.652,1.320,-.492,.209,.184,.165,.72],
    [.822,.997,-.570,.185,.219,.160,.25],
    [.857,.593,-.575,.141,.192,.129,-.11],
    [.781,.287,-.607,.087,.128,.093,-.23]
  ];
  for(const [x,y,z,rx,ry,rz,a] of puff) {
    oval(parent,c,[x,y,z],[rx,ry,rz],[.04,0,-a]);
    const pts=[[x-rx*.41,y+ry*.75,z+rz*.52],[x-rx*.50,y,z+rz*.79],[x-rx*.21,y-ry*.73,z+rz*.60]];
    lock(parent,pale(c,.028),pts,[.004,.024,.003],[.003,.013,.002],{out:[.1,0,1],steps:9});
  }
  const bands=[[.495,1.355,-.400,.10,.035,.10,.68],[.767,1.183,-.535,.105,.031,.099,.38],
    [.852,.803,-.572,.084,.032,.078,.02],[.826,.422,-.595,.066,.027,.061,-.16]];
  for(const [x,y,z,rx,ry,rz,a] of bands)ribbon(parent,[x,y,z],[rx,ry,rz],'#cdb98d',[0,0,-a]);
}
function pigtails(parent,c) {
  cap(parent,c,{front:1.0,back:.407,temple:.077,lift:.061});fringe(parent,c,{count:7,part:.07,depth:.053});
  for(const s of [-1,1]){
    const base=[s*.514,1.20,-.228];
    ribbon(parent,base,[.131,.091,.105],'#bb8b83',[0,0,s*.69]);
    tailVolume(parent,c,[base,[s*.773,1.315,-.316],[s*.874,1.191,-.354],[s*.947,.940,-.327],
      [s*.946,.646,-.282],[s*.868,.340,-.252],[s*.724,.164,-.306]],
      .141,.128,{sweep:s*.41,out:[s*.70,0,1]});
  }
}
function puffs(parent,c) {
  cap(parent,c,{front:1.025,back:.398,temple:.132,lift:.048});
  combBack(parent,c,{count:13,top:.048});
  for(const s of [-1,1]){
    ribbon(parent,[s*.510,1.155,-.108],[.134,.138,.13],'#ca977b',[0,0,s*.65]);
    const p=[s*.662,1.315,-.129];
    rosette(parent,c,p,[.317,.302,.289],{texture:.14,frequency:5});
    for(let i=0;i<8;i++){
      const a=i*TAU/8;
      oval(parent,i%3===0?pale(c,.018):c,[p[0]+.278*Math.cos(a),p[1]+.24*Math.sin(a),p[2]+.057*Math.cos(2*a)],
        [.098,.108,.101],[a,.20,0],'soft',true);
    }
    scalpLock(parent,c,s*.21,s*.93,.25,1.39,.064,.039,{lift:.07,pad:.028});
  }
}
function knot(parent,c) {
  cap(parent,c,{front:1.026,back:.424,temple:.130,lift:.056});
  combBack(parent,c,{count:14,top:.055});
  const p=[.024,1.425,-.10];
  ribbon(parent,[.026,1.311,-.091],[.196,.057,.174],'#ad8570');
  oval(parent,c,p,[.257,.211,.218],[.12,0,-.13]);
  for(let i=0;i<7;i++){
    const pts=[];
    for(let j=0;j<=9;j++){
      const t=j/9,b=-.72*PI+t*1.39*PI,a=i*TAU/7+.99*t;
      pts.push([p[0]+.253*Math.cos(b)*Math.sin(a),p[1]+.200*Math.sin(b),p[2]+.214*Math.cos(b)*Math.cos(a)]);
    }
    lock(parent,i%3===0?pale(c,.022):c,pts,.052,.039,{center:p,sides:7,steps:15});
  }
  scalpLock(parent,c,.36,.94,.29,1.57,.061,.037,{lift:.077,pad:.041});
  scalpLock(parent,c,-.51,-1.19,.51,1.67,.047,.031,{lift:.061,pad:.043});
}
function hawk(parent,c) {
  shortSides(parent,tint(c,'#463b44',.66));
  const keel=geometryGrid(15,26,(u,v)=>{
    const phi=mix(1.22,-1.92,v),a=TAU*u;
    const halfway=Math.sin(v*PI);
    const base=rowPoint(0,phi,.048,.026);
    const thickness=.091*Math.pow(halfway,.55)+.004;
    const ridge=.165*Math.pow(halfway,.60)*(.88+.12*Math.cos(8*PI*v));
    return [thickness*Math.cos(a),base[1]+ridge*Math.cos(phi)*(1+Math.sin(a)),
      base[2]+ridge*Math.sin(phi)*(1+Math.sin(a))];
  });
  mesh(parent,keel,c);
  for(let j=0;j<8;j++) {
    const a=j/7, phi=mix(1.04,-1.77,a);
    const base=rowPoint(0,phi,.052,.032);
    const h=.265+.228*Math.sin(PI*(a+.13)),x=.035*Math.cos(j*2.35);
    const dy=Math.cos(phi),dz=Math.sin(phi);
    const pts=[[0,base[1]-.033*dy,base[2]-.029*dz],
      [x*.33,base[1]+.103*dy+.025,base[2]+.075*dz],
      [x*.80,base[1]+h*.67*dy+.055,base[2]+h*.55*dz-.044],
      [x+.043,base[1]+h*dy+.087,base[2]+h*.83*dz-.127]];
    // Using lateral out makes each crest section broad in profile and slim head-on.
    lock(parent,j%3===1?pale(c,.034):c,pts,[.078,.121,.095,.002],[.114,.143,.084,.002],
      {out:[1,0,0],sides:9,steps:12});
  }
}
function victory(parent,c) {
  cap(parent,c,{front:1.078,back:.345,temple:.098,lift:.064,pad:.025});
  for(const s of [-1,1]){
    const pts=[],center=[s*.327,1.155,.303];
    for(let i=0;i<=19;i++){
      const t=i/19,a=mix(-.83,1.84,t)*PI,rad=mix(.236,.052,t);
      pts.push([center[0]+s*rad*Math.cos(a),center[1]+rad*Math.sin(a),
        center[2]+.135*Math.sin(t*1.2)+.052*Math.cos(a)]);
    }
    lock(parent,c,pts,[.035,.112,.107,.082,.066,.020],[.025,.13,.119,.087,.061,.014],
      {out:[0,0,1],sides:10,steps:33});
    scalpLock(parent,pale(c,.018),s*.36,s*1.61,.35,1.89,.133,.067,{lift:.081,pad:.061,curve:s*.23});
    const back=[s*.31,.405,-.45];
    oval(parent,c,back,[.223,.132,.164],[.28,s*.36,s*.48]);
  }
}
function chignon(parent,c) {
  cap(parent,c,{front:1.067,back:.402,temple:.088,lift:.042,pad:.021});
  for(let i=0;i<16;i++){
    const a=(i/15*2-1)*2.81;
    const path=[scalp(a*.62,.19,.063,.032),scalp(a*.92,.72,.064,.039),scalp(a*1.07,1.14,.054,.044),
      scalp(a<0?mix(a,-2.78,.50):mix(a,2.78,.50),1.67,.046,.034),[.14,.417,-.545]];
    lock(parent,i%4===0?pale(c,.021):c,path,[.014,.057,.067,.052,.010],[.009,.023,.029,.024,.008],
      {steps:18,sides:7});
  }
  const ctr=[.264,.403,-.558];
  oval(parent,c,ctr,[.265,.180,.189],[.19,.31,-.21]);
  const coil=[];
  for(let i=0;i<=21;i++){
    const t=i/21,a=t*TAU*1.65-.35,rad=.233-.166*t;
    coil.push([ctr[0]+rad*Math.cos(a),ctr[1]+.71*rad*Math.sin(a),ctr[2]-.128-.019*t]);
  }
  lock(parent,pale(c,.021),coil,[.028,.071,.064,.040,.009],[.020,.047,.039,.029,.008],{out:[0,0,-1],steps:27});
  for(const s of [-1,1])scalpLock(parent,c,s*.19,s*.93,.30,1.40,.083,.041,
    {lift:.062,pad:.030,curve:-s*.21});
}
const styles={
  bald:()=>{},buzz,crop:french,pixie,quiff,curtains,afro:cloud,coils:curlsRing,cornrows,
  locs,twinbraids:twinBraids,crown:circlet,ponytail:pony,bubble,pigtails,puffs,topknot:knot,
  mohawk:hawk,mullet,shag,longwaves:waves,hime,victory,chignon
};
export function drawHairStyle(parent,id,color) {
  const draw=styles[id];
  if(!draw)return false;
  draw(parent,color);
  return true;
}

// A radial mask follows the hair around the head, including its rear surface.
// Preserve the original geometry in case a renderer reuses a wig between edits.
const originalGeometry=new WeakMap();
export function applyHairDye(hairGroup,mode,color) {
  const tinted=mode==='tips'||mode==='split'||mode==='streaks';
  const pieces=[];
  hairGroup.traverse(piece=>{
    if(!piece.isMesh||piece.userData.hairTrim)return;
    const original=originalGeometry.get(piece);
    if(original){
      if(piece.geometry!==original)piece.geometry.dispose();
      piece.geometry=original;
      originalGeometry.delete(piece);
    }
    if(tinted&&piece.userData.paint)pieces.push(piece);
  });
  if(!pieces.length)return;
  hairGroup.updateWorldMatrix(true,true);
  const inverse=hairGroup.matrixWorld.clone().invert();
  const point=new THREE.Vector3(),matrix=new THREE.Matrix4(),target=new THREE.Color(color);
  const base=new THREE.Color(),paint=new THREE.Color();
  let minY=Infinity,maxY=-Infinity;
  for(const piece of pieces){
    matrix.multiplyMatrices(inverse,piece.matrixWorld);
    const pos=piece.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      const y=point.fromBufferAttribute(pos,i).applyMatrix4(matrix).y;
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
  }
  for(const piece of pieces){
    matrix.multiplyMatrices(inverse,piece.matrixWorld);
    const geo=piece.geometry;
    originalGeometry.set(piece,geo);
    const next=geo.clone(),pos=next.attributes.position,existing=geo.attributes.color;
    const colors=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++){
      point.fromBufferAttribute(pos,i).applyMatrix4(matrix);
      const angle=Math.atan2(point.x,point.z+.027),front=Math.max(0,Math.cos(angle));
      let t;
      if(mode==='split'){
        t=smooth(-.026,.026,point.x+.022*Math.sin(3.1*point.y));
      }else if(mode==='tips'){
        const height=(maxY-point.y)/Math.max(.18,maxY-minY);
        t=smooth(.43,.89,height+.22*front);
      }else{
        const curl=3*angle+.72*point.y+.35*Math.sin(angle*2+.35);
        t=smooth(.48,.88,Math.cos(curl))*.96;
      }
      if(existing)base.fromBufferAttribute(existing,i);else base.copy(piece.userData.paint);
      paint.copy(base).lerp(target,t).toArray(colors,i*3);
    }
    next.setAttribute('color',new THREE.BufferAttribute(colors,3));
    piece.geometry=next;
  }
}
