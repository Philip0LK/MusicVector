// 生成安卓端的金标准 fixture：android/app/src/test/resources/fixtures/。
//
// 期望值来自 tests/fixtures/mobile-fixture-data.mjs——它内部调用电脑端正在使用的算法。
// 改了电脑端的播放/排版算法后必须重跑本脚本，否则 tests/handoff.test.mjs 与安卓端单测都会报错：
//
//   node tools/mobile-fixtures.mjs
//
// 个人曲谱夹具只在本机 local/fixtures 下；没有它时只写合成曲夹具，安卓端会跳过对应断言。
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAllFixtures} from '../tests/fixtures/mobile-fixture-data.mjs';

const OUT_DIR = fileURLToPath(new URL('../android/app/src/test/resources/fixtures/', import.meta.url));

const fixtures = await buildAllFixtures();
await mkdir(OUT_DIR, {recursive: true});
await writeFile(join(OUT_DIR, 'synthetic.json'), JSON.stringify(fixtures.synthetic, null, 1), 'utf8');
await writeFile(join(OUT_DIR, 'meta.json'), JSON.stringify(fixtures.meta, null, 1), 'utf8');
if (fixtures.salon) {
  await writeFile(join(OUT_DIR, 'salon.json'), JSON.stringify(fixtures.salon, null, 1), 'utf8');
  console.log('已写入 synthetic.json、meta.json、salon.json（本机含个人夹具）');
} else {
  console.log('已写入 synthetic.json、meta.json（未找到 local/fixtures，跳过个人曲谱夹具）');
}
console.log('输出目录：' + OUT_DIR);
console.log(JSON.stringify(fixtures.meta.performance));
