import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../src/worker.js';
import {database} from './d1.mjs';
const origin='https://atlas.example';
const owner={id:'owner',email:'owner@example.test'}, reader={id:'reader',email:'reader@example.test'};
const assets={'/404.html':{body:'Missing',type:'text/html'},'/submit/index.html':{body:'Submit a link',type:'text/html'},'/moderation/submissions/index.html':{body:'Review suggestions',type:'text/html'}};
function setup(t,binding=database()) {
  t.after(()=>{try{binding.sql.close();}catch{}});
  const env={DB:binding,COMMENT_MODERATOR_EMAIL:owner.email};
  const worker=createWorker(assets,['the-ai-toy']);
  async function call(path,{user=null,data,headers={},method}={}) {
    const h={...(user?{'oai-authenticated-user-id':user.id,'oai-authenticated-user-email':user.email}:{}),...headers};
    if(data){h['Content-Type']='application/json';if(!('Origin' in h))h.Origin=origin;}
    const r=await worker.fetch(new Request(origin+path,{method:method||(data?'POST':'GET'),headers:h,...(data?{body:JSON.stringify(data)}:{})}),env);
    const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}
    return {status:r.status,body,headers:r.headers};
  }
  const submit=(data={})=>call('/api/submissions',{user:reader,data:{url:'https://example.org/paper',title:'An AI research paper',reason:'It introduced a useful learning method.',submissionKey:crypto.randomUUID(),...data}});
  return {call,submit,binding,env};
}
test('submissions pages and APIs require identity, and the review queue requires the owner',async t=>{
  const {call,env}=setup(t);
  for(const path of ['/submit','/submit/','/submit/index.html']) {
    const r=await call(path);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/signin-with-chatgpt?return_to=%2Fsubmit%2F');assert.match(r.headers.get('cache-control'),/no-store/);
  }
  assert.equal((await call('/submit/',{user:reader})).status,200);
  assert.match((await call('/submit/',{user:reader})).headers.get('cache-control'),/no-store/);
  assert.equal((await call('/api/submissions')).status,401);
  assert.equal((await call('/api/submissions',{data:{}})).status,401);
  assert.equal((await call('/api/submissions/review')).status,401);
  assert.equal((await call('/api/submissions/review',{user:reader})).status,403);
  assert.equal((await call('/moderation/submissions/',{user:reader})).status,403);
  const redirect=await call('/moderation/submissions/');assert.match(redirect.headers.get('location'),/%2Fmoderation%2Fsubmissions%2F/);
  assert.equal((await call('/moderation/submissions/',{user:owner})).status,200);
  delete env.COMMENT_MODERATOR_EMAIL;assert.equal((await call('/api/submissions/review',{user:owner})).status,403);
});
test('link submissions validate URLs and text and reject cross-site writes',async t=>{
  const {call,submit}=setup(t);
  for(const data of [{url:'javascript:alert(1)'},{url:'data:text/html,x'},{url:'file:///test'},{url:'https://user:password@example.org/'},{url:'invalid'},{url:'https://example.org/'+'x'.repeat(2048)},{title:' '},{title:'x'.repeat(201)},{reason:' '},{reason:'x'.repeat(2001)},{submissionKey:'bad'}]) assert.equal((await submit(data)).status,400,JSON.stringify(data).slice(0,100));
  for(const headers of [{Origin:'https://other.example'},{Origin:''},{Origin:origin,'Sec-Fetch-Site':'cross-site'}]) assert.equal((await call('/api/submissions',{user:reader,data:{},headers})).status,403);
  assert.equal((await call('/api/submissions',{user:reader,method:'DELETE'})).status,405);
});
test('suggestions remain private, ignore forged identities and status, and do not enter the timeline',async t=>{
  const {call,submit,binding}=setup(t);
  await submit({authorId:owner.id,status:'shortlisted',title:'<script>bad</script>',reason:'<img onerror=alert(1)>'});
  const own=(await call('/api/submissions',{user:reader})).body.submissions;
  assert.equal(own.length,1);assert.equal(own[0].status,'pending');assert.equal(own[0].title,'<script>bad</script>');
  assert.equal((await call('/api/submissions',{user:owner})).body.submissions.length,0);
  const review=await call('/api/submissions/review',{user:owner});assert.equal(review.body.submissions.length,1);assert.match(review.headers.get('cache-control'),/no-store/);
  assert.ok(!('author_id' in review.body.submissions[0]));assert.ok(!('email' in own[0]));
  assert.equal(binding.sql.prepare('SELECT author_id FROM timeline_submissions').get().author_id,reader.id);
  assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM comments').get().n,0);
});
test('only the owner can shortlist, decline, and return suggestions; stale writes conflict and decisions are audited',async t=>{
  const {call,submit,binding}=setup(t);const id=(await submit()).body.id;
  assert.equal((await call('/api/submissions/review',{user:reader,data:{id,status:'shortlisted',expectedStatus:'pending',isModerator:true}})).status,403);
  let current='pending';
  for(const status of ['shortlisted','declined','pending']) {
    assert.equal((await call('/api/submissions/review',{user:owner,data:{id,status,expectedStatus:current}})).status,200);
    assert.equal((await call('/api/submissions',{user:reader})).body.submissions[0].status,status);current=status;
  }
  assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM submission_events').get().n,3);
  assert.equal((await call('/api/submissions/review',{user:owner,data:{id,status:'declined',expectedStatus:'shortlisted'}})).status,409);
  assert.equal((await call('/api/submissions/review',{user:owner,data:{id,status:'published',expectedStatus:'pending'}})).status,400);
});
test('network retries are idempotent and submissions have an atomic per-account rate limit',async t=>{
  const {submit,binding}=setup(t);const submissionKey=crypto.randomUUID();
  const first=await submit({submissionKey});const retry=await submit({submissionKey});assert.equal(first.status,201);assert.equal(first.body.id,retry.body.id);
  for(let i=0;i<4;i++)assert.equal((await submit()).status,201);
  assert.equal((await submit()).status,429);assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM timeline_submissions').get().n,5);
});
test('submissions persist across database reopen; migration preserves existing comments',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'atlas-submissions-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,'test.sqlite');const binding=database(file,false);
  binding.sql.exec(readFileSync('drizzle/0000_curved_moonstone.sql','utf8'));
  binding.sql.prepare("INSERT INTO comments(id,entry,author_id,author_name,body,status,created_at,submission_key) VALUES ('c','the-ai-toy','u','Reader','Existing comment','approved',1,'key')").run();
  binding.sql.exec(readFileSync('drizzle/0001_low_bug.sql','utf8'));const {submit}=setup(t,binding);
  const id=(await submit()).body.id;binding.sql.close();const reopened=database(file,false);
  assert.equal(reopened.sql.prepare('SELECT id FROM timeline_submissions').get().id,id);assert.equal(reopened.sql.prepare('SELECT body FROM comments').get().body,'Existing comment');reopened.sql.close();
});
test('owner and author lists paginate and use their query indexes',async t=>{
  const {binding,call}=setup(t);
  for(let i=0;i<27;i++)binding.sql.prepare("INSERT INTO timeline_submissions(id,author_id,url,title,reason,status,created_at,submission_key) VALUES (?,?,?,?,?,'pending',?,?)").run(String(i),reader.id,'https://example.org/'+i,'Title','Reason',i,String(i));
  for(const path of ['/api/submissions','/api/submissions/review']) {
    const user=path.endsWith('review')?owner:reader;const first=await call(path,{user});const second=await call(path+'?offset=25',{user});assert.equal(first.body.submissions.length,25);assert.equal(first.body.more,true);assert.equal(second.body.submissions.length,2);
  }
  for(const [column,value,index] of [['author_id',reader.id,'idx_submissions_author_created'],['status','pending','idx_submissions_status_created']]) {
    const plan=binding.sql.prepare(`EXPLAIN QUERY PLAN SELECT id FROM timeline_submissions WHERE ${column} = ? ORDER BY created_at`).all(value);assert.match(plan.map(x=>x.detail).join(' '),new RegExp(index));
  }
});
test('submission outages return a recoverable message',async t=>{
  const {call,env}=setup(t);delete env.DB;const result=await call('/api/submissions',{user:reader});assert.equal(result.status,503);assert.match(result.body.error,/submission/i);
});
