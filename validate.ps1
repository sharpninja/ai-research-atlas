$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  & node --test 'test/*.test.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Site validation failed.' }
} finally {
  Pop-Location
}
