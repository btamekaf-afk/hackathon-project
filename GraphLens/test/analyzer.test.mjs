import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, coverage } from '../src/analyzer.mjs';
import { demoSDL, scenarios } from '../src/demo.mjs';
const fields = payload => analyze(demoSDL,payload).fields?.sort();
test('aliases and repeated fields count canonical field once',()=>assert.deepEqual(fields({query:'{ a: viewer { name } b: viewer { name } }'}),['Query.viewer','User.name']));
test('named and inline fragments map to schema types',()=>assert.deepEqual(fields({query:'{ viewer { ...U ... on User { email } } } fragment U on User { id }'}),['Query.viewer','User.email','User.id']));
test('directives honor variable defaults and supplied values',()=>{
 const query='query T($show:Boolean! = false){viewer { id email @include(if:$show) name @skip(if:true) }}';
 assert.deepEqual(fields({query}),['Query.viewer','User.id']);
 assert.deepEqual(fields({query,variables:{show:true}}),['Query.viewer','User.email','User.id']);
});
test('directives apply to entire fragment branches',()=>assert.deepEqual(fields({query:'{viewer{ id ...E @skip(if:true) }} fragment E on User {email}'}),['Query.viewer','User.id']));
test('only selected operation contributes coverage',()=>assert.deepEqual(fields({query:'query A {viewer{id}} query B {products{name}}',operationName:'B'}),['Product.name','Query.products']));
test('ambiguous operation rejected',()=>assert.ok(analyze(demoSDL,{query:'query A {viewer{id}} query B {products{name}}'}).error));
test('invalid fields and invalid variables never contribute',()=>{
 assert.ok(analyze(demoSDL,{query:'{viewer{missing}}'}).error);
 assert.ok(analyze(demoSDL,{query:'query T($id:ID!){product(id:$id){id}}'}).error);
 assert.ok(analyze(demoSDL,{query:'{'}).error);
});
test('introspection fields excluded',()=>assert.deepEqual(fields({query:'{__typename viewer{__typename id}}'}),['Query.viewer','User.id']));
test('nested fields, arguments, operation and depth recorded',()=>{
 const result=analyze(demoSDL,scenarios[5]);assert.equal(result.operation,'mutation');assert.equal(result.depth,4);assert.ok(result.arguments.includes('Mutation.addToCart(productId)'));assert.ok(result.paths.some(p=>p.endsWith('Product.name')));
});
test('interface and union fragments retain declared type semantics',()=>{
 const sdl='interface Node {id:ID!} type User implements Node {id:ID! name:String} type Team implements Node {id:ID! title:String} union Search=User|Team type Query {node:Node search:Search}';
 const result=analyze(sdl,{query:'{node{id ... on User {name}} search{... on Team{title}}}'});
 assert.deepEqual(result.fields.sort(),['Node.id','Query.node','Query.search','Team.title','User.name']);
 assert.equal(coverage(sdl,[{analysis:result}]).total,7);
});
test('fragments cycles are validation errors',()=>assert.ok(analyze(demoSDL,{query:'{viewer{...A}} fragment A on User {...A}'}).error));
test('baseline and expanded coverage preserve the same denominator',()=>{
 const base=coverage(demoSDL,scenarios.slice(0,3).map(s=>({analysis:analyze(demoSDL,s),test_name:s.test})));
 const full=coverage(demoSDL,scenarios.map(s=>({analysis:analyze(demoSDL,s),test_name:s.test})));
 assert.equal(base.total,30);assert.equal(base.covered,14);assert.equal(full.covered,27);assert.equal(full.percent,90);
 assert.deepEqual(base.types.find(t=>t.name==='User').fields.find(f=>f.name==='id').tests,['profile.spec / basic']);
});
