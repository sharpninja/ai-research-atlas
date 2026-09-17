import {readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

// Keep the existing PowerShell content generator. Read UTF-8 explicitly on Windows 5.1.
let generator = readFileSync('build.ps1','utf8');
generator = generator.replace('$siteRoot = $PSScriptRoot', "$siteRoot = '" + process.cwd().replaceAll("'", "''") + "'");
generator = generator.replace("Import-PowerShellDataFile (Join-Path $siteRoot 'research.psd1')", "& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $siteRoot 'research.psd1'))))");
// Send the growing template on stdin to stay below Windows' command-line limit.
const encoded = Buffer.from("$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); & ([scriptblock]::Create([Console]::In.ReadToEnd()))",'utf16le').toString('base64');
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded], {input:generator,encoding:'utf8',stdio:['pipe','pipe','pipe']});

const entries = [...readFileSync('research.psd1','utf8').matchAll(/Slug='([^']+)'/g)].map(m => m[1]);
const newNav = '<a href="/welcome/">Welcome</a><a href="/timeline/">Timeline</a><a href="/entries/the-ai-toy/">The AI Toy</a><a href="/submit/" target="_top">Submit a link</a><a href="/timeline/#methodology">About the sources</a>';
function enhance(html) {
  return html.replace(/<nav class="topnav"[^>]*>[\s\S]*?<\/nav>/, '<nav class="topnav" aria-label="Main navigation">' + newNav + '</nav>')
    .replace('<header class="masthead">', '<header class="masthead" id="page-top" tabindex="-1">')
    .replaceAll('href="/#','href="/timeline/#')
    .replaceAll('<a href="/"><span>Explore</span>', '<a href="/timeline/"><span>Explore</span>')
    .replaceAll('<a class="next" href="/"><span>Explore</span>', '<a class="next" href="/timeline/"><span>Explore</span>')
    .replace('href="/style.css">','href="/style.css"><link rel="stylesheet" href="/additions.css">')
    .replace('</footer>', '<a class="owner-analytics" data-owner-nav hidden href="/analytics/" target="_top">Analytics</a></footer>')
    .replace('</body>', '<a class="return-to-top" href="#page-top" aria-label="Return to top" title="Return to top"><span aria-hidden="true">↑</span></a><script src="/navigation.js" defer></script><script src="/comments.js" defer></script></body>');
}
const timeline = enhance(readFileSync('dist/index.html','utf8')).replace('<a href="/timeline/">Timeline</a>', '<a href="/timeline/" aria-current="page">Timeline</a>')
  .replace('<section class="topic-filter"', readFileSync('precursor-timeline.html','utf8') + '<section class="topic-filter"')
  .replace('<p class="nav-label">Explore the timeline</p><ol>', '<p class="nav-label">Explore the timeline</p><ol><li><a href="#precursor-to-ai"><span>1816–1899</span>Precursor to AI</a></li>')
  .replace('</body>', '<script src="/topics.js" defer></script></body>');
mkdirSync('dist/timeline',{recursive:true}); writeFileSync('dist/timeline/index.html',timeline);
const shell = enhance(readFileSync('dist/index.html','utf8'));
function withMain(content, title, description) {
  return shell.replace(/<main[\s\S]*<\/main>/, content)
    .replace(/<title>[^<]*<\/title>/, '<title>' + title + ' | AI Research Atlas</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + description + '">');
}
const welcome = withMain(readFileSync('welcome.html','utf8'), 'Welcome: a plain-language history of AI', 'Follow the history of artificial intelligence from early rules and learning machines to modern language models, with links to original research.')
  .replace('</head>', '<link rel="stylesheet" href="/analytics.css"></head>')
  .replace('<a href="/welcome/">Welcome</a>', '<a href="/welcome/" aria-current="page">Welcome</a>')
  .replace('</body>', '<script src="/welcome.js" defer></script></body>');
writeFileSync('dist/index.html',welcome);
mkdirSync('dist/welcome',{recursive:true}); writeFileSync('dist/welcome/index.html',welcome);
mkdirSync('dist/precursors',{recursive:true});
const precursors = withMain(readFileSync('precursors.html','utf8'), 'Literary and philosophical precursors', 'Explore The Sandman, Erewhon, and Moxon’s Master: nineteenth-century ideas about artificial beings, machine intelligence, and human control.')
  .replace(/<a href="https?:\/\/[^\"]+"/g, '$& target="_blank" rel="noopener noreferrer"');
writeFileSync('dist/precursors/index.html',precursors);
writeFileSync('dist/welcome.js', `const oldSections = new Set(['foundations','representations','learning-at-scale','deep-learning','transformers','scale-and-generation','alignment-and-reasoning','foundation-models','methodology']);\nif (oldSections.has(location.hash.slice(1))) location.replace('/timeline/' + location.hash);\n`);
for (const entry of entries) {
  const file = 'dist/entries/' + entry + '/index.html';
  let html = enhance(readFileSync(file,'utf8'));
  if (entry === 'the-ai-toy') {
    const lineage = html.match(/<div class="atlas-citations reading">[\s\S]*?<\/div>(?=<\/aside>)/)?.[0];
    if (!lineage) throw new Error('The AI Toy citation sidebar is missing');
    html = html.replace('<a href="/entries/the-ai-toy/">The AI Toy</a>', '<a href="/entries/the-ai-toy/" aria-current="page">The AI Toy</a>');
    const body = readFileSync('ai-toy.html','utf8').trim()
      .replace('</aside>', lineage + '</aside>')
      .replace(/<a href="https?:\/\/[^\"]+"/g, '$& target="_blank" rel="noopener noreferrer"');
    html = html.replace(/<div class="detail-body">[\s\S]*?<\/article>/, body + '</article>');
  }
  const returnTo = encodeURIComponent('/entries/' + entry + '/#comments');
  const comments = `<section class="comments" id="comments" data-comments-entry="${entry}" aria-labelledby="comments-title">
    <h2 id="comments-title">Comments</h2><p>Discuss this research, ask a question, or suggest a correction. Comments appear after the site owner approves them.</p>
    <p data-owner-nav hidden><a href="/moderation/">Moderate comments</a></p>
    <p id="comments-notice" role="status">Loading comments…</p><div id="comment-list"></div><button class="button secondary" id="comments-more" type="button" hidden>Load more comments</button>
    <div id="comment-signin"><p><a class="button" href="/signin-with-chatgpt?return_to=${returnTo}" target="_top">Sign in with ChatGPT to comment</a></p><p class="small">Use your OpenAI account. Published comments show the display name you choose, not your account email.</p></div>
    <form id="comment-form" class="comment-form" hidden><p id="comment-account" class="small account-line"></p><a class="small" href="/signout-with-chatgpt?return_to=${returnTo}" target="_top">Sign out</a>
    <label for="comment-name">Public display name</label><input id="comment-name" name="name" maxlength="60" required autocomplete="nickname" aria-describedby="comment-name-help"><p id="comment-name-help" class="comment-guidance">Choose the name readers will see. Do not include private contact details.</p>
    <label for="comment-body">Your comment</label><textarea id="comment-body" name="body" maxlength="3000" required rows="5" aria-describedby="comment-body-help"></textarea><p id="comment-body-help" class="comment-guidance">Up to 3,000 characters. Keep comments relevant and respectful. Your comment will be stored for review by the site owner.</p>
    <button class="button" type="submit">Submit for approval</button><p id="comment-feedback" class="comment-feedback" role="status"></p></form><div id="my-comments"></div><noscript><p>Enable JavaScript to load and submit comments. The research entry remains available without it.</p></noscript></section>`;
  html = html.replace(/<nav class="detail-pagination"[\s\S]*?<\/nav>/, navigation => navigation + comments);
  writeFileSync(file,html);
}
writeFileSync('dist/404.html',enhance(readFileSync('dist/404.html','utf8')));
mkdirSync('dist/moderation',{recursive:true});
writeFileSync('dist/moderation/index.html',withMain(`<main id="main" class="wrap moderation"><p class="kicker">Site owner</p><h1>Comment moderation</h1><p>Review comments from every research entry. Only approved comments are public. Removed and rejected comments can be returned to review.</p><section id="moderation-panel" aria-label="Moderation queue"><p id="moderation-counts" class="small"></p><div class="moderation-toolbar"><label for="moderation-status">Show comments<select id="moderation-status"><option value="pending">Awaiting approval</option><option value="approved">Published</option><option value="rejected">Not approved</option><option value="removed">Removed</option></select></label><button type="button" class="button secondary" id="moderation-refresh">Refresh</button><a href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a></div><p id="moderation-notice" role="status">Loading comments…</p><div id="moderation-list"></div><div class="moderation-pagination"><button class="button secondary" id="moderation-previous" type="button" disabled>Previous</button><button class="button secondary" id="moderation-next" type="button" disabled>Next</button></div></section></main>`, 'Comment moderation', 'Review comments submitted to AI Research Atlas.'));
const moderationFile = 'dist/moderation/index.html';
writeFileSync(moderationFile,readFileSync(moderationFile,'utf8').replace('<section id="moderation-panel"','<p><a href="/moderation/submissions/">Review timeline submissions</a></p><section id="moderation-panel"'));
for (const [route,source,title,description] of [
  ['submit','submit.html','Suggest a timeline entry','Submit a link to an original AI work for the site owner to consider for the timeline.'],
  ['moderation/submissions','submission-review.html','Review timeline submissions','Review suggested sources for the AI Research Atlas timeline.'],
]) {
  mkdirSync('dist/'+route,{recursive:true});
  let html = withMain(readFileSync(source,'utf8'),title,description)
    .replace('</body>','<script src="/submissions.js" type="module"></script></body>');
  if (route === 'submit') html = html.replace('href="/submit/" target="_top"','href="/submit/" target="_top" aria-current="page"');
  writeFileSync('dist/'+route+'/index.html',html);
}
mkdirSync('dist/analytics',{recursive:true});
writeFileSync('dist/analytics/index.html', withMain(readFileSync('analytics.html','utf8'), 'Analytics', 'Private analytics for the owner of AI Research Atlas.')
  .replace('</head>', '<meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="/analytics.css"></head>')
  .replace('</body>', '<script src="/dashboard.js" type="module"></script></body>'));
cpSync('src/dashboard.js','dist/dashboard.js'); cpSync('src/analytics.css','dist/analytics.css');
cpSync('src/topics.js','dist/topics.js');
cpSync('src/navigation.js','dist/navigation.js');
cpSync('src/comments.js','dist/comments.js'); cpSync('src/additions.css','dist/additions.css'); cpSync('src/submissions.js','dist/submissions.js');
cpSync('bibliography-index.json','dist/bibliography-index.json'); cpSync('citation-links.json','dist/citation-links.json');
const assets = {};
function collect(directory) {
  for (const item of readdirSync(directory,{withFileTypes:true})) {
    if (['server','.openai'].includes(item.name)) continue;
    const path = directory + '/' + item.name;
    if(item.isDirectory()) collect(path);
    else {
      const ext = path.split('.').at(-1); const type = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml'}[ext];
      if (!type) throw new Error('Unexpected public asset: ' + path);
      assets['/' + path.slice(5)] = {body:readFileSync(path,'utf8'),type};
    }
  }
}
collect('dist');
mkdirSync('dist/server',{recursive:true}); mkdirSync('dist/.openai',{recursive:true});
const source = readFileSync('src/analytics.js','utf8').replaceAll('export async function','async function') + '\n' + readFileSync('src/worker.js','utf8').replace("import {recordPageView, analyticsSummary} from './analytics.js';", '').replace('export function createWorker','function createWorker');
writeFileSync('dist/server/index.js',source + '\nconst assets = ' + JSON.stringify(assets) + ';\nexport default createWorker(assets, ' + JSON.stringify(entries) + ');\n');
cpSync('.openai/hosting.json','dist/.openai/hosting.json'); cpSync('drizzle','dist/.openai/drizzle',{recursive:true});
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/comments.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/submissions.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/dashboard.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/topics.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','dist/navigation.js'],{stdio:'inherit'});
console.log(`Built welcome, timeline, ${entries.length} commented entries, authenticated submissions, owner review, and Worker.`);
