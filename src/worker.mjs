import { buildSchema, buildClientSchema, printSchema, getIntrospectionQuery } from 'graphql';
import { analyze, coverage } from './analyzer.mjs';
import { demoSDL, demoExecute, scenarios } from './demo.mjs';
import { assets } from './assets.mjs';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const rows = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).all()).results;
const one = async (db, sql, ...params) => db.prepare(sql).bind(...params).first();
const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');

async function createRun(env, input) {
  let endpoint = input.endpoint || 'demo';
  if (endpoint !== 'demo') {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Укажите HTTP(S) endpoint без логина и пароля в URL.');
    endpoint = url.href;
  }
  let sdl = input.sdl || (endpoint === 'demo' ? demoSDL : null);
  if (!sdl) {
    const headers = new Headers(input.headers || {});
    headers.set('content-type', 'application/json');
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: getIntrospectionQuery() }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Introspection вернул HTTP ${response.status}`);
    const result = await response.json();
    if (!result.data?.__schema) throw new Error(result.errors?.[0]?.message || 'Introspection недоступен. Загрузите SDL.');
    sdl = printSchema(buildClientSchema(result.data));
  }
  sdl = printSchema(buildSchema(sdl));
  const run = { id: crypto.randomUUID(), name: String(input.name || 'Новый прогон').slice(0,120), branch: String(input.branch || 'main').slice(0,100), environment: String(input.environment || 'demo').slice(0,100), endpoint, schema_sdl: sdl, schema_hash: await sha(sdl), created_at: new Date().toISOString() };
  await env.DB.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...Object.values(run)).run();
  return run;
}

async function proxy(env, run, request, payload) {
  const started = Date.now();
  const analysis = analyze(run.schema_sdl, payload);
  const event = request.headers.get('x-coverage-event-id');
  const id = event ? await sha(`${run.id}:${event}`) : crypto.randomUUID();
  let response;
  let graphqlErrors = 0;
  try {
    if (run.endpoint === 'demo') {
      const result = await demoExecute(payload);
      graphqlErrors = result.errors?.length || 0;
      response = json(result);
    } else {
      const headers = new Headers(request.headers);
      for (const key of [...headers.keys()]) {
        if (['host', 'connection', 'content-length', 'accept-encoding', 'cookie'].includes(key) || key.startsWith('x-coverage-') || key.startsWith('cf-')) headers.delete(key);
      }
      headers.set('content-type', 'application/json');
      // Cookies are forwarded only by the local adapter, where there is no hosting sign-in cookie.
      if (env.LOCAL && request.headers.has('cookie')) headers.set('cookie', request.headers.get('cookie'));
      response = await fetch(run.endpoint, { method: request.method, headers, body: request.method === 'GET' ? undefined : JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(30000) });
      try { graphqlErrors = (await response.clone().json()).errors?.length || 0; } catch { /* Non-JSON upstream responses are returned unchanged. */ }
    }
  } catch (error) { response = json({ errors: [{ message: `API недоступен. ${error.message}` }] }, 502); }
  const duration = Date.now() - started;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, run.id, (request.headers.get('x-coverage-test') || '').slice(0,200), analysis.operation || null, analysis.name || null, payload.query || '', JSON.stringify(analysis), response.status, duration, new Date().toISOString(), graphqlErrors).run();
  } catch (error) {
    console.error('Coverage write failed', error.message);
    const failedHeaders = new Headers(response.headers); failedHeaders.delete('content-length'); failedHeaders.delete('content-encoding'); failedHeaders.set('x-coverage-status', 'storage-error');
    return new Response(response.body, { status: response.status, headers: failedHeaders });
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('x-coverage-status', analysis.error ? 'analysis-error' : 'recorded');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (assets[url.pathname] && request.method === 'GET') return new Response(assets[url.pathname].body, { headers: { 'content-type': assets[url.pathname].type } });
      if (url.pathname === '/api/health') return json({ status: 'ok', version: '1.0.0' });
      if (request.headers.get('content-length') > 1_048_576) return json({ error: 'Максимальный размер запроса 1 МБ.' }, 413);
      if (url.pathname === '/demo/graphql') return json(await demoExecute(await request.json()));
      if (url.pathname === '/api/runs' && request.method === 'GET') {
        return json(await rows(env.DB, 'SELECT id,name,branch,environment,endpoint,schema_hash,created_at FROM runs ORDER BY created_at DESC'));
      }
      if (url.pathname === '/api/runs' && request.method === 'POST') return json(await createRun(env, await request.json()), 201);
      if (url.pathname === '/api/demo' && request.method === 'POST') {
        const { extended = false } = await request.json();
        const run = await createRun(env, { name: extended ? 'Расширенный набор тестов' : 'Базовый набор тестов', branch: extended ? 'feature/coverage' : 'main', environment: 'demo' });
        for (const scenario of scenarios.slice(0, extended ? 6 : 3)) {
          await proxy(env, run, new Request(request.url, { method: 'POST', headers: { 'x-coverage-test': scenario.test } }), { query: scenario.query, variables: scenario.variables });
        }
        return json({ id: run.id }, 201);
      }
      const match = url.pathname.match(/^\/(api\/runs|proxy)\/([^/]+)(?:\/(coverage|executions|export))?$/);
      if (match) {
        const run = await one(env.DB, 'SELECT * FROM runs WHERE id = ?', match[2]);
        if (!run) return json({ error: 'Прогон не найден.' }, 404);
        if (match[1] === 'proxy') {
          if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Используйте GET или POST.' }, 405);
          const payload = request.method === 'POST' ? await request.json() : { query: url.searchParams.get('query'), operationName: url.searchParams.get('operationName'), variables: JSON.parse(url.searchParams.get('variables') || '{}') };
          if (Array.isArray(payload)) return json({ error: 'Пакетные запросы находятся за пределами MVP.' }, 400);
          if (typeof payload.query !== 'string') return json({ error: 'Ожидается поле query.' }, 400);
          if (request.method === 'GET' && analyze(run.schema_sdl, payload).operation === 'mutation') return json({ error: 'Mutation требует POST.' }, 405);
          // External GET is translated into POST with the same GraphQL payload.
          const forwarded = new Request(request.url, { method: 'POST', headers: request.headers });
          return proxy(env, run, forwarded, payload);
        }
        const executions = await rows(env.DB, 'SELECT * FROM executions WHERE run_id = ? ORDER BY created_at DESC, rowid DESC', run.id);
        if (match[3] === 'executions') return json(executions.slice(0, 200).map(e => ({ ...e, analysis: JSON.parse(e.analysis) })));
        const result = { run, ...coverage(run.schema_sdl, executions), errors: executions.filter(e => e.status >= 400 || e.graphql_errors > 0 || JSON.parse(e.analysis).error).length };
        if (match[3] === 'export') {
          if (url.searchParams.get('format') === 'csv') {
            const cell = value => '"' + String(value).replaceAll('"', '""') + '"';
            const csv = ['type,field,return_type,hits,tests', ...result.types.flatMap(t => t.fields.map(f => [t.name,f.name,f.type,f.hits,f.tests.join(' | ')].map(cell).join(',')))].join('\r\n');
            return new Response('\uFEFF' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="graphlens-coverage.csv"' } });
          }
          return new Response(JSON.stringify(result,null,2), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="graphlens-coverage.json"' } });
        }
        return json(result);
      }
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) { return json({ error: error.message }, 400); }
  }
};
