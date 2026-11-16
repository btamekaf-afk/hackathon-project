import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { writeAssets } from './write-assets.mjs';
await writeAssets();
await build({entryPoints:['src/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false});
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
