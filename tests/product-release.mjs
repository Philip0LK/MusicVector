// 便携包验收：把 releases/乐北斗 复制两份，用随包运行环境（PATH 里只剩 System32）真实启动，
// 检查端口自动错开、重复启动不增开实例、接口隔离、空库可直接上传识别、重启后数据保留。
//
//   npm run build && node tools/package.mjs --refresh && npm run test:release
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from '@playwright/test';
import {tinyScorePng} from './helpers/tiny-png.mjs';

const exec = promisify(execFile);
const root = process.cwd();
const area = path.join(root, 'qa', '便携 验收 ' + Date.now());
// 不指定端口：让两份副本都用默认端口并自动往后找，顺带验证端口自动错开。
// （Windows 会把一些端口段保留给系统，写死端口可能直接 EACCES。）
const env = {...process.env, PATH: 'C:\\Windows\\System32', YUEBEIDOU_NO_OPEN: '1', YUEBEIDOU_NO_USB: '1'};
const homes = [];
const infos = [];
let browser;
// 发行包不再提供 .cmd 启动器：按使用说明里的命令行方式启动与停止。
const NODE = 'runtime\\node\\node.exe';
const startCommand = NODE + ' app\\launch.cjs';
const stopCommand = NODE + ' app\\server\\server.mjs --home . --stop';
const runIn = (home, command) => exec('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', command], {cwd: home, env, timeout: 45000, windowsHide: true});

async function api(info, url, method = 'GET', value) {
  const response = await fetch(info.url + url, {
    method,
    headers: {'x-yuebeidou-token': info.token, 'Content-Type': 'application/json'},
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  return {status: response.status, value: await response.json()};
}

try {
  // 同一份发行包复制两份，用来验证两份同时运行时的端口错开与数据隔离。
  for (const name of ['甲', '乙']) {
    const home = path.join(area, '乐北斗 ' + name);
    await fs.cp(path.join(root, 'releases', '乐北斗'), home, {recursive: true});
    homes.push(home);
    // 许可必须真的随包：曾经因为只核对了源码里的许可文件、没人看发行目录，漏检过缺失的许可。
    for (const need of ['licenses/mobile/Apache-2.0.txt', 'licenses/mobile/zxing-android-embedded-COPYING.txt', 'runtime/adb/NOTICE.txt', 'runtime/node/LICENSE', 'runtime/python/LICENSE.txt']) {
      assert.ok(await fs.stat(path.join(home, need)).then(() => true, () => false), '发行包缺少 ' + need);
    }
    const notice = await fs.readFile(path.join(home, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const section of ['随包运行环境', 'Android 应用', 'licenses/mobile']) assert.ok(notice.includes(section), '第三方通告缺少「' + section + '」');
    // 说明书与通告都要求中英两版同时随包，少一版就等于漏发。
    for (const doc of ['使用说明.md', '使用说明.en.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.en.md']) {
      assert.ok(await fs.stat(path.join(home, doc)).then(() => true, () => false), '发行包缺少 ' + doc);
    }
    // 包里不再放任何 .cmd 启动器：启动与停止一律由命令行完成（命令见 使用说明.md）。
    for (const gone of ['启动.cmd', '停止.cmd']) {
      assert.ok(!(await fs.stat(path.join(home, gone)).then(() => true, () => false)), '发行包不该再包含 ' + gone);
    }
    const result = await runIn(home, startCommand);
    const info = JSON.parse(await fs.readFile(path.join(home, 'data/.instance.json'), 'utf8'));
    infos.push(info);
    console.log(name, info.url, result.stdout.trim());
  }
  assert.notEqual(infos[0].url, infos[1].url);
  await runIn(homes[0], startCommand);
  assert.equal(JSON.parse(await fs.readFile(path.join(homes[0], 'data/.instance.json'))).pid, infos[0].pid);
  assert.equal((await api(infos[0], '/api/library')).value.songs.length, 0);
  assert.equal((await api(infos[1], '/api/library')).value.songs.length, 0);
  assert.equal((await fetch(infos[0].url + '/api/library')).status, 401);
  assert.equal((await fetch(infos[0].url + '/api/library', {headers: {origin: 'https://evil.invalid', 'x-yuebeidou-token': infos[0].token}})).status, 403);
  // 局域网端口只开放临时曲目接收，读不到曲库、凭据与管理接口。
  for (const route of ['/api/library', '/api/credentials/describe', '/handoff/info', '/']) {
    assert.equal((await fetch('http://127.0.0.1:' + infos[0].phonePort + route)).status, 403);
  }
  const session = await api(infos[1], '/handoff', 'POST', {manifest: {handoff: 1, song: {title: 'test'}, images: []}, images: []});
  assert.equal(session.status, 200);
  const phoneURL = 'http://127.0.0.1:' + infos[1].phonePort + '/handoff/' + session.value.token;
  assert.equal((await fetch(phoneURL + '/manifest.json')).status, 200);
  assert.equal((await api(infos[1], '/handoff/' + session.value.token, 'DELETE')).status, 200);
  assert.equal((await fetch(phoneURL + '/manifest.json')).status, 404);

  const image = tinyScorePng();
  browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context = await browser.newContext({viewport: {width: 1440, height: 960}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(infos[0].url + '/?launch=' + infos[0].token);
  await page.getByRole('button', {name: '新建歌曲', exact: true}).waitFor();
  assert.equal(await page.title(), '乐北斗');
  assert.equal(await page.evaluate(() => fetch('/api/library').then((r) => r.status)), 200);
  await page.screenshot({path: 'qa/release-empty.png'});
  await page.getByRole('button', {name: '新建歌曲', exact: true}).click();
  await page.getByRole('button', {name: '选择图片', exact: true}).waitFor();
  await page.locator('input[type=file]').setInputFiles({name: '验收乐谱.png', mimeType: 'image/png', buffer: image});
  await page.waitForFunction(async () => {
    const value = await fetch('/api/library').then((r) => r.json());
    return value.songs.some((song) => song.images.length);
  });
  const uploaded = (await api(infos[0], '/api/library')).value;
  assert.equal(uploaded.songs.length, 1);
  assert.ok(uploaded.songs[0].images[0].src.startsWith('/media/'));
  // 随包 Python 切片必须真的执行。
  const slices = await api(infos[0], '/api/score-slices', 'POST', {image: 'data:image/png;base64,' + image.toString('base64')});
  assert.equal(slices.status, 200, JSON.stringify(slices.value));
  const before = await api(infos[0], '/api/library');
  assert.equal((await api(infos[0], '/api/library', 'PUT', {revision: before.value.revision - 1, value: before.value})).status, 409);
  await context.clearCookies();
  await page.goto(infos[0].url + '/?launch=' + infos[0].token);
  await page.getByRole('button', {name: '新建歌曲', exact: true}).waitFor();
  assert.equal((await api(infos[0], '/api/library')).value.songs.length, 1);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(infos[0].url + '/?launch=' + infos[0].token);
  await otherPage.getByRole('button', {name: '新建歌曲', exact: true}).waitFor();
  assert.equal(await otherPage.evaluate(() => fetch('/api/library').then((r) => r.json()).then((v) => v.songs.length)), 1);
  await other.close();
  assert.deepEqual(errors, []);
  await browser.close();
  browser = null;

  for (const home of homes) await runIn(home, stopCommand);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await runIn(homes[0], startCommand);
  infos[0] = JSON.parse(await fs.readFile(path.join(homes[0], 'data/.instance.json')));
  assert.equal((await api(infos[0], '/api/library')).value.songs.length, 1);

  console.log('PASS 中文/空格路径、随包运行环境（PATH 只剩 System32）、端口自动错开、重复启动、接口隔离、空库上传、Python 切片、重启后保留');
  await fs.mkdir('qa', {recursive: true});
  await fs.writeFile('qa/latest-test-home.json', JSON.stringify({area, homes}));
  console.log('测试副本：', area);
} finally {
  if (browser) await browser.close();
  for (const info of infos) await api(info, '/api/shutdown', 'POST').catch(() => {});
}
