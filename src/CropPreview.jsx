import React,{useRef,useState,useLayoutEffect} from 'react';
import {cropRect} from './layoutRules.js';
import {validateCrop,cssProjectiveMatrix} from './cropGeometry.js';
export function CropPreview({page,band,line,src}){
 const ref=useRef(),[frame,setFrame]=useState({w:1,h:1}),[natural,setNatural]=useState(null);
 useLayoutEffect(()=>{const ob=new ResizeObserver(()=>setFrame({w:ref.current.clientWidth,h:ref.current.clientHeight}));ob.observe(ref.current);return()=>ob.disconnect()},[]);
 const corrected=band?.version===3&&validateCrop(band)?band.rectified:null;
 const display=corrected?{w:corrected.width,h:corrected.height}:natural;
 const r=natural?(corrected?corrected.rect:cropRect(band,natural.w,natural.h)):null;
 const scale=r?Math.min(frame.w/(r.width*display.w),frame.h/(r.height*display.h)):0;
 const rw=r?r.width*display.w*scale:0,rh=r?r.height*display.h*scale:0;
 if(corrected)return <div className="crop-window stable-crop" ref={ref} data-crop={JSON.stringify(band)}><div className="crop-clip" style={{position:'absolute',overflow:'hidden',background:'white',left:(frame.w-rw)/2,top:(frame.h-rh)/2,width:rw,height:rh}}><div style={{position:'absolute',transformOrigin:'0 0',transform:`translate(${-corrected.rect.x*display.w*scale}px,${-corrected.rect.y*display.h*scale}px) scale(${scale})`}}><img src={src} onLoad={e=>setNatural({w:e.target.naturalWidth,h:e.target.naturalHeight})} alt={'原谱第'+(page+1)+'页第'+(line+1)+'行校正裁切'} style={{display:'block',width:corrected.originalWidth,height:corrected.originalHeight,maxWidth:'none',transformOrigin:'0 0',transform:cssProjectiveMatrix(corrected.fromOriginal)}}/></div></div></div>;
 return <div className="crop-window stable-crop" ref={ref} data-crop={r?JSON.stringify(r):''}><div className="crop-clip" style={{position:'absolute',overflow:'hidden',left:(frame.w-rw)/2,top:(frame.h-rh)/2,width:rw,height:rh}}><img src={src||'/song/images/00'+(page+1)+'.jpg'} onLoad={e=>setNatural({w:e.target.naturalWidth,h:e.target.naturalHeight})} alt={'原谱第'+(page+1)+'页第'+(line+1)+'行裁切'} style={{position:'absolute',width:natural?natural.w*scale:0,maxWidth:'none',height:'auto',left:r?-r.x*natural.w*scale:0,top:r?-r.y*natural.h*scale:0}}/></div></div>
}
