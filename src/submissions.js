const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
async function request(path, data) {
  const response = await fetch(path, {credentials:'same-origin',cache:'no-store',...(data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {})});
  let result;
  try { result = await response.json(); } catch { throw new Error('Unable to reach submissions. Please try again.'); }
  if (response.status === 401) throw new Error('Your sign-in expired. Reload this page to sign in again.');
  if (!response.ok) throw new Error(result.error || 'Unable to complete this request. Please try again.');
  return result;
}
const labels = {pending:'Awaiting review',shortlisted:'Shortlisted',declined:'Not selected'};
const page = document.querySelector('[data-submission-list]');
const reviewing = page.dataset.submissionList === 'review';
const list = document.querySelector('#submissions-list');
const notice = document.querySelector('#submissions-notice');
const select = document.querySelector('#submissions-status');
const previous = document.querySelector('#submissions-previous');
const next = document.querySelector('#submissions-next');
const refresh = document.querySelector('#submissions-refresh');
let offset = 0, loading = false, more = false;
function setBusy(value) {
  loading = value; page.setAttribute('aria-busy',String(value));
  if (select) select.disabled = value;
  refresh.disabled = value; previous.disabled = value || offset === 0; next.disabled = value || !more;
  list.querySelectorAll('button').forEach(button => {button.disabled = value;});
}
function card(item) {
  const article = element('article',undefined,'comment submission-card');
  const heading = element('h3'); const link = element('a',item.title);
  // Render all user-provided text as text, and allow only web links.
  const url = new URL(item.url);
  if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  heading.append(link); article.append(heading,element('p',item.url,'small submission-url'),element('p',item.reason,'comment-body'));
  const metadata = element('p',labels[item.status] + ' · ','comment-status');
  const date = element('time',new Date(item.created_at).toLocaleDateString(undefined,{dateStyle:'medium'}));
  date.dateTime = new Date(item.created_at).toISOString(); metadata.append(date); article.append(metadata);
  if (reviewing) {
    const actions = element('div',undefined,'comment-actions');
    for (const [status,label] of [['shortlisted','Shortlist'],['declined','Not selected'],['pending','Return to review']]) {
      if (status === item.status) continue;
      const button = element('button',label,'button secondary');button.type='button';
      button.addEventListener('click',async()=>{
        if (loading) return;setBusy(true);
        try {
          await request('/api/submissions/review',{id:item.id,status,expectedStatus:item.status});
          const savedMessage='Suggestion marked ' + labels[status].toLowerCase() + '.';
          setBusy(false);await load();notice.textContent=savedMessage + ' ' + notice.textContent;
        } catch(error) {notice.textContent=error.message;} finally {setBusy(false);}
      });
      actions.append(button);
    }
    article.append(actions);
  }
  return article;
}
async function load() {
  if (loading) return;setBusy(true);notice.textContent='Loading suggestions...';
  const endpoint='/api/submissions'+(reviewing?'/review':'');
  const query=()=>'?offset='+offset+(reviewing?'&status='+select.value:'');
  try {
    let data=await request(endpoint+query());
    if (!data.submissions.length && offset > 0) {offset=Math.max(0,offset-25);data=await request(endpoint+query());}
    const cards=data.submissions.map(card);list.replaceChildren(...cards);more=data.more;
    notice.textContent=cards.length?'Showing suggestions '+(offset+1)+' to '+(offset+cards.length)+'.':reviewing?'No suggestions in this queue.':'You have not submitted any suggestions yet.';
  } catch(error) {notice.textContent=error.message;} finally {setBusy(false);}
}
select?.addEventListener('change',()=>{offset=0;load();});
refresh.addEventListener('click',()=>load());
previous.addEventListener('click',()=>{offset=Math.max(0,offset-25);load();});
next.addEventListener('click',()=>{offset+=25;load();});
const form=document.querySelector('#submission-form');
if (form) {
  let submissionKey=crypto.randomUUID();
  form.addEventListener('input',()=>{submissionKey=crypto.randomUUID();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const fields=new FormData(form),feedback=document.querySelector('#submission-feedback');
    const controls=[...form.elements];controls.forEach(control=>{control.disabled=true;});
    feedback.textContent='Submitting your suggestion...';
    try {
      await request('/api/submissions',{url:fields.get('url'),title:fields.get('title'),reason:fields.get('reason'),submissionKey});
      form.reset();submissionKey=crypto.randomUUID();feedback.textContent='Your suggestion was saved for the site owner to review.';
      offset=0;await load();
    } catch(error) {feedback.textContent=error.message;}
    finally {controls.forEach(control=>{control.disabled=false;});}
  });
  request('/api/session').then(session=>{
    document.querySelector('#submission-account').textContent=session.signedIn?'Signed in as '+session.account:'';
  }).catch(()=>{});
}
await load();
