// Aggregate requests only: no IP addresses, user IDs, raw user agents, or full referrer URLs.
function deviceType(request) {
  const agent = request.headers.get('user-agent') || '';
  // Tablet checks precede Mobile because iPads also send a Mobile token.
  if (/ipad|tablet|kindle|silk/i.test(agent) || (/android/i.test(agent) && !/mobile/i.test(agent))) return 'tablet';
  if (request.headers.get('sec-ch-ua-mobile') === '?1' || /iphone|ipod|mobile|windows phone/i.test(agent)) return 'mobile';
  if (/windows nt|macintosh|x11|cros/i.test(agent)) return 'desktop';
  return 'unknown';
}

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
    env.DB.prepare("INSERT INTO analytics_meta (key, value) VALUES ('device_started_at', ?) ON CONFLICT(key) DO NOTHING").bind(new Date().toISOString()),
    env.DB.prepare(`INSERT INTO device_views_daily (day, device_type, views) VALUES (?, ?, 1)
      ON CONFLICT(day, device_type) DO UPDATE SET views = views + 1`).bind(day, deviceType(request)),
  ]);
}

export async function analyticsSummary(env, days, pageNames) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400000;
  const start = new Date(startMs).toISOString().slice(0, 10);
  const until = startMs + days * 86400000;
  const database = env.DB;
  const [daily, pages, referrers, comments, submissions, pendingComments, pendingSubmissions, meta, devices, deviceMeta] = await Promise.all([
    database.prepare('SELECT day, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day').bind(start, end).all(),
    database.prepare('SELECT path, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY path ORDER BY views DESC, path LIMIT 20').bind(start, end).all(),
    database.prepare('SELECT referrer, SUM(views) AS views FROM page_views_daily WHERE day >= ? AND day <= ? GROUP BY referrer ORDER BY views DESC, referrer LIMIT 20').bind(start, end).all(),
    database.prepare('SELECT COUNT(*) AS count FROM comments WHERE created_at >= ? AND created_at < ?').bind(startMs, until).first(),
    database.prepare('SELECT COUNT(*) AS count FROM timeline_submissions WHERE created_at >= ? AND created_at < ?').bind(startMs, until).first(),
    database.prepare("SELECT COUNT(*) AS count FROM comments WHERE status = 'pending'").first(),
    database.prepare("SELECT COUNT(*) AS count FROM timeline_submissions WHERE status = 'pending'").first(),
    database.prepare("SELECT value FROM analytics_meta WHERE key = 'started_at'").first(),
    database.prepare('SELECT device_type, SUM(views) AS views FROM device_views_daily WHERE day >= ? AND day <= ? GROUP BY device_type').bind(start, end).all(),
    database.prepare("SELECT value FROM analytics_meta WHERE key = 'device_started_at'").first(),
  ]);
  const byDay = new Map(daily.results.map(row => [row.day, row.views]));
  const totalViews = daily.results.reduce((sum, row) => sum + row.views, 0);
  const byDevice = new Map(devices.results.map(row => [row.device_type, row.views]));
  // Old aggregates never recorded devices; retain their views as unknown.
  const legacyViews = Math.max(0, totalViews - devices.results.reduce((sum, row) => sum + row.views, 0));
  byDevice.set('unknown', (byDevice.get('unknown') || 0) + legacyViews);
  return {
    days, start, end, generatedAt: now.toISOString(), startedAt: meta?.value || null,
    deviceStartedAt: deviceMeta?.value || null,
    devices: ['desktop', 'mobile', 'tablet', 'unknown'].map(deviceType => ({deviceType, views: byDevice.get(deviceType) || 0})),
    totals: {pageViews: totalViews, comments: comments.count, submissions: submissions.count},
    pending: {comments: pendingComments.count, submissions: pendingSubmissions.count},
    daily: Array.from({length: days}, (_, i) => {
      const day = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      return {day, views: byDay.get(day) || 0, collected: !!meta && day >= meta.value.slice(0, 10)};
    }),
    pages: pages.results.map(row => ({...row, title: pageNames[row.path] || row.path})),
    referrers: referrers.results,
  };
}
