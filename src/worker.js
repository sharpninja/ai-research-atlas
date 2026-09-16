// The Sites dispatcher owns sign-in and supplies the trusted identity headers.
// Never deploy this handler behind a proxy that passes visitor-supplied identity headers.
function userFrom(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return id && email ? { id, email } : null;
}
function moderator(user, env) {
  return !!user && !!env.COMMENT_MODERATOR_EMAIL &&
    user.email.trim().toLowerCase() === env.COMMENT_MODERATOR_EMAIL.trim().toLowerCase();
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store', 'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  }});
}
const bad = (message, status = 400) => json({ error: message }, status);
function db(env) { if (!env.DB) throw new Error('Comment database is unavailable'); return env.DB; }
const publicFields = 'id, entry, author_name, body, status, created_at';
const states = ['pending', 'approved', 'rejected', 'removed'];
const submissionStates = ['pending', 'shortlisted', 'declined'];
const submissionFields = 'id, url, title, reason, status, created_at';
function offsetFrom(url) { const n = Number(url.searchParams.get('offset') || 0); return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : 0; }
async function payload(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  // Bound streamed payloads even when Content-Length is missing or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return null;
  let length = 0; const chunks = [];
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length;
    if (length > 20000) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
function sameOrigin(request, url) {
  return request.headers.get('origin') === url.origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
}
export function createWorker(assets, entries) {
  const validEntries = new Set(entries);
  return { async fetch(request, env) {
    const url = new URL(request.url);
    const user = userFrom(request);
    const isModerator = moderator(user, env);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(request.method)) return bad('Method not allowed.', 405);
        if (request.method === 'POST') {
          if (!user) return bad('Sign in with ChatGPT to continue.', 401);
          if (!sameOrigin(request, url)) return bad('Please submit from this site.', 403);
        }
        if (url.pathname === '/api/session' && request.method === 'GET') {
          return json({ signedIn: !!user, isModerator, account: user?.email || null });
        }
        if (url.pathname === '/api/submissions' || url.pathname === '/api/submissions/review') {
          if (!user) return bad('Sign in with ChatGPT to continue.', 401);
          const reviewing = url.pathname.endsWith('/review');
          if (reviewing && !isModerator) return bad('Submission review is limited to the site owner.', 403);
          if (request.method === 'GET') {
            const status = url.searchParams.get('status') || 'pending';
            if (reviewing && !submissionStates.includes(status)) return bad('Unknown submission status.');
            const rows = await db(env).prepare(`SELECT ${submissionFields} FROM timeline_submissions WHERE ${reviewing ? 'status' : 'author_id'} = ? ORDER BY created_at DESC, id DESC LIMIT 26 OFFSET ?`).bind(reviewing ? status : user.id, offsetFrom(url)).all();
            return json({ submissions: rows.results.slice(0,25), more: rows.results.length > 25 });
          }
          const data = await payload(request);
          if (reviewing) {
            if (!data || typeof data.id !== 'string' || !submissionStates.includes(data.status) || !submissionStates.includes(data.expectedStatus)) return bad('Invalid review action.');
            const current = await db(env).prepare('SELECT status FROM timeline_submissions WHERE id = ?').bind(data.id).first();
            if (!current) return bad('Submission not found.', 404);
            if (current.status !== data.expectedStatus) return bad('This submission changed. Refresh the queue before trying again.', 409);
            const now = Date.now();
            const result = await db(env).batch([
              db(env).prepare('UPDATE timeline_submissions SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = ?').bind(data.status,now,user.id,data.id,data.expectedStatus),
              db(env).prepare('INSERT INTO submission_events (id, submission_id, actor_id, status, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(crypto.randomUUID(),data.id,user.id,data.status,now),
            ]);
            if (result[0].meta.changes !== 1) return bad('This submission changed. Refresh the queue before trying again.', 409);
            return json({status:data.status});
          }
          if (!data) return bad('Enter a link, title, and explanation.');
          let link;
          try {
            if (typeof data.url !== 'string' || data.url.length > 2048 || /[\u0000-\u001f\u007f]/.test(data.url)) throw new Error('Invalid URL');
            link = new URL(data.url.trim());
            if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password || link.href.length > 2048) throw new Error('Invalid URL');
          } catch { return bad('Enter a complete http or https link without embedded login details.'); }
          const title = typeof data.title === 'string' ? data.title.trim() : '';
          const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
          if (!title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title)) return bad('Enter a title between 1 and 200 characters.');
          if (!reason || reason.length > 2000) return bad('Explain the suggestion in 1 to 2,000 characters.');
          if (typeof data.submissionKey !== 'string' || !/^[a-f0-9-]{36}$/.test(data.submissionKey)) return bad('Please reload and try again.');
          const prior = await db(env).prepare('SELECT id, status FROM timeline_submissions WHERE author_id = ? AND submission_key = ?').bind(user.id,data.submissionKey).first();
          if (prior) return json(prior);
          const now = Date.now();
          await db(env).prepare(`INSERT INTO timeline_submissions (id, author_id, url, title, reason, status, created_at, submission_key)
            SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE
            (SELECT COUNT(*) FROM timeline_submissions WHERE author_id = ? AND created_at > ?) < 5
            ON CONFLICT(author_id, submission_key) DO NOTHING`).bind(crypto.randomUUID(),user.id,link.href,title,reason,now,data.submissionKey,user.id,now-600000).run();
          const inserted = await db(env).prepare('SELECT id, status FROM timeline_submissions WHERE author_id = ? AND submission_key = ?').bind(user.id,data.submissionKey).first();
          if (!inserted) return bad('You have submitted several links. Please wait a few minutes before trying again.', 429);
          return json(inserted,201);
        }
        if (url.pathname === '/api/comments' && request.method === 'GET') {
          const entry = url.searchParams.get('entry');
          if (!validEntries.has(entry)) return bad('Entry not found.', 404);
          const offset = offsetFrom(url);
          const rows = await db(env).prepare(`SELECT ${publicFields} FROM comments WHERE entry = ? AND status = 'approved' ORDER BY created_at, id LIMIT 26 OFFSET ?`).bind(entry, offset).all();
          return json({ comments: rows.results.slice(0, 25), more: rows.results.length > 25 });
        }
        if (url.pathname === '/api/comments/mine' && request.method === 'GET') {
          if (!user) return bad('Sign in with ChatGPT to continue.', 401);
          const entry = url.searchParams.get('entry');
          if (!validEntries.has(entry)) return bad('Entry not found.', 404);
          const rows = await db(env).prepare(`SELECT ${publicFields} FROM comments WHERE entry = ? AND author_id = ? AND status != 'approved' ORDER BY created_at DESC, id DESC LIMIT 50`).bind(entry, user.id).all();
          return json({ comments: rows.results });
        }
        if (url.pathname === '/api/comments' && request.method === 'POST') {
          const data = await payload(request);
          if (!data || !validEntries.has(data.entry)) return bad('Choose a valid entry.');
          const body = typeof data.body === 'string' ? data.body.trim() : '';
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          if (!body || body.length > 3000) return bad('Write a comment between 1 and 3,000 characters.');
          if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) return bad('Use a display name between 1 and 60 characters.');
          if (typeof data.submissionKey !== 'string' || !/^[a-f0-9-]{36}$/.test(data.submissionKey)) return bad('Please reload and try again.');
          const prior = await db(env).prepare('SELECT id, status FROM comments WHERE author_id = ? AND submission_key = ?').bind(user.id, data.submissionKey).first();
          if (prior) return json(prior);
          const id = crypto.randomUUID(); const now = Date.now();
          // Atomic rate limit and idempotent retry: no duplicate posts after a network timeout.
          await db(env).prepare(`INSERT INTO comments (id, entry, author_id, author_name, body, status, created_at, submission_key)
            SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE
            (SELECT COUNT(*) FROM comments WHERE author_id = ? AND created_at > ?) < 5
            ON CONFLICT(author_id, submission_key) DO NOTHING`).bind(id, data.entry, user.id, name, body, now, data.submissionKey, user.id, now - 600000).run();
          const inserted = await db(env).prepare('SELECT id, status FROM comments WHERE author_id = ? AND submission_key = ?').bind(user.id, data.submissionKey).first();
          if (!inserted) return bad('You have submitted several comments. Please wait a few minutes before trying again.', 429);
          return json(inserted, 201);
        }
        if (url.pathname === '/api/moderation' && request.method === 'GET') {
          if (!user) return bad('Sign in with ChatGPT to continue.', 401);
          if (!isModerator) return bad('Moderation is limited to the site owner.', 403);
          const status = url.searchParams.get('status') || 'pending';
          if (!states.includes(status)) return bad('Unknown comment status.');
          const rows = await db(env).prepare(`SELECT ${publicFields} FROM comments WHERE status = ? ORDER BY created_at, id LIMIT 26 OFFSET ?`).bind(status, offsetFrom(url)).all();
          const counts = await db(env).prepare('SELECT status, COUNT(*) AS count FROM comments GROUP BY status').all();
          return json({ comments: rows.results.slice(0, 25), more: rows.results.length > 25, counts: counts.results });
        }
        if (url.pathname === '/api/moderation' && request.method === 'POST') {
          if (!isModerator) return bad('Moderation is limited to the site owner.', 403);
          const data = await payload(request);
          if (!data || typeof data.id !== 'string' || !states.includes(data.status) || !states.includes(data.expectedStatus)) return bad('Invalid moderation action.');
          const current = await db(env).prepare('SELECT id, status FROM comments WHERE id = ?').bind(data.id).first();
          if (!current) return bad('Comment not found.', 404);
          if (current.status !== data.expectedStatus) return bad('This comment changed. Refresh the queue before trying again.', 409);
          const now = Date.now();
          const result = await db(env).batch([
            db(env).prepare('UPDATE comments SET status = ?, moderated_at = ?, moderated_by = ? WHERE id = ? AND status = ?').bind(data.status, now, user.id, data.id, data.expectedStatus),
            db(env).prepare('INSERT INTO moderation_events (id, comment_id, actor_id, status, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(crypto.randomUUID(), data.id, user.id, data.status, now),
          ]);
          if (result[0].meta.changes !== 1) return bad('This comment changed. Refresh the queue before trying again.', 409);
          return json({ status: data.status });
        }
        return bad('Not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return bad('Method not allowed.', 405);
      if (url.pathname === '/submit' || url.pathname.startsWith('/submit/')) {
        if (!user) return new Response(null, {status:302, headers:{Location:'/signin-with-chatgpt?return_to=%2Fsubmit%2F', 'Cache-Control':'private, no-store'}});
      }
      if (url.pathname === '/moderation' || url.pathname.startsWith('/moderation/')) {
        const returnTo = url.pathname.startsWith('/moderation/submissions') ? '/moderation/submissions/' : '/moderation/';
        if (!user) return new Response(null, {status:302, headers:{Location:'/signin-with-chatgpt?return_to=' + encodeURIComponent(returnTo), 'Cache-Control':'private, no-store'}});
        if (!isModerator) return new Response('Moderation is limited to the site owner.', {status:403, headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store'}});
      }
      let path = url.pathname;
      if (!path.endsWith('/') && assets[path + '/index.html']) return new Response(null, {status:308, headers:{Location:path + '/' + url.search}});
      if (path.endsWith('/')) path += 'index.html';
      const asset = assets[path] || assets['/404.html'];
      const status = assets[path] ? 200 : 404;
      return new Response(request.method === 'HEAD' ? null : asset.body, {status, headers:{
        'Content-Type': asset.type, 'X-Content-Type-Options':'nosniff',
        'Cache-Control': url.pathname.startsWith('/moderation') || url.pathname.startsWith('/submit') ? 'private, no-store' : 'public, max-age=60',
        'Referrer-Policy':'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
      }});
    } catch (error) {
      console.error('Atlas request failed', error instanceof Error ? error.message : 'Unknown error');
      const feature = url.pathname.startsWith('/api/submissions') ? 'Submissions' : 'Comments';
      return bad(feature + ' are temporarily unavailable. Please try again; your draft has not been cleared.', 503);
    }
  }};
}
