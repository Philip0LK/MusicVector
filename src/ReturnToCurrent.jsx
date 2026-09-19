import React,{useState,useRef,useEffect,useLayoutEffect} from 'react';
// Keep the hit target alive while the pointer remains over it after the first click.
export function ReturnToCurrent({viewport,getTarget,onReturn,label}){
 const [direction,setDirection]=useState(null),[held,setHeld]=useState(null);
 const latest=useRef();latest.current={getTarget,onReturn};
 const check=()=>{const sc=viewport.current,t=latest.current.getTarget();if(!sc||!t){setDirection(null);return}const v=sc.getBoundingClientRect(),r=t.rect;
 const top=v.top+8,bottom=v.bottom-8;
 const left=Math.max(v.left+8,t.clip?.left??-Infinity),right=Math.min(v.right-8,t.clip?.right??Infinity);
 const horizontal=r.right-r.left>right-left?(r.left+r.right)/2<left||(r.left+r.right)/2>right:r.left<left||r.right>right;
 const y=r.height>bottom-top?(r.top+r.bottom)/2:null;
 setDirection((y!==null?y<top:r.top<top)?'up':(y!==null?y>bottom:r.bottom>bottom)?'down':horizontal?'center':null);
 };
 useLayoutEffect(check);
 useEffect(()=>{let frame;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(check)};window.addEventListener('scroll',update,true);window.addEventListener('resize',update);const ob=new ResizeObserver(update);if(viewport.current)ob.observe(viewport.current);return()=>{cancelAnimationFrame(frame);ob.disconnect();window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update)}},[]);
 const shown=held||direction;if(!shown)return null;
 return <button className="return-current" data-direction={shown} aria-label={label+'回到当前音'} title="单击定位本侧 · 双击定位两侧" onPointerDown={e=>{e.preventDefault();e.stopPropagation()}} onClick={e=>{e.stopPropagation();setHeld(shown);latest.current.onReturn(false)}} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();latest.current.onReturn(true)}} onPointerLeave={()=>setHeld(null)} onBlur={()=>setHeld(null)} onKeyDown={e=>{if(e.key==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();latest.current.onReturn(e.shiftKey)}}}>
 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shown==='center'?<><circle cx="12" cy="12" r="5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>:<g transform={shown==='down'?'rotate(180 12 12)':undefined}><path d="M12 20V4m-6 6 6-6 6 6"/></g>}</svg>
 </button>;
}
