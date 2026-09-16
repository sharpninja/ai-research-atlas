// Aggregate requests only: no IP addresses, user IDs, cookies, or full referrer URLs.
export async function recordPageView(request, env, path) {
  const day = new Date().toISOString().slice(0, 10);
  let referrer = 'Direct / unknown';
  try {
    const from = new URL(request.headers.get('referer'));
    if (['http:', 'https:'].includes(from.protocol)) {
      referrer = from.origin === new URL(request.url).origin ? 'Internal navigation' : from.hostname.slice(0, 253);
    }
  } catch { /* Referrer was absent or invalid. */ }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO analytics_meta (key, value) VALUES ('started_at', ?) ON CONFLICT(key) DO NOTHING").bind(new Date().toISOString()),
    env.DB.prepare(`INSERT INTO page_views_daily (day, path, referrer, views) VALUES (?, ?, ?, 1)
      ON CONFLICT(day, path, referrer) DO UPDATE SET views = views + 1`).bind(day, path, referrer),
  ]);
}

export async function analyticsSummary(env, days, pageNames) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400000;
  const start = new Date(startMs).toISOString().slice(0, 10);
  const until = startMs + days * 86400000;
  const database = env.DB;
  const [daily, pages, referrers, comments, submissions, pendingComments, pendingSubmissions, meta] = await Promise.all([
    database.prepare('SELECT day, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day').bind(start, end).all(),
    database.prepare('SELECT path, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY path ORDER BY views DESC, path LIMIT 20').bind(start, end).all(),
    database.prepare('SELECT referrer, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY referrer ORDER BY views DESC, referrer LIMIT 20').bind(start, end).all(),
    database.prepare('SELECT COUNT(*) AS count FROM comments WHERE created_at >= ? AND created_at < ?').bind(startMs, until).first(),
    database.prepare('SELECT COUNT(*) AS count FROM timeline_submissions WHERE created_at >= ? AND created_at < ?').bind(startMs, until).first(),
    database.prepare("SELECT COUNT(*) AS count FROM comments WHERE status = 'pending'").first(),
    database.prepare("SELECT COUNT(*) AS count FROM timeline_submissions WHERE status = 'pending'").first(),
    database.prepare("SELECT value FROM analytics_meta WHERE key = 'started_at'").first(),
  ]);
  const byDay = new Map(daily.results.map(row => [row.day, row.views]));
  return {
    days, start, end, generatedAt: now.toISOString(), startedAt: meta?.value || null,
    totals: {pageViews: daily.results.reduce((sum, row) => sum + row.views, 0), comments: comments.count, submissions: submissions.count},
    pending: {comments: pendingComments.count, submissions: pendingSubmissions.count},
    daily: Array.from({length: days}, (_, i) => {
      const day = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      return {day, views: byDay.get(day) || 0, collected: !!meta && day >= meta.value.slice(0, 10)};
    }),
    pages: pages.results.map(row => ({...row, title: pageNames[row.path] || row.path})),
    referrers: referrers.results,
  };
}
