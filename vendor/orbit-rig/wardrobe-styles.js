import {THREE,PI,TAU,INK,CREAM,group,mesh,oval,profile,patch,strand,cord,geometryGrid,signedPow,tint,dark,pale} from './model-kit.js';

export const extraOutfits = [
  {id:'varsity', name:'Varsity jacket', color:'#a64f68'},
  {id:'denim', name:'Denim trucker', color:'#6696ae'},
  {id:'breton', name:'Breton stripes', color:'#374f75'},
  {id:'blazer', name:'Tailored blazer', color:'#586481'},
  {id:'overalls', name:'Workshop bib', color:'#628e9a'},
  {id:'wrap', name:'Kimono wrap', color:'#af6891'},
  {id:'poncho', name:'Mesa poncho', color:'#c9844d'},
  {id:'track', name:'Relay track top', color:'#48a1ad'},
  {id:'knight', name:'Plate armor', color:'#8599b3'},
  {id:'spacesuit', name:'EVA suit', color:'#e5dfc9'},
  {id:'sailor', name:'Sailor blouse', color:'#e8dec8'},
  {id:'cableknit', name:'Cable sweater', color:'#91a887'},
  {id:'crop', name:'Raglan crop', color:'#cc91b4'},
  {id:'moto', name:'Moto jacket', color:'#4e4858'},
  {id:'slicker', name:'Rain slicker', color:'#e3ac45'},
  {id:'folk', name:'Embroidered tunic', color:'#a05f74'},
  {id:'turtleneck', name:'Rib turtleneck', color:'#b67a53'},
  {id:'jersey', name:'Court jersey', color:'#6795bb'},
  {id:'blouse', name:'Ribbon blouse', color:'#d1a5c3'},
  {id:'ranger', name:'Trail scout', color:'#949666'},
  {id:'chef', name:'Chef jacket', color:'#e2ddd0'},
  {id:'bowling', name:'Bowling shirt', color:'#d58879'},
  {id:'mage', name:'Astral robe', color:'#786299'},
  {id:'western', name:'Western fringe', color:'#ad7956'}
];

const ivory='#f4e6ca', navy='#344259', brass='#d6ae6d', silver='#c9c6bd';
const tight=[[.01,.298,.191],[.035,.324,.207],[.19,.327,.207],[.38,.347,.216],[.60,.373,.222],[.71,.351,.203],[.805,.257,.164],[.844,.155,.121]];
const shirt=[[-.025,.319,.197],[-.009,.354,.215],[.151,.363,.226],[.386,.371,.231],[.590,.385,.230],[.709,.369,.213],[.787,.310,.180],[.844,.167,.129]];
const jacket=[[-.040,.322,.200],[-.018,.359,.225],[.115,.379,.237],[.288,.390,.241],[.540,.405,.246],[.669,.397,.232],[.749,.361,.215],[.816,.280,.172],[.861,.171,.135]];
const longCoat=[[-.165,.415,.246],[-.147,.435,.253],[.020,.412,.251],[.226,.381,.235],[.428,.378,.232],[.605,.398,.236],[.719,.370,.211],[.801,.281,.176],[.853,.171,.133]];
const blouse=[[.004,.302,.189],[.031,.343,.213],[.115,.351,.222],[.200,.373,.238],[.350,.393,.250],[.540,.391,.244],[.678,.375,.224],[.764,.327,.195],[.837,.174,.140]];
const uniform=[[-.041,.332,.204],[-.017,.361,.225],[.214,.375,.235],[.450,.383,.240],[.640,.392,.233],[.733,.368,.212],[.805,.267,.171],[.854,.172,.133]];
const elongated=[[-.18,.392,.228],[-.16,.407,.238],[.005,.386,.230],[.267,.338,.216],[.451,.352,.229],[.652,.384,.229],[.759,.340,.200],[.837,.174,.135]];
const jersey=[[-.032,.330,.201],[-.010,.354,.215],[.226,.356,.226],[.496,.364,.227],[.626,.339,.210],[.717,.302,.187],[.785,.261,.163],[.829,.180,.137]];

function cloth(root,rows,color,power=.90,surface='soft') {
  const [first,...rest]=rows;
  const last=rows[rows.length-1];
  const capped=[[first[0]-.004,.012,.011],first,...rest,[last[0]-.004,last[1]*.76,last[2]*.76],[last[0]-.011,.018,.018]];
  profile(root,capped,color,{power,surface,segments:32});
  return {root,rows,color,power};
}
function section(rows,y) {
  if(y<=rows[0][0])return rows[0];
  for(let i=1;i<rows.length;i++) {
    const [b,rxB,rzB]=rows[i];
    if(y<=b) {
      const [a,rxA,rzA]=rows[i-1], t=(y-a)/(b-a);
      return [y,rxA+(rxB-rxA)*t,rzA+(rzB-rzA)*t];
    }
  }
  return rows[rows.length-1];
}
function surfacePoint(s,x,y,side=1,lift=.006) {
  const [,rx,rz]=section(s.rows,y), exponent=2/s.power;
  const curve=Math.max(.002,1-Math.pow(Math.abs(x/rx),exponent));
  return [x,y,side*(rz*Math.pow(curve,1/exponent)+lift)];
}
function stripe(s,low,high,color,bulge=.006) {
  const from=section(s.rows,low),to=section(s.rows,high);
  const rows=[[low,from[1],from[2]],...s.rows.filter(row=>row[0]>low&&row[0]<high),[high,to[1],to[2]]];
  profile(s.root,rows.map(([y,x,z])=>[y,x+bulge,z+bulge]),color,{power:s.power,segments:36});
}
function seam(s,points,color,width=.008,side=1,lift=.009) {
  return cord(s.root,points.map(([x,y])=>surfacePoint(s,x,y,side,lift)),width,color,{steps:Math.max(6,points.length*2),sides:6,out:[0,0,side]});
}

// Panels are triangulated on the garment's curved surface. Subdivision keeps a
// broad lapel, bib or yoke flush around the sides without floating at its tips.
function inset(s,points,color,{side=1,lift=.012,surface='soft'}={}) {
  const contour=points.map(([x,y])=>new THREE.Vector2(x,y)), indices=THREE.ShapeUtils.triangulateShape(contour,[]);
  const vertices=[],normals=[];
  const normal=(x,y)=>{
    const dzdx=(surfacePoint(s,x+.001,y,side,lift)[2]-surfacePoint(s,x-.001,y,side,lift)[2])/.002;
    const dzdy=(surfacePoint(s,x,y+.001,side,lift)[2]-surfacePoint(s,x,y-.001,side,lift)[2])/.002;
    const len=Math.hypot(dzdx,dzdy,1);return [-side*dzdx/len,-side*dzdy/len,side/len];
  };
  function add(a,b,c,level) {
    const ab=a.distanceToSquared(b),bc=b.distanceToSquared(c),ca=c.distanceToSquared(a);
    if(level<4&&Math.max(ab,bc,ca)>.012) {
      let endA=a,endB=b,other=c;
      if(bc>=ab&&bc>=ca){endA=b;endB=c;other=a;}
      else if(ca>=ab){endA=c;endB=a;other=b;}
      const mid=new THREE.Vector2().addVectors(endA,endB).multiplyScalar(.5);
      add(endA,mid,other,level+1);add(mid,endB,other,level+1);return;
    }
    const winding=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    for(const v of winding*side>0?[a,b,c]:[a,c,b]){
      vertices.push(...surfacePoint(s,v.x,v.y,side,lift));normals.push(...normal(v.x,v.y));
    }
  }
  indices.forEach(([a,b,c])=>add(contour[a],contour[b],contour[c],0));
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geom.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  return mesh(s.root,geom,color,surface);
}
function button(s,x,y,col,radius=.014,side=1,lift=.018) {
  const pt=surfacePoint(s,x,y,side,lift);
  return oval(s.root,col,pt,[radius,radius,radius*.46],[0,side*x*.95,0],'metal',true);
}
function buttons(s,x,levels,col,r=.015) {for(const y of levels)button(s,x,y,col,r);}
function mirrored(s,shape,color,options) {
  for(const sign of [-1,1])inset(s,shape.map(([x,y])=>[x*sign,y]),color,options);
}
function pocket(s,x,y,w,h,col,flap=false,baseLift=0) {
  const left=x-w/2,right=x+w/2,top=y+h/2,bottom=y-h/2;
  const points=[[left,top],[right,top],[right,bottom+.026],[x,bottom],[left,bottom+.026]];
  inset(s,points,col,{lift:baseLift+.016});
  seam(s,[points[0],points[4],points[3],points[2],points[1]],pale(col,.22),.004,1,baseLift+.022);
  if(flap) {
    inset(s,[[left-.005,top+.014],[right+.005,top+.014],[right,top-.035],[x,top-.063],[left,top-.035]],pale(col,.075),{lift:baseLift+.029});
    button(s,x,top-.029,brass,.009,1,baseLift+.037);
  }
}
function pointedCollar(s,col) {
  mirrored(s,[[.022,.786],[.162,.849],[.253,.799],[.205,.652],[.115,.730]],col,{lift:.022});
}
function collarRing(s,col,tall=.910,open=0) {
  const rows=[[.793,.260,.165],[.817,.219,.159],[.837,.195,.150],[tall-.014,.192,.149],[tall,.182,.139],[tall-.002,.151,.117]];
  profile(s.root,rows,col,{segments:30,gap:open?rows.map(()=>open):null});
}
function zipper(s,pts) {
  seam(s,pts,dark(s.color,.74),.012,1,.012);
  seam(s,pts,silver,.004,1,.022);
  const [x,y]=pts[pts.length-1],p=surfacePoint(s,x,y-.031,1,.027);
  patch(s.root,silver,p,[.020,.052,.011],.005,[0,0,-.20],'metal');
}
function star(s,x,y,r,col,side=1,lift=.023) {
  const outline=[];
  for(let n=0;n<10;n++) {
    const a=PI/2+n*TAU/10,rad=n%2?r*.43:r;
    outline.push([x+Math.cos(a)*rad,y+Math.sin(a)*rad]);
  }
  inset(s,outline,col,{side,lift});
}
function diamond(s,x,y,w,h,col,side=1,lift=.018) {
  return inset(s,[[x,y+h],[x+w,y],[x,y-h],[x-w,y]],col,{side,lift});
}
function flash(s,x,y,size,col,side=1) {
  const coords=[[-.12,.53],[.45,.53],[.05,.09],[.37,.09],[-.37,-.56],[-.14,-.07],[-.46,-.07]];
  inset(s,coords.map(([u,v])=>[x+u*size,y+v*size]),col,{side,lift:.024});
}
function bow(s,col,y=.721) {
  for(const side of [-1,1]) {
    const pts=[[.007,y+.003],[.123,y+.084],[.169,y+.067],[.158,y-.002],[.125,y-.054]].map(([x,h])=>[side*x,h]);
    inset(s,pts,col,{lift:.040});
    seam(s,[[side*.020,y+.004],[side*.083,y+.025],[side*.128,y+.029]],pale(col,.23),.006,1,.051);
  }
  oval(s.root,dark(col,.22),surfacePoint(s,0,y,1,.044),[.034,.031,.021],null,'soft',true);
}
function waistBelt(s,low,high,col,metal=brass) {
  stripe(s,low,high,col,.015);
  const y=(low+high)/2,p=surfacePoint(s,0,y,1,.024);
  patch(s.root,metal,p,[.111,high-low+.015,.016],.012,null,'metal');
  patch(s.root,col,[p[0],p[1],p[2]+.013],[.073,(high-low)*.64,.008],.006);
}
function varsity(root,col) {
  const s=cloth(root,jacket,col,.85),trim=dark(col,.60);
  stripe(s,-.024,.070,trim,.009);stripe(s,.004,.018,ivory,.013);stripe(s,.038,.051,ivory,.013);
  collarRing(s,trim,.883,.31);
  seam(s,[[0,.036],[0,.27],[0,.53],[0,.72],[0,.806]],dark(col,.42),.021);
  for(const y of [.108,.248,.388,.529,.666,.761])button(s,0,y,ivory,.014,1,.035);
  const patchShape=[[-.285,.597],[-.231,.597],[-.191,.507],[-.16,.597],[-.107,.597],[-.173,.421],[-.209,.421]];
  inset(s,patchShape,ivory,{lift:.023});
  for(const sign of [-1,1])seam(s,[[sign*.204,.159],[sign*.245,.205],[sign*.281,.243]],ivory,.015);
  inset(s,[[-.145,.52],[-.102,.571],[.067,.571],[.126,.530],[.126,.48],[.073,.434],[-.061,.403],[-.067,.371],[.140,.371],[.140,.314],[-.136,.314],[-.136,.422],[-.092,.459],[.050,.489],[.055,.523],[.028,.540],[-.081,.540],[-.105,.508]],ivory,{side:-1,lift:.016});
  star(s,-.20,.648,.038,ivory,-1);
}
function denim(root,col) {
  const s=cloth(root,jacket,col,.86),thread='#e0c296';
  pointedCollar(s,pale(col,.12));
  stripe(s,-.032,.047,dark(col,.14));seam(s,[[-.025,.009],[-.025,.29],[-.025,.58],[-.025,.79]],thread,.0045);
  buttons(s,.006,[.05,.20,.35,.50,.65,.76],brass,.013);
  for(const sign of [-1,1]) {
    pocket(s,sign*.206,.528,.153,.162,dark(col,.17),true);
    seam(s,[[sign*.159,.041],[sign*.145,.188],[sign*.154,.37],[sign*.184,.430]],thread,.0045);
    seam(s,[[sign*.288,.091],[sign*.26,.165],[sign*.237,.223]],dark(col,.5),.010);
    seam(s,[[sign*.298,.634],[sign*.153,.615],[sign*.033,.617]],thread,.006);
  }
  inset(s,[[-.304,.716],[.304,.716],[.326,.602],[0,.537],[-.326,.602]],dark(col,.16),{side:-1});
  seam(s,[[-.312,.606],[0,.547],[.312,.606]],thread,.006,-1,.019);
}
function breton(root,col) {
  const s=cloth(root,shirt,ivory,.90);
  for(let i=0;i<5;i++){const y=.055+i*.118;stripe(s,y,y+.053,col,.005);}
  stripe(s,.675,.699,col,.005);
  collarRing(s,col,.851,.09);
  const points=[[.152,.662],[.275,.661],[.272,.546],[.214,.516],[.154,.548]];
  inset(s,points,col,{lift:.012});seam(s,[[.162,.643],[.263,.643]],ivory,.004,1,.019);
}
function blazer(root,col) {
  const s=cloth(root,jacket,col,.84);
  inset(s,[[-.178,.825],[.176,.825],[.111,.58],[.027,.396],[-.061,.502]],'#f1e9da',{lift:.014});
  inset(s,[[-.032,.779],[.033,.779],[.019,.721],[.046,.544],[.016,.492],[-.027,.532],[-.008,.721]],'#765066',{lift:.023});
  mirrored(s,[[.148,.842],[.251,.803],[.300,.731],[.192,.702],[.232,.649],[.034,.403],[.122,.68]],pale(col,.105),{lift:.032});
  seam(s,[[-.018,.406],[-.027,.32],[-.029,.175],[-.113,-.013]],dark(col,.38),.0065);
  buttons(s,-.032,[.367,.216],brass,.019);
  for(const sign of [-1,1]) {
    inset(s,[[.142,.242],[.301,.244],[.294,.205],[.147,.204]].map(([x,y])=>[sign*x,y]),pale(col,.07),{lift:.017});
  }
  inset(s,[[.153,.584],[.186,.627],[.205,.607],[.237,.641],[.258,.587]],ivory,{lift:.018});
  seam(s,[[.139,.575],[.20,.581],[.271,.59]],dark(col,.56),.011,1,.021);
  seam(s,[[0,-.026],[0,.155],[0,.356],[0,.594],[0,.778]],dark(col,.25),.0045,-1);
}
function overalls(root,col) {
  const s=cloth(root,shirt,'#e8d4b7');
  stripe(s,-.017,.217,col,.011);
  const bib=[[-.266,.164],[-.269,.522],[-.211,.607],[-.181,.738],[.181,.738],[.211,.607],[.269,.522],[.266,.164]];
  inset(s,bib,col,{lift:.026});
  mirrored(s,[[.093,.719],[.158,.841],[.229,.82],[.184,.677]],dark(col,.10),{lift:.033});
  pocket(s,0,.541,.245,.163,dark(col,.19),false,.025);seam(s,[[-.118,.603],[0,.609],[.118,.603]],pale(col,.25),.006,1,.051);
  for(const sign of [-1,1]){
    button(s,sign*.143,.713,brass,.022,1,.042);
    seam(s,[[sign*.257,.193],[sign*.253,.398],[sign*.257,.513],[sign*.204,.605]],pale(col,.27),.005,1,.034);
    inset(s,[[sign*.126,.838],[sign*.209,.812],[-sign*.077,.211],[-sign*.162,.202]],col,{side:-1,lift:.015+(sign>0?.009:0)});
  }
  button(s,0,.457,brass,.014,-1,.038);
}
function wrap(root,col) {
  const s=cloth(root,elongated,col,.94);
  inset(s,[[-.17,.836],[-.105,.846],[.289,.380],[.251,.314]],ivory,{lift:.018});
  inset(s,[[.171,.842],[.107,.832],[-.224,.399],[-.184,.312]],pale(col,.35),{lift:.026});
  stripe(s,.198,.333,tint(col,'#4a304c',.76),.017);
  stripe(s,.246,.273,'#e2bd82',.022);
  diamond(s,.151,.257,.034,.027,brass,1,.037);
  for(const sign of [-1,1]) {
    const x=sign*.22;
    for(let i=0;i<3;i++) {
      const xx=x+sign*(i%2)*.038,y=-.086+i*.064;
      seam(s,[[xx-.026,y],[xx,y+.023],[xx+.026,y]],ivory,.006,sign, .017);
    }
  }
  const y=.275,z=surfacePoint(s,0,y,-1,.047)[2];
  for(const sign of [-1,1])oval(root,pale(col,.22),[sign*.082,y,z],[.102,.066,.035],[0,.12*sign,.27*sign]);
  oval(root,brass,[0,y,z-.025],[.035,.038,.025],null,'soft',true);
}
function poncho(root,col) {
  cloth(root,tight,'#584a55');
  const drape=[[0,.581,.292],[.055,.574,.290],[.42,.516,.270],[.71,.415,.234],[.88,.327,.188],[1,.182,.139]];
  const point=(u,t,lift=0)=>{
    const a=TAU*u,cs=Math.cos(a),sn=Math.sin(a),[,rx,rz]=section(drape,t);
    const edge=.269-.231*Math.pow(Math.abs(cs),1.5);
    const fold=Math.cos(10*a)*.012*(1-t);
    return [(rx+fold+lift)*sn,edge+(.861-edge)*t,(rz+fold*.63+lift)*cs];
  };
  mesh(root,geometryGrid(64,14,(u,t)=>point(u,t)),col);
  const band=(t,h,c,zig=0)=>mesh(root,geometryGrid(80,2,(u,v)=>point(u,t+h*v+zig*(1-Math.abs(((u*12)%1)*2-1)),.007)),c);
  band(.033,.027,ivory);band(.109,.075,'#684d58',.038);band(.224,.017,ivory,.024);
  band(.723,.026,pale(col,.35));band(.772,.031,'#74545f');
  for(let i=0;i<23;i++) {
    const p=point((i+.5)/23,0),a=TAU*(i+.5)/23;
    cord(root,[p,[p[0]+.007*Math.sin(a),p[1]-.037,p[2]+.003*Math.cos(a)],[p[0]+.013*Math.sin(a),p[1]-.061,p[2]+.01*Math.cos(a)]],[.009,.009,.004],i%2?ivory:pale(col,.22),{sides:5,steps:5});
  }
  profile(root,[[.818,.214,.166],[.852,.207,.16],[.884,.181,.14],[.887,.154,.119]],'#66505a');
}
function track(root,col) {
  const s=cloth(root,uniform,col,.91);
  stripe(s,-.027,.056,dark(col,.55),.009);collarRing(s,dark(col,.32),.920,.065);
  for(const side of [-1,1]) {
    inset(s,[[-.338,.692],[-.318,.617],[0,.463],[.318,.617],[.338,.692],[0,.535]],ivory,{side});
    inset(s,[[-.303,.606],[-.291,.577],[0,.432],[.291,.577],[.303,.606],[0,.466]],dark(col,.48),{side,lift:.016});
  }
  zipper(s,[[0,.004],[0,.227],[0,.451],[0,.652],[0,.803]]);
  for(const sign of [-1,1])seam(s,[[sign*.180,.096],[sign*.213,.172],[sign*.262,.252]],dark(col,.60),.010);
}
function knight(root,col) {
  const s=cloth(root,tight,'#4b454b',.88);
  const plate=cloth(root,[[.186,.321,.211],[.220,.351,.230],[.305,.373,.251],[.456,.399,.268],[.603,.405,.263],[.702,.369,.226],[.781,.283,.187],[.836,.193,.144]],col,.76,'metal');
  stripe(plate,.214,.243,dark(col,.42));stripe(plate,.246,.259,brass);
  collarRing(plate,dark(col,.28),.887);
  const edge=[[-.323,.628],[0,.496],[.323,.628]];
  seam(plate,edge,pale(col,.45),.010,1,.016);
  inset(plate,[[0,.715],[-.151,.620],[-.119,.490],[0,.369],[.119,.490],[.151,.620]],dark(col,.22),{lift:.026,surface:'metal'});
  diamond(plate,0,.554,.069,.126,brass,1,.039);
  for(const side of [-1,1]) {
    inset(plate,[[side*.016,.797],[side*.083,.794],[side*.273,.586],[side*.273,.539]],'#716056',{side:-1,lift:.017});
  }
  for(const [low,high,wide] of [[-.076,.018,.374],[.003,.096,.361],[.081,.171,.345]]) {
    profile(root,[[low,.92*wide,.207],[low+.014,wide,.234],[high-.011,wide*.983,.227],[high,wide*.95,.216]],dark(col,.26),{power:.82,surface:'metal'});
    profile(root,[[low+.016,wide+.002,.236],[low+.028,wide,.235]],pale(col,.22),{power:.82});
  }
  waistBelt(s,.144,.206,'#715748');
}
function spacesuit(root,col) {
  const s=cloth(root,jacket,col,.87);
  stripe(s,.028,.112,'#606572',.013);stripe(s,.049,.070,'#c18f5b',.019);
  collarRing(s,'#5a5c6b',.900);profile(root,[[.867,.199,.160],[.882,.200,.162],[.899,.194,.156]],'#e7a65d');
  const panelPos=surfacePoint(s,0,.543,1,.024);
  patch(root,'#505765',panelPos,[.290,.208,.050],.038);
  patch(root,'#a7b9b4',[0,panelPos[1]+.025,panelPos[2]+.035],[.224,.105,.025],.018);
  patch(root,'#556a70',[-.040,panelPos[1]+.031,panelPos[2]+.051],[.096,.062,.006],.009);
  for(let i=0;i<3;i++) {
    const x=-.068+i*.068;
    oval(root,['#d78558','#e6bc72','#a1c5ba'][i],[x,.481,panelPos[2]+.035],[.018,.018,.010],null,'soft',true);
  }
  for(const sign of [-1,1]) {
    const p=surfacePoint(s,sign*.188,.293,1,.021);
    oval(root,'#666979',p,[.047,.050,.025],null,'metal',true);
    cord(root,[[p[0],p[1],p[2]+.020],[sign*.238,.207,.246],[sign*.326,.158,.200],[sign*.378,.184,.121],[sign*.383,.233,.082]],.017,'#b09b80',{steps:12,sides:8});
  }
  patch(root,'#6f7480',[0,.449,-.240],[.374,.472,.115],.050);
  patch(root,pale(col,.10),[0,.454,-.311],[.329,.404,.057],.042);
  for(const sign of [-1,1])patch(root,'#dc9655',[sign*.107,.451,-.346],[.030,.337,.011],.009);
}
function sailor(root,col) {
  const s=cloth(root,blouse,col,.91);
  const neck='#374d71',tie='#c86b63';
  stripe(s,.021,.075,neck,.007);
  inset(s,[[-.292,.793],[-.161,.842],[0,.731],[.161,.842],[.292,.793],[.226,.697],[0,.487],[-.226,.697]],neck);
  seam(s,[[-.263,.764],[-.214,.698],[0,.516],[.214,.698],[.263,.764]],ivory,.008,1,.024);
  inset(s,[[-.288,.789],[.288,.789],[.293,.550],[-.293,.550]],neck,{side:-1});
  seam(s,[[-.265,.746],[-.265,.577],[0,.571],[.265,.577],[.265,.746]],ivory,.008,-1,.022);
  const y=.536;
  inset(s,[[0,y+.006],[-.090,.375],[-.060,.309],[.021,.432],[.074,.339],[.096,.387],[.027,y+.013]],tie,{lift:.033});
  oval(root,dark(tie,.11),surfacePoint(s,0,y,1,.034),[.047,.035,.019],null,'soft',true);
}
function cableknit(root,col) {
  const s=cloth(root,blouse,col,.95);
  stripe(s,.003,.085,dark(col,.22),.010);collarRing(s,pale(col,.055),.923);
  for(const side of [-1,1]){
    for(const x of [-.18,0,.18]) {
      for(const sign of [-1,1]) {
        const pts=[];
        for(let j=0;j<=17;j++) {
          const y=.121+j*.036,dx=.034*Math.sin(j/17*PI*5)*sign;
          pts.push([x+dx,y]);
        }
        seam(s,pts,sign>0?pale(col,.14):dark(col,.15),.012,side,.014+(sign>0?.003:0));
      }
    }
  }
}
function crop(root,col) {
  const undershirt=cloth(root,tight,ivory,.92);
  stripe(undershirt,.043,.054,'#d7c8b3',.003);
  const s=cloth(root,[[.210,.383,.229],[.223,.398,.238],[.310,.391,.239],[.559,.396,.237],[.676,.386,.224],[.753,.355,.208],[.821,.264,.166],[.852,.172,.132]],col,.91);
  stripe(s,.226,.249,dark(col,.21),.007);collarRing(s,dark(col,.45),.865);
  for(const side of [-1,1]) {
    mirrored(s,[[.141,.839],[.258,.813],[.348,.747],[.368,.686],[.346,.550],[.276,.663]],ivory,{side});
  }
  star(s,0,.531,.100,ivory);star(s,0,.531,.054,pale(col,.025),1,.027);
  star(s,0,.667,.052,ivory,-1);
}
function moto(root,col) {
  const s=cloth(root,jacket,col,.84);
  waistBelt(s,-.011,.061,dark(col,.51),silver);
  inset(s,[[-.186,.835],[-.066,.824],[.216,.597],[.166,.518],[-.024,.590]],pale(col,.12),{lift:.022});
  inset(s,[[.169,.836],[.276,.769],[.225,.703],[.305,.672],[.126,.491],[.115,.670]],pale(col,.18),{lift:.028});
  zipper(s,[[-.212,.052],[-.119,.199],[-.018,.369],[.091,.541],[.124,.698],[.132,.801]]);
  for(const sign of [-1,1]) {
    button(s,sign*.215,.713,silver,.015,1,.045);
    const pts=[[sign*.185,.163],[sign*.236,.235],[sign*.277,.289]];
    seam(s,pts,'#23222a',.014);seam(s,pts,silver,.005,1,.022);
  }
  inset(s,[[-.315,.712],[0,.624],[.315,.712],[.312,.628],[0,.537],[-.312,.628]],dark(col,.34),{side:-1});
  for(const y of [.617,.583])seam(s,[[-.260,y+.053],[0,y-.017],[.26,y+.053]],pale(col,.17),.006,-1,.022);
}
function slicker(root,col) {
  const s=cloth(root,longCoat,col,.92);
  oval(root,dark(col,.15),[0,.794,-.158],[.317,.204,.175],[.27,0,0]);
  collarRing(s,dark(col,.30),.889,.42);
  inset(s,[[-.053,-.111],[.048,-.111],[.046,.755],[-.047,.779]],pale(col,.095),{lift:.018});
  buttons(s,.007,[-.034,.145,.335,.525,.697],'#756451',.015);
  for(const sign of [-1,1])pocket(s,sign*.232,.154,.157,.179,dark(col,.11),true);
  stripe(s,-.119,-.104,'#e9d9aa',.007);
  inset(s,[[-.314,.709],[.314,.709],[.321,.589],[0,.527],[-.321,.589]],pale(col,.09),{side:-1});
  seam(s,[[-.311,.594],[0,.532],[.311,.594]],dark(col,.28),.006,-1,.021);
}
function folk(root,col) {
  const s=cloth(root,elongated,col,.92);
  const thread='#f3c289',leaves='#9bb89d';
  stripe(s,-.146,-.114,'#784854');stripe(s,-.107,-.085,thread);
  inset(s,[[-.188,.816],[-.136,.840],[0,.713],[.136,.840],[.188,.816],[0,.573]],dark(col,.40));
  seam(s,[[-.170,.809],[0,.606],[.170,.809]],thread,.011,1,.022);
  for(const side of [-1,1]) {
    for(const sign of [-1,1]) {
      const x=sign*.170;
      seam(s,[[x-.026,.161],[x+.018,.244],[x-.018,.337],[x+.013,.411]],leaves,.006,side);
      for(let j=0;j<3;j++) {
        const y=.207+j*.069,offset=sign*(j%2?-.024:.027);
        diamond(s,x+offset,y,.020,.012,j===1?leaves:thread,side,.017);
      }
    }
  }
  diamond(s,0,.403,.027,.041,thread);
}
function turtleneck(root,col) {
  const s=cloth(root,tight,col,.96);
  stripe(s,.018,.096,dark(col,.12),.006);
  collarRing(s,pale(col,.04),.961);
  for(const y of [.897,.923,.946])profile(root,[[y,.196,.151],[y+.006,.195,.151]],dark(col,.17),{segments:28});
  for(const side of [-1,1])for(const x of [-.252,-.186,-.118,-.051,.018,.086,.154,.22]){
    const pts=[[x*.92,.110],[x,.298],[x*1.04,.53],[x,.696],[x*.77,.781]];
    seam(s,pts,pale(col,.059),.0045,side,.007);
  }
}
function jerseyTop(root,col) {
  const s=cloth(root,jersey,col,.86), gold='#eac178';
  stripe(s,-.011,.014,ivory,.006);
  mirrored(s,[[.274,.168],[.337,.104],[.35,.408],[.320,.574],[.281,.608],[.297,.436]],dark(col,.42));
  for(const side of [-1,1]) {
    const band=[[-.188,.809],[-.112,.769],[0,.733],[.112,.769],[.188,.809]];
    seam(s,band,ivory,.016,side,.012);
    const two=[[-.161,.505],[-.126,.566],[-.032,.565],[.001,.526],[-.001,.469],[-.048,.429],[-.117,.394],[-.118,.368],[.004,.368],[.004,.322],[-.164,.322],[-.164,.419],[-.105,.454],[-.046,.481],[-.045,.513],[-.069,.528],[-.110,.526],[-.123,.492]];
    const three=[[.033,.559],[.134,.561],[.169,.523],[.165,.469],[.141,.441],[.167,.412],[.166,.362],[.136,.329],[.027,.329],[.028,.373],[.109,.373],[.122,.391],[.116,.413],[.067,.417],[.069,.462],[.112,.466],[.124,.487],[.12,.510],[.034,.511]];
    inset(s,two,gold,{side,lift:.016});inset(s,three,ivory,{side,lift:.016});
  }
  seam(s,[[-.128,.626],[0,.641],[.127,.625]],ivory,.010);
}
function blouseTop(root,col) {
  const s=cloth(root,blouse,col,.96);
  collarRing(s,pale(col,.18),.885,.16);
  stripe(s,.022,.102,dark(col,.20),.009);
  bow(s,'#78576d',.731);
  for(const sign of [-1,1]) {
    inset(s,[[sign*.012,.723],[sign*.043,.708],[sign*.083,.542],[sign*.040,.557]],'#78576d',{lift:.024});
  }
  for(const side of [-1,1]) {
    for(let j=0;j<4;j++) {
      for(let i=-2;i<=2;i++) {
        const x=i*.104+(j%2)*.041,y=.191+j*.111;
        if(side===1&&Math.abs(x)<.073&&y>.47)continue;
        oval(root,pale(col,.50),surfacePoint(s,x,y,side,.005),[.014,.013,.005],[0,x*side*1.17,0],'soft',true);
      }
    }
  }
}
function ranger(root,col) {
  const s=cloth(root,uniform,col);
  pointedCollar(s,dark(col,.18));
  for(const sign of [-1,1])pocket(s,sign*.204,.478,.155,.151,pale(col,.055),true);
  const scarf='#bd7a4b';
  collarRing(s,scarf,.903,.19);
  const tie=[[-.149,.808],[.098,.818],[.132,.729],[.029,.591],[-.117,.715]];
  inset(s,tie,scarf,{lift:.022});
  for(const side of [-1,1]) {
    inset(s,[[-.270,.765],[-.191,.801],[.289,.145],[.239,.067]],'#765945',{side,lift:.030});
    seam(s,[[-.241,.757],[-.096,.564],[.084,.326],[.256,.103]],'#c29868',.005,side,.034);
  }
  const bag=group(root,.292,.126,.151);
  bag.rotation.y=.62;bag.rotation.z=-.083;
  patch(bag,'#765947',[0,0,0],[.166,.159,.044],.027);
  patch(bag,'#a48159',[0,.035,.027],[.172,.091,.025],.018);
  oval(bag,brass,[0,.012,.046],[.012,.012,.005],null,'metal',true);
}
function chef(root,col) {
  const s=cloth(root,uniform,col,.91);
  collarRing(s,dark(col,.14),.911,.17);
  inset(s,[[-.202,.797],[.125,.810],[.171,.673],[.165,.167],[-.197,.161]],pale(col,.072),{lift:.013});
  seam(s,[[.165,.162],[.169,.394],[.166,.668],[.127,.799]],dark(col,.26),.006,1,.022);
  for(const x of [-.132,.115])buttons(s,x,[.272,.407,.543,.675],'#52515b',.021);
  inset(s,[[-.116,.821],[.167,.815],[.097,.742],[.047,.700],[-.092,.767]],'#b66561',{lift:.029});
  inset(s,[[.032,.727],[.080,.738],[.129,.649],[.111,.611]],'#a75553',{lift:.033});
  seam(s,[[-.301,.678],[-.186,.637],[0,.626],[.186,.637],[.301,.678]],dark(col,.18),.006,-1);
}
function bowling(root,col) {
  const s=cloth(root,shirt,col,.88);
  for(const sign of [-1,1]) {
    inset(s,[[sign*.108,.011],[sign*.203,.009],[sign*.226,.752],[sign*.158,.828]],ivory,{lift:.012});
    seam(s,[[sign*.10,.010],[sign*.112,.255],[sign*.122,.544],[sign*.148,.778]],dark(col,.36),.006,1,.016);
  }
  pointedCollar(s,dark(col,.30));buttons(s,0,[.096,.239,.382,.525,.663],ivory,.012);
  pocket(s,.204,.551,.145,.113,pale(col,.05));
  const pin=(x,y,lean)=>{
    const shape=[[-.030,-.127],[.031,-.127],[.055,-.085],[.047,-.026],[.018,.048],[.027,.093],[.017,.124],[0,.139],[-.022,.122],[-.025,.094],[-.014,.052],[-.046,-.032],[-.051,-.082]];
    const ca=Math.cos(lean),sa=Math.sin(lean);
    inset(s,shape.map(([u,v])=>[x+u*ca-v*sa,y+u*sa+v*ca]),ivory,{side:-1,lift:.021});
  };
  pin(-.069,.52,-.19);pin(.061,.54,.21);
  oval(root,dark(col,.63),surfacePoint(s,.074,.376,-1,.031),[.064,.064,.013],null,'gloss',true);
}
function mage(root,col) {
  const s=cloth(root,elongated,col,.93),binding='#d5b175';
  const hood=group(root,0,.812,-.035);
  profile(hood,[[-.113,.328,.220],[-.056,.350,.225],[.018,.307,.205],[.095,.238,.163],[.143,.220,.159],[.152,.193,.137]],dark(col,.22),{gap:[.50,.53,.50,.50,.52,.57],segments:28});
  inset(s,[[-.165,.821],[-.088,.837],[.198,.352],[.137,.311]],dark(col,.33),{lift:.020});
  seam(s,[[-.130,.817],[-.032,.645],[.073,.477],[.168,.329]],binding,.009,1,.031);
  waistBelt(s,.157,.241,tint(col,'#493a56',.66));
  stripe(s,-.145,-.119,binding,.008);stripe(s,-.095,-.084,dark(col,.41));
  const back=[[-.132,.653],[-.066,.532],[.065,.575],[.133,.453],[.035,.369]];
  seam(s,back,pale(col,.48),.0055,-1,.015);
  back.forEach(([x,y],i)=>star(s,x,y,i===1?.033:.022,binding,-1,.024));
  star(s,-.189,.513,.058,binding);diamond(s,-.222,.410,.017,.028,pale(col,.61));
}
function western(root,col) {
  const s=cloth(root,shirt,col,.90),yoke=pale(col,.30);
  for(const side of [-1,1]){
    inset(s,[[-.316,.749],[-.155,.813],[.153,.813],[.317,.749],[.315,.621],[.213,.650],[.104,.560],[0,.603],[-.107,.560],[-.212,.650],[-.313,.621]],yoke,{side});
    const outline=[[-.306,.625],[-.213,.651],[-.106,.566],[0,.605],[.106,.566],[.213,.651],[.306,.625]];
    seam(s,outline,dark(col,.41),.006,side,.024);
    for(let i=-4;i<=4;i++) {
      const x=i*.057, edge=.618-.055*Math.sin(Math.abs(i)*.80), lower=edge-.071-(i%2===0?.030:0);
      inset(s,[[x-.009,edge],[x+.010,edge],[x+.019,lower],[x+.004,lower-.012]],pale(col,.20),{side,lift:.018});
    }
  }
  pointedCollar(s,dark(col,.20));
  for(const sign of [-1,1])seam(s,[[sign*.12,.814],[sign*.06,.741],[0,.697],[sign*.042,.563]],'#4d4141',.008,1,.034);
  oval(root,'#7cb6a8',surfacePoint(s,0,.698,1,.040),[.032,.039,.011],null,'metal',true);
  buttons(s,0,[.074,.209,.346,.468],ivory,.012);
}

const topArtists={
  varsity,denim,breton,blazer,overalls,wrap,poncho,track,knight,spacesuit,sailor,cableknit,crop,moto,slicker,folk,turtleneck,
  jersey:jerseyTop,blouse:blouseTop,ranger,chef,bowling,mage,western
};
export function drawTop(parent,id,color) {
  const artist=topArtists[id];
  if(!artist)return false;
  artist(parent,color);return true;
}

const upperSleeve=[[-.427,.027,.030],[-.408,.078,.082],[-.372,.120,.124],[-.316,.137,.138],[-.193,.150,.153],[-.052,.157,.161],[.018,.148,.150],[.065,.114,.120],[.094,.067,.073],[.106,.014,.016]];
const lowerSleeve=[[-.339,.089,.091],[-.319,.110,.110],[-.242,.117,.118],[-.138,.128,.129],[-.054,.132,.136],[.026,.130,.131],[.067,.085,.087],[.081,.024,.027]];
const upperSkin=[[-.414,.044,.046],[-.389,.078,.082],[-.337,.095,.103],[-.212,.105,.109],[-.080,.116,.122],[.009,.118,.119],[.057,.092,.097],[.083,.053,.058],[.091,.012,.013]];
const lowerSkin=[[-.325,.075,.077],[-.298,.086,.089],[-.236,.086,.093],[-.123,.098,.107],[-.029,.100,.106],[.027,.091,.098],[.061,.070,.074],[.073,.023,.024]];

const sleeveRecipes={
  varsity:c=>({upper:ivory,lower:ivory,cuff:dark(c,.60)}),
  denim:c=>({upper:c,cuff:dark(c,.23),volume:.96}),
  breton:c=>({upper:ivory,cuff:c,volume:.92}),
  blazer:c=>({upper:c,cuff:c,volume:.92}),
  overalls:()=>({upper:'#e8d4b7',length:'short',cuff:'#c89070'}),
  wrap:c=>({upper:c,cuff:pale(c,.32),shape:'bell',volume:1.03}),
  poncho:()=>({upper:'#584a55',cuff:'#70515d',volume:.78}),
  track:c=>({upper:c,cuff:dark(c,.53),volume:.91}),
  knight:c=>({upper:'#635e65',cuff:dark(c,.30),volume:.92}),
  spacesuit:c=>({upper:c,cuff:'#686a78',volume:1.13}),
  sailor:c=>({upper:c,length:'short',cuff:navy}),
  cableknit:c=>({upper:c,cuff:dark(c,.22),volume:1.03}),
  crop:c=>({upper:ivory,length:'short',cuff:dark(c,.16),volume:.97}),
  moto:c=>({upper:c,cuff:dark(c,.48),volume:.96}),
  slicker:c=>({upper:c,cuff:dark(c,.18),volume:1.02}),
  folk:c=>({upper:pale(c,.13),cuff:dark(c,.38),shape:'gathered'}),
  turtleneck:c=>({upper:c,cuff:dark(c,.13),volume:.82}),
  jersey:()=>({length:'bare'}),
  blouse:c=>({upper:c,cuff:dark(c,.21),shape:'puff'}),
  ranger:c=>({upper:c,length:'rolled',cuff:pale(c,.18),volume:.94}),
  chef:c=>({upper:c,length:'rolled',cuff:dark(c,.13)}),
  bowling:c=>({upper:c,length:'short',cuff:ivory,volume:1.02}),
  mage:c=>({upper:c,cuff:dark(c,.29),shape:'bell',volume:1.07}),
  western:c=>({upper:c,cuff:pale(c,.24),volume:.95})
};
function armShape(root,rows,color,power=.98) {
  profile(root,rows,color,{segments:22,power});
  return {root,rows,color,power};
}
function fabricSleeves(upper,lower,style,skin,preview) {
  const cut=style.length, volume=style.volume||1;
  if(cut&&!preview) {
    profile(upper,upperSkin,skin,{segments:20});profile(lower,lowerSkin,skin,{segments:20});
  }
  if(cut==='bare')return {};
  let uRows=upperSleeve.map(([y,x,z])=>[y,x*volume,z*volume]);
  if(style.shape==='puff') {
    uRows=[[-.330,.105,.106],[-.318,.142,.143],[-.274,.186,.183],[-.184,.192,.194],[-.076,.180,.181],[.023,.164,.169],[.079,.114,.120],[.103,.050,.060],[.11,.010,.013]];
  }
  let upperCut;
  if(cut) {
    upperCut=cut==='short'?-.212:-.335;
    const [,rx,rz]=section(uRows,upperCut);
    uRows=[[upperCut+.013,rx*.85,rz*.85],[upperCut,rx*.97,rz*.97],[upperCut+.008,rx,rz],...uRows.filter(r=>r[0]>upperCut+.008)];
  }
  const u=armShape(upper,uRows,style.upper);
  if(cut) {
    stripe(u,upperCut+.009,upperCut+(cut==='rolled'?.072:.039),style.cuff,.008);
    return {u};
  }
  let lRows=lowerSleeve.map(([y,x,z])=>[y,x*volume,z*volume]);
  if(style.shape==='bell') {
    lRows=[[-.342,.149,.143],[-.346,.186,.180],[-.329,.186,.181],[-.229,.169,.165],[-.097,.144,.148],[-.009,.143,.143],[.041,.125,.129],[.078,.051,.049]];
  }else if(style.shape==='gathered') {
    lRows=[[-.335,.092,.094],[-.310,.109,.108],[-.265,.103,.106],[-.210,.150,.150],[-.120,.163,.160],[-.028,.158,.154],[.034,.131,.132],[.079,.047,.048]];
  }else if(style.shape==='puff') {
    lRows=lowerSleeve.map(([y,x,z])=>[y,x*.84,z*.84]);
  }
  const l=armShape(lower,lRows,style.lower||style.upper);
  stripe(l,-.323,-.258,style.cuff,.007);
  if(style.shape==='puff')stripe(u,-.326,-.296,pale(style.upper,.18),.007);
  return {u,l};
}
function armLine(s,sign,levels,color,r=.008) {
  const pts=levels.map(y=>{const [,rx,rz]=section(s.rows,y);return [sign*rx*.93,y,rz*.41];});
  cord(s.root,pts,r,color,{sides:6,steps:Math.max(6,pts.length*2),out:[sign,0,.24]});
}
function sleeveMark(u,side,col,type) {
  const [,rx]=section(u.rows,-.106);
  const mark=group(u.root,side*rx,-.106,.001);mark.rotation.y=side*PI/2;
  if(type==='rank') {
    for(let i=0;i<2;i++)cord(mark,[[-.045,.030-i*.037,.012],[0,.055-i*.037,.015],[.045,.030-i*.037,.012]],.009,col,{sides:6,steps:6});
  } else if(type==='pocket'){
    patch(mark,col,[0,-.005,0],[.099,.139,.020],.018);
    patch(mark,pale(col,.32),[0,.033,.015],[.095,.034,.009],.006);
  }else{
    oval(mark,col,[0,0,.004],[.057,.058,.010],null,'soft',true);
    oval(mark,dark(col,.48),[0,0,.011],[.038,.039,.008],null,'soft',true);
    cord(mark,[[-.026,-.013,.023],[0,.002,.024],[.024,.016,.023]],.005,ivory,{sides:5,steps:5});
  }
}
const sleeveArtists={
  varsity({u,l},s,c) {
    stripe(l,-.317,-.306,ivory,.012);stripe(l,-.289,-.277,ivory,.012);
    stripe(u,-.224,-.200,pale(c,.16),.006);stripe(u,-.180,-.161,pale(c,.16),.006);
  },
  denim({u,l},s,c) {
    armLine(u,s,[-.341,-.193,-.069,.025],pale(c,.27),.004);
    armLine(l,s,[-.275,-.151,-.012],pale(c,.23),.004);
    const [,rx]=section(l.rows,-.291);oval(l.root,brass,[s*rx,-.291,.014],[.007,.012,.012],null,'metal',true);
  },
  breton({u,l},s,c) {
    for(const y of [-.311,-.192,-.074])stripe(u,y,y+.051,c,.005);
    for(const y of [-.214,-.096])stripe(l,y,y+.051,c,.005);
  },
  blazer({l},s) {
    for(const y of [-.300,-.266,-.231]){const [,rx]=section(l.rows,y);oval(l.root,brass,[s*(rx+.005),y,.010],[.006,.010,.010],null,'metal',true);}
  },
  wrap({l},s,c) {
    stripe(l,-.304,-.292,ivory,.012);stripe(l,-.253,-.238,pale(c,.17),.006);
  },
  track({u,l},s) {
    armLine(u,s,[-.347,-.206,-.070,.043],ivory,.013);armLine(l,s,[-.251,-.172,-.039,.025],ivory,.013);
  },
  knight({u,l},s,c) {
    const metalShape=[[-.187,.143,.142],[-.176,.180,.182],[-.143,.200,.198],[-.055,.203,.197],[.031,.177,.174],[.101,.110,.116],[.126,.044,.050],[.130,.008,.009]];
    const pauldron=armShape(u.root,metalShape,pale(c,.13),.87);
    stripe(pauldron,-.169,-.146,brass,.006);
    const vambrace=armShape(l.root,[[-.313,.120,.121],[-.301,.129,.130],[-.153,.147,.145],[-.100,.143,.144],[-.079,.113,.113]],c,.83);
    stripe(vambrace,-.296,-.279,pale(c,.32),.005);stripe(vambrace,-.120,-.107,brass,.006);
    sleeveMark(pauldron,s,brass,'rank');
  },
  spacesuit({u,l},s) {
    stripe(u,-.283,-.239,'#df9d56',.008);
    stripe(l,-.191,-.160,'#8997a7',.008);stripe(l,-.144,-.119,'#8997a7',.008);
    sleeveMark(u,s,s<0?'#c58364':'#8aadc2','round');
  },
  sailor({u}) {
    stripe(u,-.193,-.185,ivory,.013);stripe(u,-.153,-.142,navy,.005);
  },
  cableknit({u,l},s,c) {
    for(const shell of [u,l])armLine(shell,s,[-.247,-.166,-.059,.009],pale(c,.15),.010);
  },
  crop({u},s,c) {stripe(u,-.153,-.143,pale(c,.12),.005);},
  moto({u,l},s,c) {
    for(const y of [-.202,-.166,-.131])stripe(u,y,y+.011,pale(c,.10),.006);
    armLine(l,s,[-.297,-.242,-.162],silver,.005);
  },
  slicker({u,l},s,c) {stripe(l,-.239,-.226,'#e9d9aa',.009);sleeveMark(u,s,dark(c,.26),'pocket');},
  folk({l}) {stripe(l,-.302,-.278,'#efb984',.012);stripe(l,-.248,-.230,'#87a798',.008);},
  turtleneck({u,l},s,c) {armLine(u,s,[-.326,-.187,-.069,.026],pale(c,.08),.005);armLine(l,s,[-.251,-.138,-.026],pale(c,.08),.005);},
  blouse({u,l},s,c) {
    armLine(u,s,[-.287,-.212,-.114,-.039,.047],pale(c,.13),.005);
    stripe(l,-.307,-.287,pale(c,.28),.012);
  },
  ranger({u},s,c) {sleeveMark(u,s,dark(c,.15),'rank');},
  chef({u},s,c) {stripe(u,-.319,-.310,pale(c,.30),.012);},
  bowling({u},s,c) {stripe(u,-.194,-.188,dark(c,.36),.012);},
  mage({l}) {stripe(l,-.320,-.301,brass,.012);stripe(l,-.252,-.235,brass,.007);},
  western({l},s) {
    stripe(l,-.304,-.294,ivory,.012);
    const [,rx]=section(l.rows,-.277);oval(l.root,brass,[s*(rx+.007),-.277,.011],[.009,.015,.015],null,'metal',true);
  }
};
export function drawSleeves(upper,lower,side,id,color,skin,preview=false) {
  const recipe=sleeveRecipes[id];
  if(!recipe)return false;
  const style=recipe(color), shells=fabricSleeves(upper,lower,style,skin||'#e5ac80',preview);
  sleeveArtists[id]?.(shells,side,color);
  return true;
}
