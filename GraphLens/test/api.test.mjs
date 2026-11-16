import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';
import { demoSDL } from '../src/demo.mjs';
function fixture() {
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
 const env={LOCAL:true,DB:{prepare(sql){let args=[];const q={bind(...a){args=a;return q;},async all(){return{results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args);},async run(){return db.prepare(sql).run(...args);}};return q;}}};
 const request=(path,body,headers={})=>worker.fetch(new Request(`http://test${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
 return {request,db};
}
test('normal demo entry point creates a durable run and exports CSV',async()=>{
 const {request,db}=fixture();
 const {id}=await (await request('/api/demo',{})).json();
 const result=await (await request(`/api/runs/${id}/coverage`)).json();assert.equal(result.requests,3);assert.equal(result.covered,14);
 const csv=await(await request(`/api/runs/${id}/export?format=csv`)).text();assert.ok(csv.includes('"User","email","String!","0"'));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM executions').get().n,3);db.close();
});
test('run isolation, concurrent writes and event id deduplication',async()=>{
 const {request,db}=fixture();
 const a=await(await request('/api/runs',{name:'a'})).json();const b=await(await request('/api/runs',{name:'b'})).json();
 await Promise.all(Array.from({length:8},()=>request(`/proxy/${a.id}`,{query:'{viewer{id}}'})));
 await request(`/proxy/${a.id}`,{query:'{viewer{email}}'},{'x-coverage-event-id':'one'});
 await request(`/proxy/${a.id}`,{query:'{viewer{email}}'},{'x-coverage-event-id':'one'});
 const ca=await(await request(`/api/runs/${a.id}/coverage`)).json();const cb=await(await request(`/api/runs/${b.id}/coverage`)).json();assert.equal(ca.requests,9);assert.equal(cb.requests,0);db.close();
});
test('real forwarding preserves authorization, payload, upstream status and response',async()=>{
 const {request,db}=fixture();const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({data:{viewer:null},errors:[{message:'denied'}]}),{status:403,headers:{'x-backend':'yes','content-type':'application/json'}});};
 try {
 const run=await(await request('/api/runs',{endpoint:'https://example.test/graphql',sdl:demoSDL})).json();
 const payload={query:'query P($show:Boolean!){viewer{id email @include(if:$show)}}',variables:{show:false},operationName:'P'};
 const response=await request(`/proxy/${run.id}`,payload,{'authorization':'Bearer test','x-coverage-test':'auth-case','cookie':'session=demo'});
 assert.equal(response.status,403);assert.equal(response.headers.get('x-backend'),'yes');assert.equal(captured.options.headers.get('authorization'),'Bearer test');assert.equal(captured.options.headers.get('cookie'),'session=demo');assert.equal(captured.options.headers.get('x-coverage-test'),null);assert.deepEqual(JSON.parse(captured.options.body),payload);
 const report=await(await request(`/api/runs/${run.id}/coverage`)).json();assert.equal(report.covered,2);assert.equal(report.errors,1);
 const logs=await(await request(`/api/runs/${run.id}/executions`)).json();assert.equal(logs[0].test_name,'auth-case');assert.ok(!JSON.stringify(logs).includes('Bearer test'));
 } finally {globalThis.fetch=original;db.close();}
});
test('GET parameters reach upstream and invalid GraphQL is logged without coverage',async()=>{
 const {request,db}=fixture();const run=await(await request('/api/runs',{})).json();
 const response=await request(`/proxy/${run.id}?query=${encodeURIComponent('{viewer{id}}')}`);assert.equal(response.status,200);
 await request(`/proxy/${run.id}`,{query:'{viewer{noSuchField}}'});
 const report=await(await request(`/api/runs/${run.id}/coverage`)).json();assert.equal(report.requests,2);assert.equal(report.covered,2);assert.equal(report.errors,1);db.close();
});
test('GET cannot execute a mutation',async()=>{
 const {request,db}=fixture();const run=await(await request('/api/runs',{})).json();
 const response=await request(`/proxy/${run.id}?query=${encodeURIComponent('mutation {updateProfile(name:"x"){id}}')}`);assert.equal(response.status,405);assert.equal(db.prepare('SELECT COUNT(*) n FROM executions').get().n,0);db.close();
});
