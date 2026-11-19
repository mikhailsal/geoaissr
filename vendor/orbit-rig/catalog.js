import {extraOutfits} from './wardrobe-styles.js';
import {extraHairs} from './hair-styles.js';
import {bottoms,shoes} from './lower-styles.js';
import {mustaches,beards} from './facial-hair.js';
import {eyeStyles,browStyles,noseStyles,freckleStyles,faceMarks} from './face-styles.js';
import {extraHeadwear,extraEyewear,earrings,neckwear} from './accessory-styles.js';
import {builds,faceShapes} from './proportions.js';

const baseOutfits=[
  {id:'bomber',name:'Orbit bomber',color:'#ec813f'},{id:'hoodie',name:'Cloud hoodie',color:'#ac90e9'},
  {id:'vest',name:'Field vest',color:'#77ad97'},{id:'tech',name:'Tech jacket',color:'#444859'}
];
const baseHairs=[
  {id:'swoop',name:'Side sweep',color:'#483029'},{id:'curls',name:'Soft curls',color:'#734832'},
  {id:'bob',name:'Blunt bob',color:'#39303e'},{id:'buns',name:'Space buns',color:'#aa7291'}
];
function showcase(items,first) {
  const favorites=first.map(id=>items.find(v=>v.id===id)).filter(Boolean);
  return [...favorites,...items.filter(item=>!favorites.includes(item))];
}
export const outfits=showcase([...baseOutfits,...extraOutfits],['bomber','varsity','wrap','spacesuit','denim','hoodie','sailor','moto','poncho','knight','vest','tech']);
export const hairs=showcase([...baseHairs,...extraHairs],['swoop','afro','bob','mohawk','buns','pixie','locs','curls','braids','ponytail']);
const no={id:'none',name:'None'};
const headwear=[{...no,name:'No headwear'},{id:'headset',name:'Headphones',color:'#e88a48'},{id:'beanie',name:'Knit beanie',color:'#a494ce',brim:.798},...extraHeadwear];
const eyewear=[{...no,name:'No eyewear'},{id:'shades',name:'Sun shades',color:'#444859'},...extraEyewear];
const dyeStyles=[{id:'solid',name:'Single color'},{id:'tips',name:'Dip-dyed ends'},{id:'split',name:'Split dye'},{id:'streaks',name:'Highlights'}];
function palette(pairs) {return pairs.map(([name,color])=>({id:color,name,color}));}
export const tones=palette([
  ['Porcelain','#fbe0cf'],['Rose ivory','#f3d1c0'],['Peach','#f5c4a1'],['Sand','#e4bc91'],
  ['Honey','#e5ac80'],['Golden','#ce9064'],['Caramel','#b37752'],['Sienna','#a76b4c'],
  ['Chestnut','#935f45'],['Walnut','#805742'],['Umber','#704632'],['Espresso','#4b3028']
]);
export const fabricColors=palette([
  ['Solar orange','#ec813f'],['Nebula','#ac90e9'],['Glacier','#72b6cc'],['Sage','#77ad97'],
  ['Pearl','#e6dfcb'],['Graphite','#444859'],['Cherry','#bd485c'],['Cobalt','#4368a7'],
  ['Marigold','#d9ae53'],['Ink','#292935']
]);
export const hairColors=palette([
  ['Espresso','#483029'],['Chestnut','#734832'],['Honey blond','#d3a467'],['Inkwell','#39303e'],
  ['Dusty rose','#aa7291'],['Silver','#bbc1d3'],['Copper','#b9653f'],['Platinum','#ecdec5'],
  ['Lagoon','#397d84'],['Iris','#8468bb']
]);
const eyeColors=palette([
  ['Cocoa','#543a2b'],['Amber','#ad793d'],['Hazel','#8a8150'],['Fern','#54846b'],['Ocean','#5184a9'],
  ['Ice','#8bbac5'],['Violet','#9171ad'],['Slate','#8c959a']
]);
const metalColors=palette([
  ['Gold','#dcb674'],['Silver','#b9c4d0'],['Rose gold','#cc9485'],['Obsidian','#43434f'],
  ['Violet','#ac90e9'],['Turquoise','#72b6b2'],['Ruby','#bd485c'],['Pearl','#e6dfcb']
]);
export const gestures=[
  {id:'gg',name:'Good game',duration:2.2},{id:'laugh',name:'Laugh',duration:2.3},
  {id:'cheer',name:'Celebrate',duration:2.6},{id:'wave',name:'Wave',duration:2.5},
  {id:'think',name:'Think',duration:2.7},{id:'joy',name:'Happy tears',duration:2.5},{id:'cool',name:'Cool',duration:2.4}
];
export const categories=[
  {id:'outfit',name:'Clothes',icon:'outfit',fields:['outfit','bottom','shoe']},
  {id:'hair',name:'Hair',icon:'hair',fields:['hair','dye']},
  {id:'face',name:'Face',icon:'face',fields:['eyeStyle','brow','nose','freckles','mark']},
  {id:'groom',name:'Facial hair',icon:'mustache',fields:['mustache','beard']},
  {id:'gear',name:'Gear',icon:'gear',fields:['gear','eyewear','earrings','neckwear']},
  {id:'skin',name:'Body',icon:'body',fields:['skin','faceShape','build']}
];
function field(name,items,colorField=null,colorName=null,colors=null,linked=false) {
  return {name,items,colorField,colorName,colors,linked};
}
export const slots={
  outfit:field('Tops',outfits,'color','Top color',fabricColors),
  bottom:field('Bottoms',bottoms,'bottomColor','Bottom color',fabricColors),
  shoe:field('Shoes',shoes,'shoeColor','Shoe color',fabricColors),
  hair:field('Hairstyles',hairs,'hairColor','Base color',hairColors),
  dye:field('Color effects',dyeStyles,'dyeColor','Accent color',hairColors),
  eyeStyle:field('Eyes',eyeStyles,'eyeColor','Iris color',eyeColors),
  brow:field('Brows',browStyles,'browColor','Brow color',hairColors,true),
  nose:field('Noses',noseStyles),freckles:field('Freckles',freckleStyles),mark:field('Marks',faceMarks),
  mustache:field('Mustaches',mustaches,'mustacheColor','Mustache color',hairColors,true),
  beard:field('Beards',beards,'beardColor','Beard color',hairColors,true),
  gear:field('Headwear',headwear,'gearColor','Headwear color',fabricColors),
  eyewear:field('Eyewear',eyewear,'eyewearColor','Frame color',fabricColors),
  earrings:field('Earrings',earrings,'earringColor','Jewelry color',metalColors),
  neckwear:field('Neckwear',neckwear,'neckColor','Accessory color',metalColors),
  skin:field('Skin tones',tones),faceShape:field('Head shape',faceShapes),build:field('Build',builds)
};
export const defaultLook=Object.freeze({
  name:'Nova',outfit:'bomber',color:'#ec813f',bottom:'cargo',bottomColor:'#414351',shoe:'sneakers',shoeColor:'#464554',
  hair:'swoop',hairColor:'#483029',dye:'solid',dyeColor:'#aa7291',skin:'#e5ac80',faceShape:'classic',build:'classic',
  eyeStyle:'classic',eyeColor:'#543a2b',brow:'classic',browColor:'match',nose:'button',freckles:'light',mark:'none',
  mustache:'none',mustacheColor:'match',beard:'none',beardColor:'match',gear:'headset',gearColor:'#e88a48',
  eyewear:'none',eyewearColor:'#444859',earrings:'none',earringColor:'#dcb674',neckwear:'none',neckColor:'#dcb674'
});
const isColor=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v);
const choices=Object.fromEntries(Object.entries(slots).map(([id,s])=>[id,new Set(s.items.map(item=>item.id))]));
export function validLook(value) {
  const v=value && typeof value==='object'?value:{};
  const result={...defaultLook};
  result.name=typeof v.name==='string'&&v.name.trim()?v.name.trim().slice(0,32):defaultLook.name;
  for(const [id,s] of Object.entries(slots)) {
    if(choices[id].has(v[id])) result[id]=v[id];
    const key=s.colorField;
    if(key && isColor(v[key]))result[key]=v[key].toLowerCase();
    else if(key && s.linked && v[key]==='match')result[key]='match';
  }
  if(isColor(v.skin))result.skin=v.skin.toLowerCase();
  // Earlier saves used one shared headgear slot for both hats and glasses.
  if(v.gear==='shades'){result.gear='none';if(v.eyewear===undefined)result.eyewear='shades';}
  if(v.gear==='beanie'&&v.gearColor===undefined)result.gearColor='#a494ce';
  return result;
}
export function pigment(look,key) {return look[key]==='match'?look.hairColor:look[key];}
export function chooseStyle(look,id,choice) {
  if(id==='skin')return {...look,skin:choice};
  const slot=slots[id],item=slot.items.find(i=>i.id===choice);
  if(!item)return look;
  const next={...look,[id]:choice};
  const prev=slot.items.find(i=>i.id===look[id]);
  if(item.color && slot.colorField && !slot.linked && id!=='eyeStyle' && id!=='dye' &&
     (look[slot.colorField]===prev?.color || (prev?.id==='none' && look[slot.colorField]===defaultLook[slot.colorField]))) {
    next[slot.colorField]=item.color;
  }
  return next;
}
const sample=(list,random)=>list[Math.floor(random()*list.length)];
export function randomLook(current,random=Math.random) {
  const next={...defaultLook,name:current.name};
  const optional={gear:.47,eyewear:.44,earrings:.46,neckwear:.38,mustache:.47,beard:.42,mark:.43};
  for(const [id,s] of Object.entries(slots)) {
    const pick=optional[id]!==undefined?(random()<optional[id]?sample(s.items.filter(i=>i.id!=='none'),random):s.items.find(i=>i.id==='none')):sample(s.items,random);
    next[id]=pick.id;
    if(s.colorField) {
      next[s.colorField]=s.linked && random()<.82?'match':(pick.color && random()<.67?pick.color:sample(s.colors,random).color);
      if(id==='eyeStyle')next.eyeColor=sample(eyeColors,random).color;
    }
  }
  if(random()<.65)next.dye='solid';
  return validLook(next);
}
