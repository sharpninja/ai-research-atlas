import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import worker from '../dist/server/index.js';
const html=[];
function walk(path) {for(const entry of readdirSync(path,{withFileTypes:true})) {if(['server','.openai'].includes(entry.name))continue;const p=path+'/'+entry.name;if(entry.isDirectory())walk(p);else if(p.endsWith('.html'))html.push(p);}}
walk('dist');
test('77 documents retain valid local links, unique headings/IDs, and clean encoding',()=>{
  assert.equal(html.length,77); let checked=0;
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
test('all 67 entry pages have independent comments and top-level OpenAI sign-in links',()=>{
  const entries=html.filter(p=>p.includes('/entries/')); assert.equal(entries.length,67);
  for(const path of entries) {
    const content=readFileSync(path,'utf8');const slug=path.split('/')[2];
    assert.ok(content.includes('data-comments-entry="'+slug+'"'));assert.match(content,/href="\/signin-with-chatgpt\?return_to=[^"]+" target="_top"/);
    assert.match(content,/Submit for approval/);
  }
});
test('welcome introduces the precursors and seven research chapters',()=>{
  const content=readFileSync('dist/index.html','utf8');
  assert.equal([...content.matchAll(/<section id=/g)].length,8);
  assert.ok(content.indexOf('id="before-the-research"') < content.indexOf('id="early-questions"'));
  assert.match(content,/href="\/precursors\/"/);
  assert.match(content,/href="\/literary-timeline\/"/);
  const timeline=readFileSync('dist/timeline/index.html','utf8');
  assert.match(timeline,/id="precursor-title">Precursor to AI<\/h2>/);
  assert.match(timeline,/href="\/precursors\/"/);
  assert.ok([...content.matchAll(/href="\/entries\//g)].length>=30);
  assert.match(content,/aria-current="page">Welcome/);assert.match(content,/href="\/timeline\/">/);
});
test('built artifact exports a callable Worker and serves public pages',async()=>{
  assert.equal(typeof worker.fetch,'function');
  for(const path of ['/','/welcome/','/timeline/','/precursors/','/literary-timeline/','/entries/mcculloch-pitts/','/entries/the-ai-toy/','/entries/deepseek-r1/','/comments.js']) {
    const response=await worker.fetch(new Request('https://atlas.example'+path),{});assert.equal(response.status,200,path);
  }
  assert.equal((await worker.fetch(new Request('https://atlas.example/no-such-page'),{})).status,404);
  const returning = await worker.fetch(new Request('https://atlas.example/',{headers:{Cookie:'atlas_visited=1'}}),{});
  assert.equal(returning.status,302);assert.equal(returning.headers.get('location'),'/timeline/');
  const introduction = await worker.fetch(new Request('https://atlas.example/welcome/',{headers:{Cookie:'atlas_visited=1'}}),{});
  assert.equal(introduction.status,200);assert.match(await introduction.text(),/href="\/welcome\/" aria-current="page">Welcome/);
  assert.equal((await worker.fetch(new Request('https://atlas.example/moderation/'),{})).status,302);
  assert.equal((await worker.fetch(new Request('https://atlas.example/submit/'),{})).status,302);
  const signedIn = await worker.fetch(new Request('https://atlas.example/submit/',{headers:{'oai-authenticated-user-id':'reader','oai-authenticated-user-email':'reader@example.test'}}),{});
  assert.equal(signedIn.status,200);assert.match(await signedIn.text(),/id="submission-form"/);
  const ownerReview = await worker.fetch(new Request('https://atlas.example/moderation/submissions/',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),{COMMENT_MODERATOR_EMAIL:'owner@example.test'});
  assert.equal(ownerReview.status,200);assert.match(await ownerReview.text(),/data-submission-list="review"/);
});
