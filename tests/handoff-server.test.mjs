// 「发送到手机」服务端契约测试：路由、体积上限、过期、并发上限与同源限制。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  HANDOFF_MAX_BYTES,
  createHandoffHandler,
  createHandoffStore,
  privateAddresses,
} from '../server/handoff.mjs';

const IMAGE_PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function manifestFixture() {
  return {
    handoff: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    song: {id: 'x', title: '测试曲', key: 'C', octave: 4, bpm: 80, meter: {beats: 4, beatUnit: 4}, pickup: false},
    notes: [],
    rows: [],
    measures: [],
    images: [
      {index: 0, id: 'img-0', name: 'a.png', mime: 'image/png', path: 'images/0.png'},
      {index: 1, id: 'img-1', name: 'b.png', mime: 'image/png', path: 'images/1.png'},
    ],
    totals: {notes: 0, rows: 0, measures: 0, missingDurations: 0, differentPitchTies: 0},
  };
}

function payload(patch = {}) {
  const manifest = patch.manifest || manifestFixture();
  return JSON.stringify({
    manifest,
    images: manifest.images.map((image) => ({
      id: image.id,
      mime: image.mime,
      base64: IMAGE_PNG.toString('base64'),
    })),
    ...patch.extra,
  });
}

async function withServer(handlerOptions, run) {
  const handle = createHandoffHandler(handlerOptions);
  const server = http.createServer((req, res) => {
    handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = async (method, path, {body, headers = {}, host = `127.0.0.1:${port}`} = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      body,
      headers: {...headers, ...(host ? {host} : {})},
      redirect: 'error',
    });
    const type = response.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return {status: response.status, value, headers: response.headers};
  };
  try {
    await run({request, port});
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('只列出对局域网可见的 IPv4 地址', () => {
  for (const entry of privateAddresses()) {
    assert.match(entry.address, /^\d+\.\d+\.\d+\.\d+$/);
    assert.ok(!entry.address.startsWith('127.'));
  }
});

test('token 到期后立即失效，且最多保留 4 个会话', () => {
  let stamp = 1_000_000;
  const store = createHandoffStore({ttl: 1000, maxSessions: 4, now: () => stamp});
  const manifest = manifestFixture();
  const tokens = [];
  for (let i = 0; i < 5; i += 1) tokens.push(store.create(manifest, []).token);
  assert.equal(store.size(), 4);
  assert.equal(store.get(tokens[0]), null, '最早的会话应被挤掉');
  assert.ok(store.get(tokens[4]));
  stamp += 1001;
  assert.equal(store.get(tokens[4]), null, '过期后必须失效');
});

test('上传后可取回 manifest、图片与状态，未知 token 返回 404', async () => {
  await withServer({lanBound: true, addresses: () => [{name: 'wifi', address: '192.168.1.9'}]}, async ({request}) => {
    const info = await request('GET', '/handoff/info');
    assert.equal(info.status, 200);
    assert.equal(info.value.lanBound, true);
    assert.deepEqual(info.value.addresses, [{name: 'wifi', address: '192.168.1.9'}]);
    assert.equal(info.value.preferred, '192.168.1.9');
    assert.ok(info.value.port > 0);

    const upload = await request('POST', '/handoff', {
      body: payload(),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(upload.status, 200);
    const {token, url} = upload.value;
    assert.match(token, /^[0-9a-f]{16}$/);
    assert.match(url, /^http:\/\/192\.168\.1\.9:\d+\/handoff\/[0-9a-f]{16}$/);

    const manifest = await request('GET', `/handoff/${token}/manifest.json`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.value.song.title, '测试曲');
    assert.equal(manifest.value.images.length, 2);

    const before = await request('GET', `/handoff/${token}/status`);
    assert.deepEqual(
      {total: before.value.imagesTotal, served: before.value.imagesServed, done: before.value.completed},
      {total: 2, served: 0, done: false},
    );

    const image = await request('GET', `/handoff/${token}/images/0.png`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(image.value, IMAGE_PNG);

    const after = await request('GET', `/handoff/${token}/status`);
    assert.equal(after.value.imagesServed, 1);
    assert.equal(after.value.completed, false);
    await request('GET', `/handoff/${token}/images/1.png`);
    const done = await request('GET', `/handoff/${token}/status`);
    assert.equal(done.value.completed, true);

    const missing = await request('GET', '/handoff/deadbeefdeadbeef/manifest.json');
    assert.equal(missing.status, 404);
    assert.match(missing.value.error, /过期/);

    // 面板关闭即释放：避免二维码在过期前继续可被取走。
    const released = await request('DELETE', `/handoff/${token}`);
    assert.equal(released.status, 200);
    const gone = await request('GET', `/handoff/${token}/manifest.json`);
    assert.equal(gone.status, 404);
  });
});

test('拒绝超体积、图片数量不符与跨站上传', async () => {
  await withServer({lanBound: false, addresses: () => []}, async ({request}) => {
    const tooBig = await request('POST', '/handoff', {
      body: 'x'.repeat(HANDOFF_MAX_BYTES + 16),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(tooBig.status, 413);

    const mismatched = await request('POST', '/handoff', {
      body: payload({extra: {images: []}}),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(mismatched.status, 400);

    const badVersion = await request('POST', '/handoff', {
      body: JSON.stringify({manifest: {...manifestFixture(), handoff: 2}, images: []}),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(badVersion.status, 400);

    const crossSite = await request('POST', '/handoff', {
      body: payload(),
      headers: {'content-type': 'application/json', origin: 'http://evil.example'},
    });
    assert.equal(crossSite.status, 403);

    const notJson = await request('POST', '/handoff', {
      body: 'not json',
      headers: {'content-type': 'application/json'},
    });
    assert.equal(notJson.status, 400);
  });
});

test('未绑到局域网时 info 明确告知，前端据此提示改用 dev:phone', async () => {
  await withServer({lanBound: false, addresses: () => []}, async ({request}) => {
    const info = await request('GET', '/handoff/info');
    assert.equal(info.value.lanBound, false);
    assert.equal(info.value.preferred, null);
  });
});
