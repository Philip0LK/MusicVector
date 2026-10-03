// 上传前复核候选成品。个人包被拒绝，历史版本号不能冒充新发行。
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {root, git, scanDirectory} from './security.mjs';
import {sha256, verifyPackage, normalizedVersion} from './release-support.mjs';
try {
  const args=process.argv.slice(2);
  if(args.length!==4 || args[0]!=='--run' || args[2]!=='--tag' || !/^v\d+\.\d+(?:\.\d+)?$/.test(args[3])) throw Error('用法：npm run release:verify -- --run <候选目录> --tag <新版本标签>');
  const area=path.resolve(args[1]), tag=args[3];
  const report=JSON.parse(await fs.readFile(path.join(area,'验收记录.json'),'utf8'));
  if(report.status!=='passed' || report.edition!=='public' || report.protectedInputsUnchanged!==true) throw Error('只允许验收通过的空库公开包');
  if(normalizedVersion(tag.slice(1))!==report.version) throw Error('上传标签与候选版本不一致');
  const existing=git(['ls-remote','--tags','origin','refs/tags/'+tag]).trim();
  if(existing) throw Error('该版本标签已在远端使用，不能覆盖发行');
  const tags=git(['tag','--list','v*']).trim().split('\n').filter(Boolean);
  for(const previous of tags) {
    const text=git(['show',previous+':android/app/build.gradle.kts']);
    const code=Number(/versionCode\s*=\s*(\d+)/.exec(text)?.[1]);
    if(code && report.androidVersionCode<=code) throw Error('Android versionCode 必须高于已有版本：'+previous);
  }
  if(report.artifacts.length!==2) throw Error('发行附件不完整');
  for(const artifact of report.artifacts) {
    const file=path.resolve(artifact.path);
    if(path.dirname(file)!==area || await sha256(file)!==artifact.sha256) throw Error('候选附件路径或校验值不一致');
  }
  const zip=report.artifacts.find(f=>f.path.endsWith('.zip'));
  if(!zip) throw Error('缺少 Windows 压缩包');
  const extracted=path.join(area,'upload-check-'+Date.now());
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/archive-package.ps1'),'-Source',zip.path,'-Destination',extracted,'-Extract'],{windowsHide:true});
  const manifest=await verifyPackage(path.join(extracted,'MusicVector'));
  if(manifest.sourceCommit!==report.sourceCommit || manifest.version!==report.version || manifest.androidVersionCode!==report.androidVersionCode) throw Error('最终压缩包与验收记录不一致');
  const apk=report.artifacts.find(f=>f.path.endsWith('.apk'));
  if(!apk || apk.sha256!==manifest.apk.sha256) throw Error('独立 APK 与 Windows 包内 APK 不一致');
  scanDirectory(extracted);
  console.log('上传前复核通过。请确认公开以下提交与附件：');
  console.log(JSON.stringify({tag,sourceCommit:report.sourceCommit,artifacts:report.artifacts},null,2));
} catch(error) { console.error(error.message);process.exitCode=1; }
