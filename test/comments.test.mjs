import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../src/worker.js';
import {database} from './d1.mjs';
const origin = 'https://atlas.example';
const assets = {'/index.html':{body:'Welcome',type:'text/html'},'/404.html':{body:'Missing',type:'text/html'},'/moderation/index.html':{body:'Owner moderation',type:'text/html'}};
const owner = {id:'owner-site-id',email:'owner@example.test'};
const reader = {id:'reader-site-id',email:'reader@example.test'};
function setup(t, binding = database()) {
  const env = {DB:binding, COMMENT_MODERATOR_EMAIL:owner.email};
  t.after(() => {try {binding.sql.close();} catch {}});
  const worker = createWorker(assets,['mcculloch-pitts','turing']);
  async function call(path, {user = null, data, headers = {}, method} = {}) {
    const h = {...(user ? {'oai-authenticated-user-id':user.id,'oai-authenticated-user-email':user.email} : {}),...headers};
    if(data) {h['Content-Type']='application/json'; if(!('Origin' in h)) h.Origin=origin;}
    const response = await worker.fetch(new Request(origin + path,{method:method || (data?'POST':'GET'),headers:h,...(data ? {body:JSON.stringify(data)} : {})}),env);
    const text = await response.text(); let body; try {body=JSON.parse(text);} catch {body=text;}
    return {status:response.status,body,headers:response.headers};
  }
  const submit = (opts={}) => call('/api/comments',{user:reader,data:{entry:'mcculloch-pitts',name:'A reader',body:'A useful question',submissionKey:crypto.randomUUID(),...opts}});
  return {call,submit,env,binding};
}
test('anonymous visitors read public content but cannot submit or access private views', async t => {
  const {call}=setup(t);
  assert.equal((await call('/')).status,200);
  assert.deepEqual((await call('/api/session')).body,{signedIn:false,isModerator:false,account:null});
  assert.equal((await call('/api/comments',{data:{}})).status,401);
  assert.equal((await call('/api/comments/mine?entry=mcculloch-pitts')).status,401);
  assert.equal((await call('/api/moderation')).status,401);
  const page=await call('/moderation/'); assert.equal(page.status,302); assert.match(page.headers.get('location'),/^\/signin-with-chatgpt\?return_to=/);
});
test('owner permission is server-enforced; payload roles and another account do not grant it',async t=>{
  const {call,env}=setup(t);
  assert.equal((await call('/api/session',{user:owner})).body.isModerator,true);
  assert.equal((await call('/api/session',{user:reader})).body.isModerator,false);
  assert.equal((await call('/api/moderation',{user:reader})).status,403);
  assert.equal((await call('/api/moderation',{user:reader,data:{isModerator:true,authorId:owner.id}})).status,403);
  assert.equal((await call('/moderation/',{user:reader})).status,403);
  delete env.COMMENT_MODERATOR_EMAIL;
  assert.equal((await call('/api/moderation',{user:owner})).status,403);
});
test('cross-site and missing-origin writes are rejected',async t=>{
  const {call}=setup(t);
  for(const headers of [{Origin:'https://other.example'},{Origin:''},{Origin:origin,'Sec-Fetch-Site':'cross-site'}]) {
    assert.equal((await call('/api/comments',{user:reader,data:{},headers})).status,403);
  }
});
test('submission validates entry, name, size, empty content, and idempotency key',async t=>{
  const {submit}=setup(t);
  for(const data of [{entry:'unknown'},{name:' '},{name:'x'.repeat(61)},{name:'x\ny'},{body:' '},{body:'x'.repeat(3001)},{submissionKey:'bad'}]) assert.equal((await submit(data)).status,400);
});
test('pending comments are private to their authenticated author and owner',async t=>{
  const {submit,call}=setup(t); await submit({authorId:owner.id,status:'approved',name:'<script>bad</script>',body:'<img src=x onerror=alert(1)>'});
  assert.equal((await call('/api/comments?entry=mcculloch-pitts')).body.comments.length,0);
  assert.equal((await call('/api/comments/mine?entry=mcculloch-pitts',{user:reader})).body.comments.length,1);
  assert.equal((await call('/api/comments/mine?entry=mcculloch-pitts',{user:owner})).body.comments.length,0);
  const queue=(await call('/api/moderation',{user:owner})).body.comments;
  assert.equal(queue.length,1); assert.equal(queue[0].status,'pending');
  assert.equal(queue[0].body,'<img src=x onerror=alert(1)>');
  assert.ok(!('author_id' in queue[0])); assert.ok(!('email' in queue[0]));
});
test('owner can approve, remove, restore to review, and reject; each transition is audited',async t=>{
  const {call,submit,binding}=setup(t); const id=(await submit()).body.id;
  let current='pending';
  for(const status of ['approved','removed','pending','rejected']) {
    assert.equal((await call('/api/moderation',{user:owner,data:{id,status,expectedStatus:current}})).status,200);
    const visible=(await call('/api/comments?entry=mcculloch-pitts')).body.comments;
    assert.equal(visible.length,status==='approved'?1:0); current=status;
  }
  assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM moderation_events').get().n,4);
  assert.equal((await call('/api/moderation',{user:owner,data:{id,status:'approved',expectedStatus:'pending'}})).status,409);
});
test('retries do not duplicate a comment and rate limiting applies atomically',async t=>{
  const {submit,binding}=setup(t); const submissionKey=crypto.randomUUID();
  const first=await submit({submissionKey}); const retry=await submit({submissionKey});
  assert.equal(first.body.id,retry.body.id);
  for(let i=0;i<4;i++) assert.equal((await submit()).status,201);
  assert.equal((await submit()).status,429);
  assert.equal(binding.sql.prepare('SELECT COUNT(*) AS n FROM comments').get().n,5);
});
test('API responses are not cached; approved comments never expose account identifiers',async t=>{
  const {call,submit}=setup(t); const id=(await submit()).body.id;
  await call('/api/moderation',{user:owner,data:{id,status:'approved',expectedStatus:'pending'}});
  const r=await call('/api/comments?entry=mcculloch-pitts');
  assert.match(r.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Object.keys(r.body.comments[0]).sort(),['id','entry','author_name','body','status','created_at'].sort());
});
test('comment data survives a database reopen',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'atlas-comments-')); t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'comments.sqlite'); const binding=database(path); const {submit}=setup(t,binding);
  const submitted=await submit(); binding.sql.close(); const reopened=database(path,false);
  assert.equal(reopened.sql.prepare('SELECT id FROM comments').get().id,submitted.body.id); reopened.sql.close();
});
test('public query uses the entry/status index and pages results',async t=>{
  const {binding,call}=setup(t);
  for(let i=0;i<27;i++) binding.sql.prepare("INSERT INTO comments(id,entry,author_id,author_name,body,status,created_at,submission_key) VALUES (?,?,?,?,?,'approved',?,?)").run(String(i),'turing','u'+i,'Reader','Comment',i,String(i));
  const first=await call('/api/comments?entry=turing'); const second=await call('/api/comments?entry=turing&offset=25');
  assert.equal(first.body.comments.length,25); assert.equal(first.body.more,true); assert.equal(second.body.comments.length,2);
  const plan=binding.sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM comments WHERE entry = ? AND status = 'approved' ORDER BY created_at").all('turing');
  assert.match(plan.map(x=>x.detail).join(' '),/idx_comments_entry_status_created/);
});
test('database failures produce a recoverable error without clearing a draft',async t=>{
  const {call,env}=setup(t); delete env.DB;
  const result=await call('/api/comments?entry=turing'); assert.equal(result.status,503); assert.match(result.body.error,/draft has not been cleared/);
});
