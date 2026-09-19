// Automatic crop upgrades change geometry only. Manual and legacy/unknown crops are protected.
import {validateCrop} from './cropGeometry.js';
export const CROP_ALGORITHM='image-only-row-v5-geometry';
const eligible=row=>row.crop?.source==='auto'&&row.crop.reviewed!==true&&row.reviewStatus!=='manually-saved'&&['image-only-row-v1','image-only-row-v2-content-gaps','image-only-row-v3-consensus'].includes(row.crop.algorithm);
// Completion is approval even when the proposed automatic box was unchanged.
export const needsCropUpgrade=(image,song)=>!song?.completed&&image.status==='done'&&image.result?.rows?.some(eligible);
export function applyCropUpgrade(image,slices){
 const rows=image.result?.rows;
 if(!rows?.length||rows.length!==slices?.length)return image;
 // Require a one-to-one spatial correspondence, not merely equal array lengths.
 const centers=slices.map(s=>(s.digitBand?.[0]+s.digitBand?.[1])/2);
 if(centers.some((c,i)=>!Number.isFinite(c)||(i>0&&c<=centers[i-1])))return image;
 for(let i=0;i<rows.length;i++){
  const old=rows[i].crop,next=slices[i].crop;
  if(next?.version!==2||!validateCrop(old)||!validateCrop(next)||next.source!=='auto'||next.algorithm!==CROP_ALGORITHM)return image;
  const bands=slices[i].digitBands??[slices[i].digitBand];
  if(!Array.isArray(bands)||!bands.length||bands.some(b=>!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)||b[0]<next.y-1e-9||b[0]>=b[1]||b[1]>next.y+next.height+1e-9))return image;
  if(centers[i]<old.y||centers[i]>old.y+old.height)return image;
  if(centers.some((c,j)=>j!==i&&c>old.y&&c<old.y+old.height))return image;
 }
 let changed=false;
 const updated=rows.map((row,i)=>{
  if(!eligible(row))return row;
  const old=row.crop,next=slices[i].crop;
  // Structural or large changes require explicit recognition, not migration.
  const dy=Math.max(Math.abs(old.y-next.y),Math.abs(old.y+old.height-next.y-next.height));
  const dx=Math.max(Math.abs(old.x-next.x),Math.abs(old.x+old.width-next.x-next.width));
  if(dy>.15*Math.min(old.height,next.height)+1e-9||dx>.15*Math.min(old.width,next.width)+1e-9)return row;
  changed=true;return {...row,crop:{...slices[i].crop}};
 });
 return changed?{...image,result:{...image.result,rows:updated}}:image;
}
export async function refreshAutomaticCrops(image,{signal,fetcher=fetch}={}){
 if(!needsCropUpgrade(image))return image;
 let src=image.src;
 if(!src?.startsWith('data:image/')){
  const response=await fetcher(src,{signal});if(!response.ok)throw Error('原图读取失败');
  const blob=await response.blob();src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
 }
 const response=await fetcher('/api/score-slices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:src}),signal});
 if(!response.ok)throw Error('自动框更新暂不可用');
 const value=await response.json();return applyCropUpgrade(image,value.rows);
}
