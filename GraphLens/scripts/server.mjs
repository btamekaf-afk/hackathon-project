import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeAssets } from './write-assets.mjs';
await writeAssets();
const { default: worker } = await import('../src/worker.mjs');
mkdirSync('data',{recursive:true});
const db = new DatabaseSync(process.env.DB_PATH || 'data/graphlens.sqlite');
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(readFileSync(resolve('migrations/0001_initial.sql'),'utf8'));
const DB = { prepare(sql) { let args=[]; const query={ bind(...values){args=values;return query;}, async all(){return {results:db.prepare(sql).all(...args)};}, async first(){return db.prepare(sql).get(...args)||null;}, async run(){return db.prepare(sql).run(...args);} };return query;} };
const portFlag = process.argv.indexOf('--port');
const port=Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT || 3000);
http.createServer(async(req,res)=>{
 try {
  const chunks=[]; let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
  const origin=`http://${req.headers.host||'localhost'}`;
  const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  const response=await worker.fetch(request,{DB,LOCAL:true});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
}).listen(port,'0.0.0.0',()=>console.log(`GraphLens http://localhost:${port}`));
