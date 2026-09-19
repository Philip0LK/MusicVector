// V2 uses the upright original image, never CSS pixels or analysis-image pixels.
function validBox(crop){return [2,3].includes(crop?.version)&&crop.space==='image-normalized'&&[crop.x,crop.y,crop.width,crop.height].every(Number.isFinite)&&crop.x>=0&&crop.y>=0&&crop.width>0&&crop.height>0&&crop.x+crop.width<=1+1e-9&&crop.y+crop.height<=1+1e-9;}
const matrixValid=m=>Array.isArray(m)&&m.length===3&&m.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite))&&Math.abs(m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]))>1e-12;
export function validateCrop(crop){
 if(!validBox(crop))return false;
 if(crop.version===2)return true;
 const f=crop.rectified;
 return !!f&&[f.width,f.height,f.originalWidth,f.originalHeight].every(n=>Number.isFinite(n)&&n>0)&&matrixValid(f.fromOriginal)&&matrixValid(f.toOriginal)&&validBox(f.rect)&&f.rect.version===2&&Array.isArray(crop.quad)&&crop.quad.length===4&&crop.quad.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
}
export function editingCropRect(crop,w,h){return crop?.version===3&&validateCrop(crop)?crop.rectified.rect:cropRect(crop,w,h);}
export function projectedPoint(matrix,x,y){const z=matrix[2][0]*x+matrix[2][1]*y+matrix[2][2];if(Math.abs(z)<1e-9)throw Error('无效坐标变换');return [(matrix[0][0]*x+matrix[0][1]*y+matrix[0][2])/z,(matrix[1][0]*x+matrix[1][1]*y+matrix[1][2])/z];}
export function replaceRectifiedCrop(crop,rect){
 if(!validateCrop(crop)||crop.version!==3||!validBox(rect))throw Error('无效校正裁切');
 const f=crop.rectified,{x,y,width:w,height:h}=rect;
 const quad=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b])=>projectedPoint(f.toOriginal,a*f.width,b*f.height)).map(([a,b])=>[a/f.originalWidth,b/f.originalHeight]);
 const left=Math.max(0,Math.min(...quad.map(p=>p[0]))),top=Math.max(0,Math.min(...quad.map(p=>p[1]))),right=Math.min(1,Math.max(...quad.map(p=>p[0]))),bottom=Math.min(1,Math.max(...quad.map(p=>p[1])));
 const next={...crop,x:left,y:top,width:right-left,height:bottom-top,quad,source:'manual',reviewed:true,rectified:{...f,rect:{...rect,source:'manual',reviewed:true}}};
 if(!validateCrop(next))throw Error('裁切超出原图');return next;
}
export function adjustCropEdge(crop,edge,value,w,h){
 const c={...editingCropRect(crop,w,h),version:2,space:'image-normalized',source:'manual',reviewed:true};
 if(edge===0){c.height+=c.y-value;c.y=value;}else if(edge===1)c.height=value-c.y;else if(edge===2){c.width+=c.x-value;c.x=value;}else c.width=value-c.x;
 return crop?.version===3?replaceRectifiedCrop(crop,c):c;
}
export function cropPolygonStyle(crop){
 if(crop?.version!==3||!validateCrop(crop))return {};
 return {clipPath:'polygon('+crop.quad.map(([x,y])=>((x-crop.x)/crop.width*100)+'% '+((y-crop.y)/crop.height*100)+'%').join(',')+')'};
}
export function cssProjectiveMatrix(m){return 'matrix3d('+[m[0][0],m[1][0],0,m[2][0],m[0][1],m[1][1],0,m[2][1],0,0,1,0,m[0][2],m[1][2],0,m[2][2]].join(',')+')';}

export function cropRect(crop,imageWidth,imageHeight){
 const ratio=imageHeight/imageWidth;
 if(!Number.isFinite(ratio)||ratio<=0)return {x:0,y:0,width:1,height:1,top:0,bottom:1};
 if(Array.isArray(crop)){const top=Math.max(0,Math.min(Number(crop[0])||0,ratio-.01));const bottom=Math.max(top+.01,Math.min(Number(crop[1])||top+.01,ratio));return {x:.065,y:top/ratio,width:.925,height:(bottom-top)/ratio,top,bottom};}
 if(!validateCrop(crop))return {x:0,y:0,width:1,height:1,top:0,bottom:ratio,invalid:true};
 return {...crop,top:crop.y*ratio,bottom:(crop.y+crop.height)*ratio};
}
export function manualCrop(crop,imageWidth,imageHeight){if(crop?.version===3&&validateCrop(crop))return {...structuredClone(crop),source:'manual',reviewed:true};const r=cropRect(crop,imageWidth,imageHeight);return {version:2,space:'image-normalized',x:r.x,y:r.y,width:r.width,height:r.height,source:'manual',reviewed:true};}
// Provider boxes are in an explicitly declared analysis frame. Inverse affine
// transform includes any resize, crop offset, rotation or letterboxing.
export function cropFromRegions(regions,{width,height,toOriginal,originalWidth,originalHeight},metadata={}){
 if(!regions.length||![width,height,originalWidth,originalHeight].every(n=>Number.isFinite(n)&&n>0)||!Array.isArray(toOriginal)||toOriginal.length!==6||!toOriginal.every(Number.isFinite))throw Error('Missing image coordinate frame');
 const [a,b,c,d,e,f]=toOriginal;if(Math.abs(a*d-b*c)<1e-12)throw Error("Non-invertible coordinate transform");const points=regions.flatMap(r=>{if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)throw Error('Invalid region');return [[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f]);});
 const left=Math.max(0,Math.min(...points.map(p=>p[0]))),top=Math.max(0,Math.min(...points.map(p=>p[1]))),right=Math.min(originalWidth,Math.max(...points.map(p=>p[0]))),bottom=Math.min(originalHeight,Math.max(...points.map(p=>p[1])));
 const crop={...metadata,version:2,space:'image-normalized',x:left/originalWidth,y:top/originalHeight,width:(right-left)/originalWidth,height:(bottom-top)/originalHeight};if(!validateCrop(crop))throw Error('Region outside original image');return crop;
}
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<1e-7);
export function upgradeLegacyCrops(songs,reference){return songs.map(song=>{const ref=reference.find(s=>s.id===song.id);if(!ref)return song;const byId=new Map(ref.images.flatMap(i=>i.result.rows.map(r=>[r.id,r])));const upgradeImage=image=>({...image,result:image.result?{...image.result,rows:image.result.rows.map(row=>{const target=byId.get(row.id);if(!target||!Array.isArray(row.crop)||row.cropNeedsReview===false||!target.previousAutoCrops?.some(c=>same(c,row.crop)))return row;return {...row,crop:structuredClone(target.crop),cropNeedsReview:true};})}:image.result});return {...song,images:song.images.map(upgradeImage),deletedImages:song.deletedImages?.map(entry=>({...entry,image:upgradeImage(entry.image)}))};});}

// A crop-only library upgrade must not discard an unfinished notation draft.
export function reconcileCropDraft(saved,incoming){
 if(!saved)return null;
 if(saved.base===JSON.stringify(incoming))return saved;
 try{
  const base=JSON.parse(saved.base);
  const withoutCrops=doc=>{const copy=structuredClone(doc);for(const row of copy.rows){delete row.crop;delete row.cropNeedsReview;}return JSON.stringify(copy)};
  if(withoutCrops(base)!==withoutCrops(incoming))return null;
  const document=structuredClone(saved.document);
  for(const row of document.rows){const old=base.rows.find(r=>r.id===row.id),next=incoming.rows.find(r=>r.id===row.id);if(old&&next&&JSON.stringify(row.crop)===JSON.stringify(old.crop)&&row.cropNeedsReview===old.cropNeedsReview){row.crop=structuredClone(next.crop);row.cropNeedsReview=next.cropNeedsReview;}}
  return {...saved,base:JSON.stringify(incoming),document};
 }catch{return null;}
}
