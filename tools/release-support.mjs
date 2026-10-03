import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {git} from './security.mjs';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('发行内容不能包含目录联接或符号链接：' + rel);
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), rel + '/'));
    else if (entry.isFile()) files.push(rel);
    else throw Error('不支持的文件类型：' + rel);
  }
  return files.sort();
}
export function normalizedVersion(version) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw Error('版本号须为两段或三段数字：' + version);
  return version.split('.').length === 2 ? version + '.0' : version;
}
export async function versions(root) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const android = await fs.readFile(path.join(root, 'android/app/build.gradle.kts'), 'utf8');
  const name = /versionName\s*=\s*"([^"]+)"/.exec(android)?.[1];
  const code = Number(/versionCode\s*=\s*(\d+)/.exec(android)?.[1]);
  if (!name || !code || normalizedVersion(pkg.version) !== normalizedVersion(name)) throw Error('产品版本号与 Android 版本号不一致');
  return {version: normalizedVersion(pkg.version), androidVersionName: name, androidVersionCode: code};
}
export function requireClean(root) {
  const commit = git(['rev-parse', 'HEAD'], root).trim();
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], root).trim()) throw Error('工作副本存在未提交内容，不能作为发行来源');
  return commit;
}
export async function buildProvenance(root) {
  const commit = requireClean(root);
  const paths = [...(await filesIn(path.join(root, 'dist'))).map(p => 'dist/' + p), 'build/server.mjs'];
  const files = await Promise.all(paths.map(async rel => ({path: rel, sha256: await sha256(path.join(root, rel))})));
  return {sourceCommit: commit, builtAt: new Date().toISOString(), node: process.version, files};
}
export async function verifyBuild(root) {
  const commit = requireClean(root);
  const proof = JSON.parse(await fs.readFile(path.join(root, 'build/provenance.json'), 'utf8'));
  if (proof.sourceCommit !== commit || !Array.isArray(proof.files) || !proof.files.length) throw Error('构建记录与选定提交不一致，请使用 release:prepare');
  const actual = [...(await filesIn(path.join(root, 'dist'))).map(p => 'dist/' + p), 'build/server.mjs'].sort();
  if (JSON.stringify(actual) !== JSON.stringify(proof.files.map(f => f.path).sort())) throw Error('构建文件清单已变化');
  for (const file of proof.files) if (await sha256(path.join(root, file.path)) !== file.sha256) throw Error('构建产物已变化：' + file.path);
  return proof;
}
export async function verifyPackage(directory, expectedEdition = 'public') {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.edition !== expectedEdition || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '')) throw Error('发行类型或来源提交无效');
  if (!Array.isArray(manifest.files)) throw Error('缺少发行文件清单');
  const actual = (await filesIn(directory)).filter(p => p !== 'manifest.json');
  const listed = manifest.files.map(f => f.path).sort();
  if (new Set(listed).size !== listed.length || JSON.stringify(actual) !== JSON.stringify(listed)) throw Error('发行文件与清单不一致');
  for (const file of manifest.files) {
    const rel = file.path;
    if (path.isAbsolute(rel) || rel.split('/').includes('..') || /(^|\/)(\.git|private|local)(\/|$)|\.(jks|keystore|pfx|p12)$|(^|\/)\.env(?:\.|$)|(^|\/)keystore\.properties$/i.test(rel)) throw Error('发行包含禁止内容：' + rel);
    if (!/^(app\/|runtime\/|Android\/MusicVector\.apk$|licenses\/|data\/|USER-GUIDE(?:\.zh-CN)?\.md$|THIRD_PARTY_NOTICES(?:\.en)?\.md$)/.test(rel)) throw Error('不在发行白名单内：' + rel);
    if (expectedEdition === 'public' && rel.startsWith('data/') && !['data/library.json', 'data/settings.json', 'data/practice.json'].includes(rel)) throw Error('公开包含曲库文件或运行记录：' + rel);
    if (await sha256(path.join(directory, rel)) !== file.sha256) throw Error('发行文件校验失败：' + rel);
  }
  const library = JSON.parse(await fs.readFile(path.join(directory, 'data/library.json'), 'utf8'));
  if (!Array.isArray(library.songIds) || (expectedEdition === 'public' && library.songIds.length)) throw Error('公开包必须是空曲库');
  if (expectedEdition === 'public') for (const name of ['settings.json','practice.json']) {
    const value=JSON.parse(await fs.readFile(path.join(directory,'data',name),'utf8').catch(error=>{if(error.code==='ENOENT')return '{}';throw error;}));
    if (Object.keys(value).length) throw Error('公开包不能包含个人设置或练习记录');
  }
  if (!manifest.apk || manifest.apk.sourceCommit !== manifest.sourceCommit || manifest.apk.sha256 !== await sha256(path.join(directory,'Android/MusicVector.apk')) || manifest.apk.fingerprint !== '8aaf2211ee6dc5ba7508d1144097026741fa2147b9685a019e999bf81f62e1a1') throw Error('发行 APK 来源或签名记录不一致');
  if (normalizedVersion(manifest.version) !== normalizedVersion(manifest.apk.versionName) || manifest.androidVersionCode !== manifest.apk.versionCode) throw Error('发行版本与 APK 版本不一致');
  return manifest;
}
