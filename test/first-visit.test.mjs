import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
const assets={
  '/index.html':{body:'Welcome introduction',type:'text/html; charset=utf-8'},
  '/welcome/index.html':{body:'Welcome introduction',type:'text/html; charset=utf-8'},
  '/timeline/index.html':{body:'Timeline',type:'text/html; charset=utf-8'},
  '/entries/the-ai-toy/index.html':{body:'The AI Toy',type:'text/html; charset=utf-8'},
  '/style.css':{body:'body{}',type:'text/css'},
  '/404.html':{body:'Missing',type:'text/html; charset=utf-8'},
};
const worker=createWorker(assets,['the-ai-toy']);
const fetchPage=(path='/',cookie='',method='GET')=>worker.fetch(new Request('https://atlas.example'+path,{method,headers:cookie?{Cookie:cookie}:{}}),{});
test('a first root visit shows Welcome and sets a host-only one-year visit cookie',async()=>{
  const response=await fetchPage();assert.equal(response.status,200);assert.equal(await response.text(),'Welcome introduction');
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/^atlas_visited=1;/);assert.match(cookie,/Path=\//);assert.match(cookie,/Max-Age=31536000/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);assert.doesNotMatch(cookie,/Domain=/);
  assert.match(response.headers.get('cache-control'),/private, no-store/);assert.match(response.headers.get('vary'),/Cookie/);
});
test('returning root visitors redirect to Timeline, including index.html, while other cookies do not count',async()=>{
  for(const path of ['/','/?from=bookmark','/index.html']) {
    const response=await fetchPage(path,'other=1; atlas_visited=1');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/timeline/');assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('vary'),/Cookie/);
  }
  for(const cookie of ['other=atlas_visited=1','atlas_visited=0','prefix_atlas_visited=1']) assert.equal((await fetchPage('/',cookie)).status,200);
});
test('Welcome remains directly accessible to returning visitors without a redirect loop',async()=>{
  const welcome=await fetchPage('/welcome/','atlas_visited=1');assert.equal(welcome.status,200);assert.equal(await welcome.text(),'Welcome introduction');
  const timeline=await fetchPage('/timeline/','atlas_visited=1');assert.equal(timeline.status,200);assert.equal(await timeline.text(),'Timeline');
});
test('an entry visit records the preference, while assets, APIs, 404s and HEAD do not',async()=>{
  const entry=await fetchPage('/entries/the-ai-toy/');const cookie=entry.headers.get('set-cookie');assert.match(cookie,/atlas_visited=1/);
  assert.equal((await fetchPage('/',cookie.split(';')[0])).status,302);
  for(const [path,method] of [['/style.css','GET'],['/api/session','GET'],['/missing','GET'],['/','HEAD']]) assert.equal((await fetchPage(path,'',method)).headers.get('set-cookie'),null,path);
  assert.equal(await (await fetchPage('/','','HEAD')).text(),'');
});
test('removing the visit cookie restores the first-visit welcome',async()=>{
  assert.equal((await fetchPage('/','atlas_visited=1')).status,302);
  const reset=await fetchPage('/');assert.equal(reset.status,200);assert.equal(await reset.text(),'Welcome introduction');
});
