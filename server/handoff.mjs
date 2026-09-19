// 「发送到手机」的局域网临时服务。
//
// 为什么需要服务端：一首曲子的原谱图片约 1.6 MB，二维码单码上限约 2.9 KB，
// 物理上塞不进去。二维码只承载地址，手机在同 Wi-Fi 下把曲目包拉走。
//
// 安全边界：token 不可猜、10 分钟后过期、用完即释放，但局域网内拿到该地址的人
// 都能取走这一首曲谱。只适用于家庭/教室 Wi-Fi，不做身份认证。
import {randomUUID} from 'node:crypto';
import {networkInterfaces} from 'node:os';

export const HANDOFF_TTL = 10 * 60 * 1000;
export const HANDOFF_MAX_BYTES = 64 * 1024 * 1024;
export const HANDOFF_MAX_SESSIONS = 4;

export function privateAddresses() {
  const list = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      list.push({name, address: entry.address});
    }
  }
  const rank = (address) =>
    address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : 3;
  return list.sort((a, b) => rank(a.address) - rank(b.address) || a.address.localeCompare(b.address));
}

export function createHandoffStore({ttl = HANDOFF_TTL, maxBytes = HANDOFF_MAX_BYTES, maxSessions = HANDOFF_MAX_SESSIONS, now = Date.now} = {}) {
  const sessions = new Map();
  const prune = () => {
    const stamp = now();
    for (const [token, session] of sessions) if (session.expiresAt <= stamp) sessions.delete(token);
  };
  return {
    maxBytes,
    prune,
    create(manifest, images) {
      prune();
      const serialized = JSON.stringify(manifest);
      const session = {
        token: randomUUID().replace(/-/g, '').slice(0, 16),
        manifest,
        manifestBytes: Buffer.byteLength(serialized, 'utf8'),
        images,
        createdAt: now(),
        expiresAt: now() + ttl,
        served: new Set(),
      };
      sessions.set(session.token, session);
      while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
      return session;
    },
    get(token) {
      prune();
      return sessions.get(token) || null;
    },
    drop(token) {
      sessions.delete(token);
    },
    markServed(session, index) {
      session.served.add(index);
    },
    size() {
      return sessions.size;
    },
  };
}

function sessionStatus(session) {
  return {
    imagesTotal: session.images.length,
    imagesServed: session.served.size,
    completed: session.served.size >= session.images.length,
    expiresAt: session.expiresAt,
  };
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  res.end(payload);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createHandoffHandler({store = createHandoffStore(), lanBound = false, addresses = () => privateAddresses()} = {}) {
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (!pathname.startsWith('/handoff')) return false;
    if (!sameOrigin(req)) {
      send(res, 403, {error: '仅允许本机页面调用'});
      return true;
    }
    const port = Number((req.headers.host || '').split(':')[1]) || 80;

    if (req.method === 'GET' && pathname === '/handoff/info') {
      const list = addresses();
      const bound = typeof lanBound === 'function' ? lanBound() : Boolean(lanBound);
      send(res, 200, {
        lanBound: Boolean(bound),
        port,
        addresses: list,
        preferred: list[0]?.address || null,
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/handoff') {
      let body;
      try {
        body = await readBody(req, store.maxBytes);
      } catch (error) {
        send(res, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, {error: '曲目包过大或读取失败'});
        return true;
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        send(res, 400, {error: '曲目包格式错误'});
        return true;
      }
      if (payload?.manifest?.handoff !== 1 || !Array.isArray(payload?.images)) {
        send(res, 400, {error: '曲目包版本不受支持'});
        return true;
      }
      if (payload.images.length !== (payload.manifest.images || []).length) {
        send(res, 400, {error: '曲目包图片数量不一致'});
        return true;
      }
      const images = payload.images.map((image, index) => ({
        index,
        id: String(image?.id ?? index),
        mime: typeof image?.mime === 'string' && image.mime.startsWith('image/') ? image.mime : 'image/jpeg',
        buffer: Buffer.from(String(image?.base64 || ''), 'base64'),
      }));
      if (images.some((image) => !image.buffer.length)) {
        send(res, 400, {error: '曲目包图片为空'});
        return true;
      }
      const session = store.create(payload.manifest, images);
      const preferred = addresses()[0]?.address || null;
      send(res, 200, {
        token: session.token,
        port,
        addresses: addresses().map((entry) => entry.address),
        preferred,
        url: preferred ? `http://${preferred}:${port}/handoff/${session.token}` : null,
        expiresAt: session.expiresAt,
      });
      return true;
    }

    const match = /^\/handoff\/([^/]+)\/(manifest\.json|images\/(\d+)\.[a-z]+|status)$/.exec(pathname);
    if (req.method === 'DELETE' && /^\/handoff\/[^/]+$/.test(pathname)) {
      store.drop(pathname.split('/').at(-1));
      send(res, 200, {released: true});
      return true;
    }
    if (req.method !== 'GET' || !match) {
      send(res, 404, {error: 'not found'});
      return true;
    }
    const session = store.get(match[1]);
    if (!session) {
      send(res, 404, {error: '二维码已过期，请重新生成'});
      return true;
    }
    if (match[2] === 'status') {
      send(res, 200, sessionStatus(session));
      return true;
    }
    if (match[2] === 'manifest.json') {
      send(res, 200, session.manifest);
      return true;
    }
    const index = Number(match[3]);
    const image = session.images.find((item) => item.index === index);
    if (!image) {
      send(res, 404, {error: '曲目包缺少这一页图片'});
      return true;
    }
    store.markServed(session, index);
    res.writeHead(200, {
      'Content-Type': image.mime,
      'Content-Length': image.buffer.length,
      'Cache-Control': 'no-store',
    });
    res.end(image.buffer);
    return true;
  };
}

export function handoffMiddleware(options = {}) {
  const handle = createHandoffHandler(options);
  return async (req, res, next) => {
    try {
      if (await handle(req, res)) return;
    } catch {
      if (!res.headersSent) send(res, 500, {error: '发送到手机的服务出错'});
      return;
    }
    next();
  };
}

export function handoffPlugin(options = {}) {
  // 是否对局域网开放要看真实监听地址，不能看配置里的 host：Vite 会把 CLI 参数
  // 合并进 config，但只有 httpServer.address() 才是权威结果。
  let configuredHost;
  const lanBound = (server) => () => {
    const address = server.httpServer?.address?.();
    const value = typeof address === 'object' && address ? address.address : '';
    return [value, configuredHost].some((item) => item === '0.0.0.0' || item === '::' || item === '' || item === true);
  };
  const attach = (server) => {
    server.middlewares.use(handoffMiddleware({...options, lanBound: lanBound(server)}));
  };
  return {
    name: 'yuebeidou-handoff',
    configResolved(config) {
      configuredHost = config.server?.host;
    },
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
