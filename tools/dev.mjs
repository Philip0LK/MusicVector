// 开发模式：产品服务 + Vite 热更新，改代码即时生效。
//
//   npm run dev                      用仓库内的 data/ 作为曲库
//   npm run dev -- --data <目录>      指定曲库目录（例如你自己的那份）
//   npm run dev -- --port 5180       指定 Vite 端口（被占用时自动往后找）
//   npm run dev -- --no-open         不自动打开浏览器
//
// 原理：产品服务照常跑（曲库、图片、Python 切片、识别、发送到手机都在它那边），
// Vite 只负责前端源码与热更新，并把 /api、/media、/handoff 反向代理给产品服务。
// 产品的接口要求启动令牌，且会校验 Host 与写请求的 Origin，代理统一注入令牌头、
// 改写 Host 并去掉 Origin，因此不需要为开发模式改动任何产品代码。
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function proxyFor(target, token) {
  return {
    target,
    changeOrigin: true, // 让产品的 Host 校验看到它自己的地址
    headers: {'x-yuebeidou-token': token},
    configure(proxy) {
      // 浏览器对写请求会带 Origin（开发端口与产品端口不同），产品会因此拒绝；代理里去掉。
      proxy.on('proxyReq', (request) => request.removeHeader('origin'));
    },
  };
}

async function waitForInstance(file, child, readOutput) {
  for (let i = 0; i < 160; i += 1) {
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text) {
      try {
        const instance = JSON.parse(text);
        // 只认刚起的那个进程写的实例文件：数据目录里可能残留着上一次运行的旧文件，
        // 直接采信它会拿到过期的令牌，于是所有接口都返回 401。
        if (instance.pid === child.pid) return instance;
      } catch {
        // 正在写入，稍后重试
      }
    }
    if (child.exitCode !== null) {
      const existing = await fs.readFile(file, 'utf8').catch(() => null);
      if (existing) throw Error('该数据目录已有实例在运行，请先停止它再启动开发模式：\n' + existing.trim());
      throw Error('产品服务已退出：\n' + readOutput());
    }
    await sleep(250);
  }
  throw Error('等待产品服务启动超时：\n' + readOutput());
}

/** 起一个开发实例；测试脚本也用它。 */
export async function startDev({data = null, port = null, open = true, home = root, quiet = false} = {}) {
  const dataRoot = path.resolve(data ?? path.join(home, 'data'));
  const instanceFile = path.join(dataRoot, '.instance.json');
  const server = path.join(root, 'server/product.mjs');

  let output = '';
  const child = spawn(process.execPath, [server, '--home', home], {
    env: {
      ...process.env,
      YUEBEIDOU_NO_OPEN: '1',
      YUEBEIDOU_NO_USB: '1',
      ...(data ? {YUEBEIDOU_DATA: dataRoot} : {}),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  let vite;
  try {
    const instance = await waitForInstance(instanceFile, child, () => output.trim());
    if (path.resolve(instance.home) !== path.resolve(home)) {
      throw Error(`数据目录 ${dataRoot} 已被另一个实例占用（home=${instance.home}），请先停止它再启动开发模式。`);
    }

    vite = await createServer({
      root,
      configFile: path.join(root, 'vite.config.mjs'),
      server: {
        host: '127.0.0.1',
        port: port ?? 5173,
        strictPort: false, // 端口被占用就让 Vite 往后找，再把真实地址报出来
        proxy: {
          '/api': proxyFor(instance.url, instance.token),
          '/media': proxyFor(instance.url, instance.token),
          '/handoff': proxyFor(instance.url, instance.token),
        },
      },
    });
    await vite.listen();
    const url = vite.resolvedUrls.local[0];

    if (!quiet) {
      console.log('乐北斗 · 开发模式（改代码即时生效）');
      console.log('  界面      ' + url);
      console.log('  本地服务  ' + instance.url + '（曲库：' + dataRoot + '）');
      console.log('  停止      Ctrl+C');
    }
    if (open) {
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {windowsHide: true, detached: true, stdio: 'ignore'}).unref();
    }

    let closed = false;
    return {
      url,
      api: instance.url,
      token: instance.token,
      phonePort: instance.phonePort,
      dataRoot,
      async close() {
        if (closed) return;
        closed = true;
        await vite?.close().catch(() => {});
        await fetch(instance.url + '/api/shutdown', {method: 'POST', headers: {'x-yuebeidou-token': instance.token}}).catch(() => {});
        await sleep(200);
        if (child.exitCode === null) child.kill();
      },
    };
  } catch (error) {
    await vite?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? null : process.argv[i + 1];
  };
  const dev = await startDev({
    data: arg('--data'),
    port: arg('--port') ? Number(arg('--port')) : null,
    open: !process.argv.includes('--no-open'),
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      dev.close().finally(() => process.exit(0));
    });
  }
}
