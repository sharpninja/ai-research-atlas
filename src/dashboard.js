const el = (tag, text) => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;};
const number = value => value.toLocaleString();
const select = document.getElementById('analytics-range');
const refresh = document.getElementById('analytics-refresh');
const notice = document.getElementById('analytics-notice');
const results = document.getElementById('analytics-results');
const dateLabel = value => new Date(value + 'T00:00:00Z').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
function table(id, rows, empty, render) {
  const target = document.getElementById(id); target.replaceChildren();
  if (!rows.length) {const row = el('tr'); const cell = el('td', empty); cell.colSpan = 2; row.append(cell); target.append(row); return;}
  for (const item of rows) {const row = el('tr'); const label = el('td'); render(label, item); row.append(label, el('td', item.collected === false ? 'Not collected' : number(item.views))); target.append(row);}
}
function chart(data) {
  const target = document.getElementById('analytics-chart'); target.replaceChildren();
  if (!data.totals.pageViews) {target.append(el('p', 'No page views recorded in this period.')); return;}
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const create = (tag, attrs, text) => {const node = document.createElementNS(svg.namespaceURI, tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, value); if(text !== undefined) node.textContent = text; return node;};
  svg.setAttribute('viewBox', '0 0 960 230'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily page views. Exact figures are in the daily totals table below.');
  const max = Math.max(...data.daily.map(row => row.views), 1);
  for (let i=0; i<=2; i++) {const y = 20 + i*85; svg.append(create('line', {x1:45,y1:y,x2:944,y2:y,stroke:'#d8dde3'}),create('text', {x:38,y:y+4,'text-anchor':'end',fill:'#576477','font-size':12}, number(Math.round(max*(1-i/2)))));}
  const step = 890/data.daily.length;
  data.daily.forEach((row,i) => {
    if (!row.collected) return;
    const height = row.views/max*170;
    const bar = create('rect', {x:50+i*step,y:190-height,width:Math.max(2,step-3),height,fill:'#287783',rx:2});
    bar.append(create('title', {}, `${row.day}: ${number(row.views)} views`)); svg.append(bar);
  });
  svg.append(create('text', {x:50,y:219,fill:'#576477','font-size':12}, dateLabel(data.start)),create('text', {x:940,y:219,'text-anchor':'end',fill:'#576477','font-size':12},dateLabel(data.end)));
  target.append(svg);
}
async function load() {
  select.disabled = refresh.disabled = true; results.hidden = true; results.setAttribute('aria-busy','true'); notice.textContent = 'Loading analytics…';
  try {
    const response = await fetch('/api/analytics?days=' + select.value, {credentials:'same-origin',cache:'no-store'});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {notice.replaceChildren(el('span','Your sign-in has expired. ')); const link = el('a','Sign in with ChatGPT'); link.href='/signin-with-chatgpt?return_to=%2Fanalytics%2F'; link.target='_top'; notice.append(link); return;}
      throw new Error(data.error || 'Unable to load analytics. Please try again.');
    }
    for (const [id,value] of Object.entries({'metric-views':data.totals.pageViews,'metric-comments':data.totals.comments,'metric-submissions':data.totals.submissions,'pending-comments':data.pending.comments,'pending-submissions':data.pending.submissions})) document.getElementById(id).textContent=number(value);
    document.getElementById('analytics-period').textContent = dateLabel(data.start) + ' – ' + dateLabel(data.end) + ' · UTC';
    document.getElementById('analytics-coverage').textContent = data.startedAt ? 'Traffic collection began ' + new Date(data.startedAt).toLocaleString(undefined, {timeZone:'UTC'}) + ' UTC. Earlier dates were not collected; the first day may be partial.' : 'Traffic collection starts with the first eligible public page visit.';
    table('analytics-daily', [...data.daily].reverse(), '', (cell,row) => cell.textContent=dateLabel(row.day));
    table('analytics-pages', data.pages, 'No page views recorded in this period.', (cell,row) => {const link=el('a'); link.href=row.path; const decoder=document.createElement('textarea'); decoder.innerHTML=row.title; link.textContent=decoder.value; cell.append(link);});
    table('analytics-referrers', data.referrers, 'No referral sources recorded in this period.', (cell,row) => cell.textContent=row.referrer);
    chart(data); results.hidden = false;
    notice.textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString(undefined, {timeZone:'UTC'}) + ' UTC.';
  } catch(error) {notice.textContent=error.message;}
  finally {select.disabled = refresh.disabled = false; results.setAttribute('aria-busy','false');}
}
select.addEventListener('change',load); refresh.addEventListener('click',load); load();
