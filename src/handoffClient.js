// 「发送到手机」的浏览器侧：把当前曲目打成一个包，交给本机服务，拿回二维码地址。
import {buildHandoffManifest} from './handoffManifest.js';

async function readJson(response, fallback) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function fetchHandoffInfo() {
  const response = await fetch('/handoff/info');
  if (!response.ok) throw new Error('发送到手机的服务不可用');
  return response.json();
}

// 上传的原谱可能是打包资源，也可能是用户上传后存在本机的 data URL，两种都要能读。
async function toBase64(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error('原谱图片读取失败');
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('原谱图片读取失败'));
    reader.readAsDataURL(blob);
  });
  const text = String(dataUrl);
  return text.slice(text.indexOf(',') + 1);
}

export async function startHandoff({song, document, images, baseTempo}) {
  const manifest = buildHandoffManifest({song, document, images, baseTempo});
  const packed = [];
  for (const image of manifest.images) {
    const source = images[image.index];
    if (!source?.src) throw new Error('第 ' + (image.index + 1) + ' 页原图不存在');
    packed.push({id: image.id, mime: image.mime, base64: await toBase64(source.src)});
  }
  const response = await fetch('/handoff', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({manifest, images: packed}),
  });
  if (!response.ok) {
    const detail = await readJson(response, null);
    throw new Error(detail?.error || '发送失败，请重试');
  }
  const session = await response.json();
  return {...session, manifest};
}

export async function pollHandoff(token) {
  const response = await fetch('/handoff/' + token + '/status');
  if (!response.ok) return null;
  return response.json();
}

export async function releaseHandoff(token) {
  try {
    await fetch('/handoff/' + token, {method: 'DELETE'});
  } catch {
    /* 释放失败只影响二维码寿命，不影响用户操作。 */
  }
}
