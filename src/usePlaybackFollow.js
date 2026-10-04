import {useLayoutEffect,useRef,useState} from 'react';
import {canScroll} from './lib/viewportFollow.js';

// Audio owns the cursor. This hook only arbitrates who owns each viewport.
export function usePlaybackFollow({songId,revision,enabled,sourceClosed,score,source,onCheck}){
 const [following,setFollowing]=useState({score:true,source:true});
 const state=useRef(following),latest=useRef(),holds=useRef(new Map()),writes=useRef(new WeakMap()),frame=useRef(0),versions=useRef({score:0,source:0});
 latest.current={onCheck};
 const request=()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{frame.current=0;latest.current.onCheck()})};
 const cancel=()=>{cancelAnimationFrame(frame.current);frame.current=0};
 const change=(side,value)=>{state.current={...state.current,[side]:value};setFollowing(state.current)};
 const browse=side=>{versions.current[side]++;if(state.current[side])change(side,false)};
 const resume=side=>{versions.current[side]++;change(side,true);request()};
 const canFollow=side=>state.current[side]&&![...holds.current.values()].some(h=>h.side===side);
 const move=(el,{top=el.scrollTop,left=el.scrollLeft})=>{
  el.scrollTop=top;el.scrollLeft=left;writes.current.set(el,{top:el.scrollTop,left:el.scrollLeft});
 };
 useLayoutEffect(()=>{cancel();holds.current.clear();state.current={score:true,source:true};setFollowing(state.current)},[songId]);
 useLayoutEffect(()=>{
  if(!enabled)return;
  const cleanups=[],observer=new ResizeObserver(request);
  for(const [side,ref] of [['score',score],['source',source]]){
   const root=ref.current;if(!root)continue;
   observer.observe(root);for(const child of root.querySelectorAll('.engraved-row,.source-pages'))observer.observe(child);
   const container=target=>target.closest?.('.measure-scroll')??root;
   const wheel=e=>{
    if(e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea'))return;
    const candidate=container(e.target),nested=candidate!==root&&candidate.scrollWidth>candidate.clientWidth+1;
    const el=nested?candidate:root,factor=e.deltaMode===1?20:e.deltaMode===2?el.clientHeight:1;
    const dx=(nested?(e.deltaX||e.deltaY):e.deltaX)*factor,dy=nested?0:e.deltaY*factor;
    if(canScroll(el.scrollLeft,el.scrollWidth-el.clientWidth,dx)||canScroll(el.scrollTop,el.scrollHeight-el.clientHeight,dy))browse(side);
   };
   const down=e=>{
    if(e.button!==0||e.target.closest('input,select,textarea,.range-handle')||e.pointerType!=='touch'&&e.target.closest('[data-global-index]'))return;
    const el=container(e.target),positions=new Map([el,root].map(view=>[view,{top:view.scrollTop,left:view.scrollLeft}]));
    holds.current.set(e.pointerId,{side,positions,touch:e.pointerType==='touch'});
   };
   const scrollEvent=e=>{
    const el=e.target,expected=writes.current.get(el);
    if(expected&&Math.abs(expected.top-el.scrollTop)<1&&Math.abs(expected.left-el.scrollLeft)<1){writes.current.delete(el);request();return;}
    for(const h of holds.current.values()){
     const before=h.positions.get(el);
     if(h.side===side&&before&&(Math.abs(before.top-el.scrollTop)>.5||Math.abs(before.left-el.scrollLeft)>.5))browse(side);
    }
    request();
   };
   const key=e=>{
    if(!['PageUp','PageDown','Home','End'].includes(e.key)||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea'))return;
    const delta=['PageUp','Home'].includes(e.key)?-root.scrollHeight:root.scrollHeight;
    if(canScroll(root.scrollTop,root.scrollHeight-root.clientHeight,delta))browse(side);
   };
   for(const [name,fn] of [['wheel',wheel],['pointerdown',down],['scroll',scrollEvent],['keydown',key]]){root.addEventListener(name,fn,{capture:true,passive:true});cleanups.push(()=>root.removeEventListener(name,fn,true));}
  }
  // Native touch scrolling cancels pointer events before its first scroll event.
  // Keep ownership suspended until touchend/touchcancel completes that gesture.
  const release=e=>{if(e.type==='pointercancel'&&holds.current.get(e.pointerId)?.touch)return;holds.current.delete(e.pointerId);request()};
  const endTouch=e=>{if(!e.touches.length){for(const [id,h] of holds.current)if(h.touch)holds.current.delete(id);request()}};
  const blur=()=>{holds.current.clear();request()};
  window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('touchend',endTouch);window.addEventListener('touchcancel',endTouch);window.addEventListener('blur',blur);window.addEventListener('resize',request);request();
  return()=>{cancel();holds.current.clear();observer.disconnect();cleanups.forEach(fn=>fn());window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('touchend',endTouch);window.removeEventListener('touchcancel',endTouch);window.removeEventListener('blur',blur);window.removeEventListener('resize',request)};
 },[songId,revision,enabled,sourceClosed]);
 useLayoutEffect(()=>()=>cancel(),[]);
 return {following,canFollow,browse,resume,move,request,cancel,version:side=>versions.current[side]};
}
