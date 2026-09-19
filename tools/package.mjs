// 打出可分发的 Windows 便携包。
//
//   node tools/package.mjs                       → releases/乐北斗        （空库，供公开分发）
//   node tools/package.mjs --with-data <目录>     → releases/乐北斗－自用   （带你自己的曲库，只在本机用）
//   --refresh                                    先删除同名发行目录再重建
//   --runtime <目录>                             指定自带运行环境（默认 runtime/）
//
// 前置：npm run build；手机端 APK 已构建（android/ 下 assembleRelease）。
// 发行目录不会进仓库（见 .gitignore），也不包含任何个人曲谱数据。
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DataStore, hash} from '../server/dataStore.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const output = path.join(root, 'releases');
const runtime = path.resolve(arg('--runtime') ?? 'runtime');
const personalData = arg('--with-data') ? path.resolve(arg('--with-data')) : null;
const edition = personalData ? '自用' : '公开版';
const target = path.join(output, personalData ? '乐北斗－自用' : '乐北斗');

const APK_CANDIDATES = [
  'android/app/build/outputs/apk/release/app-release.apk',
  'android/app/build/outputs/apk/debug/app-debug.apk',
];
const apk = (await Promise.all(APK_CANDIDATES.map(async (file) => ((await fs.access(file).then(() => true, () => false)) ? file : null)))).find(Boolean);
if (!apk) throw Error('没有找到手机端 APK：请先在 android/ 下构建（assembleRelease 或 assembleDebug）');
if (!apk.includes('release')) console.warn('警告：用的是调试签名的 APK，只适合自己试，不要对外分发。');
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

// 还没 git init 或没有 git 时也能打包，只是清单里不记录来源提交。
const git = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  } catch {
    return null;
  }
})();
const app = path.join(target, 'app');
await fs.mkdir(path.join(app, 'server'), {recursive: true});
await fs.cp('dist', path.join(app, 'public'), {recursive: true});
await fs.copyFile('build/server.mjs', path.join(app, 'server/server.mjs'));
for (const file of ['dpapi.py', 'slice_bridge.py']) await fs.copyFile('server/' + file, path.join(app, 'server', file));
await fs.mkdir(path.join(app, 'python'), {recursive: true});
for (const file of ['score_geometry.py', 'score_layout.py', 'score_pixels.py', 'score_slicer.py', 'score_structure.py']) await fs.copyFile('python/' + file, path.join(app, 'python', file));
await fs.copyFile('tools/launch.cjs', path.join(app, 'launch.cjs'));

await fs.cp(runtime, path.join(target, 'runtime'), {recursive: true, filter: (f) => !f.includes('__pycache__') && !f.endsWith('.pyc')});
await fs.mkdir(path.join(target, '手机端'), {recursive: true});
await fs.copyFile(apk, path.join(target, '手机端/乐北斗.apk'));
await fs.writeFile(path.join(target, '手机端/安装手机端.cmd'), '@echo off\r\nchcp 65001 >nul\r\ntitle 乐北斗\r\n"%~dp0..\\runtime\\adb\\adb.exe" install -r "%~dp0乐北斗.apk"\r\npause\r\n');
await fs.writeFile(path.join(target, '启动.cmd'), '@echo off\r\nchcp 65001 >nul\r\ntitle 乐北斗\r\n"%~dp0runtime\\node\\node.exe" "%~dp0app\\launch.cjs"\r\nif errorlevel 1 pause\r\n');
await fs.writeFile(path.join(target, '停止.cmd'), '@echo off\r\nchcp 65001 >nul\r\ntitle 乐北斗\r\n"%~dp0runtime\\node\\node.exe" "%~dp0app\\server\\server.mjs" --home "%~dp0." --stop\r\nif errorlevel 1 pause\r\n');
// 说明书与第三方声明：中文、英文两版一起随包发布（缺哪版就跳过哪版）
for (const name of ['使用说明.md', '使用说明.en.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.en.md']) {
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
  for (const id of index.songIds) await fs.cp(path.join(personalData, 'songs', id), path.join(data, 'songs', id), {recursive: true});
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
    else files.push({path: path.relative(target, at).replaceAll('\\', '/'), sha256: hash(await fs.readFile(at))});
  }
};
await walk(target);
await fs.writeFile(path.join(target, '发行清单.json'), JSON.stringify({
  name: '乐北斗',
  version: '1.0.0',
  edition,
  sourceCommit: git,
  node: '24.14.0',
  python: '3.12.14',
  opencv: '4.12.0.88',
  numpy: '2.2.6',
  pillow: '11.3.0',
  files,
}, null, 2));
console.log(`${target} — ${files.length} 个文件（${edition}）`);
