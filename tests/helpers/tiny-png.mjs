// 生成一张带横向"谱线"的灰度 PNG，供上传、切片与识别链路的测试使用。
// 测试不依赖任何真实曲谱图片，公开仓库里也能完整跑通。
import {deflateSync} from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** 白底 + 等间距黑线的 RGB PNG。 */
export function tinyScorePng({width = 800, height = 1000, lineGap = 110} = {}) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 3 + 1);
    raw[offset] = 0; // 每行的过滤器字节
    const dark = y % lineGap < 3;
    for (let x = 0; x < width; x += 1) {
      const value = dark ? 0 : 255;
      raw[offset + 1 + x * 3] = value;
      raw[offset + 2 + x * 3] = value;
      raw[offset + 3 + x * 3] = value;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型：真彩色
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
