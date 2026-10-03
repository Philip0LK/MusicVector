import {fileURLToPath} from 'node:url';process.chdir(fileURLToPath(new URL('..',import.meta.url)));
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {buildProvenance} from './release-support.mjs';
await build({entryPoints:['server/product.mjs'],bundle:true,platform:'node',format:'esm',outfile:'build/server.mjs',packages:'bundle',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},external:[]});
// 开发构建可带未提交改动；发行组包必须有干净提交的构建证明。
await fs.rm('build/provenance.json', {force:true});
try { await fs.writeFile('build/provenance.json', JSON.stringify(await buildProvenance(process.cwd()), null, 2)); }
catch (error) { console.log('开发构建完成，未生成发行证明：' + error.message); }
