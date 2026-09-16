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
