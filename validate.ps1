$ErrorActionPreference='Stop'
$siteRoot=$PSScriptRoot
$dist=Join-Path $siteRoot 'dist'
$entries=(Import-PowerShellDataFile (Join-Path $siteRoot 'research.psd1')).Entries
$issues=[Collections.Generic.List[string]]::new()
$checks=0
function Check([bool]$ok,[string]$label){$script:checks++;if(-not $ok){$script:issues.Add($label)}}
Check ($entries.Count -eq 45) 'Expected 45 selected entries'
Check ((@($entries.Slug | Select-Object -Unique)).Count -eq $entries.Count) 'Duplicate entry slugs'
$previous=0
foreach($entry in $entries){
 Check ($entry.Year -ge $previous) ('Nonchronological year: '+$entry.Slug)
 $previous=$entry.Year
 foreach($key in @('Title','Authors','Paper','Kind','Venue','Summary','Description','Caveat','DateNote','Url')){Check (-not [string]::IsNullOrWhiteSpace($entry[$key])) ('Missing '+$key+': '+$entry.Slug)}
 Check ($entry.Url.StartsWith('https://')) ('Source must use HTTPS: '+$entry.Slug)
 Check (Test-Path -LiteralPath (Join-Path $dist ('entries/'+$entry.Slug+'/index.html'))) ('Missing detail route: '+$entry.Slug)
}
$htmlFiles=@(Get-ChildItem -LiteralPath $dist -Filter '*.html' -Recurse -File)
Check ($htmlFiles.Count -eq 47) 'Expected timeline, 45 details, and 404 document'
$localLinks=0
foreach($file in $htmlFiles){
 $html=[IO.File]::ReadAllText($file.FullName)
 Check ($html -match '<html lang="en">') ('Missing document language: '+$file.FullName)
 Check (([regex]::Matches($html,'<h1(?:\s|>)')).Count -eq 1) ('Expected one h1: '+$file.FullName)
 Check ($html -match 'name="viewport"') ('Missing viewport: '+$file.FullName)
 Check ($html -notmatch '\$\(|REPLACE_ME|TODO|\uFFFD|Ã|â€') ('Unresolved markup or encoding: '+$file.FullName)
 $ids=@([regex]::Matches($html,'\bid="([^"]+)"') | ForEach-Object {$_.Groups[1].Value})
 Check ((@($ids | Select-Object -Unique)).Count -eq $ids.Count) ('Duplicate HTML IDs: '+$file.FullName)
 foreach($match in [regex]::Matches($html,'(?:href|src)="([^"]+)"')){
  $url=[Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
  if($url.StartsWith('https://')){continue}
  $parts=$url.Split('#',2)
  if($parts[0] -eq ''){$target=$file.FullName}else{$target=Join-Path $dist $parts[0].TrimStart('/')}
  if(Test-Path -LiteralPath $target -PathType Container){$target=Join-Path $target 'index.html'}
  $localLinks++
  Check (Test-Path -LiteralPath $target -PathType Leaf) ('Broken local target '+$url+' in '+$file.FullName)
  if($parts.Count -eq 2 -and (Test-Path -LiteralPath $target -PathType Leaf)){
   $targetText=[IO.File]::ReadAllText($target)
   Check ($targetText.Contains('id="'+$parts[1]+'"')) ('Missing fragment '+$url+' in '+$file.FullName)
  }
 }
}
Check (([IO.File]::ReadAllText((Join-Path $dist 'style.css'))) -match '@media\(max-width:650px\)') 'Missing narrow-screen styles'
Check (([IO.File]::ReadAllText((Join-Path $dist 'style.css'))) -match 'focus-visible') 'Missing keyboard focus styles'
$manifest=Get-Content -LiteralPath (Join-Path $siteRoot '.openai/hosting.json') -Raw | ConvertFrom-Json
Check ($manifest.project_id -eq 'appgprj_6aaaca0fecf88191a7a8de752cef13bb') 'Wrong registered site'
Check ($manifest.static.directory -eq 'dist') 'Wrong static output'
$report=[ordered]@{ timestampUtc=[DateTime]::UtcNow.ToString('o'); entries=$entries.Count; htmlDocuments=$htmlFiles.Count; checkedLocalLinks=$localLinks; checks=$checks; passed=($checks-$issues.Count); failed=$issues.Count; failures=@($issues); browserVisualTesting='Not run: not requested'; externalLinks='Primary sources reviewed during research; bulk HTTP availability not asserted' }
$report | ConvertTo-Json -Depth 5
if($issues.Count){exit 1}
