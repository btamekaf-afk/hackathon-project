import { readFile, writeFile } from 'node:fs/promises';
export async function writeAssets(){
 const files=[['/','index.html','text/html; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8'],['/app.js','app.js','application/javascript; charset=utf-8']];
 const assets={};for(const [url,file,type] of files)assets[url]={body:await readFile(new URL(`../public/${file}`,import.meta.url),'utf8'),type};
 await writeFile(new URL('../src/assets.mjs',import.meta.url),`export const assets = ${JSON.stringify(assets)};\n`);
}
