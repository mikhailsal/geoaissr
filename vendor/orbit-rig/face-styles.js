import {
  THREE, PI, TAU, mesh, oval, strand, geometryGrid, tint, dark,
  faceZ, faceStroke
} from './model-kit.js';

export const eyeStyles = [
  {id:'classic',name:'Classic'}, {id:'round',name:'Round'},
  {id:'almond',name:'Almond'}, {id:'sleepy',name:'Half-lidded'},
  {id:'wide',name:'Wide oval'}, {id:'winged',name:'Winged liner'},
  {id:'doe',name:'Doe eyes'}, {id:'cat',name:'Cat eyes'},
  {id:'star',name:'Star pupils'}, {id:'bead',name:'Bead eyes'}
];
export const browStyles = [
  {id:'classic',name:'Classic arch'}, {id:'straight',name:'Straight'},
  {id:'bold',name:'Bold'}, {id:'arched',name:'High arch'},
  {id:'rounded',name:'Rounded'}, {id:'slim',name:'Fine line'},
  {id:'angular',name:'Angled'}, {id:'notched',name:'Notched'},
  {id:'feathered',name:'Feathered'}, {id:'none',name:'No brows'}
];
export const noseStyles = [
  {id:'button',name:'Button'}, {id:'small',name:'Petite'},
  {id:'broad',name:'Broad'}, {id:'upturn',name:'Upturned'},
  {id:'straight',name:'Straight bridge'}, {id:'aquiline',name:'Aquiline'},
  {id:'round',name:'Rounded tip'}, {id:'softsquare',name:'Soft square'}
];
export const freckleStyles = [
  {id:'none',name:'Clear'}, {id:'light',name:'Light freckles'},
  {id:'bridge',name:'Sun-kissed'}, {id:'cluster',name:'Cheek clusters'},
  {id:'dense',name:'Full freckles'}, {id:'pearl',name:'Pearl specks'}
];
export const faceMarks = [
  {id:'none',name:'No mark'}, {id:'spot',name:'Beauty spot'},
  {id:'bandage',name:'Cheek bandage'}, {id:'star',name:'Star stickers'},
  {id:'heart',name:'Heart sticker'}, {id:'bolt',name:'Lightning bolt'},
  {id:'scar',name:'Fine scar'}, {id:'stripes',name:'Racing stripes'},
  {id:'constellation',name:'Constellation'}, {id:'whiskers',name:'Whiskers'},
  {id:'moon',name:'Crescent moon'}, {id:'daisy',name:'Daisy'},
  {id:'birthmark',name:'Birthmark'}, {id:'patches',name:'Pigment patches'}
];

const chocolate='#543a2b';
const liner='#322b38';
const pupil='#21212b';
const ivory='#fff2db';

function starPoints(radius, count=5, inner=.45) {
  const points=[];
  for(let i=0;i<count*2;i++) {
    const angle=PI/2+i*PI/count, r=i%2?radius*inner:radius;
    points.push([Math.cos(angle)*r, Math.sin(angle)*r]);
  }
  return points;
}

// A nose or cheek is curved enough that a flat sticker will float at its
// corners. Project the entire polygon, including any interior diagonals.
function polygon(parent,points,depth,color) {
  const outline=points.map(([x,y])=>new THREE.Vector2(x,y));
  const triangles=THREE.ShapeUtils.triangulateShape(outline,[]);
  const vertices=points.slice(), idx=[], midpoints=new Map();
  function midpoint(a,b) {
    const key=a<b ? a+','+b : b+','+a;
    if(midpoints.has(key))return midpoints.get(key);
    const v=vertices[a],w=vertices[b],i=vertices.length;
    vertices.push([(v[0]+w[0])*.5,(v[1]+w[1])*.5]);
    midpoints.set(key,i);
    return i;
  }
  function edgeLength(a,b) {
    return (vertices[a][0]-vertices[b][0])**2+(vertices[a][1]-vertices[b][1])**2;
  }
  function triangulate(a,b,c) {
    const ab=edgeLength(a,b),bc=edgeLength(b,c),ca=edgeLength(c,a);
    const longest=Math.max(ab,bc,ca);
    if(longest<=.036*.036) {idx.push(a,b,c);return;}
    if(longest===bc){[a,b,c]=[b,c,a];}
    else if(longest===ca){[a,b,c]=[c,a,b];}
    const middle=midpoint(a,b);
    triangulate(a,middle,c);triangulate(middle,b,c);
  }
  for(const [a,b,c] of triangles) {
    const A=points[a],B=points[b],C=points[c];
    const forward=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0])>0;
    triangulate(a,forward?b:c,forward?c:b);
  }
  const pos=vertices.flatMap(([x,y])=>[x,y,depth(x,y)]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  return mesh(parent,geometry,color);
}

function headDecal(parent,cx,cy,points,color,angle=0,offset=.008) {
  const cs=Math.cos(angle),sn=Math.sin(angle);
  const projected=points.map(([x,y])=>[cx+x*cs-y*sn,cy+x*sn+y*cs]);
  return polygon(parent,projected,(x,y)=>faceZ(x,y)+offset,color);
}

const eyes = {
  round:  {width:.111, height:.109, irisX:.076, irisY:.083, pupilX:.046, pupilY:.057, taper:0, tilt:0},
  almond: {width:.131, height:.075, irisX:.067, irisY:.059, pupilX:.039, pupilY:.043, taper:.46, tilt:.13},
  sleepy: {width:.121, height:.071, irisX:.059, irisY:.040, pupilX:.039, pupilY:.032, taper:.12, tilt:.035, top:.45, y:-.015},
  wide:   {width:.142, height:.091, irisX:.068, irisY:.072, pupilX:.040, pupilY:.050, taper:.06, tilt:-.025, x:-.006},
  winged: {width:.120, height:.081, irisX:.064, irisY:.061, pupilX:.038, pupilY:.044, taper:.43, tilt:.22},
  doe:    {width:.109, height:.125, irisX:.077, irisY:.096, pupilX:.046, pupilY:.065, taper:.07, tilt:-.065},
  cat:    {width:.137, height:.076, irisX:.077, irisY:.060, pupilX:.018, pupilY:.053, taper:.50, tilt:.23},
  star:   {width:.111, height:.113, irisX:.081, irisY:.089, pupilX:.045, pupilY:.059, taper:.04, tilt:0}
};

function lens(parent,side,style,width,height,base,depth,color) {
  const sides=32, shells=5;
  const vertices=[0,0,base+depth],indices=[];
  for(let j=1;j<=shells;j++) {
    const r=j/shells;
    for(let i=0;i<sides;i++) {
      const a=i*TAU/sides, u=Math.cos(a),v=Math.sin(a),x=r*u*width;
      const upper=v>0 ? (style.top||1) : 1;
      const y=r*v*height*(1-style.taper*u*u)*upper+side*x*style.tilt;
      vertices.push(x,y,base+depth*(1-r*r));
      const here=1+(j-1)*sides+i,next=1+(j-1)*sides+(i+1)%sides;
      if(j===1)indices.push(0,here,next);
      else indices.push(here-sides,here,next,next, next-sides,here-sides);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  mesh(parent,geometry,color,'gloss');
}

function lid(parent,side,style,id) {
  const {width,height,tilt,taper}=style;
  const points=[];
  for(let i=0;i<=8;i++) {
    const u=-.9+1.84*i/8, x=width*u;
    const y=height*Math.sqrt(1-u*u)*(1-taper*u*u)*(style.top||1)+x*tilt;
    points.push([side*x,y,.028]);
  }
  const thick=id==='winged' ? .013 : .008;
  strand(parent,points,[.001,thick*.75,thick,thick*.8,.003],[.001,.004,.004,.003,.001],liner,{steps:17,sides:6});
  if(id==='winged') {
    const x=width*.78;
    polygon(parent,[[side*x,.055],[side*(width+.045),.087],[side*(width-.006),.025]],()=>.031,liner);
  }
  if(id==='doe') {
    for(const [u,length] of [[.56,.025],[.78,.031],[.92,.028]]) {
      const x=width*u,y=height*Math.sqrt(1-u*u)+x*tilt;
      strand(parent,[[side*x,y,.025],[side*(x+.01),y+.012,.026],[side*(x+length),y+length,.028]],
        [.009,.006,.001],[.003,.003,.001],liner,{steps:7,sides:5});
    }
  }
}

export function drawEye(eye,side,id,eyeColor=chocolate) {
  const color=eyeColor||chocolate;
  if(id==='classic') {
    const original=color.toLowerCase()===chocolate;
    oval(eye,'#332b32',[0,0,.004],[.084,.117,.041],null,'gloss');
    oval(eye,color,[0,original?-.024:-.006,.031],[original ? .059 : .073,original ? .074 : .101,.017],null,'gloss',true);
    oval(eye,'#241f29',[.0005,.012,.036],[original ? .062 : .043,original ? .083 : .067,.019],null,'gloss');
    oval(eye,'#fff9e9',[-.019,.052,.053],[.021,.026,.006],null,'gloss',true);
    oval(eye,'#d2b7a5',[.027,-.041,.049],[.008,.008,.003],null,'gloss',true);
    return;
  }
  if(id==='bead') {
    oval(eye,dark(color,.47),[0,0,.009],[.057,.072,.038],null,'gloss');
    oval(eye,color,[0,-.007,.041],[.043,.047,.012],null,'gloss',true);
    oval(eye,pupil,[.001,.007,.049],[.026,.034,.008],null,'gloss',true);
    oval(eye,ivory,[-.011,.024,.056],[.011,.014,.005],null,'gloss',true);
    return;
  }
  const style=eyes[id]||eyes.round;
  const {width,height,irisX,irisY,pupilX,pupilY}=style;
  lens(eye,side,style,width,height,.012,.025,liner);
  lens(eye,side,style,width*.925,height*.87,.018,.025,ivory);
  const cx=(style.x||0)*side,cy=style.y||0;
  oval(eye,dark(color,.34),[cx,cy,.040],[irisX,irisY,.013],null,'gloss');
  oval(eye,color,[cx,cy-.002,.049],[irisX*.87,irisY*.87,.012],null,'gloss');
  if(id==='star') {
    polygon(eye,starPoints(.057).map(([x,y])=>[cx+x,cy+y]),()=>.064,pupil);
  } else {
    oval(eye,pupil,[cx,cy+.003,.056],[pupilX,pupilY,.012],null,'gloss',true);
  }
  const glint=id==='sleepy' ? .010 : .015;
  oval(eye,'#fffaf0',[cx-irisX*.29,cy+irisY*.33,.068],[glint,glint*1.15,.004],null,'gloss',true);
  oval(eye,'#dfdacb',[cx+irisX*.31,cy-irisY*.38,.063],[.006,.006,.003],null,'gloss',true);
  if(['almond','winged','sleepy','doe','cat'].includes(id))lid(eye,side,style,id);
}

const browShapes = {
  straight: {pts:[[.127,.745],[.166,.758],[.251,.764],[.336,.763],[.412,.756]],w:[.005,.025,.024,.018,.002]},
  bold:     {pts:[[.123,.747],[.151,.766],[.230,.784],[.293,.786],[.359,.780],[.420,.756]],w:[.010,.033,.040,.035,.023,.003]},
  arched:   {pts:[[.129,.735],[.176,.756],[.250,.798],[.311,.812],[.370,.792],[.411,.762]],w:[.003,.016,.025,.021,.012,.0015]},
  rounded:  {pts:[[.120,.744],[.178,.778],[.257,.790],[.327,.785],[.389,.762],[.408,.747]],w:[.004,.021,.029,.024,.014,.001]},
  slim:     {pts:[[.127,.757],[.182,.773],[.267,.790],[.335,.786],[.411,.757]],w:[.002,.008,.010,.007,.001]},
  angular:  {pts:[[.130,.727],[.169,.741],[.242,.773],[.321,.805],[.342,.797],[.419,.754]],w:[.005,.027,.026,.017,.015,.001]},
  feathered:{pts:[[.122,.746],[.159,.759],[.226,.780],[.306,.790],[.375,.777],[.418,.757]],w:[.003,.022,.027,.024,.014,.002]}
};
function browCurve(parent,side,pts,widths,color,thickness=.015) {
  faceStroke(parent,pts.map(([x,y])=>[side*x,y]),widths,widths.map(w=>Math.max(.001,w*.55)),color,thickness);
}
export function drawBrow(brow,side,id,hairColor) {
  if(id==='none')return;
  const col=dark(hairColor,.10);
  if(id==='classic') {
    const lift=side<0 ? .011 : 0;
    faceStroke(brow,[[side*.128,.748+lift],[side*.165,.759+lift],[side*.240,.774+lift],[side*.309,.774+lift],[side*.362,.765+lift],[side*.405,.752+lift]],
      [.004,.019,.023,.019,.013,.002],[.003,.011,.014,.011,.007,.002],col,.018);
    return;
  }
  if(id==='notched') {
    browCurve(brow,side,[[.122,.741],[.160,.755],[.242,.780],[.286,.786]], [.005,.027,.030,.020],col);
    browCurve(brow,side,[[.313,.787],[.340,.787],[.385,.772],[.420,.755]], [.017,.023,.015,.002],col);
    return;
  }
  const form=browShapes[id]||browShapes.rounded;
  browCurve(brow,side,form.pts,form.w,col);
  if(id==='feathered') {
    for(let i=0;i<6;i++) {
      const x=.145+.033*i, y=.767+.025*Math.sin((i+.5)*PI/7);
      browCurve(brow,side,[[x,y-.014],[x+.005,y+.001],[x+.016,y+.019]],
        [.003,.005,.001],tint(col,'#c8aa89',.045),.022);
    }
  }
}

// Cross-sections start just above the smile and finish on the bridge.
// Each entry gives the height, half-width and forward projection.
const noseRows = {
  small: [
    [.380,.016,0],[.389,.041,.031],[.407,.057,.059],[.427,.051,.063],[.449,.035,.037],[.475,.020,0]
  ],
  broad: [
    [.345,.025,0],[.357,.085,.035],[.375,.117,.081],[.404,.134,.114],[.432,.099,.109],[.470,.060,.050],[.535,.030,0]
  ],
  upturn: [
    [.361,.020,0],[.375,.055,.039],[.400,.086,.091],[.425,.090,.124],[.453,.066,.103],[.473,.042,.055],[.518,.029,0]
  ],
  straight: [
    [.346,.023,0],[.364,.054,.051],[.385,.066,.108],[.423,.061,.117],[.490,.053,.093],[.556,.043,.060],[.605,.021,0]
  ],
  aquiline: [
    [.347,.019,0],[.363,.048,.063],[.384,.058,.114],[.420,.064,.142],[.466,.064,.146],[.512,.054,.108],[.566,.037,.042],[.596,.020,0]
  ],
  round: [
    [.344,.028,0],[.360,.070,.045],[.390,.096,.105],[.426,.096,.145],[.455,.079,.126],[.480,.053,.066],[.526,.027,0]
  ],
  softsquare: [
    [.352,.036,0],[.365,.087,.057],[.384,.102,.095],[.414,.101,.107],[.449,.085,.098],[.484,.056,.056],[.539,.032,0]
  ]
};
function sectionValue(rows,i,t,col) {
  const a=rows[Math.max(0,i-1)][col],b=rows[i][col],c=rows[i+1][col],d=rows[Math.min(rows.length-1,i+2)][col];
  return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
}
export function drawNose(head,id,skin) {
  if(id==='button') {
    oval(head,tint(skin,'#da8e6a',.19),[0,.421,faceZ(0,.421)-.005],[.086,.070,.090],[.10,0,0]);
    return;
  }
  const rows=noseRows[id]||noseRows.small;
  const base=new THREE.Color(skin),tip=base.clone().lerp(new THREE.Color('#ca7f64'),.135);
  const colors=[];
  const geo=geometryGrid(26,3*(rows.length-1),(u,v)=>{
    const q=v*(rows.length-1),i=Math.min(Math.floor(q),rows.length-2),f=q-i;
    const y=sectionValue(rows,i,f,0), w=sectionValue(rows,i,f,1), d=Math.max(0,sectionValue(rows,i,f,2));
    const across=2*u-1,x=across*w;
    const shape=id==='softsquare'?Math.pow(1-Math.pow(Math.abs(across),3.5),.8):Math.pow(1-across*across,.76);
    const depth=d*shape;
    const warm=Math.min(1,depth/.07);
    colors.push(base.r+(tip.r-base.r)*warm,base.g+(tip.g-base.g)*warm,base.b+(tip.b-base.b)*warm);
    return [x,y,faceZ(x,y)+depth+.002];
  },false);
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  mesh(head,geo,skin);
  if(['broad','upturn','round','softsquare'].includes(id)) {
    const wide=id==='broad'||id==='softsquare';
    for(const s of [-1,1]) {
      const x=(wide ? .079 : .056)*s,y=id==='upturn' ? .393 : .381;
      const z=faceZ(x,y)+(wide ? .049 : .053);
      oval(head,dark(tint(skin,'#ad6458',.23),.20),[x,y,z],[wide ? .015 : .011,.007,.005],[-.36,s*.39,s*-.12],'soft',true);
    }
  }
}

function roundedSpots(head,spots,color,depth=.0065) {
  if(!spots.length)return;
  const vertices=[],index=[],sides=12;
  for(const [x,y,r,stretch=.84,angle=0] of spots) {
    const start=vertices.length/3,cs=Math.cos(angle),sn=Math.sin(angle);
    vertices.push(x,y,faceZ(x,y)+depth+.001);
    for(let i=0;i<sides;i++) {
      const a=i*TAU/sides, dx=r*Math.cos(a),dy=r*stretch*Math.sin(a);
      const px=x+dx*cs-dy*sn,py=y+dx*sn+dy*cs;
      vertices.push(px,py,faceZ(px,py)+depth);
      index.push(start,start+i+1,start+(i+1)%sides+1);
    }
  }
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.setIndex(index);geom.computeVertexNormals();
  mesh(head,geom,color);
}
const dust = [
  [.145,.432,.006],[.182,.454,.008],[.209,.427,.006],[.240,.447,.009],
  [.269,.411,.007],[.305,.436,.009],[.326,.402,.011],[.350,.459,.007],
  [.370,.420,.012],[.389,.384,.007],[.410,.452,.006],[.428,.405,.011],
  [.451,.440,.008],[.479,.409,.007],[.507,.426,.005]
];
export function drawFreckles(head,id,skin) {
  if(id==='none')return;
  if(id==='light') {
    const original=[[.338,.403,.008],[.374,.425,.010],[.410,.395,.009],[.451,.416,.006],[.475,.389,.006]];
    for(const s of [-1,1]) original.forEach(([dx,dy,r],i)=>{
      const x=s*dx,y=dy+(s>0&&i%2 ? .011 : 0);
      oval(head,dark(skin,.49),[x,y,faceZ(x,y)+.006],[r,r*.76,.004],[0,s*.45,0],'soft',true);
    });
    return;
  }
  const spots=[];
  const spread=(source,s)=>{
    source.forEach(([dx,dy,r],i)=>{
      const y=dy+(s>0 ? .009*Math.sin(i*2+1) : 0);
      spots.push([dx*s,y,r,.76+.18*((i%3)/2),s*(i%3)*.19]);
    });
  };
  for(const s of [-1,1]) {
    if(id==='bridge'||id==='dense')spread(dust,s);
    if(id==='cluster'||id==='pearl') {
      const pattern=[[.299,.407,.010],[.329,.435,.013],[.356,.391,.008],[.386,.432,.014],[.410,.406,.010],[.438,.450,.008],[.464,.399,.009]];
      spread(pattern,s);
    }
    if(id==='dense') {
      spread([[.219,.394,.006],[.265,.464,.007],[.295,.387,.008],[.322,.365,.009],[.346,.398,.006],
        [.365,.349,.008],[.399,.364,.010],[.432,.372,.007],[.458,.354,.008],[.491,.376,.006],[.519,.394,.005]],s);
    }
  }
  roundedSpots(head,spots,id==='pearl'?tint(skin,'#fff0cb',.74):dark(skin,id==='dense' ? .57 : .52));
}

function softRect(w,h,r) {
  const shape=new THREE.Shape(),x=w/2,y=h/2;
  shape.moveTo(-x+r,-y);shape.lineTo(x-r,-y);shape.quadraticCurveTo(x,-y,x,-y+r);
  shape.lineTo(x,y-r);shape.quadraticCurveTo(x,y,x-r,y);shape.lineTo(-x+r,y);
  shape.quadraticCurveTo(-x,y,-x,y-r);shape.lineTo(-x,-y+r);shape.quadraticCurveTo(-x,-y,-x+r,-y);
  return shape.getPoints(4).slice(0,-1).map(v=>[v.x,v.y]);
}
function star(head,x,y,r,color) {headDecal(head,x,y,starPoints(r),color,.16);}
function streak(head,pts,widths,col,extra=.009) {faceStroke(head,pts,widths,widths.map(w=>Math.min(.0035,w)),col,extra);}
function organicPatch(head,x,y,rx,ry,color,phase) {
  const pts=[];
  for(let i=0;i<40;i++){
    const t=i*TAU/40;
    const k=1+.135*Math.sin(3*t+phase)+.11*Math.sin(5*t-phase)+.045*Math.cos(8*t+phase);
    pts.push([Math.cos(t)*rx*k,Math.sin(t)*ry*k]);
  }
  headDecal(head,x,y,pts,color,-.2,.007);
}
export function drawMark(head,id,skin) {
  switch(id) {
    case 'spot':
      roundedSpots(head,[[-.235,.307,.020,.90]],dark(skin,.71));
      break;
    case 'bandage': {
      const x=.395,y=.385, angle=-.30, base='#d99971';
      headDecal(head,x,y,softRect(.200,.077,.022),dark(base,.34),angle,.009);
      headDecal(head,x,y+.002,softRect(.193,.069,.019),base,angle,.013);
      headDecal(head,x,y,softRect(.072,.057,.009),'#efcba5',angle,.017);
      const holes=[];
      for(const s of [-1,1])for(const dy of [-.011,.011])for(const dx of [.055,.071]){
        const xx=dx*s,c=Math.cos(angle),n=Math.sin(angle);
        holes.push([x+xx*c-dy*n,y+xx*n+dy*c,.003,.9]);
      }
      roundedSpots(head,holes,'#a97555',.018);
      break;
    }
    case 'star':
      star(head,-.388,.394,.065,'#ffd063');star(head,-.468,.442,.028,'#bf9eff');break;
    case 'heart': {
      const contour=[];
      for(let i=0;i<50;i++) {
        const t=-i*TAU/50;
        contour.push([.0034*16*Math.sin(t)**3,.0037*(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))]);
      }
      headDecal(head,.396,.396,contour,'#e27389',-.15);
      streak(head,[[.365,.407],[.373,.419],[.382,.421]],[.003,.004,.001],'#ffd3dc',.011);
      break;
    }
    case 'bolt':
      headDecal(head,-.409,.404,[[-.009,.086],[.050,.086],[.008,.017],[.047,.017],[-.057,-.090],[-.014,-.011],[-.052,-.011]],'#ffd46a',-.09);break;
    case 'scar':
      streak(head,[[.466,.479],[.442,.447],[.416,.414],[.408,.403],[.382,.365],[.358,.344]],
        [.001,.006,.009,.006,.005,.001],tint(skin,'#985c62',.46),.009);
      streak(head,[[.460,.473],[.432,.437],[.411,.411],[.391,.381]],
        [.001,.0028,.002,.001],tint(skin,'#ffeacf',.32),.012);
      break;
    case 'stripes':
      for(const s of [-1,1]) {
        streak(head,[[s*.31,.387],[s*.384,.401],[s*.467,.427],[s*.487,.437]], [.002,.013,.013,.002],'#647e98');
        streak(head,[[s*.329,.358],[s*.398,.372],[s*.474,.398]], [.003,.009,.003],'#f9dd9d');
      }
      break;
    case 'constellation': {
      const points=[[-.487,.405],[-.445,.438],[-.400,.390],[-.355,.419],[-.305,.383]];
      const ink='#8d91d1';
      for(let i=1;i<points.length;i++)streak(head,[points[i-1],points[i]],[.004,.004],ink);
      roundedSpots(head,points.map(([x,y],i)=>[x,y,i===2 ? .012 : .009,1]),'#eee2ad',.011);
      break;
    }
    case 'whiskers':
      for(const s of [-1,1])for(let k=0;k<3;k++){
        const y=.393-.028*k;
        streak(head,[[s*.270,y],[s*.377,y+.008-.008*k],[s*.501,y+.025-.018*k]],
          [.002,.006,.0015],dark(skin,.57));
      }
      break;
    case 'moon': {
      const shape=new THREE.Shape();shape.moveTo(.028,.064);
      shape.bezierCurveTo(-.103,.081,-.083,-.081,.042,-.054);
      shape.bezierCurveTo(-.022,-.042,-.037,.022,.028,.064);
      headDecal(head,.396,.395,shape.getPoints(14).slice(0,-1).map(p=>[p.x,p.y]),'#f4ce92',.19);
      star(head,.453,.430,.020,'#f4e7d0');break;
    }
    case 'daisy': {
      const x=-.389,y=.398,petals=[];
      for(let i=0;i<6;i++){
        const angle=i*TAU/6;petals.push([x+.034*Math.cos(angle),y+.034*Math.sin(angle),.031,.52,angle]);
      }
      roundedSpots(head,petals,'#fff0e3',.009);
      roundedSpots(head,[[x,y,.019,1]],'#eeac49',.014);break;
    }
    case 'birthmark':
      organicPatch(head,-.419,.386,.068,.043,tint(skin,'#a46b63',.39),.28);
      break;
    case 'patches': {
      const pigment=tint(skin,'#f8ddc2',.50);
      organicPatch(head,-.437,.404,.095,.058,pigment,.46);
      organicPatch(head,-.348,.365,.030,.018,pigment,1.31);
      organicPatch(head,.359,.791,.084,.043,pigment,2.17);
      break;
    }
  }
}
