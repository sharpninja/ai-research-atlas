# AI Research Atlas

## Owner analytics

`/analytics/` and `GET /api/analytics?days=7|30|90` use the same server-enforced owner identity as moderation. Anonymous requests are sent to ChatGPT sign-in; other accounts receive 403. Missing owner configuration denies access. Dashboard/API responses are private and uncached; a footer link appears for the signed-in owner.

Successful public HTML requests increment daily D1 counters by canonical path and referring domain, plus separate daily device totals in the same transaction. Device type is estimated as desktop, mobile, tablet, or unknown from browser signals; raw user agents are never stored. Earlier views remain unknown. The Worker excludes recognized owner traffic, known bots, prefetch, private pages, redirects, errors, assets, and HEAD requests. Verified owner responses set the host-only `__Host-atlas_analytics_excluded=1` cookie (Secure, HttpOnly, SameSite=Lax, one year), preserving exclusion after sign-out in that browser. Sign in once on each browser; clearing cookies resets the preference. The preference never grants access to private pages or APIs. Older anonymous owner visits cannot be separated from existing aggregate totals.

These are page views, not unique visitors. No IP addresses, user identifiers, raw user agents, or full referrer URLs are stored. The exclusion cookie contains no visitor identifier. `waitUntil` retains writes after the response; failures do not prevent reading. Tracking starts with the first eligible view, with no historical traffic backfill. Dates use UTC, with unavailable earlier days distinguished from observed zeroes. Comment/submission period totals use existing creation dates; pending queues cover all dates.

The additive analytics migration preserves existing content. Tests cover route/API authorization, missing configuration, aggregate persistence, filtering, referrer minimization, period bounds, failure handling, and the welcome page's closing link to the first chronological entry.

The welcome page introduces AI research in plain language. `/timeline/` presents a 67-entry chronology; every `/entries/:slug/` page has moderated comments. The 1990 entry, `/entries/the-ai-toy/`, describes Kevin E. Martin's Gazette articles and C64 programs, with its extended narrative in `ai-toy.html`. Legacy homepage era fragments forward to the timeline.

On a first visit, `/` shows the welcome introduction. Successful HTML visits set the host-only `atlas_visited=1` cookie for one year (Secure, HttpOnly, SameSite=Lax). Returning requests to `/` or `/index.html` redirect to `/timeline/`; `/welcome/` always opens the introduction. Clearing the cookie restores first-visit behavior. HTML responses are private and uncached so cookie-setting responses and redirects cannot be shared between visitors. APIs, assets, errors, and HEAD requests do not set the visit cookie. Owner-only comment moderation links appear inside each entry's comments section.

## Build and validation

`npm ci`, `npm run build`, and `npm test`. Node 22.13+ is required for the local SQLite test adapter. The content generator remains `build.ps1` with `research.psd1`; the build runner reads both as UTF-8 on Windows. `dist/style.css` is the original authored stylesheet. `src/additions.css` extends it.

`npm run db:generate` generates Drizzle migrations after schema changes. Review and commit the SQL and metadata. Sites applies these migrations before deployment; never edit an applied migration.

The build emits a self-contained Cloudflare Worker at `dist/server/index.js`, with static pages embedded to preserve the existing small static-site architecture. `.openai/hosting.json` declares the Sites-managed D1 `DB` binding. There are no external runtime dependencies.

## Authentication and moderation

Sites owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback`. Use top-level links. The Worker reads only the dispatch-provided `oai-authenticated-user-id` and `oai-authenticated-user-email` headers. It must run behind the Sites dispatcher, which provides trusted identity. Never put it behind a proxy that forwards client-controlled identity headers.

`COMMENT_MODERATOR_EMAIL` is a secret runtime value configured through Sites using the verified site's owner email. It is compared only against the platform-authenticated email on the server. Without it, moderation fails closed. Stable site-scoped IDs own comments and audit actions; user IDs and account emails never appear in public comments. Display names are chosen by commenters and are not verified identities.

New comments are pending. Only approved comments are public. A signed-in author sees their latest 50 unpublished submissions. The owner can review all entries at `/moderation/`, approve or reject, remove a published comment, and return rejected/removed comments to review. Removal preserves the record and audit history. Moderation APIs enforce owner authorization independently of the UI.

POSTs require authenticated identity, matching Origin, and JSON. Body sizes are bounded, SQL is parameterized, public text is rendered using textContent, and five submissions per ten minutes are allowed per account. Idempotency keys prevent duplicate retries. API responses and moderation pages are never publicly cached.

Tests use local SQLite with the actual generated migrations. They cover anonymous/author/owner permissions, private pending comments, approval and removal, audit history, CSRF, validation, retries, rate limits, persistence, pagination, links, every entry, and the built Worker. Tests do not log into a real OpenAI account.

## Timeline submissions

`/submit/` requires OpenAI sign-in and accepts an HTTP(S) source URL, title, and explanation. Suggestions are stored in D1 and visible only to their submitter and the site owner. The owner reviews them at `/moderation/submissions/`, using the same server-enforced owner identity as comment moderation. States are pending, shortlisted, and declined; shortlisting does not automatically change the editorial timeline.

Submissions use bounded JSON input, prepared SQL, same-origin writes, per-account rate limits, retry keys, private uncached responses, text-only rendering of user content, paginated lists, and an audit trail for review changes. Submitted URLs are stored and displayed; the server does not fetch them. The additive migration preserves existing comment tables. Tests exercise authentication, privacy, URL validation, owner actions, stale updates, retry behavior, rate limiting, persistence, and query indexes.

## Topic navigation

Every research record has curated `Tags`. Entry pages show clickable topic clouds; tag size reflects the number of matching Atlas entries. Timeline rows expose the same tags. The timeline topic selector filters entries and era navigation, updates counts, supports clearing, and stores the selection in `?tag=` for bookmarks and browser history. Unknown tags show all entries with a notice. Without JavaScript, the complete timeline remains readable. The build rejects missing, duplicate, or conflicting tag labels.

## Bibliography and citation index

Every entry has Cited By and Citations sections in the publication sidebar below the original source record, including the extended AI Toy page. Both directions are derived from `citation-links.json`, a single reviewed graph of 148 relationships. The original 24 curated links and their publication-version notes are retained. Unknown entries, duplicate edges, self links, or missing source evidence fail the build.

`bibliography-index.json` registers all 67 works: 54 extracted reference sections, 5 partial records, 7 unavailable bibliographies, and 1 work with no formal bibliography located. Four partial records use publisher-deposited Crossref references. The fifth contains verified bibliographical footnotes recovered by OCR from the 64-page Logic Theory Machine report. STUDENT, focused backpropagation, and SHRDLU include OCR text with PDF page numbers and extraction hashes. OCR and PDF extraction may retain spelling or column-order errors; raw text alone does not authorize a citation link.

Entries provide expandable reference text, source links, explicit coverage limitations, and downloadable bibliography/citation indexes. These are matches within the Atlas, not total scholarly citation counts. Distinct papers and publication versions must be reviewed separately. In particular, 1957 Logic Theory Machine papers are not mapped to the 1956 report, and the 1986 PDP backpropagation chapter is not mapped to the Nature article. Adding a paper requires a bibliography coverage record; adding a link requires evidence and version notes where applicable. The build does not generate links from fuzzy similarity.

## Memory foundations

Fourteen pre-1990 entries extend the chronology with associative memory, semantic networks, persistent neural states, and recurrent sequence learning. Their optional CitedBy records preserve the original curated relationships; the canonical citation graph now supplies both displayed directions. Publication versions and citation-title discrepancies are stated explicitly. Entry content remains in research.psd1.

Seven reasoning foundations (1964-1969) extend the same citation-first process: STUDENT, resolution, QA1/QA2, QA3, PLANNER, CARPS, and SAMENLAQ II. Each links to an existing SHRDLU bibliography reference, distinguishes publication versions, and carries topic tags. SAMENLAQ II includes a Persistent memory tag because its original implementation section documents disk storage of memories. STUDENT now also links to the recovered original thesis scan, whose bibliography was processed with OCR.
