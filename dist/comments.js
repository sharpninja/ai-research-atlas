const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
async function api(path, data) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(data ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete this request. Please try again.');
  return result;
}
const statusLabels = {pending:'Awaiting approval', approved:'Published', rejected:'Not approved', removed:'Removed from public view'};
function card(comment, showStatus = false) {
  const article = el('article', undefined, 'comment');
  const heading = el('div', undefined, 'comment-heading');
  heading.append(el('strong', comment.author_name));
  const date = el('time', new Date(comment.created_at).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'}));
  date.dateTime = new Date(comment.created_at).toISOString(); heading.append(date);
  article.append(heading, el('p', comment.body, 'comment-body'));
  if (showStatus) article.append(el('p', statusLabels[comment.status], 'comment-status'));
  return article;
}
function button(text, action) { const b = el('button', text, 'button secondary'); b.type = 'button'; b.addEventListener('click', action); return b; }
async function loadEntry(session) {
  const section = document.querySelector('[data-comments-entry]'); if (!section) return;
  const entry = section.dataset.commentsEntry;
  const list = document.querySelector('#comment-list');
  const notice = document.querySelector('#comments-notice');
  const more = document.querySelector('#comments-more');
  let offset = 0;
  async function publicComments(append = false) {
    more.disabled = true;
    try {
      const data = await api('/api/comments?entry=' + encodeURIComponent(entry) + '&offset=' + offset);
      if (!append) list.replaceChildren();
      for (const item of data.comments) list.append(card(item));
      offset += data.comments.length; more.hidden = !data.more;
      notice.textContent = offset ? '' : 'No published comments yet. Start the conversation.';
    } catch (error) { notice.textContent = error.message; more.hidden = false; more.textContent = 'Retry loading comments'; }
    finally { more.disabled = false; }
  }
  more.addEventListener('click', () => publicComments(true));
  await publicComments();
  if (!session.signedIn) return;
  document.querySelector('#comment-signin').hidden = true;
  const form = document.querySelector('#comment-form'); form.hidden = false;
  document.querySelector('#comment-account').textContent = 'Signed in as ' + session.account;
  const own = document.querySelector('#my-comments');
  async function ownComments() {
    const data = await api('/api/comments/mine?entry=' + encodeURIComponent(entry));
    own.replaceChildren();
    if (data.comments.length) {
      own.append(el('h3', 'Your unpublished comments'), el('p', 'Only you and the site owner can see these comments. Showing your 50 most recent unpublished comments.', 'small'));
      for (const item of data.comments) own.append(card(item, true));
    }
  }
  const message = document.querySelector('#comment-feedback');
  try { await ownComments(); } catch(error) { message.textContent = error.message; }
  let submissionKey = crypto.randomUUID();
  // Keep a retry's key until success; changing the draft starts a new submission.
  form.addEventListener('input', () => { submissionKey = crypto.randomUUID(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const fields = new FormData(form); const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true; message.textContent = 'Submitting your comment…';
    try {
      await api('/api/comments', {entry, name:fields.get('name'), body:fields.get('body'), submissionKey});
      form.elements.body.value = ''; submissionKey = crypto.randomUUID();
      message.textContent = 'Your comment has been submitted. It will appear publicly after the site owner approves it.';
      try { await ownComments(); } catch { message.textContent += ' Your comment was saved, but the list could not refresh.'; }
    } catch(error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });
}
async function loadModeration(session) {
  const page = document.querySelector('#moderation-panel'); if (!page) return;
  const notice = document.querySelector('#moderation-notice');
  if (!session.isModerator) { notice.textContent = 'Moderation is limited to the site owner.'; return; }
  const list = document.querySelector('#moderation-list');
  const select = document.querySelector('#moderation-status');
  const previous = document.querySelector('#moderation-previous');
  const next = document.querySelector('#moderation-next');
  const refresh = document.querySelector('#moderation-refresh');
  let offset = 0; let loading = false;
  async function load() {
    if (loading) return; loading = true; page.setAttribute('aria-busy','true');
    select.disabled = previous.disabled = next.disabled = refresh.disabled = true;
    list.querySelectorAll('button').forEach(b => { b.disabled = true; });
    notice.textContent = 'Loading comments…';
    try {
      let data = await api('/api/moderation?status=' + select.value + '&offset=' + offset);
      if (!data.comments.length && offset > 0) { offset = Math.max(0, offset - 25); data = await api('/api/moderation?status=' + select.value + '&offset=' + offset); }
      list.replaceChildren();
      for (const comment of data.comments) {
        const item = card(comment, true);
        const link = el('a', 'Open research entry'); link.href = '/entries/' + encodeURIComponent(comment.entry) + '/#comments'; item.prepend(link);
        const actions = el('div', undefined, 'comment-actions');
        const options = comment.status === 'pending' ? [['approved','Approve'],['rejected','Reject']] : comment.status === 'approved' ? [['removed','Remove from public view']] : [['pending','Return to review']];
        for (const [status, label] of options) actions.append(button(label, async () => {
          if (loading) return; loading = true;
          select.disabled = previous.disabled = next.disabled = refresh.disabled = true;
          list.querySelectorAll('button').forEach(b => { b.disabled = true; });
          try {
            await api('/api/moderation', {id:comment.id, status, expectedStatus:comment.status});
            loading = false; await load(); notice.textContent = 'Comment ' + statusLabels[status].toLowerCase() + '.';
          } catch(error) { notice.textContent = error.message; }
          finally {
            loading = false; select.disabled = refresh.disabled = false;
            previous.disabled = offset === 0; next.disabled = !data.more;
            list.querySelectorAll('button').forEach(b => { b.disabled = false; });
          }
        }));
        item.append(actions); list.append(item);
      }
      document.querySelector('#moderation-counts').textContent = statesCount(data.counts);
      notice.textContent = data.comments.length ? 'Showing comments ' + (offset + 1) + '–' + (offset + data.comments.length) + '.' : 'No comments in this queue.';
      previous.disabled = offset === 0; next.disabled = !data.more;
    } catch(error) { notice.textContent = error.message; }
    finally { loading = false; page.setAttribute('aria-busy','false'); select.disabled = refresh.disabled = false; list.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  select.addEventListener('change', () => {offset = 0; load();});
  refresh.addEventListener('click', () => load());
  previous.addEventListener('click', () => {offset = Math.max(0,offset-25); load();});
  next.addEventListener('click', () => {offset += 25; load();});
  await load();
}
function statesCount(rows) { return ['pending','approved','rejected','removed'].map(s => statusLabels[s] + ': ' + (rows.find(r => r.status === s)?.count || 0)).join(' · '); }
(async () => {
  try {
    const session = await api('/api/session');
    document.querySelectorAll('[data-owner-nav]').forEach(link => {link.hidden = !session.isModerator;});
    await Promise.all([loadEntry(session), loadModeration(session)]);
  } catch(error) {
    for (const id of ['comments-notice','moderation-notice']) { const target = document.getElementById(id); if(target) target.textContent = error.message; }
    const retry = document.querySelector('#comments-more');
    if (retry) { retry.hidden = false; retry.textContent = 'Retry'; retry.addEventListener('click', () => location.reload(), {once:true}); }
  }
})();
