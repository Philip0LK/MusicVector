import {boot,readResource,writeResource} from './localApi.js';
import {useEffect,useRef,useState} from 'react';
import {upgradeLegacyCrops} from './cropGeometry.js';
import {needsCropUpgrade,refreshAutomaticCrops} from './cropUpgrade.js';
import {validBackups,snapshotImage,RECOVERY_TTL,documentFromImages} from './recovery.js';
import {normalizeMusicDocument} from './lib/musicStructure.js';
import {headerSuggestions} from './recognitionModel.js';
import {describeAiError} from './aiProviders.js';
import {defaultAiSettings,normalizeAiSettings} from './aiProviders.js';
import {salonSeedSong} from './salonSeed.js';
export const defaultSettings={...defaultAiSettings(),recognitionMode:'live'};
// 业务库的安全阀：不论调用方传了什么，凭据字段都不允许写进 yuebeidou-training-library。
const SECRET_FIELDS=['apiKey','api_key','apikey','authorization','encryptedApiKey','CryptoKey','iv'];
function stripSecrets(payload){
 if(!payload?.settings)return payload;
 const settings={...payload.settings};
 for(const field of SECRET_FIELDS)delete settings[field];
 return {...payload,settings};
}
export const makeSong=()=>({id:crypto.randomUUID(),title:'新歌曲',key:'C',octave:4,bpm:80,completed:false,stage:'recognition',images:[]});
// 种子歌曲定义在 salonSeed.js：那份数据不依赖 React/IndexedDB/AI，Node 端导出与测试可直接引用。
export {seedSong,salonSeedSong} from './salonSeed.js';
export function recognitionTargets(song,selected=[]){return selected.length?song.images.filter(i=>selected.includes(i.id)).map(i=>i.id):song.images.filter(i=>i.status!=='done').map(i=>i.id)}
// 歌曲搜索：一次搜索里的多个关键词用空白分隔，必须全部命中歌名（顺序无关、大小写不敏感）。
// 只按歌名匹配——歌曲对象目前只有 title 一个文本字段。保持原列表顺序，不按相关度重排。
export function filterSongs(songs,query){
 const list=Array.isArray(songs)?songs:[];
 const terms=String(query??'').toLowerCase().split(/\s+/).filter(Boolean);
 if(!terms.length)return list;
 return list.filter(song=>{const title=typeof song?.title==='string'?song.title.toLowerCase():'';return title?terms.every(term=>title.includes(term)):false});
}
export function normalizeSaved(songs){return songs.filter(s=>s.completed||s.images.length||validBackups(s.deletedImages).length).map(s=>({...s,deletedImages:validBackups(s.deletedImages),images:s.images.map(i=>({...i,status:i.status==='processing'?'failed':i.status,...(i.status==='processing'?{error:'识别已中断，请手动重新识别',jobToken:null}:{})}))}))}
async function readLibrary(){return boot.library||readResource('/api/library')}
async function writeLibrary(value){return writeResource('/api/library',stripSecrets(value))}
function normalizeDocumentForSong(song, images) {
  const base = documentFromImages(
    {
      ...song,
      meter: song.meter || { beats: 4, beatUnit: 4 },
      pickup: Boolean(song.pickup),
      music: song.music,
    },
    images,
  );
  return normalizeMusicDocument(base, {
    key: song.key,
    octave: song.octave,
    bpm: song.bpm,
    assignStableIds: true,
  });
}

function rowsForImages(rows, images, { origin, renumberOriginalRow = false } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return images.map((image, page) => {
    const selected = sourceRows
      .map((row, index) => ({
        ...row,
        ...(origin ? { origin } : {}),
        ...(renumberOriginalRow ? { originalRow: index } : {}),
      }))
      .filter((row) => row.imageId === image.id || (!row.imageId && row.page === page))
      .map((row) => ({
        ...row,
        notes: (row.notes || []).map((note) => ({
          ...note,
          annotation: {
            ...(note.annotation || {}),
            originalTie: note.annotation?.originalTie ?? note.annotation?.tieToNext,
          },
        })),
      }));
    const result = image.result || selected.length
      ? { ...(image.result || {}), rows: selected }
      : undefined;
    return {
      ...image,
      ...(result ? { result } : {}),
      status: image.status,
    };
  });
}

function compactImages(images) {
  return images.map(({ recoveryExpiresAt, ...image }) => image);
}

export function useLibrary(document){
 const [songs,setSongs]=useState(()=>normalizeSaved(boot.library?.songs||[])),[settings,setSettings]=useState(defaultSettings),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(''),[jobs,setJobs]=useState({});
 const firstSave=useRef(true),importedLegacy=useRef(false),latest=useRef(songs),timers=useRef(new Map()),controllers=useRef(new Map()),settingsRef=useRef(settings),saveQueue=useRef(Promise.resolve());latest.current=songs;settingsRef.current=settings;
 useEffect(()=>{let live=true;readLibrary().then(v=>{if(!live)return;setSongs(normalizeSaved(v.songs||[]));setSettings({...defaultSettings,...normalizeAiSettings(v.settings)});setReady(true)}).catch(e=>{if(live)setStorageError('本地曲库读取失败：'+e.message)});return()=>{live=false;for(const job of controllers.current.values())job.controller.abort()}},[]);
 useEffect(()=>{if(!ready)return;if(firstSave.current){firstSave.current=false;return}saveQueue.current=saveQueue.current.catch(()=>{}).then(()=>writeLibrary({songs:latest.current.filter(s=>s.completed||s.images.length||validBackups(s.deletedImages).length),settings})).then(()=>setStorageError('')).catch(e=>setStorageError('未保存：'+e.message))},[songs,settings,ready]);

 // Once per load, refresh only old image-algorithm crops. Re-read live identity
 // before applying each result so recognition, deletion or manual edits always win.
 useEffect(()=>{
  if(!ready)return;
  const controller=new AbortController();
  (async()=>{
   for(const song of latest.current){for(const image of song.images){
    if(controller.signal.aborted)return;
    if(!needsCropUpgrade(image,song))continue;
    try{
     const updated=await refreshAutomaticCrops(image,{signal:controller.signal});
     if(controller.signal.aborted)return;
     if(updated===image)continue;
     const current=latest.current.find(s=>s.id===song.id)?.images.find(i=>i.id===image.id);
     if(current?.result!==image.result||current.src!==image.src||current.status!=='done')continue;
     const next=latest.current.map(s=>s.id===song.id?{...s,images:s.images.map(i=>i.id===image.id?{...i,result:updated.result}:i)}:s);
     latest.current=next;setSongs(next);
    }catch{ /* Keep existing geometry if the local slicer is unavailable. */ }
   }}
  })();
  return()=>controller.abort();
 },[ready]);
 const update=(id,fn)=>{const all=latest.current.map(s=>s.id===id?(typeof fn==='function'?fn(s):{...s,...fn}):s);latest.current=all;setSongs(all)};
 const commitImages=async(id,images,patch={})=>{
   const current=latest.current.find(s=>s.id===id);if(!current)throw Error('歌曲不存在');
   const deleted=current.images.filter(i=>!images.some(n=>n.id===i.id));
   const snapshots=await Promise.all(deleted.map(snapshotImage));
   const operation=saveQueue.current.catch(()=>{}).then(async()=>{
    const now=Date.now(),song=latest.current.find(s=>s.id===id);if(!song)throw Error('歌曲不存在');
    const backups=validBackups(song.deletedImages,now).filter(b=>!images.some(i=>i.id===b.image.id));
    const entries=snapshots.map(image=>({id:crypto.randomUUID(),image,position:current.images.findIndex(i=>i.id===image.id),deletedAt:now,expiresAt:now+RECOVERY_TTL}));
    for(const image of images){if(image.recoveryExpiresAt&&image.recoveryExpiresAt<=now)throw Error('恢复副本已到期，请重新上传识别');}
    const mergedImages=images.map(image=>song.images.find(i=>i.id===image.id)||image);
    const normalized=normalizeDocumentForSong(song,mergedImages);
    const stored=rowsForImages(normalized.rows,mergedImages,{origin:id});
    const nextSong={...song,...patch,meter:patch.meter||song.meter||normalized.meter,pickup:patch.pickup??song.pickup??normalized.pickup,images:compactImages(stored),deletedImages:[...backups,...entries],music:normalized.music};
    const all=latest.current.map(s=>s.id===id?nextSong:s);
    await writeLibrary({songs:all,settings,importedLegacy:importedLegacy.current});
    const fresh=latest.current.find(s=>s.id===id);if(!fresh)return [];
    const committed={...fresh,...nextSong,images:nextSong.images.map(i=>fresh.images.find(n=>n.id===i.id)||i)};
    const applied=latest.current.map(s=>s.id===id?committed:s);latest.current=applied;setSongs(applied);return entries;
   });saveQueue.current=operation;return operation;
  };

 useEffect(()=>{if(!ready)return;const prune=()=>{const all=latest.current; if(all.some(s=>(s.deletedImages||[]).some(b=>b.expiresAt<=Date.now()))){const next=all.map(s=>({...s,deletedImages:validBackups(s.deletedImages)}));latest.current=next;setSongs(next)}};prune();const timer=setInterval(prune,30000);return()=>clearInterval(timer)},[ready]);
 const saveDocument=async(id,doc)=>{const operation=saveQueue.current.catch(()=>{}).then(async()=>{const song=latest.current.find(s=>s.id===id);if(!song)throw Error('歌曲已不存在');const normalized=normalizeMusicDocument(doc,{key:song.key,octave:song.octave,bpm:song.bpm,assignStableIds:true});const rows=Array.isArray(normalized.rows)?normalized.rows:[];const images=song.images.map((image,page)=>({...image,result:{...(image.result||{}),rows:rows.map((r,index)=>({...r,originalRow:index,origin:id,recognitionBlocked:r.notes.some(n=>!Number.isInteger(n.degree)||!Number.isInteger(n.octave)),reviewStatus:'manually-saved'})).filter(r=>r.imageId===image.id||(!r.imageId&&r.page===page)).map(r=>({...r,notes:r.notes.map(n=>({...n,annotation:{...(n.annotation||{}),originalTie:n.annotation?.originalTie??n.annotation?.tieToNext}}))}))},status:image.status}));const all=latest.current.map(s=>s.id===id?{...s,images,meter:normalized.meter??doc.meter,pickup:normalized.pickup??doc.pickup,music:normalized.music}:s);await writeLibrary({songs:all,settings,importedLegacy:importedLegacy.current});latest.current=all;setSongs(all)});saveQueue.current=operation;return operation};
 const stop=id=>{controllers.current.get(id)?.controller.abort();controllers.current.delete(id);clearTimeout(timers.current.get(id));timers.current.delete(id);setJobs(j=>{const n={...j};delete n[id];return n});update(id,s=>({...s,images:s.images.map(i=>i.status==='processing'?{...i,status:'failed',error:'识别已终止',jobToken:null}:i)}))};
 const remove=id=>{stop(id);latest.current=latest.current.filter(s=>s.id!==id);setSongs(latest.current)};
 // Recognition writes become visible only after the complete local-file transaction.
 const persistRecognition=(id,transform,valid=()=>true)=>{
  const operation=saveQueue.current.catch(()=>{}).then(async()=>{
   while(valid()){
    const before=latest.current;if(!before.some(s=>s.id===id))return false;
    const all=before.map(s=>s.id===id?transform(s):s);
    await writeLibrary({songs:all,settings:settingsRef.current,importedLegacy:importedLegacy.current});
    if(!valid())return false;
    if(latest.current!==before)continue;
    latest.current=all;setSongs(all);return true;
   }return false;
  });saveQueue.current=operation;return operation;
 };
 const recognize=async(id,selected=[])=>{
  if(controllers.current.has(id)||timers.current.has(id))return;
  const initial=latest.current.find(s=>s.id===id);if(!initial)return;
  const ids=recognitionTargets(initial,selected);if(!ids.length)return;
  const controller=new AbortController(),runId=crypto.randomUUID(),config={...settings};
  const job={controller,runId};controllers.current.set(id,job);
  const active=()=>controllers.current.get(id)===job&&!controller.signal.aborted;
  try{
   const {recognizeImage}=await import('./recognition.js');
   for(let index=0;index<ids.length&&active();index++){
    const imageId=ids[index],image=latest.current.find(s=>s.id===id)?.images.find(i=>i.id===imageId);if(!image)continue;
    const token=runId+':'+imageId,valid=()=>active()&&latest.current.find(s=>s.id===id)?.images.some(i=>i.id===imageId&&i.jobToken===token);
    setJobs(j=>({...j,[id]:{current:index+1,total:ids.length,phase:'准备识别'}}));
    await persistRecognition(id,s=>({...s,error:'',images:s.images.map(i=>i.id===imageId?{...i,status:'processing',error:'',simulated:false,jobToken:token,recognitionTask:{runId,model:config.model,provider:config.provider,startedAt:Date.now()}}:i)}),active);
    try{
     const result=await recognizeImage({image,songId:id,songTitle:initial.title,page:initial.images.findIndex(i=>i.id===imageId),firstImage:initial.images[0]?.id===imageId,settings:config,runId,signal:controller.signal,
      onProgress:phase=>{if(valid())setJobs(j=>({...j,[id]:{current:index+1,total:ids.length,phase}}));},
      onPartial:partial=>persistRecognition(id,s=>({...s,images:s.images.map(i=>i.id===imageId?{...i,recognitionTask:{...i.recognitionTask,partial}}:i)}),valid)});
     if(!valid())continue;
     await persistRecognition(id,s=>{
      const suggestions=headerSuggestions(result.header),attributes={};
      if(!s.completed)for(const [key,value] of Object.entries(suggestions))if(!s.userAttributes?.includes(key))attributes[key]=value;
      const images=s.images.map(i=>i.id===imageId?{...i,status:'done',error:'',simulated:false,result,recognitionTask:{...i.recognitionTask,finishedAt:Date.now()}}:i);
      // Rebuild relationships after replacement; never retain references to discarded note IDs.
      const noteIds=new Set(images.flatMap(i=>(i.result?.rows||[]).flatMap(r=>r.notes.map(n=>n.id))));
      const retained=(s.music?.arcs||[]).filter(a=>noteIds.has(a.fromNoteId)&&noteIds.has(a.toNoteId));
      const arcs=[...retained,...result.rows.flatMap(r=>r.recognitionArcs||[])];
      const pendingArcs=[...(s.music?.pendingArcs||[]).filter(a=>noteIds.has(a.fromNoteId)||noteIds.has(a.toNoteId)),...result.rows.flatMap(r=>r.recognitionPendingArcs||[])];
      const meterChanges=[...(s.music?.meterChanges||[]).filter(c=>noteIds.has(c.noteId)),...result.rows.flatMap(r=>r.recognitionMeterChanges||[])];
      return {...s,...attributes,error:'',images,headerCandidate:result.header||s.headerCandidate,music:{...s.music,measures:[],pitchContexts:[],arcs,pendingArcs,meterChanges,pitchSemantics:'measured'}};
     },valid);
    }catch(error){
     if(!valid())continue;const message=describeAiError(error);
     await persistRecognition(id,s=>({...s,error:message,images:s.images.map(i=>i.id===imageId?{...i,status:'failed',error:message}:i)}),valid);
    }
   }
  }catch(error){if(active()){setStorageError('识别结果保存失败：'+describeAiError(error));update(id,s=>({...s,error:describeAiError(error),images:s.images.map(i=>i.jobToken?.startsWith(runId)&&i.status==='processing'?{...i,status:'failed',error:'识别或保存失败'}:i)}));}}
  finally{if(controllers.current.get(id)===job){controllers.current.delete(id);setJobs(j=>{const next={...j};delete next[id];return next;});}}
 };
 return {songs,settings,setSettings,ready,storageError,jobs,update,saveDocument,commitImages,remove,recognize,stop,create:()=>{const song=makeSong();latest.current=[...latest.current,song];setSongs(latest.current);return song.id}};
}
