// Geometry shared by automatic following and the return-to-current affordance.
const tolerance=1; // Layout can be fractional while native scroll positions round to pixels.
export function scrollDelta(start,end,low,high,force=false){
 if(![start,end,low,high].every(Number.isFinite)||high<=low)return 0;
 if(end-start>high-low+tolerance){const center=(start+end)/2;return !force&&center>=low-tolerance&&center<=high+tolerance?0:center-(low+high)/2;}
 return !force&&start>=low-tolerance&&end<=high+tolerance?0:start-low;
}
export function targetDirection(target,viewport,padding=12){
 if(!target)return null;
 const r=target.rect,top=viewport.top+padding,bottom=viewport.bottom-padding;
 const left=Math.max(viewport.left+padding,target.clip?target.clip.left+6:-Infinity),right=Math.min(viewport.right-padding,target.clip?target.clip.right-6:Infinity);
 const y=r.bottom-r.top>bottom-top+tolerance?(r.top+r.bottom)/2:null;
 if(y!==null?y<top-tolerance:r.top<top-tolerance)return 'up';
 if(y!==null?y>bottom+tolerance:r.bottom>bottom+tolerance)return 'down';
 return scrollDelta(r.left,r.right,left,right)!==0?'center':null;
}
export function canScroll(position,maximum,delta){return Math.abs(Math.max(0,Math.min(maximum,position+delta))-position)>.5;}
