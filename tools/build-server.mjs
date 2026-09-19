import {fileURLToPath} from 'node:url';process.chdir(fileURLToPath(new URL('..',import.meta.url)));
import {build} from 'esbuild';
await build({entryPoints:['server/product.mjs'],bundle:true,platform:'node',format:'esm',outfile:'build/server.mjs',packages:'bundle',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},external:[]});

