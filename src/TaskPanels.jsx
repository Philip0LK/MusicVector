import React,{useEffect,useRef,useState} from 'react';
import {matchingBackups,restoreBackup} from './recovery.js';
import {recognitionTargets} from './library.js';
import {PROVIDERS,providerById,defaultAiSettings,verifyConnection,describeAiError} from './aiProviders.js';
import {CredentialService} from './credentials/service.js';
import './panels.css';
export const CloseIcon=()=> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>;
export function Modal({title,onClose,onDismiss=onClose,children,className=''}){
 const ref=useRef(),pressed=useRef(null),esc=useRef(0);useEffect(()=>{const el=ref.current;el.showModal();const before=document.activeElement;return()=>{el.close();before?.focus?.()}},[]);
 useEffect(()=>{const key=e=>{if(e.key==='Escape')esc.current=performance.now()};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[]);
 // 只有"按下就在面板外、随即松开"才算点击面板外：系统文件选择框、拖放等产生的不成对 click 不会收起面板。
 const outside=(el,e)=>e.clientX<el.getBoundingClientRect().left||e.clientX>el.getBoundingClientRect().right||e.clientY<el.getBoundingClientRect().top||e.clientY>el.getBoundingClientRect().bottom;
 // Esc 只认页面上真实按下的 Esc：系统文件选择框关闭时浏览器会向最上层 dialog 补发 cancel（无按键），不算用户收起面板。
 const cancel=e=>{e.preventDefault();if(performance.now()-esc.current<1000)onDismiss()};
 const backdrop=e=>{const at=pressed.current;pressed.current=null;if(at&&performance.now()-at<1000&&e.target===e.currentTarget&&outside(e.currentTarget,e))onDismiss()};
 return <dialog ref={ref} className={'task-dialog '+className} aria-label={title} onCancel={cancel} onPointerDown={e=>{pressed.current=e.target===e.currentTarget&&outside(e.currentTarget,e)?performance.now():null}} onClick={backdrop}><header className="task-title"><h2>{title}</h2><button className="icon-button" title="收起面板" aria-label={'关闭'+title} onClick={onClose}><CloseIcon/></button></header>{children}</dialog>;
}
export function Confirm({title,description,onConfirm,onClose,label='确认删除'}){return <Modal title={title} onClose={onClose} className="confirm-dialog"><div className="confirm-content">{description}</div><footer className="task-footer"><button className="secondary" onClick={onClose}>返回</button><button className="danger-button" onClick={onConfirm}>{label}</button></footer></Modal>}
export function SettingsPanel({settings,onSave,onClose}){
 // 明文密钥不进 state、不进 props：只在 ref 指向的输入框与一次函数调用里存在。
 const [draft,setDraft]=useState(()=>({...defaultAiSettings(),...settings})),[error,setError]=useState(''),[test,setTest]=useState(null),[credential,setCredential]=useState(null),[editing,setEditing]=useState(true),[busy,setBusy]=useState(''),[confirming,setConfirming]=useState(false);
 const keyRef=useRef(),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
 const provider=providerById(draft.provider),endpoint=draft.endpoint.trim()||provider.endpoint;
 // 不同接口地址视为不同凭据：换服务商或换地址只重新查一次，绝不自动沿用旧地址的密钥。
 useEffect(()=>{let stale=false;setTest(null);setBusy('');
  CredentialService.describeCredential(draft.provider,endpoint).then(result=>{if(stale||!live.current)return;setCredential(result);setEditing(!result);if(keyRef.current)keyRef.current.value=''}).catch(()=>{if(!stale&&live.current)setCredential(null)});
  return()=>{stale=true};
 },[draft.provider,endpoint]);
 const field=(name,value)=>{setDraft(d=>({...d,[name]:value}));setError('')};
 const pickProvider=id=>{const next=providerById(id);setDraft(d=>({...d,provider:next.id,endpoint:next.endpoint,model:next.models[0]}));setError('')};
 const targets=()=>{
  if(!/^https?:\/\//.test(endpoint)){setTest({state:'fail',text:'接口地址需以 http:// 或 https:// 开头'});return null}
  if(!draft.model.trim()){setTest({state:'fail',text:'请填写模型名称'});return null}
  return {model:draft.model.trim()};
 };
 // 保存流程：验证通过才加密落库，落库后立刻把明文从输入框清掉。
 const submitKey=async()=>{
  const apiKey=(keyRef.current?.value||'').trim();
  if(!apiKey){setTest({state:'fail',text:'请先填写 API 密钥'});return}
  const options=targets();if(!options)return;
  setBusy('checking');setTest({state:'running',text:'正在验证 '+provider.label+'…'});
  try{
   const {reply,latencyMs}=await verifyConnection({provider:draft.provider,endpoint,model:options.model,apiKey});
   const saved=await CredentialService.saveCredential({provider:draft.provider,baseURL:endpoint,apiKey});
   if(keyRef.current)keyRef.current.value='';
   if(!live.current)return;
   setCredential(saved);setEditing(false);
   setTest({state:'ok',text:'验证通过并已保存 · '+(latencyMs/1000).toFixed(1)+' 秒 · 模型回复：'+(reply||'（空回复）')});
  }catch(exception){if(live.current)setTest({state:'fail',text:'未保存：'+describeAiError(exception)})}
  finally{if(live.current)setBusy('')}
 };
 const reverify=async()=>{
  const options=targets();if(!options)return;
  setBusy('checking');setTest({state:'running',text:'正在重新验证 '+provider.label+'…'});
  try{
   const stored=await CredentialService.getCredential(draft.provider,endpoint);
   if(!stored)throw Error('该地址没有已保存的密钥');
   const {reply,latencyMs}=await verifyConnection({provider:draft.provider,endpoint,model:options.model,apiKey:stored.apiKey});
   const updated=await CredentialService.markVerified(draft.provider,endpoint);
   if(!live.current)return;
   setCredential(updated);
   setTest({state:'ok',text:'连接成功 · '+(latencyMs/1000).toFixed(1)+' 秒 · 模型回复：'+(reply||'（空回复）')});
  }catch(exception){
   if(CredentialService.isAuthError(exception))await CredentialService.markAuthError(draft.provider,endpoint).catch(()=>{});
   const latest=await CredentialService.describeCredential(draft.provider,endpoint).catch(()=>null);
   if(live.current){setCredential(latest);setTest({state:'fail',text:'连接失败：'+describeAiError(exception)})}
  }finally{if(live.current)setBusy('')}
 };
 const clearCredential=async()=>{
  setConfirming(false);setBusy('clearing');
  try{
   await CredentialService.deleteCredential(draft.provider,endpoint);
   if(keyRef.current)keyRef.current.value='';
   if(live.current){setCredential(null);setEditing(true);setTest({state:'ok',text:'已清除该地址保存的密钥，歌曲与草稿不受影响'})}
  }catch(exception){if(live.current)setTest({state:'fail',text:'清除失败：'+describeAiError(exception)})}
  finally{if(live.current)setBusy('')}
 };
 const save=e=>{
  e.preventDefault();const model=draft.model.trim();
  if(!/^https?:\/\//.test(endpoint)){setError('请输入有效的 http 或 https 接口地址');return}
  if(!model){setError('请填写模型名称');return}
  onSave({...draft,provider:provider.id,endpoint,model});onClose();
 };
 const busyNow=busy!=='';
 return <Modal title="设置" onClose={onClose} className="settings-dialog"><form onSubmit={save}><div className="settings-content">
  <h3>AI 识别接口</h3><p className="muted">识别使用当前保存的接口和模型。</p>
  <label>服务商<select aria-label="服务商" disabled={busyNow} value={provider.id} onChange={e=>pickProvider(e.target.value)}>{PROVIDERS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
  <label>接口地址<input aria-label="接口地址" disabled={busyNow} type="url" value={draft.endpoint} onChange={e=>field('endpoint',e.target.value)}/></label>
  <label>模型名称<input aria-label="模型名称" disabled={busyNow} list="ai-model-options" placeholder="填写模型名称" value={draft.model} onChange={e=>field('model',e.target.value)}/><datalist id="ai-model-options">{provider.models.map(m=><option key={m} value={m}/>)}</datalist><small>{provider.label} 最新模型</small></label>
  <div className="credential-block"><span className="credential-label">API 密钥</span>
   {editing?<><input aria-label="API 密钥" disabled={busyNow} ref={keyRef} type="password" autoComplete="off" name="yuebeidou-credential" placeholder="填写 API Key"/><small>{credential?'输入新密钥以替换已保存的':'该地址尚未保存密钥，验证通过后自动保存'}</small></>
   :<div className={'credential-card '+(credential.status==='invalid'?'invalid':'')}><strong>{credential.masked}</strong><small className={'credential-status '+credential.status}>{(credential.status==='invalid'?'认证失败':'已验证')+' · 最后验证 '+new Date(credential.lastVerifiedAt).toLocaleString('zh-CN',{hour12:false})}</small></div>}
   <div className="credential-actions">{editing
    ?<><button className="secondary" type="button" disabled={busyNow} onClick={submitKey}>{busy==='checking'?'正在验证…':'验证并保存'}</button>{credential&&<button className="text-button" type="button" disabled={busyNow} onClick={()=>{setEditing(false);setTest(null)}}>取消修改</button>}</>
    :<><button className="secondary" type="button" disabled={busyNow} onClick={()=>{setEditing(true);setTest(null)}}>修改</button><button className="text-button quiet-danger" type="button" disabled={busyNow} onClick={()=>setConfirming(true)}>清除</button><button className="text-button credential-reverify" type="button" disabled={busyNow} onClick={reverify}>重新验证</button></>}
   </div>
  </div>
  {test&&<p role="status" className={'verify-status '+test.state}>{test.text}</p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
 </div><footer className="task-footer"><button className="secondary" type="button" onClick={onClose}>取消</button><button className="primary" type="submit">保存设置</button></footer></form>
 {confirming&&<Confirm title="清除 API 密钥？" description="将从本机删除该地址保存的密钥。歌曲、草稿和校对结果都不受影响。" label="确认清除" onClose={()=>setConfirming(false)} onConfirm={()=>void clearCredential()}/>}</Modal>;
}
function readImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('图片读取失败'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('图片损坏或格式无法读取'));img.onload=()=>resolve({id:crypto.randomUUID(),name:file.name,src:reader.result,status:'pending',simulated:false});img.src=reader.result};reader.readAsDataURL(file)})}
const statusText={pending:'等待识别',processing:'识别中',done:'已识别',failed:'识别出错'};
function ImageStatus({status}){return <svg className={status==='processing'?'status-spinner':''} width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{status==='done'?<path d="m4 10 4 5 8-11"/>:status==='processing'?<><circle cx="10" cy="10" r="7.5" opacity=".3"/><path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5"/></>:status==='pending'?<><circle cx="10" cy="10" r="7.5"/><path d="M10 5v5l4 2"/></>:<path d="m5 5 10 10M15 5 5 15"/>}</svg>}
export function SongPanel({song:persistedSong,library,onClose,onSettings,onComplete,initialTab}){
 const [draftImages,setDraftImages]=useState(null),[removeImage,setRemoveImage]=useState(null),[unsaved,setUnsaved]=useState(false),[saving,setSaving]=useState(false),[undo,setUndo]=useState(null),[recovery,setRecovery]=useState(null),[recoveryId,setRecoveryId]=useState('');
 const recoveryResolve=useRef(),undoTimer=useRef();
 const song={...persistedSong,images:draftImages===null?persistedSong.images:draftImages.map(i=>persistedSong.images.find(n=>n.id===i.id)||i)};
 const dirty=draftImages!==null;
 useEffect(()=>()=>{clearTimeout(undoTimer.current);recoveryResolve.current?.(null)},[]);
 const changeImages=async images=>{if(song.completed){setDraftImages(images);return []}return library.commitImages(song.id,images)};
 const applyStructure=async()=>{if(!dirty)return;setSaving(true);try{const entries=await library.commitImages(song.id,song.images);setDraftImages(null);if(entries.length){const entry=entries.at(-1);setUndo({image:entry.image,position:entry.position,entry});clearTimeout(undoTimer.current);undoTimer.current=setTimeout(()=>setUndo(null),8000);}return true}catch(e){setError('保存失败，图片尚未删除：'+e.message);return false}finally{setSaving(false)}};
 const removePage=async image=>{setRemoveImage(null);setSaving(true);try{const position=song.images.findIndex(i=>i.id===image.id);const entries=await changeImages(song.images.filter(i=>i.id!==image.id));setSelected(s=>s.filter(id=>id!==image.id));setUndo({image,position,entry:entries?.[0]});clearTimeout(undoTimer.current);undoTimer.current=setTimeout(()=>setUndo(null),8000)}catch(e){setError('未能保留恢复副本，图片未删除：'+e.message)}finally{setSaving(false)}};
 const undoRemove=async()=>{if(!undo)return;setSaving(true);try{const image=undo.entry?restoreBackup(undo.entry):undo.image;const images=[...song.images];images.splice(Math.min(undo.position,images.length),0,image);await changeImages(images);setUndo(null)}catch(e){setError(e.message)}finally{setSaving(false)}};
 const [tab,setTab]=useState(initialTab||song.stage),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState([]),[preview,setPreview]=useState(null),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[uploading,setUploading]=useState(false),[drag,setDrag]=useState(null),[over,setOver]=useState(false),[attrs,setAttrs]=useState({title:song.title,key:song.key,octave:song.octave,bpm:song.bpm});
 useEffect(()=>{setAttrs({title:song.title,key:song.key,octave:song.octave,bpm:song.bpm})},[song.title,song.key,song.octave,song.bpm]);
 const attribute=(field,value)=>{setAttrs(a=>({...a,[field]:value}));library.update(song.id,s=>({...s,userAttributes:[...new Set([...(s.userAttributes||[]),field])]}));};
 const picker=useRef(),dragEnded=useRef(0),live=useRef(true);useEffect(()=>()=>{live.current=false},[]);
 const busy=!!library.jobs[song.id],allDone=song.images.length>0&&song.images.every(i=>i.status==='done'),canProperties=song.completed||song.propertiesUnlocked||song.stage==='properties';
 const changeTab=t=>{setTab(t);if(!song.completed)library.update(song.id,{stage:t})};
 const add=async files=>{if(uploading||saving)return;setUploading(true);setError('');try{const list=[...files],valid=list.filter(f=>['image/png','image/jpeg'].includes(f.type)&&f.size<=15*1024*1024);let problems=list.length-valid.length?'仅支持不超过 15 MB 的 JPG、PNG 图片':'';const results=await Promise.allSettled(valid.map(readImage));if(!live.current)return;const images=[];for(const result of results){if(result.status!=='fulfilled'){problems='部分图片无法读取';continue}let image=result.value;const matches=await matchingBackups(image,(persistedSong.deletedImages||[]).filter(b=>b.image.status==='done'||b.image.result));if(matches.length){setRecovery({matches,name:image.name});setRecoveryId(matches[0].id);const choice=await new Promise(resolve=>{recoveryResolve.current=resolve});if(choice===null)continue;if(choice!=='new'){const entry=matches.find(m=>m.id===choice);try{image={...restoreBackup(entry),name:image.name}}catch(e){problems=e.message;continue}}}if(song.images.some(i=>i.id===image.id)||images.some(i=>i.id===image.id))image={...image,id:crypto.randomUUID(),result:image.result?{...image.result,rows:image.result.rows.map(r=>({...r,notes:r.notes.map(n=>({...n,id:crypto.randomUUID()}))}))}:image.result};images.push(image);}if(images.length){await changeImages([...song.images,...images]);if(!song.completed)library.update(song.id,{stage:'recognition',propertiesUnlocked:false})}setError(problems)}catch(e){setError(e.message)}finally{setUploading(false)}};
 const reorder=target=>{if(!drag||drag===target||saving)return;const images=[...song.images],from=images.findIndex(i=>i.id===drag),to=images.findIndex(i=>i.id===target);if(from<0||to<0)return;images.splice(to,0,images.splice(from,1)[0]);void changeImages(images).catch(e=>setError(e.message));setDrag(null)};
 const close=()=>{if(uploading||saving)return;if(dirty){setUnsaved(true);return;}if(!song.images.length&&!song.completed)library.remove(song.id);else if(!song.completed)library.update(song.id,{...attrs,title:attrs.title||'新歌曲',bpm:Number(attrs.bpm)||80,octave:Number(attrs.octave)});onClose()};
 const save=async e=>{e?.preventDefault();const bpm=Number(attrs.bpm),octave=Number(attrs.octave);if(!attrs.title.trim()||!Number.isFinite(bpm)||bpm<30||bpm>240){setError('请填写歌名，并将原速设为 30–240 拍/分钟');return}if(dirty&&!(await applyStructure()))return;library.update(song.id,{...attrs,title:attrs.title.trim(),bpm,octave,completed:true,stage:'recognition'});onComplete(song.id)};
 const start=async()=>{const targets=recognitionTargets(song,selected);if(!targets.length)return;if(dirty&&!(await applyStructure()))return;library.recognize(song.id,targets);setSelecting(false);setSelected([])};
 const chosen=selected.length,targets=recognitionTargets(song,selected).length;
 return <><Modal title={song.completed?song.title:'新歌曲'} onClose={close} className="song-dialog">
 <nav className="task-tabs" aria-label="歌曲任务"><button aria-current={tab==='recognition'?'page':undefined} onClick={()=>changeTab('recognition')}>歌曲识别</button><button disabled={!canProperties} aria-current={tab==='properties'?'page':undefined} onClick={()=>changeTab('properties')}>歌曲属性</button></nav>
 {tab==='recognition'?<div className={'recognition-content '+(!song.images.length?'is-empty ':'')+(over?'drag-over':'')} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setOver(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOver(false)}} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();setOver(false);void add(e.dataTransfer.files)}}}>
 <input ref={picker} className="file-picker" type="file" multiple accept="image/jpeg,image/png" aria-label="上传乐谱图片" onChange={e=>{void add(e.target.files);e.target.value=''}}/>
 {!song.images.length?<div className="upload-empty"><svg width="58" height="58" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="7" width="54" height="48" rx="6"/><circle cx="22" cy="23" r="5"/><path d="m15 55 24-25 20 18"/></svg><strong>拖拽乐谱图片到此处</strong><span>或点击选择图片</span><button className="secondary" disabled={uploading} onClick={()=>picker.current.click()}>{uploading?'正在添加…':'选择图片'}</button><small>支持 JPG、PNG，可一次选择多张</small></div>:<><div className="image-list-heading"><div><strong>乐谱图片</strong><span>{song.images.filter(i=>i.status==='done').length}/{song.images.length} 已识别</span></div>{selecting?<div><span>{chosen?'已选 '+chosen+' 张':'未勾选时，仅识别未识别的图片'}</span><button onClick={()=>setSelected(song.images.map(i=>i.id))}>全选</button><button onClick={()=>setSelected([])}>取消全选</button></div>:busy?<span role="status">{'正在识别'} {library.jobs[song.id].current}/{library.jobs[song.id].total} · {library.jobs[song.id].phase||'处理中'}</span>:<small>{library.settings.model}</small>}</div>
 <div className="image-grid">{song.images.map((img,i)=><article className={'image-card '+(selected.includes(img.id)?'chosen':'')} key={img.id} data-image-id={img.id} draggable={!saving&&!uploading} onDragStart={e=>{if(e.target.closest(".image-delete")){e.preventDefault();return}setDrag(img.id);e.dataTransfer.setData('text/plain',img.id)}} onDragOver={e=>{if(drag)e.preventDefault()}} onDrop={e=>{if(drag){e.preventDefault();reorder(img.id)}}} onDragEnd={()=>{dragEnded.current=performance.now()+200;setDrag(null)}}>
 <button className="image-face" title={img.name} aria-pressed={selecting?selected.includes(img.id):undefined} aria-label={(selecting?'选择':'预览')+'第 '+(i+1)+' 张图片'} onClick={()=>{if(performance.now()<dragEnded.current)return;selecting?setSelected(s=>s.includes(img.id)?s.filter(id=>id!==img.id):[...s,img.id]):setPreview(img.id)}}><img src={img.src} alt={img.name} draggable="false"/><span className={'image-badge '+img.status} title={img.error||statusText[img.status]+(img.simulated?'（演示）':'')} aria-label={'第 '+(i+1)+' 张：'+statusText[img.status]}>{i+1} <ImageStatus status={img.status}/></span>{selecting&&<span className="image-checkbox" aria-hidden="true">{selected.includes(img.id)?'✓':''}</span>}</button>
 <button className="image-delete" title="移除图片" disabled={saving||uploading} draggable="false" onDragStart={e=>{e.preventDefault();e.stopPropagation()}} aria-label={'移除第 '+(i+1)+' 张图片'} onClick={e=>{e.stopPropagation();if(img.status==='done'||img.result)setRemoveImage(img);else void removePage(img)}}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg></button></article>)}<button className="add-image" disabled={saving||uploading} aria-label="添加图片" onClick={()=>picker.current.click()}><span>＋</span><small>{uploading?'正在添加…':'添加图片'}</small></button></div></>}

 </div>:<form id="song-properties" className="properties-content" onSubmit={save}><label>歌名<input value={attrs.title} maxLength="80" onChange={e=>attribute('title',e.target.value)} required/></label><div className="property-row"><label>调号<select aria-label="调号" value={attrs.key} onChange={e=>attribute('key',e.target.value)}>{['C','C#','Db','D','D#','Eb','E','Fb','E#','F','F#','Gb','G','G#','Ab','A','A#','Bb','B','Cb','B#'].map(k=><option key={k} value={k}>1 = {k}</option>)}</select></label><label>基准音区<select aria-label="基准音区" value={attrs.octave} onChange={e=>attribute('octave',e.target.value)}>{[2,3,4,5,6].map(n=><option key={n} value={n}>{n} 组{n===4?'（中央音区）':''}</option>)}</select></label></div><label>BPM<div className="bpm-field"><input aria-label="BPM" type="number" min="30" max="240" step="1" value={attrs.bpm} onChange={e=>attribute('bpm',e.target.value)} required/></div></label>{error&&<p className="form-error" role="alert">{error}</p>}</form>}
 <footer className="task-footer"><div className="footer-left task-feedback">{tab==='recognition'&&(error||song.error)&&<div className="task-error" role="alert"><span>{error||song.error}</span>{song.error&&<div className="task-error-actions"><button onClick={onSettings}>修改设置</button>{targets>0&&<button disabled={busy||uploading||saving} onClick={start}>重试</button>}</div>}</div>}{undo&&<span role="status">已移除图片 <button disabled={saving} onClick={undoRemove}>撤销</button></span>}{!song.completed&&song.images.length>0&&<button className="quiet-danger" onClick={()=>setConfirm(true)}>取消导入</button>}{library.storageError&&<small role="alert">{library.storageError}</small>}</div>{dirty&&tab==='recognition'&&<button className="primary" disabled={saving||uploading} onClick={applyStructure}>{saving?'正在保存…':'保存修改'}</button>}{tab==='properties'?<button className="primary" type="submit" form="song-properties">{song.completed?'保存修改':'完成导入'}</button>:busy?<button className="secondary" onClick={()=>library.stop(song.id)}>终止识别</button>:<>{song.images.some(i=>i.status==='done'||i.status==='failed')&&<button className="text-button" onClick={()=>{setSelecting(v=>!v);setSelected([])}}>{selecting?'取消重选':'重新识别…'}</button>}{!selecting&&allDone&&!song.completed?<button className="primary" onClick={()=>{library.update(song.id,{stage:'properties',propertiesUnlocked:true});setTab('properties')}}>下一步</button>:<button className="primary" disabled={!targets||uploading} onClick={start}>{selected.length?'识别所选 '+selected.length+' 张':'开始识别'}</button>}</>}</footer>
 </Modal>
 {removeImage&&<Confirm title="移除图片？" description="该页的识别和校对结果将一并移除。删除生效后保留 24 小时，重新上传原文件可恢复。" onClose={()=>setRemoveImage(null)} onConfirm={()=>void removePage(removeImage)} label="移除图片"/>}
 {unsaved&&<Modal title="保存图片修改？" onClose={()=>setUnsaved(false)} className="confirm-dialog"><div className="confirm-content">图片的顺序或内容已更改。</div><footer className="task-footer"><button className="secondary" onClick={()=>{setDraftImages(null);onClose()}}>不保存</button><button className="primary" disabled={saving} onClick={async()=>{if(await applyStructure())onClose()}}>保存修改</button></footer></Modal>}
 {recovery&&<Modal title="沿用上次结果？" onClose={()=>{setRecovery(null);recoveryResolve.current?.(null)}} className="confirm-dialog"><div className="confirm-content">这张图片与此前删除的图片完全一致，可恢复上次的识别和人工校对结果。{recovery.matches.length>1&&<label>恢复版本<select aria-label="恢复版本" value={recoveryId} onChange={e=>setRecoveryId(e.target.value)}>{recovery.matches.map(m=><option key={m.id} value={m.id}>{new Date(m.deletedAt).toLocaleString()} · {m.image.result?'含校对结果':'识别结果'}</option>)}</select></label>}</div><footer className="task-footer"><button className="secondary" onClick={()=>{setRecovery(null);recoveryResolve.current?.('new')}}>重新识别</button><button className="primary" onClick={()=>{setRecovery(null);recoveryResolve.current?.(recoveryId)}}>沿用上次结果</button></footer></Modal>}
 {preview&&<Modal title="图片预览" onClose={()=>setPreview(null)} className="preview-dialog"><div className="preview-content"><img src={song.images.find(i=>i.id===preview)?.src} alt={song.images.find(i=>i.id===preview)?.name}/></div></Modal>}
 {confirm&&<Confirm title="取消导入？" description="已上传图片、识别进度及歌曲草稿将从本机删除。" label="确认取消导入" onClose={()=>setConfirm(false)} onConfirm={()=>{library.remove(song.id);onClose()}}/>}
 </>;
}