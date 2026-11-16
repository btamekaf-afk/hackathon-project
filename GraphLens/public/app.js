const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
let runs = [], current = null, executions = [], view = 'graph', onlyUncovered = false, history = [], selectedComparison = [];
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.errors?.[0]?.message || `HTTP ${response.status}`);
  return data;
}
function notify(message) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#notice').hidden = true, 6000); }
async function action(button, task) { button.disabled = true; try { await task(); } catch (error) { notify(error.message); } finally { button.disabled = false; } }
function page(name) {
  document.querySelectorAll('.page').forEach(element => element.hidden = element.id !== `${name}-page`);
  document.querySelectorAll('.nav').forEach(element => element.classList.toggle('active', element.dataset.page === name));
  $('#breadcrumb').textContent = document.querySelector(`[data-page="${name}"]`).textContent.trim().slice(1).trim();
  if (name === 'history') loadHistory().catch(error => notify(error.message));
  if (name === 'coverage') requestAnimationFrame(drawEdges);
}
function date(value) { return new Intl.DateTimeFormat('ru', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(value)); }
async function loadRuns(id) {
  runs = await api('/api/runs');
  $('#run-select').innerHTML = runs.map(run => `<option value="${escape(run.id)}">${escape(run.name)}</option>`).join('');
  if (runs.length) await selectRun(id || current?.run.id || runs[0].id);
}
async function selectRun(id) {
  [current, executions] = await Promise.all([api(`/api/runs/${id}/coverage`), api(`/api/runs/${id}/executions`)]);
  $('#run-select').value = id;
  $('#m-percent').textContent = current.percent;
  $('#m-fields').textContent = current.covered;
  $('#m-total').textContent = `/ ${current.total}`;
  $('#m-types').textContent = current.coveredTypes;
  $('#m-types-total').textContent = `/ ${current.totalTypes}`;
  $('#m-requests').textContent = current.requests;
  $('#m-errors').textContent = current.errors ? `${current.errors} с ошибками` : 'Без ошибок';
  $('#coverage-meter').style.width = `${current.percent}%`;
  $('#field-count').textContent = current.total;
  $('#run-meta').textContent = `${current.run.branch} · ${current.run.environment} · ${date(current.run.created_at)}`;
  $('#schema-label').textContent = `schema ${current.run.schema_hash.slice(0,8)}`;
  $('#export').href = `/api/runs/${id}/export?format=csv`;
  $('#demo-expand').hidden = current.run.endpoint !== 'demo';
  const gaps = current.types.flatMap(t => t.fields).filter(f => !f.hits);
  $('#insight-title').textContent = gaps.length ? `Остались незапрошенные поля (${gaps.length})` : 'Все поля схемы были запрошены';
  $('#insight-text').textContent = gaps.length ? `${gaps.slice(0,3).map(f => f.key).join(', ')}${gaps.length > 3 ? ' и другие.' : '.'}` : 'Проверьте качество assertions в ваших тестовых сценариях.';
  document.querySelectorAll('.context-run').forEach(element => element.textContent = `${current.run.name} · ${current.run.environment}`);
  $('#proxy-address').textContent = `${location.origin}/proxy/${id}`;
  render();
}
function switchView(next) {
  view = next;
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === next));
  document.querySelectorAll('.view').forEach(element => element.hidden = element.id !== `${next}-view`);
  $('.legend').hidden = next !== 'graph';
  render();
}
function matches(type, field) { const term = $('#search').value.toLowerCase(); return `${type.name} ${field?.name || ''}`.toLowerCase().includes(term) && (!onlyUncovered || (field ? !field.hits : type.covered < type.total)); }
function render() { if (!current) return; renderGraph(); renderFields(); renderRequests(); }
function renderGraph() {
  const types = current.types.filter(t => t.total);
  const roots = types.filter(t => ['Query','Mutation'].includes(t.name));
  const rest = types.filter(t => !roots.includes(t));
  const columns = [roots.length ? roots : rest.splice(0, Math.ceil(types.length / 3)), rest.filter((_,i) => i % 2 === 0), rest.filter((_,i) => i % 2 === 1)];
  const height = Math.max(620, ...columns.map(column => column.length * 235 + 35));
  $('#graph').style.height = `${height}px`;
  const width = Math.max($('#graph').clientWidth,940);
  $('#nodes').innerHTML = columns.flatMap((column,c) => column.map((type,r) => {
    const x = 36 + c * (width - 290) / 2;
    const y = 28 + r * 235 + (c === 0 ? 70 : 0);
    const dim = !type.fields.some(field => matches(type, field));
    return `<button class="node ${type.percent===100?'full':type.percent===0?'empty':''} ${dim?'dim':''}" data-type="${escape(type.name)}" style="left:${x}px;top:${y}px" aria-label="${escape(type.name)}, покрытие ${type.percent}%"><div class="node-title"><span class="node-symbol">${roots.includes(type)?'↳':'T'}</span><strong>${escape(type.name)}</strong><span class="node-percent">${type.percent}%</span></div><div class="node-fields">${type.fields.slice(0,4).map(field => `<div class="node-field ${field.hits?'hit':''}"><i></i><span>${escape(field.name)}</span><span>${escape(field.type)}</span></div>`).join('')}</div><span class="node-more">${type.fields.length>4?`Всего полей ${type.fields.length}`:`${type.covered} из ${type.total} полей`}</span></button>`;
  })).join('');
  document.querySelectorAll('.node').forEach(node => node.addEventListener('click', () => detailType(node.dataset.type)));
  requestAnimationFrame(drawEdges);
}
function drawEdges() {
  if (!current || $('#coverage-page').hidden || view !== 'graph') return;
  const canvas = $('#edges'), ratio = window.devicePixelRatio || 1;
  const width = $('#graph').clientWidth, height = $('#graph').clientHeight;
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio,ratio); ctx.clearRect(0,0,width,height);
  const nodes = new Map([...document.querySelectorAll('.node')].map(node => [node.dataset.type,node]));
  const drawn = new Set();
  for (const type of current.types) {
    const source = nodes.get(type.name); if (!source) continue;
    for (const field of type.fields) {
      const target = nodes.get(field.target), key = `${type.name}:${field.target}`;
      if (!target || target === source || drawn.has(key)) continue;
      drawn.add(key);
      let x1 = source.offsetLeft + source.offsetWidth, y1 = source.offsetTop + 25;
      let x2 = target.offsetLeft, y2 = target.offsetTop + 25;
      if (x1 > x2) { x1 = source.offsetLeft; x2 = target.offsetLeft + target.offsetWidth; }
      ctx.beginPath(); ctx.strokeStyle = source.classList.contains('dim') || target.classList.contains('dim') ? '#e9eee5' : '#cbd7c1'; ctx.lineWidth = 1.2;
      const bend = (x1+x2)/2;
      ctx.moveTo(x1,y1); ctx.bezierCurveTo(bend,y1,bend,y2,x2,y2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x2,y2,3,0,Math.PI*2); ctx.fillStyle='#bacbac'; ctx.fill();
    }
  }
}
function fieldTable(fields) { return `<div class="table-wrap"><table><thead><tr><th>Поле схемы</th><th>Тип ответа</th><th>Запросы</th><th>Тестовые сценарии</th></tr></thead><tbody>${fields.map(field=>`<tr><td><code>${escape(field.key)}</code></td><td><code>${escape(field.type)}</code></td><td><span class="pill ${field.hits?'':'zero'}">${field.hits}</span></td><td>${field.tests.length?field.tests.map(escape).join('<br>'):'<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>${fields.length?'':'<div class="empty-message">По этим фильтрам полей нет.</div>'}</div>`; }
function renderFields() { $('#fields-view').innerHTML = fieldTable(current.types.flatMap(type => type.fields.filter(field => matches(type,field)))); }
function renderRequests() {
  const term = $('#search').value.toLowerCase();
  const filtered = executions.filter(e=>`${e.operation_name} ${e.test_name} ${e.query_text}`.toLowerCase().includes(term) && (!onlyUncovered || e.analysis.error));
  $('#requests-view').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Операция</th><th>Сценарий</th><th>Поля</th><th>HTTP</th><th>Время</th><th></th></tr></thead><tbody>${filtered.map(e=>`<tr><td><code>${escape(e.operation_name || 'Ошибка анализа')}</code><br><small class="muted">${escape(e.operation||'')}</small></td><td>${escape(e.test_name||'Без метки')}</td><td>${e.analysis.fields?.length||0}</td><td>${e.status}${e.graphql_errors?' · GraphQL error':''}</td><td>${e.duration_ms} мс</td><td><button data-execution="${e.id}">Открыть</button></td></tr>`).join('')}</tbody></table>${filtered.length?'':'<div class="empty-message">Запросов по фильтру нет.</div>'}</div>`;
  document.querySelectorAll('[data-execution]').forEach(button => button.addEventListener('click', () => { const e = executions.find(e=>e.id===button.dataset.execution); $('#detail-title').textContent = e.operation_name || 'Запрос'; $('#detail-body').innerHTML = `<p>${escape(e.test_name)} · HTTP ${e.status} · ${e.duration_ms} мс</p><pre>${escape(e.query_text)}</pre>${e.analysis.error?`<p class="error">${escape(e.analysis.error)}</p>`:`<p>Глубина ${e.analysis.depth} · ${e.analysis.fields.length} полей</p><pre>${escape(e.analysis.paths.join('\n'))}</pre>`}`; $('#detail').showModal(); }));
}
function detailType(name) { const type = current.types.find(t=>t.name===name); $('#detail-title').textContent = `${type.name} · ${type.percent}%`; $('#detail-body').innerHTML = `<p class="muted">${type.covered} из ${type.total} полей выбраны запросами этого прогона.</p>${fieldTable(type.fields)}`; $('#detail').showModal(); }
async function loadHistory() { await loadRuns(current?.run.id); history = await Promise.all(runs.map(run=>api(`/api/runs/${run.id}/coverage`))); renderHistory(); }
function renderHistory() {
  const branch = $('#branch-filter').value.toLowerCase(), environment = $('#env-filter').value.toLowerCase();
  $('#history-list').innerHTML = history.filter(item=>item.run.branch.toLowerCase().includes(branch)&&item.run.environment.toLowerCase().includes(environment)).map(item=>`<article class="history-card"><input type="checkbox" aria-label="Сравнить ${escape(item.run.name)}" data-compare="${item.run.id}" ${selectedComparison.includes(item.run.id)?'checked':''}><div><h3>${escape(item.run.name)}</h3><p>${escape(item.run.branch)} · ${escape(item.run.environment)} · ${date(item.run.created_at)}</p></div><strong>${item.percent}%</strong><span class="muted">${item.covered}/${item.total}</span><button data-open-run="${item.run.id}">Открыть</button></article>`).join('') || '<div class="empty-message">Прогонов по фильтру нет.</div>';
  document.querySelectorAll('[data-open-run]').forEach(button=>button.onclick=()=>action(button,async()=>{ await selectRun(button.dataset.openRun); page('coverage'); }));
  document.querySelectorAll('[data-compare]').forEach(input=>input.onchange=()=>{ if(input.checked) selectedComparison=[...selectedComparison.slice(-1),input.dataset.compare]; else selectedComparison=selectedComparison.filter(id=>id!==input.dataset.compare); renderHistory(); });
  if(selectedComparison.length!==2) { $('#comparison').textContent='Выберите два прогона для сравнения покрытия.'; return; }
  const items=selectedComparison.map(id=>history.find(item=>item.run.id===id)).sort((a,b)=>a.run.created_at.localeCompare(b.run.created_at));
  if(items[0].run.schema_hash!==items[1].run.schema_hash) { $('#comparison').textContent='Снимки схем различаются. Выберите прогоны с одинаковой схемой для сравнения.'; return; }
  const before = new Set(items[0].types.flatMap(t=>t.fields).filter(f=>f.hits).map(f=>f.key));
  const after = new Set(items[1].types.flatMap(t=>t.fields).filter(f=>f.hits).map(f=>f.key));
  const added=[...after].filter(key=>!before.has(key)), lost=[...before].filter(key=>!after.has(key));
  const delta=items[1].percent-items[0].percent;
  $('#comparison').innerHTML=`<h2>${escape(items[0].run.name)} → ${escape(items[1].run.name)}</h2><div class="diff"><strong>${delta>=0?'+':''}${delta} п.п.</strong><p>Новых полей ${added.length}<br>Перестали запрашиваться ${lost.length}</p></div><p>${escape(added.join(', ') || 'Новых полей нет.')}</p>${lost.length?`<p class="error">Потеряно покрытие ${escape(lost.join(', '))}</p>`:''}`;
}
document.querySelectorAll('.nav').forEach(button => button.onclick=()=>page(button.dataset.page));
document.querySelectorAll('.tab').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('#run-select').onchange=()=>selectRun($('#run-select').value).catch(error=>notify(error.message));
$('#search').oninput=render;
$('#uncovered').onclick=()=>{ onlyUncovered=!onlyUncovered; $('#uncovered').setAttribute('aria-pressed',String(onlyUncovered)); if(view==='requests')switchView('fields'); else render(); };
$('#show-gaps').onclick=()=>{ onlyUncovered=true; $('#uncovered').setAttribute('aria-pressed','true'); switchView('fields'); $('.panel-toolbar').scrollIntoView({behavior:'smooth'}); };
$('#close-detail').onclick=()=>$('#detail').close();
$('#new-run').onclick=()=>page('connect');
$('#demo-expand').onclick=()=>action($('#demo-expand'),async()=>{const run=await api('/api/demo',{method:'POST',body:JSON.stringify({extended:true})}); await loadRuns(run.id); notify('Расширенный набор выполнил 6 запросов. Результат сохранён.');});
$('#connection-form').onsubmit=event=>{event.preventDefault(); const form=event.currentTarget; action(form.querySelector('button[type=submit]'),async()=>{ const data=Object.fromEntries(new FormData(form)); data.headers=JSON.parse(data.headers||'{}'); const run=await api('/api/runs',{method:'POST',body:JSON.stringify(data)}); await loadRuns(run.id); page('coverage'); notify('Прогон создан. Адрес прокси доступен в разделе подключения.'); });};
$('#sdl-file').onchange=async event=>{ if(event.target.files[0]) $('#connection-form [name=sdl]').value=await event.target.files[0].text(); };
$('#execute').onclick=()=>action($('#execute'),async()=>{ if(!current)throw new Error('Сначала создайте прогон.'); const headers=JSON.parse($('#query-headers').value||'{}'); const payload={query:$('#query').value,variables:JSON.parse($('#variables').value||'{}'),operationName:$('#operation-name').value||undefined}; const response=await fetch(`/proxy/${current.run.id}`,{method:'POST',headers:{...headers,'content-type':'application/json','x-coverage-test':$('#test-name').value},body:JSON.stringify(payload)}); const body=await response.text(); try { $('#response').textContent=`HTTP ${response.status} · ${response.headers.get('x-coverage-status')}\n\n${JSON.stringify(JSON.parse(body),null,2)}`; } catch { $('#response').textContent=body; } await selectRun(current.run.id); });
$('#copy-proxy').onclick=()=>action($('#copy-proxy'),async()=>{await navigator.clipboard.writeText($('#proxy-address').textContent); notify('Адрес скопирован.');});
$('#branch-filter').oninput=renderHistory; $('#env-filter').oninput=renderHistory;
$('#refresh-history').onclick=()=>action($('#refresh-history'),loadHistory);
window.addEventListener('resize',()=>{ if(current)renderGraph(); });
try { runs=await api('/api/runs'); if(!runs.length){const run=await api('/api/demo',{method:'POST',body:'{}'});await loadRuns(run.id);}else await loadRuns(); } catch(error){ notify(`Ошибка загрузки. ${error.message}`); $('#insight-title').textContent='Не удалось загрузить данные'; $('#insight-text').textContent=error.message; }
