import {analyzeRowGeometry,createDigitClassifier,ANALYSIS_WIDTH} from './rhythmGeometry.js';
import {fuseRow,buildClassifierSamples} from './rhythmFusion.js';
// Convert full-image normalized evidence to normalized strip coordinates.
// Rounding of the crop's source pixels is covered by the detector's relative tolerance.
export function geometryOptions(row) {
 const band=row.digitBand,crop=row.crop?.version===3?row.crop.rectified.rect:row.crop;
 if(band==null)return {};
 if(!Array.isArray(band)||band.length!==2||!band.every(Number.isFinite)||band[0]<0||band[1]>1||band[0]>=band[1]||!crop||!Number.isFinite(crop.y)||!Number.isFinite(crop.height)||crop.height<=0)return {digitBand:[-1,-1]};
 return {digitBand:band.map(y=>(y-crop.y)/crop.height)};
}
// 几何测量层：把行裁切图解码成 RGBA，交给纯函数的 rhythmGeometry 分析。
// 浏览器内用 canvas 解码；无 DOM（单测/SSR）时返回 null，整条链路自动退回纯 AI 行为。
async function decodeImageData(src,width=ANALYSIS_WIDTH){
 if(typeof document==='undefined'||typeof Image==='undefined')return null;
 return new Promise(resolve=>{
  const image=new Image();
  image.onload=()=>{
   try{
     const height=Math.max(1,Math.round(image.naturalHeight*width/image.naturalWidth));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.fillStyle='white';context.fillRect(0,0,width,height);
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(image,0,0,width,height);
    resolve(context.getImageData(0,0,width,height));
   }catch{resolve(null);}
  };
  image.onerror=()=>resolve(null);
  image.src=src;
 });
}
// Recheck a smaller raster before accepting the measured skeleton. This guards
// against component splits/merges caused by aliasing, regardless of song/font.
export function validateGeometryStability(primary, check) {
 if(!primary.available)return primary;
 const ratio=(check.analyzedWidth||1)/(primary.analyzedWidth||1);
 const same=check.available&&primary.blocks.length===check.blocks.length&&primary.blocks.every((b,i)=>
  Math.abs(b.centerX*ratio-check.blocks[i].centerX)<=Math.max(1,primary.scale*ratio*.3));
 if(!same)return {...primary,available:false,reason:'unstable-geometry',stability:{stable:false,checkCount:check.blocks.length}};
 return {...primary,stability:{stable:true,checkCount:check.blocks.length},blocks:primary.blocks.map((b,i)=>
  b.underlines===check.blocks[i].underlines?b:{...b,underlineConfidence:0,unstableUnderlines:true})};
}
// Learn only from localized, stable, count-consistent rows. The classifier is
// supplementary alignment evidence; it never generates missing AI notes.
export async function measurePageGeometry(rows){
 if(!rows.length)return null;
 try{
  // Both sizes come directly from the original strip; resizing an already
  // resampled raster introduces avoidable extra aliasing.
  const [images,checks]=await Promise.all([
   Promise.all(rows.map(row=>decodeImageData(row.slice))),
   Promise.all(rows.map(row=>decodeImageData(row.slice,Math.round(ANALYSIS_WIDTH*.75)))),
  ]);
  if(images.every(image=>!image))return null;
  const geometries=images.map((image,index)=>{
   if(!image)return null;
   const options=geometryOptions(rows[index]);
   const primary=analyzeRowGeometry(image,options);
   return primary.available?validateGeometryStability(primary,analyzeRowGeometry(checks[index],options)):primary;
  });
  const samples=[];
  geometries.forEach((geometry,index)=>{
   if(!geometry?.available)return;
   samples.push(...buildClassifierSamples([{geometry,fused:fuseRow(geometry,rows[index].events)}]));
  });
  const classifier=samples.length?createDigitClassifier(samples):null;
  const byRow=new Map(rows.map((row,index)=>{
   const geometry=geometries[index];
   if(!geometry||!classifier)return [row.id,geometry];
   return [row.id,{...geometry,blocks:geometry.blocks.map(block=>{
    const result=classifier.classify(block.signature);
    return {...block,digit:result.digit,digitConfidence:Number((result.confidence??0).toFixed(4)),digitRejected:Boolean(result.rejected)};
   })}];
  }));
  return {byRow,classifier,sampleCount:samples.length};
 }catch{return null;}
}
