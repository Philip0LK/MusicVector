// 从明确提交创建干净工作副本，生成候选包与验收记录；不上传 GitHub。
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git, root, scanner, scanDirectory} from './security.mjs';
import {versions, normalizedVersion, sha256, filesIn, verifyPackage} from './release-support.mjs';

export function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--ref', '--runtime', '--tooling', '--with-data'].includes(key) || out[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('参数无效：' + key);
    out[key] = args[++i];
  }
  if (!out['--ref'] || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(out['--ref'])) throw Error('必须指定 --ref <已提交版本或标签>');
  return out;
}
export async function fingerprint(directory) {
  const files = (await filesIn(directory)).filter(p => !/(^|\/)(\.lock|\.instance\.json)$/.test(p));
  const result=[];
  for(let i=0;i<files.length;i+=16) result.push(...await Promise.all(files.slice(i,i+16).map(async p=>({path:p,sha256:await sha256(path.join(directory,p))}))));
  return result;
}
async function main() {
  if (process.platform !== 'win32') throw Error('正式签名与便携包验收目前要求 Windows');
  const opts = options(process.argv.slice(2));
  const settings = JSON.parse(await fs.readFile(path.join(root, 'local/release-settings.json'), 'utf8').catch(() => '{}'));
  const runtime = path.resolve(opts['--runtime'] ?? settings.runtime ?? path.join(root, 'runtime'));
  const tooling = path.resolve(opts['--tooling'] ?? process.env.YUEBEIDOU_TOOLING ?? settings.tooling ?? 'android/.tooling');
  const gitleaks = scanner();
  for (const need of [path.join(runtime, 'node/node.exe'), path.join(runtime, 'python/python.exe'), path.join(tooling, 'jdk-17/bin/java.exe'), path.join(root, 'android/keystore.properties')]) await fs.access(need);
  if (Object.keys(process.env).some(key => key.startsWith('VITE_'))) throw Error('发行构建拒绝继承 VITE_* 环境变量，请先清除再运行');
  const commit = git(['rev-parse', '--verify', opts['--ref'] + '^{commit}']).trim();
  const label = new Date().toISOString().replace(/[:.]/g, '-') + '-' + commit.slice(0,8);
  const area = path.join(root, 'releases/candidates', label), source = path.join(area, 'source');
  await fs.mkdir(area, {recursive:true});
  const report = {schemaVersion:1, status:'running', startedAt:new Date().toISOString(), sourceCommit:commit, selectedRef:opts['--ref'], edition:opts['--with-data']?'personal':'public', developmentStatus:git(['status','--porcelain=v1']), steps:[], artifacts:[]};
  const reportPath = path.join(area, '验收记录.json');
  const save = () => fs.writeFile(reportPath, JSON.stringify(report,null,2));
  await save();
  const env = {...process.env, GITLEAKS:gitleaks, YUEBEIDOU_TOOLING:tooling, YUEBEIDOU_NO_OPEN:'1', YUEBEIDOU_NO_USB:'1'};
  const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  async function run(name, executable, args, cwd = source) {
    console.log('进行：' + name);
    const step = {name, startedAt:new Date().toISOString(), status:'running', log:'logs/' + (report.steps.length+1) + '.log'};
    report.steps.push(step); await save();
    await fs.mkdir(path.join(area,'logs'), {recursive:true});
    const log = await fs.open(path.join(area,step.log), 'w');
    try {
      const exit = await new Promise((resolve,reject) => {
        const child = spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
        child.once('error',reject); child.once('exit',code=>resolve(code));
      });
      if (exit !== 0) throw Error(name + '失败，查看 ' + path.join(area,step.log));
      step.status='passed';
    } catch (error) { step.status='failed'; throw error; }
    finally { await log.close(); step.finishedAt=new Date().toISOString(); await save(); }
  }
  const node = (name,args) => run(name,process.execPath,args);
  const npmRun = name => run(name,process.execPath,[npm,'run',name]);
  const protectedInputs = [path.join(root,'data'), path.join(root,'private')];
  let before;
  try {
    before = await Promise.all(protectedInputs.map(fingerprint));
    await run('建立干净工作副本','git',['-c','safe.directory='+root.replaceAll('\\','/'),'clone','--no-hardlinks','--no-checkout',root,source],root);
    await run('固定来源提交','git',['checkout','--detach',commit]);
    await fs.access(path.join(source,'tools/security.mjs')); // 旧版本缺少发布约束时拒绝继续。
    const version = await versions(source); Object.assign(report,version);
    if (opts['--ref'].startsWith('v') && normalizedVersion(opts['--ref'].slice(1)) !== version.version) throw Error('版本标签与产品版本不一致');
    const jdk=spawnSync(path.join(tooling,'jdk-17/bin/java.exe'),['-version'],{encoding:'utf8',windowsHide:true});
    if(jdk.status!==0) throw Error('JDK 无法运行');
    report.tooling = {node:process.version,gitleaks:'8.30.1',gradle:'8.10.2',jdk:(jdk.stdout+jdk.stderr).trim()};
    await run('安装锁定依赖',process.execPath,[npm,'ci','--no-audit','--no-fund']);
    await fs.cp(runtime,path.join(source,'runtime'),{recursive:true});
    for (const rel of ['local/fixtures','local/tests']) {
      if (await fs.access(path.join(root,rel)).then(()=>true,()=>false)) await fs.cp(path.join(root,rel),path.join(source,rel),{recursive:true});
    }
    // 本机曲谱夹具和手机端金标准成对使用；只复制被忽略的测试资源，不改变选定版本的已跟踪文件。
    report.privateFixtures=[];
    for(const rel of git(['ls-files','--others','--ignored','--exclude-standard','-z','--','android/app/src/test/resources']).split('\0').filter(Boolean)) {
      if(!rel.startsWith('android/app/src/test/resources/')) throw Error('测试资源路径越界');
      await fs.mkdir(path.dirname(path.join(source,rel)),{recursive:true});
      await fs.copyFile(path.join(root,rel),path.join(source,rel));
      const digest=await sha256(path.join(root,rel));
      if(digest!==await sha256(path.join(source,rel))) throw Error('测试资源复制校验失败');
      report.privateFixtures.push({path:rel,sha256:digest});
    }
    // 签名配置只进入被忽略的构建位置；密钥库保持外部路径。
    await fs.copyFile(path.join(root,'android/keystore.properties'),path.join(source,'android/keystore.properties'));
    await node('历史密钥与私人路径扫描',['tools/security.mjs','--history']);
    await npmRun('check:publish');
    await npmRun('test');
    await npmRun('build');
    await npmRun('test:ai'); // 现有脚本使用本地模拟服务，不调用真实付费模型。
    await npmRun('test:editor');
    if (await fs.access(path.join(source,'local/tests/run.mjs')).then(()=>true,()=>false)) {
      env.SELF_LIBRARY=path.join(root,'data');
      await node('本机 UI 回归',['local/tests/run.mjs']);
    } else throw Error('本机 UI 回归脚本缺失，请恢复 local/tests');
    await run('重新构建正式 APK','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'android/scripts/gradle-local.ps1'),'clean',':app:assembleRelease']);
    const apk = path.join(source,'android/app/build/outputs/apk/release/app-release.apk');
    const apkInfo=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'tools/verify-apk.ps1'),'-Apk',apk,'-Tooling',tooling],{cwd:source,env,encoding:'utf8',windowsHide:true}));
    if (apkInfo.applicationId!=='com.yuebeidou.player' || apkInfo.versionName!==version.androidVersionName || apkInfo.versionCode!==version.androidVersionCode || apkInfo.fingerprint!=='8aaf2211ee6dc5ba7508d1144097026741fa2147b9685a019e999bf81f62e1a1') throw Error('正式 APK 签名或版本不匹配');
    const proof={...apkInfo,sourceCommit:commit,sha256:await sha256(apk),builtAt:new Date().toISOString()};
    await fs.writeFile(path.join(source,'build/apk-provenance.json'),JSON.stringify(proof,null,2));
    report.apk=proof;
    await node('组装空库公开包',['tools/package.mjs']);
    const publicPackage=path.join(source,'releases/MusicVector');
    await verifyPackage(publicPackage);
    await node('公开包密钥扫描',['tools/security.mjs','--directory',publicPackage]);
    await npmRun('test:release'); // 此验收只写两份测试副本。
    await verifyPackage(publicPackage);
    let target=publicPackage;
    if (opts['--with-data']) {
      const personalData=path.resolve(opts['--with-data']), snapshot=path.join(area,'personal-data-snapshot');
      const original=await fingerprint(personalData);
      await fs.cp(personalData,snapshot,{recursive:true,filter:from=>!/(^|[\\/])(\.lock|\.instance\.json)$/.test(from)});
      if (JSON.stringify(original)!==JSON.stringify(await fingerprint(snapshot))) throw Error('个人曲库快照校验失败');
      await node('组装个人包',['tools/package.mjs','--with-data',snapshot]);
      target=path.join(source,'releases/MusicVector-personal');
      const personal=await verifyPackage(target,'personal');
      const outputData=await fingerprint(path.join(target,'data'));
      const index=JSON.parse(await fs.readFile(path.join(snapshot,'library.json'),'utf8'));
      const selected=original.filter(f=>['library.json','settings.json','practice.json'].includes(f.path) || index.songIds.some(id=>f.path.startsWith('songs/'+id+'/')));
      if (JSON.stringify(outputData)!==JSON.stringify(selected)) throw Error('个人包曲库校验失败');
      report.personalSongCount=index.songIds.length;
      report.personalManifestSha256=await sha256(path.join(target,'manifest.json'));
      if (personal.sourceCommit!==commit) throw Error('个人包来源不一致');
      // 个人包留在本机。涉及私人原始归档的内容不进入公开扫描范围或上传入口。
    }
    const zip=path.join(area,`MusicVector-${version.version}-${report.edition==='personal'?'personal-':''}windows-x64.zip`);
    await run('生成压缩包','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'tools/archive-package.ps1'),'-Source',target,'-Destination',zip]);
    const extracted=path.join(area,'zip-verification');
    await run('复核压缩包内容','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'tools/archive-package.ps1'),'-Source',zip,'-Destination',extracted,'-Extract']);
    const extractedPackage=path.join(extracted,path.basename(target));
    await verifyPackage(extractedPackage,report.edition);
    if (await sha256(path.join(extractedPackage,'manifest.json'))!==await sha256(path.join(target,'manifest.json'))) throw Error('压缩包清单与原包不一致');
    if(report.edition==='public') await node('最终压缩包密钥扫描',['tools/security.mjs','--directory',extracted]);
    const apkOut=path.join(area,`MusicVector-${version.version}-android.apk`);
    await fs.copyFile(apk,apkOut);
    report.artifacts=await Promise.all([zip,apkOut].map(async file=>({path:file,size:(await fs.stat(file)).size,sha256:await sha256(file)})));
    const after=await Promise.all(protectedInputs.map(fingerprint));
    if(JSON.stringify(before)!==JSON.stringify(after)) throw Error('正式曲库或凭据在验收期间发生变化，请核对来源');
    report.protectedInputsUnchanged=true;
    // 成功后回收 UI 测试的曲库副本；保留截图、日志、源码和候选成品。
    const qa=path.resolve(source,'qa');
    if(path.dirname(qa)!==path.resolve(source) || !qa.startsWith(path.resolve(area)+path.sep)) throw Error('测试清理路径越界');
    for(const entry of await fs.readdir(qa,{withFileTypes:true})) {
      if(!entry.isDirectory() || !/^自用验收 \d+$/.test(entry.name)) continue;
      const testData=path.resolve(qa,entry.name,'data');
      if(!testData.startsWith(qa+path.sep)) throw Error('测试曲库清理路径越界');
      await fs.rm(testData,{recursive:true,force:true});
    }
    report.testLibraryCopiesCleaned=true;
    report.status='passed'; report.finishedAt=new Date().toISOString(); await save();
    console.log('候选包验收通过：'+reportPath);
    console.log('上传前需选定未使用的版本标签、检查 Android 升级版本号并由负责人确认。');
  } catch(error) {
    report.status='failed';report.error=error.message;report.finishedAt=new Date().toISOString();await save();throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
