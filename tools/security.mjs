// 密钥扫描只打印脱敏结果。工作区/暂存区按 Git 文件清单导出，不读取私人曲库。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sensitivePath = name => /(^|\/)(data|private|local|runtime|releases|qa|node_modules|\.git)(\/|$)/i.test(name) || /(^|\/)(\.env(?:\..*)?|keystore\.properties)$|\.(jks|keystore|p12|pfx)$/i.test(name);
export function git(args, cwd = root, options = {}) {
  return execFileSync('git', ['-c', 'safe.directory=' + cwd.replaceAll('\\', '/'), '-c', 'core.quotepath=false', ...args], {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options});
}
export function safeGitEnv(cwd) {
  const env = {...process.env};
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  env.GIT_CONFIG_COUNT = String(count + 1);
  env['GIT_CONFIG_KEY_' + count] = 'safe.directory';
  env['GIT_CONFIG_VALUE_' + count] = cwd.replaceAll('\\', '/');
  // 扫描配置必须来自这份源码，不能被本机环境里的另一个规则集替代。
  delete env.GITLEAKS_CONFIG; delete env.GITLEAKS_CONFIG_TOML;
  return env;
}
export function scanner() {
  const candidates = [process.env.GITLEAKS, path.join(root, 'local', 'tooling', 'gitleaks.exe'), path.resolve(root, '../../tools/git/vendor/gitleaks-8.30.1/gitleaks.exe'), 'gitleaks'].filter(Boolean);
  for (const file of candidates) {
    const result = spawnSync(file, ['version'], {encoding: 'utf8', windowsHide: true});
    if (result.status === 0 && result.stdout.trim() === '8.30.1') return file;
  }
  throw Error('缺少 Gitleaks 8.30.1。运行 tools/install-gitleaks.ps1，或设置 GITLEAKS 指向该版本。');
}
export function scanDirectory(directory, executable = scanner(), extra = []) {
  runScan(executable, ['dir', directory, ...extra]);
}
function runScan(executable, args) {
  const reports = mkdtempSync(path.join(os.tmpdir(), 'musicvector-scan-report-'));
  const report = path.join(reports, 'report.json');
  const result = spawnSync(executable, [...args, '--config', path.join(root, '.gitleaks.toml'), '--redact', '--no-banner', '--exit-code', '1', '--max-decode-depth', '2', '--report-format', 'json', '--report-path', report], {cwd: root, env: safeGitEnv(root), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024});
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  let locations = '';
  try { locations = JSON.parse(readFileSync(report, 'utf8')).map(x => `${x.File}:${x.StartLine} [${x.RuleID}]`).join('\n'); } catch {}
  rmSync(reports, {recursive: true, force: true});
  // 工具可能在 Git 读取失败时仍退出 0，因此错误日志也必须阻断。
  if (result.error || result.status !== 0 || /\bERR\b|level=error/i.test(output)) throw Error('密钥扫描未通过：\n' + (result.error?.message ?? output) + locations);
  console.log(output.trim());
}
export async function scanFiles(mode = 'worktree', repository = root, executable = scanner()) {
  const staged = mode === 'staged';
  const files = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], repository).split('\0').filter(Boolean);
  const area = await fs.mkdtemp(path.join(os.tmpdir(), 'musicvector-scan-'));
  try {
    for (const rel of new Set(files)) {
      if (sensitivePath(rel)) throw Error('发现不允许提交的私人路径：' + rel);
      const source = path.resolve(repository, rel), destination = path.resolve(area, rel);
      if (!source.startsWith(repository + path.sep) || !destination.startsWith(area + path.sep)) throw Error('文件路径越界');
      await fs.mkdir(path.dirname(destination), {recursive: true});
      if (staged) await fs.writeFile(destination, git(['show', ':' + rel], repository, {encoding: 'buffer'}));
      else {
        const stat = await fs.lstat(source).catch(() => null);
        if (!stat) continue; // 已删除的已跟踪文件。
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('候选文件不是普通文件：' + rel);
        await fs.copyFile(source, destination);
      }
    }
    if (files.length) scanDirectory(area, executable);
    console.log((staged ? '暂存区' : '工作区') + '：已检查 ' + new Set(files).size + ' 个候选文件');
  } finally { await fs.rm(area, {recursive: true, force: true}); }
}
export function scanHistory() {
  if (!Number(git(['rev-list', '--all', '--count']).trim())) throw Error('没有可扫描的提交历史');
  for (const line of git(['rev-list', '--objects', '--all']).split('\n')) {
    const rel = line.slice(line.indexOf(' ') + 1);
    if (line.includes(' ') && sensitivePath(rel)) throw Error('历史中含私人路径：' + rel);
  }
  runScan(scanner(), ['git', root, '--log-opts=--all']);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modes = process.argv.slice(2);
  try {
    if (!modes.length) await scanFiles();
    else if (modes.length === 1 && ['--worktree', '--staged'].includes(modes[0])) await scanFiles(modes[0].slice(2));
    else if (modes.length === 1 && modes[0] === '--history') scanHistory();
    else if (modes.length === 2 && modes[0] === '--directory') scanDirectory(path.resolve(modes[1]), scanner(), ['--max-archive-depth', '2']);
    else throw Error('用法：node tools/security.mjs [--worktree|--staged|--history|--directory <目录>]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
