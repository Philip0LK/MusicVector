// 打出可分发的 Windows 便携包。
//
//   node tools/package.mjs                       → releases/MusicVector          （空库，供公开分发）
//   node tools/package.mjs --with-data <目录>     → releases/MusicVector-personal （带你自己的曲库，只在本机用）
//   --refresh                                    先删除同名发行目录再重建
//   --runtime <目录>                             指定自带运行环境（默认 runtime/）
//
// 前置：npm run build；手机端 APK 已构建（android/ 下 assembleRelease）。
// 发行目录不会进仓库（见 .gitignore），也不包含任何个人曲谱数据。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DataStore} from '../server/dataStore.mjs';
import {versions, verifyBuild, verifyPackage, sha256} from './release-support.mjs';
import {scanDirectory} from './security.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const build = await verifyBuild(root);
const version = await versions(root);

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const output = path.join(root, 'releases');
const runtime = path.resolve(arg('--runtime') ?? 'runtime');
const personalData = arg('--with-data') ? path.resolve(arg('--with-data')) : null;
const edition = personalData ? 'personal' : 'public';
const target = path.join(output, personalData ? 'MusicVector-personal' : 'MusicVector');

const apk = 'android/app/build/outputs/apk/release/app-release.apk';
const apkProof = JSON.parse(await fs.readFile('build/apk-provenance.json', 'utf8').catch(() => {throw Error('缺少正式 APK 来源记录，请运行 npm run release:prepare -- --ref <提交或标签>');}));
if (apkProof.sourceCommit !== build.sourceCommit || apkProof.sha256 !== await sha256(apk) || apkProof.applicationId !== 'com.yuebeidou.player' || apkProof.versionCode !== version.androidVersionCode || apkProof.versionName !== version.androidVersionName) throw Error('正式 APK 的提交、版本或校验值不一致');
if (apkProof.fingerprint !== '8aaf2211ee6dc5ba7508d1144097026741fa2147b9685a019e999bf81f62e1a1') throw Error('APK 未沿用正式签名身份');
if (!(await fs.access(runtime).then(() => true, () => false))) throw Error('缺少自带运行环境：' + runtime + '（可用 --runtime 指定）');

await fs.mkdir(output, {recursive: true});
if (process.argv.includes('--refresh')) {
  if (path.dirname(path.resolve(target)) !== path.resolve(output)) throw Error('路径越界');
  await fs.rm(target, {recursive: true, force: true});
}
try {
  await fs.access(target);
  throw Error('发行目录已存在，请先另存或改用 --refresh：' + target);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const app = path.join(target, 'app');
await fs.mkdir(path.join(app, 'server'), {recursive: true});
await fs.cp('dist', path.join(app, 'public'), {recursive: true});
await fs.copyFile('build/server.mjs', path.join(app, 'server/server.mjs'));
for (const file of ['dpapi.py', 'slice_bridge.py']) await fs.copyFile('server/' + file, path.join(app, 'server', file));
await fs.mkdir(path.join(app, 'python'), {recursive: true});
for (const file of ['score_geometry.py', 'score_layout.py', 'score_pixels.py', 'score_slicer.py', 'score_structure.py']) await fs.copyFile('python/' + file, path.join(app, 'python', file));
await fs.copyFile('tools/launch.cjs', path.join(app, 'launch.cjs'));

await fs.cp(runtime, path.join(target, 'runtime'), {recursive: true, filter: (f) => !f.includes('__pycache__') && !f.endsWith('.pyc')});
await fs.mkdir(path.join(target, 'Android'), {recursive: true});
await fs.copyFile(apk, path.join(target, 'Android/MusicVector.apk'));
// 不生成任何 .cmd：用户在包目录打开命令行运行命令（见 USER-GUIDE.zh-CN.md）；Android 目录里只放 APK。
// 说明书与第三方声明：中文、英文两版一起随包发布（缺哪版就跳过哪版）
for (const name of ['USER-GUIDE.zh-CN.md', 'USER-GUIDE.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.en.md']) {
  if (!(await fs.access(name).then(() => true, () => false))) {
    console.warn('跳过缺失的文档：' + name);
    continue;
  }
  await fs.copyFile(name, path.join(target, name));
}

const data = path.join(target, 'data');
if (personalData) {
  const index = JSON.parse(await fs.readFile(path.join(personalData, 'library.json'), 'utf8'));
  await fs.mkdir(path.join(data, 'songs'), {recursive: true});
  for (const name of ['library.json', 'settings.json', 'practice.json']) {
    await fs.copyFile(path.join(personalData, name), path.join(data, name)).catch(() => {});
  }
  for (const id of index.songIds) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(id)) throw Error('歌曲标识无效');
    await fs.cp(path.join(personalData, 'songs', id), path.join(data, 'songs', id), {recursive: true});
  }
} else {
  await new DataStore(data).init();
}
for (const name of ['logs', 'recovery', 'backups']) await fs.mkdir(path.join(data, name), {recursive: true});

// 第三方许可：node_modules 里的声明 + 手机端的 Apache/ZXing 声明
const licenses = path.join(target, 'licenses');
await fs.mkdir(licenses, {recursive: true});
const visit = async (dir) => {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('@')) await visit(at);
      else {
        for (const name of (await fs.readdir(at)).filter((n) => /^(LICENSE|LICENCE|NOTICE|COPYING)/i.test(n))) {
          const file = path.join(at, name);
          if ((await fs.stat(file)).isFile()) await fs.copyFile(file, path.join(licenses, path.relative('node_modules', file).replaceAll(/[/\\]/g, '_')));
        }
      }
    }
  }
};
await visit('node_modules');
await fs.cp('licenses-mobile', path.join(licenses, 'mobile'), {recursive: true});

const files = [];
const walk = async (dir) => {
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(at);
    else files.push({path: path.relative(target, at).replaceAll('\\', '/'), size: (await fs.stat(at)).size, sha256: await sha256(at)});
  }
};
await walk(target);
const bundledNode = execFileSync(path.join(runtime, 'node/node.exe'), ['--version'], {encoding:'utf8', windowsHide:true}).trim();
const bundledPython = JSON.parse(execFileSync(path.join(runtime, 'python/python.exe'), ['-c', 'import json,sys,cv2,numpy,PIL;print(json.dumps(dict(python=sys.version.split()[0],opencv=cv2.__version__,numpy=numpy.__version__,pillow=PIL.__version__)))'], {encoding:'utf8', windowsHide:true}));
await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({
  name: 'MusicVector',
  ...version,
  edition,
  sourceCommit: build.sourceCommit,
  builtAt: new Date().toISOString(),
  lockSha256: await sha256(path.join(root, 'package-lock.json')),
  apk: apkProof,
  node: bundledNode,
  ...bundledPython,
  files,
}, null, 2));
await verifyPackage(target, edition);
scanDirectory(target);
console.log(`${target} — ${files.length} 个文件（${edition}）`);
