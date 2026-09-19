// 发布前检查：确认将要公开的文件里没有个人内容。
//
//   node tools/check-publish.mjs
//
// 检查的是「提交后会进仓库的文件」——即 git 视角下的候选文件（未跟踪但未被忽略的，
// 加上已跟踪的）。发现可疑项时以非零退出码结束，避免把私人曲谱、曲库或截图推上去。
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function candidates() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'});
    return out.split('\n').filter(Boolean);
  } catch {
    return null; // 还不是 git 仓库时按 .gitignore 自己扫一遍
  }
}

// 把 .gitignore 里那几条规则实现成够用的匹配：目录名、具体路径、*.后缀。
function ignoredByGitignore() {
  const patterns = fs
    .readFileSync(path.join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return (rel) => patterns.some((pattern) => {
    const bare = pattern.replace(/\/$/, '').replace(/^\//, '');
    if (pattern.endsWith('/')) return rel === bare || rel.startsWith(bare + '/') || rel.includes('/' + bare + '/');
    if (bare.startsWith('*')) return rel.endsWith(bare.slice(1));
    return rel === bare || rel.startsWith(bare + '/');
  });
}

function walk(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const r = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (ignored(r + '/')) continue;
      walk(path.join(dir, entry.name), r, out);
    } else if (!ignored(r)) out.push(r);
  }
  return out;
}

const ignored = ignoredByGitignore();
const files = candidates() ?? walk(root);
const problems = [];
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|rgba|psd|heic)$/i;
// 只有这些位置的图片是产品自带的素材
const ALLOWED_IMAGE = /^(public\/icons\/|public\/assets\/piano\/|android\/app\/src\/main\/res\/|android\/app\/src\/main\/assets\/)/;
// 个人内容与开发产物的路径特征
const FORBIDDEN = [/(^|\/)legacy-public\//, /(^|\/)img_data\//, /(^|\/)recognition-raw\//, /(^|\/)reports\//, /(^|\/)backups\//, /^local\//, /^data\//, /(^|\/)salon\.json$/, /(^|\/)corrected-draft\.json$/];
const BIG = 8 * 1024 * 1024;

let total = 0;
const sized = [];
for (const file of files) {
  const at = path.join(root, file);
  let size = 0;
  try {
    size = fs.statSync(at).size;
  } catch {
    continue;
  }
  total += size;
  sized.push([file, size]);
  for (const pattern of FORBIDDEN) if (pattern.test(file)) problems.push(`不该公开的路径：${file}`);
  if (IMAGE.test(file) && !ALLOWED_IMAGE.test(file)) problems.push(`产品素材之外的图片：${file}`);
  if (size > BIG) problems.push(`超过 ${(BIG / 1048576).toFixed(0)} MB 的文件：${file}`);
}

console.log(`候选文件 ${files.length} 个，合计 ${(total / 1048576).toFixed(1)} MB`);
console.log('\n最大的文件：');
sized
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([file, size]) => console.log(`  ${(size / 1048576).toFixed(2).padStart(7)} MB  ${file}`));

if (problems.length) {
  console.error('\n发现可疑内容，已停止：');
  [...new Set(problems)].forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('\n检查通过：没有发现个人内容。');
