import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
export async function startUsbPhone(home,port){
 const adb=path.join(home,'runtime/adb/adb.exe');
 const run=args=>exec(adb,args,{windowsHide:true,timeout:15000});
 try{
  const {stdout}=await run(['devices']);
  for(const line of stdout.split(/\r?\n/)){
   const match=/^(\S+)\s+device$/.exec(line.trim());if(!match)continue;
   await run(['-s',match[1],'reverse','tcp:'+port,'tcp:'+port]);
   await run(['-s',match[1],'shell','am','start','-n','com.yuebeidou.player/.MainActivity']);
   console.log('已开启 USB 手机端');
  }
 }catch{console.log('USB 手机端未自动开启；可使用 Android 目录中的安装包及同一 Wi-Fi 扫码。')}
}
