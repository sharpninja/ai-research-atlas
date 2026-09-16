# AI Research Atlas

The welcome page introduces AI research in plain language. `/timeline/` preserves the 45-entry chronology; every `/entries/:slug/` page has moderated comments. Legacy homepage era fragments forward to the timeline.

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
