import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import worker from '../dist/server/index.js';
const html=[];
function walk(path) {for(const entry of readdirSync(path,{withFileTypes:true})) {if(['server','.openai'].includes(entry.name))continue;const p=path+'/'+entry.name;if(entry.isDirectory())walk(p);else if(p.endsWith('.html'))html.push(p);}}
walk('dist');
test('50 documents retain valid local links, unique headings/IDs, and clean encoding',()=>{
  assert.equal(html.length,50); let checked=0;
  for(const path of html) {
    const content=readFileSync(path,'utf8');
    assert.equal([...content.matchAll(/<h1(?:\s|>)/g)].length,1,path);
    assert.doesNotMatch(content,/\uFFFD|Ã|â€|REPLACE_ME/,path);
    const ids=[...content.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); assert.equal(new Set(ids).size,ids.length,path);
    for(const m of content.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if(m[1].startsWith('https://')) continue;
      const url=new URL(m[1],'https://atlas.example/'+path.slice(5));
      if(['/signin-with-chatgpt','/signout-with-chatgpt'].includes(url.pathname)) continue;
      let local='dist'+url.pathname; assert.ok(existsSync(local),path+' -> '+url.pathname);
      if(statSync(local).isDirectory()) local+='/index.html';
      assert.ok(existsSync(local),local);
      if(url.hash) assert.ok(readFileSync(local,'utf8').includes('id="'+url.hash.slice(1)+'"'),m[1]);
      checked++;
    }
  }
  console.log('Validated '+checked+' local links across '+html.length+' documents.');
});
test('all 46 entry pages have independent comments and top-level OpenAI sign-in links',()=>{
  const entries=html.filter(p=>p.includes('/entries/')); assert.equal(entries.length,46);
  for(const path of entries) {
    const content=readFileSync(path,'utf8');const slug=path.split('/')[2];
    assert.ok(content.includes('data-comments-entry="'+slug+'"'));assert.match(content,/href="\/signin-with-chatgpt\?return_to=[^"]+" target="_top"/);
    assert.match(content,/Submit for approval/);
  }
});
test('welcome has seven narrative chapters and working research links',()=>{
  const content=readFileSync('dist/index.html','utf8');
  assert.equal([...content.matchAll(/<section id=/g)].length,7);
  assert.ok([...content.matchAll(/href="\/entries\//g)].length>=30);
  assert.match(content,/aria-current="page">Welcome/);assert.match(content,/href="\/timeline\/">/);
});
test('built artifact exports a callable Worker and serves public pages',async()=>{
  assert.equal(typeof worker.fetch,'function');
  for(const path of ['/','/timeline/','/entries/mcculloch-pitts/','/entries/the-ai-toy/','/entries/deepseek-r1/','/comments.js']) {
    const response=await worker.fetch(new Request('https://atlas.example'+path),{});assert.equal(response.status,200,path);
  }
  assert.equal((await worker.fetch(new Request('https://atlas.example/no-such-page'),{})).status,404);
  assert.equal((await worker.fetch(new Request('https://atlas.example/moderation/'),{})).status,302);
});
