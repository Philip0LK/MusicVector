const revisions=new Map(),queues=new Map(),blocked=new Set();
export let boot={library:null,practice:{}};
export async function request(url,{method='GET',value,signal}={}){
 const r=await fetch(url,{method,signal,headers:value===undefined?{}:{'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
 const v=await r.json();if(!r.ok)throw Object.assign(Error(v?.error||'本地服务请求失败'),{statusCode:r.status});return v;
}
export async function readResource(url){const v=await request(url);revisions.set(url,v.revision);return v}
export function writeResource(url,value,{retryOnConflict=false}={}){const snapshot=structuredClone(value);const run=(queues.get(url)||Promise.resolve()).catch(()=>{}).then(async()=>{if(blocked.has(url))throw Error('其他窗口已更新数据，请刷新后重新操作');if(!revisions.has(url))await readResource(url);const put=()=>request(url,{method:'PUT',value:{revision:revisions.get(url),value:snapshot}});try{const result=await put();revisions.set(url,result.revision);return result}catch(e){
  // 练习位置这类"单值偏好"由最后写入者胜出：刷新页面时上一个页面可能刚好补交一次保存，
  // 这里重新取一次版本号再写一遍，而不是像编辑类资源那样封锁后续保存并报警。
  if(e.statusCode===409&&retryOnConflict){await readResource(url);const result=await put();revisions.set(url,result.revision);return result}
  if(e.statusCode===409)blocked.add(url);throw e}});queues.set(url,run);return run}
export async function initialize(){const [library,practice]=await Promise.all([readResource('/api/library'),readResource('/api/practice')]);boot={library,practice:practice.value||{}};return boot}
export async function aiRequest(value,signal,onDelta){
 const r=await fetch('/api/ai/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal});
 if(!r.ok){const error=await r.json();throw Object.assign(Error(error.error||'识别请求失败'),{statusCode:r.status})}
 const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',result;
 for(;;){const {value:chunk,done}=await reader.read();if(done)break;pending+=decoder.decode(chunk,{stream:true});let split;while((split=pending.indexOf('\n'))>=0){const line=pending.slice(0,split);pending=pending.slice(split+1);if(!line)continue;const event=JSON.parse(line);if(event.error)throw Object.assign(Error(event.error),{statusCode:event.statusCode});if(event.delta)await onDelta(event.delta);if(event.result)result=event.result}}
 if(!result)throw Error('识别连接中断，已收到的记录保存在本地');return result;
}

