import {initialize,boot,writeResource} from './localApi.js';
import {cropPolygonStyle} from './cropGeometry.js';
import React,{useState,useEffect,useRef,useMemo,useLayoutEffect} from 'react';
import {EngravedRow} from './EngravedRow.jsx';
import {CropPreview} from './CropPreview.jsx';
import {SourceRowTargets} from './SourceRowTargets.jsx';
import {documentFromImages,reconcilePractice} from './recovery.js';
import {measures} from './model.js';
import {beatPositions,cropRect} from './layoutRules.js';
import {flatten,rhythmOf,normalizedRange,nextIndex,playbackPlan,readPreferences,BASE_TEMPO,normalizeRate} from './training.js';
import {ReturnToCurrent} from './ReturnToCurrent.jsx';
import {useLibrary,filterSongs} from './library.js';
import {SongPanel,SettingsPanel,Confirm} from './TaskPanels.jsx';
import {HandoffPanel} from './HandoffPanel.jsx';
import {SpeedControl} from './SpeedControl.jsx';
import {PianoPlayer} from './audio.js';
import {buildRhythmPlaybackPlan} from './lib/rhythmPlayback.js';
import {normalizeMusicDocument,buildPitchPlan,tieLinksForDocument} from './lib/musicStructure.js';

const EMPTY_IMAGES=[];
const Chevrons=({reverse=false})=><img className={'chevrons '+(reverse?'reverse':'')} src="/icons/chevrons-left.svg" alt=""/>;
export function App(){
 const [doc,setDoc]=useState(null),[error,setError]=useState('');
 useEffect(()=>{initialize().then(()=>setDoc({meter:{beats:4,beatUnit:4},pickup:false,rows:[],music:{arcs:[],measures:[],tuplets:[]}})).catch(e=>setError(e.message))},[]);
 return doc?<Training doc={doc}/>:<div className="loading" role="status">{error||'正在打开乐北斗…'}</div>;
}
function Training({doc:originalDocument}){
 const library=useLibrary(originalDocument);
 const [activeId,setActiveId]=useState(()=>boot.practice.activeId||boot.library?.songs?.find(s=>s.completed)?.id||''),[task,setTask]=useState(null),[settingsOpen,setSettingsOpen]=useState(false),[handoffOpen,setHandoffOpen]=useState(false),[menu,setMenu]=useState(null),[deleting,setDeleting]=useState(null),[editing,setEditing]=useState(null);
 const activeSong=library.songs.find(s=>s.id===activeId),salonImages=activeSong?.images||EMPTY_IMAGES,baseTempo=activeSong?.bpm??80;
 const rawDoc=useMemo(()=>documentFromImages({...originalDocument,meter:activeSong?.meter||originalDocument.meter,pickup:activeSong?.pickup??(activeSong?.id==='salon'?originalDocument.pickup:false),music:activeSong?.music??(activeSong?.id==='salon'?originalDocument.music:{arcs:[],tuplets:[],measures:[]})},salonImages),[originalDocument,salonImages,activeSong?.meter,activeSong?.pickup,activeSong?.music]);
 const doc=useMemo(()=>normalizeMusicDocument(rawDoc,{key:activeSong?.key,octave:activeSong?.octave,bpm:baseTempo}),[rawDoc,activeSong?.key,activeSong?.octave,baseTempo]);
 const isSalon=doc.rows.length>0;
 const editFrame=useRef();
 const modalState=useRef();modalState.current={isSalon:isSalon&&!editing};
 const notes=useMemo(()=>flatten(doc),[doc]);
 const rhythm=useMemo(()=>rhythmOf(doc,{baseTempo,key:activeSong?.key,octave:activeSong?.octave}),[doc,baseTempo,activeSong?.key,activeSong?.octave]);
 const pitchPlan=useMemo(()=>buildPitchPlan(doc,{key:activeSong?.key,octave:activeSong?.octave}),[doc,activeSong?.key,activeSong?.octave]);
 const tieLinks=useMemo(()=>tieLinksForDocument(doc),[doc]);
 const initial=useMemo(()=>readPreferences(notes.length,notes.findIndex(n=>n.degree!==0),baseTempo),[]);
 const [cursor,updateCursor]=useState(initial.cursor),[hasPlayed,setHasPlayed]=useState(false),[range,setRange]=useState(initial.range),[tempo,setTempo]=useState(initial.tempo);
 const [navClosed,setNavClosed]=useState(initial.navClosed),[sourceClosed,setSourceClosed]=useState(initial.sourceClosed);
 // 搜索只改列表的可见范围，不进入曲库数据；关闭导航或选中歌曲后收回，避免留下看不见的筛选状态。
 const [searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState(''),[closing,setClosing]=useState(false);
 const searchInput=useRef(),searchOpenRef=useRef(),closeTimer=useRef();
 const [status,setStatus]=useState('paused'),[selecting,setSelecting]=useState(false),[anchor,setAnchor]=useState(null),[notice,setNotice]=useState(''),[follow,setFollow]=useState(true),[zoom,setZoom]=useState(100),[sourcePage,setSourcePage]=useState(0),[loaded,setLoaded]=useState(0),[size,setSize]=useState(24);
 const played=useRef({index:initial.cursor,value:false});
 const setCursor=(index,didPlay=false)=>{played.current={index,value:didPlay};updateCursor(index);setHasPlayed(didPlay)};
 const player=useRef(new PianoPlayer()),scroll=useRef(),sourceScroll=useRef(),imgs=useRef([]),rows=useRef([]),main=useRef(),latest=useRef(),gesture=useRef(null),pan=useRef(null),followRef=useRef(true),sourceScrollTop=useRef(0),sourceScrollLeft=useRef(0),restoreSource=useRef(null),live=useRef(true),noticeTimer=useRef();
 latest.current={cursor,range,tempo,rate:tempo/baseTempo,baseTempo,status,selecting,anchor};followRef.current=follow;
 const allMeasures=useMemo(()=>measures(doc),[doc]),beams=useMemo(()=>beatPositions(doc,allMeasures),[doc]);
 const offsets=useMemo(()=>{let i=0;return doc.rows.map(r=>{const s=i;i+=r.notes.length;return s})},[doc]);
 const current=notes[Math.min(cursor,notes.length-1)]||{row:0,note:0};
 const previousNotes=useRef(notes),hydratedPractice=useRef(false),savedPractice=useRef(null);
 if(savedPractice.current===null)savedPractice.current=boot.practice;
 useLayoutEffect(()=>{const before=previousNotes.current;if(before===notes&&(!library.ready||hydratedPractice.current))return;let mapped=reconcilePractice(before,notes,latest.current.cursor,latest.current.range);if(library.ready&&!hydratedPractice.current){hydratedPractice.current=true;const saved=savedPractice.current;if(saved.cursorId){const index=notes.findIndex(n=>n.id===saved.cursorId);if(index>=0)mapped.cursor=index;}if(saved.rangeIds){const positions=saved.rangeIds.map(id=>notes.findIndex(n=>n.id===id));mapped.range=positions.length&&positions.every((v,i)=>v>=0&&v===positions[0]+i)?{startIndex:positions[0],endIndex:positions.at(-1)}:null;}}player.current.stop();setStatus('paused');setCursor(mapped.cursor);setRange(mapped.range);setSelecting(false);setAnchor(null);previousNotes.current=notes;if(mapped.invalidated)message('歌曲结构已改变，请重新选择练习片段')},[notes,library.ready]);
 const highlightedRows=range?doc.rows.map((r,i)=>i).filter(i=>i>=notes[range.startIndex]?.row&&i<=notes[range.endIndex]?.row):[current.row];
 // 零音符行在训练页当作不存在：不显示、不占位、原图对应裁切区域也不显示且点不到。
 const emptyRows=doc.rows.filter(r=>!r.notes.length).length;
 const visibleRows=doc.rows.map((r,i)=>[r,i]).filter(([r])=>r.notes.length>0);
 const incompleteScore=salonImages.some(i=>!i.result?.rows?.length);
 const active=status==='playing'||status==='waiting'||status==='loading';
 const message=text=>{clearTimeout(noticeTimer.current);setNotice(text);noticeTimer.current=setTimeout(()=>setNotice(''),3200)};
 useEffect(()=>()=>{live.current=false;player.current.dispose();clearTimeout(noticeTimer.current)},[]);
 // 开发模式下的只读状态钩子，供本地 UI 回归测试断言内部状态；生产构建里 import.meta.env.DEV
 // 为 false，整段会被摇树掉，发布包不含它。
 useEffect(()=>{if(!import.meta.env.DEV)return;window.__training={snapshot:()=>({...latest.current,hasPlayed:played.current.value,notes:notes.length,missing:notes.filter(n=>!n.annotation.durationTicks).length,audio:{...player.current.stats,activeSources:player.current.sources.size,timers:player.current.timers?.size??0},document:doc,music:doc.music,diagnostics:doc.music?.diagnostics??[]}),previewPlan:options=>playbackPlan(notes,rhythm,options?.startIndex??latest.current.cursor,options?.range??latest.current.range,options?.tempo??latest.current.tempo)};return()=>delete window.__training},[doc,notes,rhythm]);
 useEffect(()=>{if(!library.ready)return;const timer=setTimeout(()=>{writeResource('/api/practice',{activeId,cursor,range,cursorId:notes[cursor]?.id,rangeIds:range?notes.slice(range.startIndex,range.endIndex+1).map(n=>n.id):null,tempo,rate:tempo/baseTempo,navClosed,sourceClosed},{retryOnConflict:true}).catch(e=>setNotice('练习位置未保存：'+e.message))},200);return()=>clearTimeout(timer)},[activeId,cursor,range,tempo,navClosed,sourceClosed,library.ready,notes]);
 useLayoutEffect(()=>{const el=main.current;if(!el)return;const ob=new ResizeObserver(()=>setSize(Math.max(22,Math.min(28,22+(el.clientWidth-500)/100))));ob.observe(el);return()=>ob.disconnect()},[isSalon]);
 const reveal=(index,force=false)=>{const el=rows.current[notes[index].row],sc=scroll.current;if(!el||!sc||(!force&&!followRef.current))return;const r=el.getBoundingClientRect(),s=sc.getBoundingClientRect();if(force||r.top<s.top+12||r.bottom>s.bottom-12)sc.scrollTop+=r.top-s.top-24;};
 const locateOriginal=(index=latest.current.cursor)=>{const r=doc.rows[notes[index].row],img=imgs.current[r.page],sc=sourceScroll.current;if(!img||!sc)return;const rect=cropRect(r.crop,img.naturalWidth,img.naturalHeight);sc.scrollTop+=img.getBoundingClientRect().top-sc.getBoundingClientRect().top+img.clientHeight*(rect.y+rect.height/2)-sc.clientHeight/2;};
 useLayoutEffect(()=>{if(!sourceClosed&&sourceScroll.current&&restoreSource.current!==null&&imgs.current.filter(Boolean).length===salonImages.length&&imgs.current.every(i=>i?.naturalWidth)){sourceScroll.current.scrollTop=restoreSource.current;sourceScroll.current.scrollLeft=sourceScrollLeft.current;sourceScrollTop.current=restoreSource.current;restoreSource.current=null}},[sourceClosed,loaded]);
 const pause=()=>{player.current.stop();setStatus('paused')};
 const choose=(index,{keepRange=true,revealScore=true}={})=>{pause();const s=latest.current;if(!keepRange&&s.range&&(index<s.range.startIndex||index>s.range.endIndex))setRange(null);setCursor(index);if(revealScore)reveal(index,true);};
 async function play(start=latest.current.cursor,r=latest.current.range,t=latest.current.tempo){
  if(doc.rows.some(r=>r.recognitionBlocked&&r.notes.length)){message('存在未确认的音符，请先修正乐谱');return;}
  if(incompleteScore){message('部分图片尚无可训练乐谱，请先完成识别和校对');return;}
  try{const plan=playbackPlan(notes,rhythm,start,r,t);const blocking=plan.diagnostics.find(item=>item.severity==='error');if(blocking){message(blocking.message);return;}if(plan.missingIndexes.length){message('选段中有未标注时值');return;}
   setSelecting(false);setAnchor(null);setStatus('loading');setFollow(true);followRef.current=true;reveal(plan.startIndex,true);
   await player.current.play(plan,notes,{midiForStep:index=>pitchPlan[index]?.midi??null,onReady:()=>{if(live.current)setStatus('playing')},onNote:i=>{if(!live.current)return;setCursor(i,true);reveal(i)},onDone:()=>{if(!live.current)return;if(r){setStatus('waiting');const g=player.current.generation;player.current.later(()=>{player.current.stats.loops++;void play(r.startIndex,r,latest.current.tempo)},1000,g)}else{setStatus('ended')}}});}catch(e){if(live.current){setStatus('paused');message(e.message)}}
  }
 async function audition(index=latest.current.cursor){
  const r=latest.current.range,limit=r?.endIndex??notes.length-1;let end=index;
  while(end<limit&&tieLinks[end]){end++;}
  const plan=buildRhythmPlaybackPlan(notes,rhythm,{startIndex:index,endIndex:end,tempo:latest.current.tempo,baseTempo});setStatus('audition');setCursor(index);reveal(index,true);
  try{await player.current.play(plan,notes,{midiForStep:i=>pitchPlan[i]?.midi??null,onNote:i=>{if(live.current)setCursor(i,true)},onDone:()=>{if(live.current)setStatus('paused')}})}catch(e){setStatus('paused');message(e.message)}
 }
 const step=d=>{const s=latest.current;void audition(played.current.index===s.cursor&&played.current.value?nextIndex(s.cursor,d,notes.length,s.range):s.cursor);};
 const clearRange=()=>{pause();setRange(null);setSelecting(false);setAnchor(null)};
 const startSelection=()=>{pause();setSelecting(v=>!v);setAnchor(null)};
 const commitRate=value=>{const n=baseTempo*normalizeRate(value);setTempo(n);if(['playing','waiting','loading'].includes(latest.current.status))void play(latest.current.cursor,latest.current.range,n)};
 const togglePlay=()=>{const s=latest.current;if(['playing','waiting','loading','audition'].includes(s.status))pause();else void play(s.status==='ended'?(s.range?.startIndex??0):s.cursor)};
 useEffect(()=>{const key=e=>{
  if(document.querySelector('dialog[open]')||!modalState.current.isSalon)return;
  if(e.target.closest('input:not([type=range]),select,textarea,[contenteditable=true]')||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  if(e.target.closest('.return-current,.speed-control button')&&(e.key==='Enter'||e.code==='Space'))return;
  if(e.key==='F7'){e.preventDefault();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();window.getSelection()?.removeAllRanges();}
  const s=latest.current;
  if(e.key==='Escape'){e.preventDefault();if(s.range||s.selecting)clearRange();else pause();}
  else if(e.code==='Space'){e.preventDefault();if(!e.repeat)togglePlay()}
  else if(e.key==='Enter'){e.preventDefault();if(!e.repeat)void audition()}
  else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const d=e.key==='ArrowLeft'?-1:1;if(e.shiftKey&&!s.range){pause();const end=nextIndex(s.cursor,d,notes.length,null),a=s.anchor??s.cursor;setAnchor(a);setRange(normalizedRange(a,end,notes.length));setCursor(end);reveal(end,true)}else step(d)}
  else if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const first=s.range?notes[s.range.startIndex].row:0,last=s.range?notes[s.range.endIndex].row:doc.rows.length-1;const i=notes[s.cursor].row+(e.key==='ArrowUp'?-1:1);if(i<first||i>last)return;const index=Math.max(offsets[i],s.range?.startIndex??0);choose(index);locateOriginal(index);}
 };window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[doc]);
 useEffect(()=>{const leave=()=>pause();window.addEventListener('pagehide',leave);return()=>window.removeEventListener('pagehide',leave)},[]);

 const noteHit=target=>{const e=target?.closest?.('[data-global-index]');return e?{index:Number(e.dataset.globalIndex),edge:e.dataset.handle}:null;};
 function pointerDown(e){const hit=noteHit(e.target);if(!hit||e.button!==0)return;e.preventDefault();main.current.focus({preventScroll:true});pause();const s=latest.current;gesture.current={start:hit.index,last:hit.index,x:e.clientX,y:e.clientY,drag:false,edge:hit.edge,range:s.range,shift:e.shiftKey,anchor:s.anchor??s.cursor};}
 useEffect(()=>{const move=e=>{const g=gesture.current;if(!g)return;if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>5)g.drag=true;if(!g.drag)return;const sc=scroll.current,rect=sc.getBoundingClientRect();if(e.clientY<rect.top+35)sc.scrollTop-=18;if(e.clientY>rect.bottom-35)sc.scrollTop+=18;const hit=noteHit(document.elementFromPoint(e.clientX,e.clientY));if(!hit)return;g.last=hit.index;const a=g.edge&&g.range?(g.edge==='start'?g.range.endIndex:g.range.startIndex):g.start;setRange(normalizedRange(a,g.last,notes.length));setCursor(g.last);};
 const up=e=>{const g=gesture.current;if(!g)return;gesture.current=null;if(g.drag){setSelecting(false);setAnchor(null);setCursor(Math.min(g.edge&&g.range?(g.edge==='start'?g.range.endIndex:g.range.startIndex):g.start,g.last));return;}if(g.edge)return;const s=latest.current;if(s.selecting){if(s.anchor===null){setAnchor(g.start);setCursor(g.start)}else{setRange(normalizedRange(s.anchor,g.start,notes.length));setCursor(Math.min(s.anchor,g.start));setAnchor(null);setSelecting(false)}}else if(g.shift){setRange(normalizedRange(g.anchor,g.start,notes.length));setCursor(Math.min(g.anchor,g.start));setAnchor(null)}else{choose(g.start,{keepRange:false,revealScore:false});locateOriginal(g.start)}};
 const cancel=()=>{gesture.current=null};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel)}},[doc]);
 useEffect(()=>{const move=e=>{const g=pan.current,sc=sourceScroll.current;if(!g||!sc)return;sc.scrollLeft=g.left-(e.clientX-g.x);sc.scrollTop=g.top-(e.clientY-g.y)};const up=()=>{pan.current=null;sourceScroll.current?.classList.remove('panning')};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);const preventCaret=e=>{if(!e.target.closest('input:not([type=range]),textarea,[contenteditable=true]')){window.getSelection()?.removeAllRanges();if(!e.target.closest('button,a,input,select'))e.preventDefault()}};document.addEventListener('mousedown',preventCaret);return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);document.removeEventListener('mousedown',preventCaret)}},[]);
 const focusMain=()=>main.current?.focus({preventScroll:true});
 const changeNav=()=>{setNavClosed(v=>!v);setSearchOpen(false);setQuery('');focusMain()};
 const changeSource=()=>{if(sourceScroll.current){sourceScrollTop.current=sourceScroll.current.scrollTop;sourceScrollLeft.current=sourceScroll.current.scrollLeft;}if(sourceClosed)restoreSource.current=sourceScrollTop.current;setSourceClosed(v=>!v);focusMain()};
 // 展开搜索就聚焦并全选已有文字：接着输入即是新查询，想改一个字也能直接覆盖。
 useLayoutEffect(()=>{if(!searchOpen)return;const el=searchInput.current;if(!el)return;el.focus({preventScroll:true});el.select()},[searchOpen]);
 // 逆动画期间保持搜索框在场，动画结束再清状态、交回焦点，避免中途跳变。
 useEffect(()=>{if(searchOpen){clearTimeout(closeTimer.current);setClosing(false);return}if(!closing)return;closeTimer.current=setTimeout(()=>{setClosing(false);searchOpenRef.current?.focus({preventScroll:true})},260);return()=>clearTimeout(closeTimer.current)},[searchOpen,closing]);
 const openSearch=()=>{setQuery('');setSearchOpen(true)};
 // 叉号、Esc、选中歌曲都走这里：清空查询并触发反向动效（放大镜滑回右侧、搜索框收起）。
 const closeSearch=()=>{if(!searchOpen)return;setQuery('');setSearchOpen(false);setClosing(true)};
 const visibleSongs=useMemo(()=>library.songs.filter(s=>s.completed||s.images.length||s.deletedImages?.length),[library.songs]);
 const matchedSongs=useMemo(()=>filterSongs(visibleSongs,query),[visibleSongs,query]);
 const sourceTarget=()=>{if(!notes[latest.current.cursor])return null;const r=doc.rows[notes[latest.current.cursor].row],img=imgs.current[r.page];if(!img?.naturalWidth)return null;const c=cropRect(r.crop,img.naturalWidth,img.naturalHeight),b=img.getBoundingClientRect();return {rect:{top:b.top+b.height*c.y,bottom:b.top+b.height*(c.y+c.height),left:b.left+b.width*c.x,right:b.left+b.width*(c.x+c.width),height:b.height*c.height}}};
 const scoreTarget=()=>{const el=main.current?.querySelector(`.engraved-note[data-global-index="${latest.current.cursor}"] .note-digit`);return el?{rect:el.getBoundingClientRect(),clip:el.closest('.measure-scroll').getBoundingClientRect()}:null};
 const returnScore=()=>{reveal(latest.current.cursor,true);const el=main.current?.querySelector(`.engraved-note[data-global-index="${latest.current.cursor}"] .note-digit`),sc=el?.closest('.measure-scroll');if(sc){const r=el.getBoundingClientRect(),v=sc.getBoundingClientRect();if(r.left<v.left||r.right>v.right)sc.scrollLeft+=r.left-v.left-sc.clientWidth/2}};
 const returnSource=()=>{locateOriginal();const t=sourceTarget(),sc=sourceScroll.current;if(t&&sc){const v=sc.getBoundingClientRect();sc.scrollLeft+=(t.rect.left+t.rect.right)/2-(v.left+v.right)/2}};
 const returnViews=(side,both)=>{if(side==='source'||both)returnSource();if(side==='score'||both)returnScore()};
 const previousBase=useRef(baseTempo);
 useEffect(()=>{if(previousBase.current!==baseTempo){const rate=latest.current.tempo/previousBase.current;setTempo(baseTempo*normalizeRate(rate));previousBase.current=baseTempo}player.current.key='1='+(activeSong?.key??'E')+(activeSong?.octave??4)},[baseTempo,activeSong?.key,activeSong?.octave]);
 const openEditor=()=>{pause();if(!doc.rows.length){message('请先识别歌曲');return;}setEditing({id:activeId,song:activeSong,document:structuredClone(doc),cursor:{row:current.row,note:current.note}})};
 useEffect(()=>{if(!editing)return;const receive=async e=>{if(e.origin!==location.origin||e.source!==editFrame.current?.contentWindow)return;if(e.data?.type==='correction-ready')e.source.postMessage({type:'correction-init',...editing},location.origin);if(e.data?.type==='correction-save'){try{await library.saveDocument(editing.id,e.data.document);setEditing(null)}catch(error){e.source.postMessage({type:'correction-error',message:'保存失败：'+error.message},location.origin)}}};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[editing,library.saveDocument]);
 const openTask=(id,tab)=>{pause();setMenu(null);setTask({id,tab})};
 const openSettings=()=>{pause();setMenu(null);setSettingsOpen(true)};
 // 与播放前校验同源：能播的曲子才发得出去，提示文案也保持一致。
 const openHandoff=()=>{pause();if(doc.rows.some(r=>r.recognitionBlocked&&r.notes.length)){message('存在未确认的音符，请先修正乐谱');return}if(incompleteScore){message('部分图片尚无可训练乐谱，请先完成识别和校对');return}if(notes.some(n=>!(n.annotation?.durationTicks>0))){message('有音符缺少时值标注，请先在修正乐谱中补全');return}if(doc.music?.pendingArcs?.some(a=>a.number)){message('连音组范围待确认，请修正连接');return}setHandoffOpen(true)};
 useEffect(()=>{if(!menu)return;const close=e=>{if(!e.target.closest('.song-menu,.song-more'))setMenu(null)};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close)},[menu]);
 const taskSong=library.songs.find(s=>s.id===task?.id);
 const scopeLabel=range?`第 ${notes[range.startIndex]?.row+1} 行${notes[range.startIndex]?.row===notes[range.endIndex]?.row?'':` — ${notes[range.endIndex]?.row+1} 行`}`:'全曲';
 return <div className={'app '+(navClosed?'nav-closed ':'')+(sourceClosed?'source-closed ':'')+(!isSalon?'no-source':'')}>
  <a className="skip-link" href="#training">跳到训练谱面</a>
  <aside className="navigation" aria-label="歌曲导航">
   <div className="brand-row">{!navClosed&&<span className="brand">乐北斗</span>}<button className="icon-button collapse-nav" aria-label={navClosed?'展开歌曲导航':'收起歌曲导航'} aria-expanded={!navClosed} onClick={changeNav}><Chevrons reverse={navClosed}/></button></div>
   {!navClosed&&<><button className="import-song" disabled={!library.ready} onClick={()=>openTask(library.create(),'recognition')}>新建歌曲</button><div className={'song-header '+(searchOpen?'searching ':'')+(closing?'closing':'')}><p>歌曲列表</p><div className="song-search" role="search"><input ref={searchInput} aria-label="搜索歌曲" maxLength="40" autoComplete="off" tabIndex={searchOpen?0:-1} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSearch()}}}/><button className="icon-button search-open" ref={searchOpenRef} aria-label="搜索歌曲" title="搜索歌曲" aria-disabled={searchOpen} tabIndex={searchOpen?-1:0} onClick={searchOpen?undefined:openSearch}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg></button><button className="clear" type="button" aria-label="清除搜索" tabIndex={searchOpen?0:-1} onClick={closeSearch}>×</button></div></div>
    <nav className="song-list">{(searchOpen?matchedSongs:visibleSongs).map(song=><div className="song-entry" key={song.id}><button aria-current={activeId===song.id?'page':undefined} className={'song '+(activeId===song.id?'selected':'')} onClick={()=>{closeSearch();if(song.completed){pause();setActiveId(song.id);focusMain()}else openTask(song.id,song.stage)}}><span className="song-name">{song.title}</span>{!song.completed&&<span className="song-state">{library.jobs[song.id]?'识别中':song.images.some(i=>i.status==='failed')?'识别失败':'草稿'}</span>}</button>{<button className="song-more" aria-label={song.title+'更多操作'} aria-expanded={menu?.id===song.id} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setMenu(menu?.id===song.id?null:{id:song.id,x:r.right+5,y:r.top})}}><svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="8" cy="4" r="1.5"/><circle cx="8" cy="10" r="1.5"/><circle cx="8" cy="16" r="1.5"/></svg></button>}</div>)}{searchOpen&&!matchedSongs.length&&<p className="song-empty">没有匹配的歌曲</p>}</nav></>}
   <button className="settings icon-button" aria-label="设置" onClick={openSettings}><img src="/icons/settings.svg" width="25" height="25" alt=""/></button>
  </aside>
  {isSalon&&!sourceClosed&&<section className="original" aria-label="原始乐谱">
    <header className="source-header"><div><strong>原始简谱</strong><small>第 {Math.min(sourcePage+1,salonImages.length)} / {salonImages.length} 页</small></div><button className="icon-button" onClick={changeSource} aria-label="关闭原谱" title="关闭原谱" aria-expanded="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div className="source-controls"><div><button aria-label="缩小原谱" disabled={zoom<=100} onClick={()=>setZoom(z=>z-25)}>−</button><button onClick={()=>setZoom(100)} title="恢复原图缩放">{zoom}%</button><button aria-label="放大原谱" disabled={zoom>=250} onClick={()=>setZoom(z=>z+25)}>＋</button></div></div>
    <div className="pane-viewport source-viewport"><div className={"source-scroll "+(zoom>100?"zoomed":"")} ref={sourceScroll} onPointerDown={e=>{if(zoom<=100||e.button!==0||!e.target.closest(".image-surface"))return;e.preventDefault();pan.current={x:e.clientX,y:e.clientY,left:sourceScroll.current.scrollLeft,top:sourceScroll.current.scrollTop};sourceScroll.current.classList.add("panning")}} onScroll={()=>{const sc=sourceScroll.current;if(restoreSource.current===null)sourceScrollTop.current=sc.scrollTop;const y=sc.getBoundingClientRect().top+sc.clientHeight/2;let best=0,min=Infinity;imgs.current.forEach((img,i)=>{if(!img)return;const r=img.getBoundingClientRect(),d=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;if(d<min){min=d;best=i}});setSourcePage(best)}}>
    <div style={{width:zoom+'%'}} className="source-pages">{salonImages.map((image,page)=><figure key={image.id}><div className="image-surface"><img ref={el=>imgs.current[page]=el} src={image.src} alt={(activeSong?.title||'')+'原谱第'+(page+1)+'页'} draggable="false" onLoad={()=>setLoaded(v=>v+1)}/>{imgs.current[page]?.naturalWidth>0&&highlightedRows.filter(i=>doc.rows[i].page===page&&!(doc.rows[i].sourceMapping==='page'&&!doc.rows[i].crop)&&doc.rows[i].notes.length).map(i=><div key={i} data-row={i} className="source-highlight" style={(()=>{const c=cropRect(doc.rows[i].crop,imgs.current[page].naturalWidth,imgs.current[page].naturalHeight);return {...cropPolygonStyle(doc.rows[i].crop),top:c.y*100+'%',height:c.height*100+'%',left:c.x*100+'%',width:c.width*100+'%'}})()}/>)}<SourceRowTargets rows={doc.rows} page={page} image={imgs.current[page]} current={current.row} doubleClick={zoom>100} hidden={r=>!r.notes.length} onSelect={i=>{if(latest.current.range)reveal(offsets[i],true);else choose(offsets[i]);}}/></div><figcaption>{page+1} / {salonImages.length}</figcaption></figure>)}</div></div><ReturnToCurrent viewport={sourceScroll} getTarget={sourceTarget} onReturn={both=>returnViews('source',both)} label="原谱"/></div>
  </section>}
  {isSalon?<main id="training" className="training" ref={main} tabIndex={-1} aria-label="歌曲训练">
   <header className="training-header"><div className="song-heading"><h1>{activeSong.title}</h1><span>1={activeSong.key}</span><span>{doc.meter.beats}/{doc.meter.beatUnit}</span><button className="text-button handoff-open" onClick={openHandoff}>发送到手机</button></div><div className="header-actions"><button className="text-button" disabled={!sourceClosed} onClick={()=>{if(sourceClosed)changeSource()}} aria-expanded={!sourceClosed}>{sourceClosed?'查看原谱':'原谱已展开'}</button><span className="separator"/><button className="text-button" onClick={openEditor}>修正乐谱</button></div></header>
   <div className="pane-viewport training-viewport"><div className={'score-scroll '+(selecting?'selecting':'')} ref={scroll} onPointerDown={pointerDown} onWheel={()=>setFollow(false)} onTouchMove={()=>setFollow(false)}>
    {visibleRows.map(([r,i])=><section className={'score-row '+(current.row===i?'current-row':'')} data-row={i} key={r.id} ref={el=>rows.current[i]=el} aria-label={'第'+(r.page+1)+'页第'+(r.line+1)+'行谱面'}>
     <div className="row-location">{r.seamNeedsReview&&<span>跨页连接待检查</span>}<span>第 {r.page+1} 页 · 第 {r.line+1} 行</span>{range&&range.startIndex>=offsets[i]&&range.startIndex<offsets[i]+r.notes.length&&<span className="range-caption">练习片段</span>}</div>
     <CropPreview src={r.src} page={r.page} line={r.line} band={r.crop}/>
     <EngravedRow document={doc} rowIndex={i} row={r} offset={offsets[i]} allMeasures={allMeasures} active={current.row===i?current.note:-1} previousTie={i>0&&Boolean(doc.rows[i-1].notes.at(-1)?.annotation.tieToNext)} nextExists={i<doc.rows.length-1} fontSize={size} beamGroups={beams} range={range}/>
    </section>)}
    <div className="score-end">{incompleteScore?'部分图片尚无可训练乐谱，暂不能自动演奏':emptyRows?`有 ${emptyRows} 行没有识别到音符，已忽略（可在“修正乐谱”中处理）`:'全曲结束'}</div>
   </div>
   <ReturnToCurrent viewport={scroll} getTarget={scoreTarget} onReturn={both=>returnViews('score',both)} label="训练谱"/></div>
   <div className="playback-dock">
    <div className="dock-status"><div>{selecting?<span className="selection-instruction">{anchor===null?'点选起音，再点选止音':'请选择片段的止音'}</span>:<><span className={'scope '+(range?'looping':'')}><span aria-hidden="true">{range?'↻':'♫'}</span>{range?'片段循环':'全曲演奏'}</span><small>{range?scopeLabel:status==='ended'?'已播放完毕':status==='waiting'?'稍后重复':''}</small></>}{range&&!selecting&&<button className="text-button" onClick={clearRange}>取消选段</button>}</div><div><button className={'select-button '+(selecting?'pressed':'')} aria-pressed={selecting} onClick={startSelection}>{selecting?'取消':'选段'}</button></div></div>
    <div className="transport"><div className="step-controls"><button aria-label="上一音" title="上一音（←）" onClick={()=>step(-1)} disabled={!range&&cursor===0&&hasPlayed}>‹</button><button className="audition-button" onClick={()=>audition()} title="试听当前音（Enter）">试听当前音</button><button aria-label="下一音" title="下一音（→）" onClick={()=>step(1)} disabled={!range&&cursor===notes.length-1&&hasPlayed}>›</button></div><button className="play-button" onClick={togglePlay} aria-label={active?'暂停':'播放'}><span aria-hidden="true">{active?'Ⅱ':'▶'}</span>{status==='loading'?'准备中':active?'暂停':'播放'}</button><button className="restart-button" title="从当前练习范围的开头播放" onClick={()=>play(range?.startIndex??0)}>从头播放</button><SpeedControl rate={tempo/baseTempo} baseTempo={baseTempo} onChange={commitRate}/></div>
   </div>
   {notice&&<div className="toast" role="status">{notice}</div>}
  </main>:<main className="training"><header className="training-header"><div className="song-heading"><h1>{activeSong?.title||'乐北斗'}</h1></div></header><div className="imported-empty"><h2>{activeSong?.id==='salon'?'当前没有可训练音符':activeSong?'图片已准备好':'选择歌曲，开始练习'}</h2><p>{activeSong?'尚无完整音符数据，请完成图片识别。':'从左侧选择歌曲，或新建歌曲导入乐谱图片。'}</p>{activeSong&&<button onClick={()=>openTask(activeSong.id,'recognition')}>管理歌曲</button>}</div></main>}
 {menu&&<div className="song-menu" style={{left:Math.min(menu.x,window.innerWidth-155),top:menu.y}}>{library.songs.find(s=>s.id===menu.id)?.completed&&<><button onClick={()=>openTask(menu.id,'recognition')}>编辑图片</button><button onClick={()=>openTask(menu.id,'properties')}>修改歌曲属性</button></>}<button className="quiet-danger" onClick={()=>{setDeleting(menu.id);setMenu(null)}}>删除歌曲</button></div>}
 {taskSong&&<SongPanel key={taskSong.id} song={taskSong} library={library} initialTab={task.tab} onClose={()=>setTask(null)} onSettings={openSettings} onComplete={id=>{setActiveId(id);setTask(null)}}/>}
 {editing&&<div className="correction-overlay"><iframe ref={editFrame} title="歌曲编辑" src="/correction.html"/></div>}
 {settingsOpen&&<SettingsPanel settings={library.settings} onSave={library.setSettings} onClose={()=>setSettingsOpen(false)}/>}
 {handoffOpen&&<HandoffPanel song={activeSong} document={doc} baseTempo={baseTempo} onClose={()=>setHandoffOpen(false)}/>}
 {deleting&&<Confirm title="删除歌曲？" description={library.songs.find(s=>s.id===deleting)?.completed?"该歌曲的图片、识别进度和属性将从本机移除。":"该草稿的图片、识别进度和属性将从本机删除；正在进行的识别也会终止。"} onClose={()=>setDeleting(null)} onConfirm={()=>{pause();library.remove(deleting);if(activeId===deleting)setActiveId(null);setDeleting(null)}}/>}
 </div>;
}
