$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$releaseVersion = '10'
$publishedAtUtc = '2026-09-16T20:06:25Z'
$publishDateLabel = [datetimeoffset]::Parse($publishedAtUtc, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime().ToString("d MMMM yyyy, HH:mm:ss 'UTC'", [Globalization.CultureInfo]::InvariantCulture)
$entries = (Import-PowerShellDataFile (Join-Path $siteRoot 'research.psd1')).Entries
$eras = @(
  @{Id='foundations'; Name='Foundations & symbolic beginnings'; Range='1943–1966'},
  @{Id='representations'; Name='Knowledge, memory & learning'; Range='1969–1990'},
  @{Id='learning-at-scale'; Name='Statistical learning to deep vision'; Range='1995–2012'},
  @{Id='deep-learning'; Name='Deep learning takes shape'; Range='2013–2016'},
  @{Id='transformers'; Name='The Transformer era'; Range='2017–2019'},
  @{Id='scale-and-generation'; Name='Scale, transfer & generation'; Range='2020–2021'},
  @{Id='alignment-and-reasoning'; Name='Instructions, feedback & reasoning'; Range='2022'},
  @{Id='foundation-models'; Name='Multimodal & reasoning models'; Range='2023–2025'}
)
function EscapeHtml([string]$value) { [System.Net.WebUtility]::HtmlEncode($value) }
function Save-Page([string]$file,[string]$title,[string]$description,[string]$content,[bool]$isHome=$false) {
  $navCurrent = if($isHome){' aria-current="page"'}else{''}
  $html = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>$(EscapeHtml $title) | AI Research Atlas</title><meta name="description" content="$(EscapeHtml $description)"><meta name="theme-color" content="#14233b"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header class="masthead"><div class="wrap masthead-inner"><a class="brand" href="/" aria-label="AI Research Atlas home"><span class="brand-mark" aria-hidden="true">ai</span>AI Research Atlas</a><nav class="topnav" aria-label="Main navigation"><a href="/"$navCurrent>Timeline</a><a href="/#methodology">About the sources</a></nav></div></header>
$content
<footer class="wrap footer"><span>AI Research Atlas · Selected works, 1943–2025<span class="footer-release">Version $(EscapeHtml $releaseVersion) · Published <time datetime="$publishedAtUtc">$(EscapeHtml $publishDateLabel)</time></span></span><a href="/#methodology">Sources &amp; date conventions</a></footer></body></html>
"@
  $html = [regex]::Replace($html, '<a href="https?://[^"]+"', '$0 target="_blank" rel="noopener noreferrer"')
  [System.IO.File]::WriteAllText((Join-Path $siteRoot ('dist/' + $file)), $html, [System.Text.UTF8Encoding]::new($false))
}
$navItems = for($e=0;$e -lt $eras.Count;$e++) { $era=$eras[$e]; '<li><a href="#'+$era.Id+'"><span>'+ (EscapeHtml $era.Range) +'</span>'+ (EscapeHtml $era.Name) +'</a></li>' }
$sections = for($e=0;$e -lt $eras.Count;$e++) {
  $era=$eras[$e]
  $subset=@($entries | Where-Object { $_.Era -eq $e })
  $rows=foreach($entry in $subset) {
@"
<li class="entry"><div class="entry-year"><time datetime="$($entry.Year)">$($entry.Year)</time></div><article class="entry-main"><div class="entry-meta"><span class="entry-topic">$(EscapeHtml $entry.Topic)</span><span>$(EscapeHtml $entry.Kind)</span></div><h3><a href="/entries/$($entry.Slug)/">$(EscapeHtml $entry.Title)</a></h3><p>$(EscapeHtml $entry.Summary)</p><div class="entry-bottom"><span>$(EscapeHtml $entry.Authors)</span><a href="/entries/$($entry.Slug)/" aria-label="Read about $(EscapeHtml $entry.Title)">Read entry <span aria-hidden="true">↗</span></a></div></article></li>
"@
  }
@"
<section class="era-section" id="$($era.Id)" aria-labelledby="$($era.Id)-title"><div class="era-heading"><h2 id="$($era.Id)-title">$(EscapeHtml $era.Name)</h2><span class="era-count">$($subset.Count) entries</span></div><ol class="entries">$($rows -join "`n")</ol></section>
"@
}
$timelinePage = @"
<main id="main"><div class="wrap"><section class="intro" aria-labelledby="title"><div><p class="kicker">A history through research and practice</p><h1 id="title">The ideas that shaped<br>artificial intelligence.</h1><p>Trace the publications behind the breakthroughs, from mathematical neurons to reasoning models. Open any entry for the research, its significance, and its limits.</p></div><div class="range-panel"><div class="year-range">1943–2025</div><span class="small">$($entries.Count) selected works<br>Original sources linked throughout</span></div></section><div class="timeline-layout"><nav class="era-nav" aria-label="Timeline eras"><p class="nav-label">Explore the timeline</p><ol>$($navItems -join "`n")</ol></nav><div>$($sections -join "`n")</div></div></div>
<section class="method" id="methodology" aria-labelledby="method-title"><div class="wrap method-inner"><div><p class="kicker">Reading the timeline</p><h2 id="method-title">Follow the evidence.</h2></div><div><div class="method-columns"><div><h3>Dates belong to publications</h3><p>Years refer to the specific work linked in each entry. For papers first released on arXiv, the timeline uses the first submission year and notes a later conference when applicable. An invention, a software release, and a paper may have different dates.</p></div><div><h3>Claims stay within the source</h3><p>Entries summarize a contribution and its limits. Journal papers, conference papers, preprints, technical reports, a foundational monograph, and a commercial magazine series with programs are labeled separately. Being a primary source does not mean every claim has been independently reproduced.</p></div></div><div class="method-source"><p>This is a curated history of AI research and practice, not an exhaustive catalogue or a ranking of current models. Era names are editorial navigation, not universally agreed scientific periods. Entries within a year are not necessarily ordered by month.</p><p>The selection builds on the <a href="https://drops.mts.now/research-papers/">MTS research-paper timeline</a> and <a href="https://www.preprints.org/manuscript/202511.0637">Tracing the Evolution of Artificial Intelligence</a>, with dates and descriptions checked against the original publications and authoritative records linked on each detail page. The latter review is a preprint; neither overview substitutes for the original evidence.</p><p>Source review: 16 September 2026. Historical coverage ends in 2025. External links may lead to a publisher record, an open manuscript, or a PDF; some publishers restrict full-text access.</p></div></div></div></section></main>
"@
Save-Page 'index.html' 'Timeline of artificial intelligence, 1943–2025' 'Explore 46 milestones in AI research and practice, with original publications, historical context, and carefully distinguished publication dates.' $timelinePage $true
for($i=0;$i -lt $entries.Count;$i++) {
  $entry=$entries[$i]; $era=$eras[$entry.Era]
  $dir=Join-Path $siteRoot ('dist/entries/'+$entry.Slug)
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $second=if($entry.SecondUrl){'<li><a href="'+(EscapeHtml $entry.SecondUrl)+'">'+(EscapeHtml $entry.SecondLabel)+' <span aria-hidden="true">↗</span></a></li>'}else{''}
  $prev=if($i -gt 0){$p=$entries[$i-1];'<a href="/entries/'+$p.Slug+'/"><span>Previous · '+$p.Year+'</span>'+(EscapeHtml $p.Title)+'</a>'}else{'<a href="/"><span>Explore</span>Back to the timeline</a>'}
  $next=if($i -lt $entries.Count-1){$n=$entries[$i+1];'<a class="next" href="/entries/'+$n.Slug+'/"><span>Next · '+$n.Year+'</span>'+(EscapeHtml $n.Title)+'</a>'}else{'<a class="next" href="/"><span>Explore</span>Return to the timeline</a>'}
  $content=@"
<main id="main" class="wrap"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/#$($era.Id)">Timeline</a><span aria-hidden="true">/</span><span aria-current="page">$($entry.Year)</span></nav><article><header class="detail-hero"><div class="detail-year"><time datetime="$($entry.Year)">$($entry.Year)</time><span>$(EscapeHtml $entry.Kind)</span></div><div><p class="kicker">$(EscapeHtml $entry.Topic)</p><h1>$(EscapeHtml $entry.Title)</h1><p class="detail-lede">$(EscapeHtml $entry.Summary)</p><p class="authors">$(EscapeHtml $entry.Authors)</p></div></header><div class="detail-body"><div class="reading"><h2>The contribution</h2><p>$(EscapeHtml $entry.Description)</p><section class="boundary" aria-labelledby="boundary-title"><h2 id="boundary-title">What this does not establish</h2><p>$(EscapeHtml $entry.Caveat)</p></section><h2>Why this date?</h2><p>$(EscapeHtml $entry.DateNote)</p><p class="small">This entry follows the linked publication. <a href="/#methodology">Read the source and date conventions.</a></p></div><aside class="publication" aria-labelledby="publication-title"><h2 id="publication-title">The original work</h2><p class="paper-title">$(EscapeHtml $entry.Paper)</p><dl><dt>Authors</dt><dd>$(EscapeHtml $entry.Authors)</dd><dt>Publication</dt><dd>$(EscapeHtml $entry.Venue)</dd><dt>Source type</dt><dd>$(EscapeHtml $entry.Kind)</dd></dl><ul class="source-links"><li><a href="$(EscapeHtml $entry.Url)">$(EscapeHtml $entry.LinkLabel) <span aria-hidden="true">↗</span></a></li>$second</ul><p class="source-note">The links above support the description and dating of this entry. Full text may be open or publisher-restricted.</p></aside></div></article><nav class="detail-pagination" aria-label="Adjacent timeline entries">$prev$next</nav></main>
"@
  if($entry.ExploreUrl) {
    $explore='<div class="source-links"><h3>Explore further</h3><p><a href="'+(EscapeHtml $entry.ExploreUrl)+'">'+(EscapeHtml $entry.ExploreLabel)+'</a></p></div>'
    $content=$content.Replace('</aside>', $explore+'</aside>')
  }
  Save-Page ('entries/'+$entry.Slug+'/index.html') $entry.Title $entry.Summary $content
}
Save-Page '404.html' 'Page not found' 'Return to the AI Research Atlas timeline.' '<main id="main" class="wrap not-found"><p class="kicker">Page not found</p><h1>Return to the timeline.</h1><p>This address does not match an entry in the atlas.</p><a href="/">Explore the research timeline</a></main>'
Write-Output ('Generated '+$entries.Count+' detail pages, the timeline, and a 404 page.')
