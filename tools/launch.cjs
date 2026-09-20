const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const home=path.resolve(__dirname,'..'),data=path.join(home,'data');
(async()=>{
 fs.mkdirSync(path.join(data,'logs'),{recursive:true});
 const probe=path.join(data,'.write-test');fs.writeFileSync(probe,'');fs.unlinkSync(probe);
 const out=fs.openSync(path.join(data,'logs','startup.log'),'a');
 const child=spawn(process.execPath,[path.join(__dirname,'server/server.mjs'),'--home',home],{cwd:home,windowsHide:true,detached:true,stdio:['ignore',out,out]});child.unref();fs.closeSync(out);
 for(let i=0;i<120;i++){
  try{const info=JSON.parse(fs.readFileSync(path.join(data,'.instance.json'),'utf8'));const r=await fetch(info.url+'/api/health',{headers:{'x-yuebeidou-token':info.token},signal:AbortSignal.timeout(500)});if(r.ok){console.log('乐北斗已开启（'+info.url+'）。关闭浏览器不会停止服务；要停止请运行使用说明里的停止命令。');return}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('启动未完成，请查看 data/logs/startup.log');
})().catch(e=>{console.error(e.message);process.exitCode=1});
