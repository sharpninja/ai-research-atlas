import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../src/worker.js';
import {database} from './d1.mjs';
const owner = {'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};
const reader = {'oai-authenticated-user-id':'reader','oai-authenticated-user-email':'reader@example.test'};
const html = body => ({body, type:'text/html; charset=utf-8'});
const assets = {'/index.html':html('Welcome'),'/welcome/index.html':html('<title>Welcome | AI Research Atlas</title>'),'/timeline/index.html':html('<title>Timeline | AI Research Atlas</title>'),'/entries/mcculloch-pitts/index.html':html('<title>A mathematical neuron | AI Research Atlas</title>'),'/analytics/index.html':html('Private dashboard'),'/404.html':html('Missing'),'/style.css':{body:'',type:'text/css'}};
function setup(t, binding=database()) {
  t.after(()=>binding.sql.close());
  const worker = createWorker(assets,['mcculloch-pitts']);
  const env={DB:binding,COMMENT_MODERATOR_EMAIL:'owner@example.test'};
  const call = (path,headers={},method='GET',ctx) => worker.fetch(new Request('https://atlas.example'+path,{headers,method}),env,ctx);
  const summary = async (range='30') => (await call('/api/analytics?days='+range,owner)).json();
  return {call, summary, env, binding};
}
test('dashboard aliases and API enforce owner access independently of UI',async t=>{
  const {call,env}=setup(t);
  for (const path of ['/analytics','/analytics/','/analytics/index.html']) {
    const anonymous=await call(path); assert.equal(anonymous.status,302); assert.match(anonymous.headers.get('location'),/^\/signin-with-chatgpt/);
    assert.equal((await call(path,reader)).status,403);
    assert.ok([200,308].includes((await call(path,owner)).status));
  }
  assert.equal((await call('/api/analytics')).status,401);
  assert.equal((await call('/api/analytics?isModerator=true',reader)).status,403);
  assert.equal((await call('/api/analytics',{Cookie:'isModerator=true; role=owner'})).status,401);
  assert.equal((await call('/api/analytics',owner,'POST')).status,405);
  assert.equal((await call('/api/search-console')).status,401);
  assert.equal((await call('/api/search-console',reader)).status,403);
  assert.equal((await call('/api/search-console',owner,'POST')).status,405);
  assert.deepEqual(await (await call('/api/search-console?days=30',owner)).json(),{configured:false,rows:[]});
  delete env.COMMENT_MODERATOR_EMAIL;
  assert.equal((await call('/api/analytics',owner)).status,403);
  assert.equal((await call('/analytics/',owner)).status,403);
});
test('private analytics responses do not permit shared caching',async t=>{
  const {call}=setup(t);
  for (const path of ['/analytics/','/api/analytics']) {
    const response=await call(path,owner); assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/private, no-store/);
  }
});
test('empty analytics is real zero, and dates before collection are unavailable',async t=>{
  const {summary,call}=setup(t);const data=await summary('7');
  assert.equal(data.startedAt,null);assert.equal(data.totals.pageViews,0);assert.equal(data.daily.length,7);assert.ok(data.daily.every(row=>!row.collected));
  for (const days of ['0','31','100000',"7' OR 1=1--"]) assert.equal((await call('/api/analytics?days='+encodeURIComponent(days),owner)).status,400);
});
test('public requests aggregate atomically and referrers retain only their host',async t=>{
  const {call,summary,binding}=setup(t);
  await call('/?private=query',{Referer:'https://search.example/private/account?email=secret#token','x-forwarded-for':'1.2.3.4'});
  await call('/welcome/index.html',{Referer:'https://search.example/other'});
  await call('/entries/mcculloch-pitts/',{Referer:'https://atlas.example/welcome/'});
  const data=await summary();assert.equal(data.totals.pageViews,3);assert.equal(data.pages[0].path,'/welcome/');assert.equal(data.pages[0].views,2);
  assert.equal(data.referrers[0].referrer,'search.example');assert.equal(data.referrers[0].views,2);
  assert.ok(data.startedAt);assert.equal(data.daily.at(-1).collected,true);assert.equal(data.daily[0].collected,false);
  const rows=binding.sql.prepare('SELECT * FROM page_views_daily').all();
  assert.deepEqual(Object.keys(rows[0]).sort(),['day','path','referrer','views']);
  assert.doesNotMatch(JSON.stringify(rows),/secret|account|1\.2\.3\.4|private=query|owner|reader/);
});
test('private pages, signed-in owner, bots, prefetch, errors, assets and HEAD do not inflate traffic',async t=>{
  const {call,summary}=setup(t);
  for (const [path,headers,method] of [['/analytics/',owner],['/welcome/',owner],['/timeline/',{'User-Agent':'Googlebot'}],['/timeline/',{'Sec-Purpose':'prefetch'}],['/timeline/',{Purpose:'prefetch'}],['/missing',{}],['/style.css',{}],['/timeline/',{},'HEAD'],['/',{Cookie:'atlas_visited=1'}]]) await call(path,headers,method);
  assert.equal((await summary()).totals.pageViews,0);
  await call('/timeline/',reader);assert.equal((await summary()).totals.pageViews,1);
});
test('date range and current review queues have distinct meanings',async t=>{
  const {summary,binding}=setup(t);const now=Date.now();
  const today=new Date().toISOString().slice(0,10);const older=new Date(now-15*86400000).toISOString().slice(0,10);
  binding.sql.prepare('INSERT INTO page_views_daily VALUES (?,?,?,?)').run(today,'/welcome/','Direct / unknown',3);
  binding.sql.prepare('INSERT INTO page_views_daily VALUES (?,?,?,?)').run(older,'/timeline/','Direct / unknown',9);
  binding.sql.prepare('INSERT INTO comments (id,entry,author_id,author_name,body,status,created_at,submission_key) VALUES (?,?,?,?,?,?,?,?)').run('old','mcculloch-pitts','reader','Name','Private text','pending',now-15*86400000,'old-key');
  binding.sql.prepare('INSERT INTO timeline_submissions (id,author_id,url,title,reason,status,created_at,submission_key) VALUES (?,?,?,?,?,?,?,?)').run('new','reader','https://example.test/','Private title','Private reason','pending',now,'new-key');
  const data=await summary('7');assert.equal(data.totals.pageViews,3);assert.equal(data.totals.comments,0);assert.equal(data.totals.submissions,1);assert.equal(data.pending.comments,1);assert.equal(data.pending.submissions,1);
  const long=await summary('30');assert.equal(long.totals.pageViews,12);assert.equal(long.totals.comments,1);assert.doesNotMatch(JSON.stringify(data),/Private text|Private reason|reader/);
  const query=binding.sql.prepare('EXPLAIN QUERY PLAN SELECT SUM(views) FROM page_views_daily WHERE day >= ? AND day <= ?').all(older,today);assert.match(JSON.stringify(query),/USING INDEX/);
});
test('tracking failure preserves public reading; dashboard database errors stay explicit',async t=>{
  const {call,env}=setup(t);env.DB={batch:async()=>{throw Error('offline');},prepare:()=>{throw Error('offline');}};
  assert.equal((await call('/welcome/')).status,200);
  const response=await call('/api/analytics',owner);assert.equal(response.status,503);assert.match((await response.json()).error,/Analytics are temporarily unavailable/);
});
test('production lifecycle retains asynchronous writes with waitUntil',async t=>{
  const {call,summary}=setup(t);const pending=[];
  assert.equal((await call('/welcome/',{},'GET',{waitUntil:p=>pending.push(p)})).status,200);
  await Promise.all(pending);assert.equal(pending.length,1);assert.equal((await summary()).totals.pageViews,1);
});
test('owner exclusion persists after sign-out without granting owner access',async t=>{
  const {call,summary}=setup(t);
  const response=await call('/analytics/',owner);
  const exclusion=response.headers.getSetCookie().find(value=>value.startsWith('__Host-atlas_analytics_excluded='));
  assert.ok(exclusion,'owner browsing installs a persistent exclusion preference');
  for (const flag of ['Path=/','Max-Age=31536000','HttpOnly','Secure','SameSite=Lax']) assert.ok(exclusion.includes(flag));
  assert.doesNotMatch(exclusion,/Domain=/i);
  assert.ok(response.headers.getSetCookie().some(value=>value.startsWith('atlas_visited=')));
  const cookie=exclusion.split(';')[0];
  await call('/timeline/',{Cookie:cookie});
  await call('/welcome/',{...reader,Cookie:cookie});
  assert.equal((await summary()).totals.pageViews,0);
  assert.equal((await call('/api/analytics',{Cookie:cookie})).status,401);
  assert.equal((await call('/api/analytics',{...reader,Cookie:cookie})).status,403);
  await call('/timeline/',reader);
  await call('/welcome/',{Cookie:'__Host-atlas_analytics_excluded=0'});
  assert.equal((await summary()).totals.pageViews,2);
});
test('owner session checks remember exclusion but readers cannot mark a browser as owner',async t=>{
  const {call}=setup(t);
  assert.ok((await call('/api/session',owner)).headers.getSetCookie().some(value=>value.startsWith('__Host-atlas_analytics_excluded=1;')));
  for (const headers of [{},reader]) assert.ok(!(await call('/api/session',headers)).headers.getSetCookie().some(value=>value.startsWith('__Host-atlas_analytics_excluded=')));
});
test('device counts classify common browser signals without storing raw user agents',async t=>{
  const {call,summary,binding}=setup(t);
  const agents=[
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36','desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1','mobile'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36','mobile'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1','tablet'],
    ['Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36','tablet'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0','desktop'],
    ['','unknown'],['Custom-client/private-token','unknown'],
  ];
  for (const [agent] of agents) await call('/timeline/',{'User-Agent':agent});
  await call('/timeline/',{'Sec-CH-UA-Mobile':'?1'});
  const data=await summary();
  assert.deepEqual(data.devices,[{deviceType:'desktop',views:2},{deviceType:'mobile',views:3},{deviceType:'tablet',views:2},{deviceType:'unknown',views:2}]);
  assert.equal(data.devices.reduce((sum,row)=>sum+row.views,0),data.totals.pageViews);
  const stored=binding.sql.prepare('SELECT * FROM device_views_daily').all();
  assert.deepEqual(Object.keys(stored[0]).sort(),['day','device_type','views']);
  assert.doesNotMatch(JSON.stringify(stored),/Mozilla|private-token|Pixel|Windows/);
  assert.ok(data.deviceStartedAt);
});
test('legacy views remain unknown and device counts respect the selected date range',async t=>{
  const {call,summary,binding}=setup(t);
  const today=new Date().toISOString().slice(0,10);
  const older=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
  binding.sql.prepare('INSERT INTO page_views_daily VALUES (?,?,?,?)').run(today,'/welcome/','Direct / unknown',3);
  binding.sql.prepare('INSERT INTO page_views_daily VALUES (?,?,?,?)').run(older,'/timeline/','Direct / unknown',9);
  const before=await summary('7');
  assert.equal(before.deviceStartedAt,null);
  assert.equal(before.devices.find(row=>row.deviceType==='unknown').views,3);
  await call('/timeline/',{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
  assert.deepEqual((await summary('7')).devices,[{deviceType:'desktop',views:1},{deviceType:'mobile',views:0},{deviceType:'tablet',views:0},{deviceType:'unknown',views:3}]);
  assert.equal((await summary('30')).devices.find(row=>row.deviceType==='unknown').views,12);
  const plan=binding.sql.prepare('EXPLAIN QUERY PLAN SELECT SUM(views) FROM device_views_daily WHERE day >= ? AND day <= ?').all(older,today);
  assert.match(JSON.stringify(plan),/USING INDEX/);
});
test('page and device counters roll back together when a device write fails',async t=>{
  const {call,summary,binding}=setup(t);
  binding.sql.exec("CREATE TRIGGER reject_device BEFORE INSERT ON device_views_daily BEGIN SELECT RAISE(ABORT, 'test unavailable'); END");
  assert.equal((await call('/timeline/')).status,200);
  assert.equal((await summary()).totals.pageViews,0);
  assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM analytics_meta').get().n,0);
});
test('traffic counters survive a database reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-analytics-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'analytics.sqlite');const first=database(path);const worker=createWorker(assets,[]);
  await worker.fetch(new Request('https://atlas.example/welcome/'),{DB:first});first.sql.close();
  const second=database(path,false);assert.equal(second.sql.prepare('SELECT SUM(views) AS n FROM page_views_daily').get().n,1);second.sql.close();
});
test('welcome finishes with first-entry navigation on both welcome routes',()=>{
  for (const path of ['dist/index.html','dist/welcome/index.html']) {
    const source=readFileSync(path,'utf8');assert.match(source,/<nav class="welcome-next"[^>]*><a class="button" href="\/entries\/mcculloch-pitts\/">/);assert.ok(source.indexOf('welcome-next')>source.indexOf('id="open-questions"'));
  }
});
