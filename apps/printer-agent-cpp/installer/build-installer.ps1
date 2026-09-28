<#
.SYNOPSIS
  Builds the native agent's Windows installer: release build and tests, staging, Inno Setup.

.DESCRIPTION
  1. ..\build.ps1 (release, with the tests) unless -SkipBuild.
  2. Stages print-automated-agent.exe, pdfium.dll and the licences of everything linked into
     them (PDFium and its bundled libraries; libcurl, libsodium, SQLite, nlohmann-json and zlib
     from vcpkg) into installer\staging.
  3. Compiles setup.iss with Inno Setup 6's ISCC.exe into
     installer\output\print-automated-agent-setup-<version>.exe.
  staging\ and output\ are build outputs (git-ignored).

.PARAMETER ApiBaseUrl
  The API this release's agents will talk to, written into each install's config.json. Must be
  https (plain http only for localhost). Defaults to the local development API.

.EXAMPLE
  ./build-installer.ps1 -ApiBaseUrl https://api.printautomated.example
#>
param(
  [string]$ApiBaseUrl = "http://localhost:3000",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$agentDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$buildDir = Join-Path $agentDir "build\windows-x64"
$staging = Join-Path $PSScriptRoot "staging"

if ($ApiBaseUrl -notmatch '^https://' -and $ApiBaseUrl -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?(/|$)') {
  throw "ApiBaseUrl must be https (plain http only for localhost): $ApiBaseUrl"
}
if ($ApiBaseUrl -match '["\\]') { throw "ApiBaseUrl must not contain quotes or backslashes." }

if (-not $SkipBuild) {
  & (Join-Path $agentDir "build.ps1")
  if ($LASTEXITCODE -ne 0) { throw "The agent build or its tests failed." }
}

$versionHeader = Join-Path $buildDir "generated\pa_version.h"
if (-not (Test-Path $versionHeader)) { throw "No build found; run without -SkipBuild." }
$version = ([regex]::Match((Get-Content -Raw $versionHeader), 'PA_VERSION_STRING "([^"]+)"')).Groups[1].Value
if (-not $version) { throw "Could not read the version from $versionHeader." }

# --- Stage ---
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $staging "licenses") | Out-Null
Copy-Item (Join-Path $buildDir "print-automated-agent.exe") $staging
Copy-Item (Join-Path $buildDir "pdfium.dll") $staging

# The PDFium release this build actually linked (cmake/Pdfium.cmake records it in the cache).
$cacheLine = Select-String -Path (Join-Path $buildDir "CMakeCache.txt") -Pattern '^PA_PDFIUM_DIR:[A-Z]+=(.+)$' |
  Select-Object -First 1
if (-not $cacheLine) { throw "PA_PDFIUM_DIR is not in the build's CMakeCache.txt." }
$pdfiumDir = $cacheLine.Matches[0].Groups[1].Value
$pdfiumLicenses = Join-Path $staging "licenses\pdfium"
New-Item -ItemType Directory -Force $pdfiumLicenses | Out-Null
Copy-Item (Join-Path $pdfiumDir "LICENSE") (Join-Path $pdfiumLicenses "LICENSE.txt")
Copy-Item (Join-Path $pdfiumDir "licenses\*") $pdfiumLicenses

$vcpkgShare = Join-Path $buildDir "vcpkg_installed\x64-windows-static\share"
foreach ($package in "curl", "libsodium", "sqlite3", "nlohmann-json", "zlib") {
  $copyright = Join-Path $vcpkgShare "$package\copyright"
  if (-not (Test-Path $copyright)) { throw "Missing licence for $package ($copyright)." }
  Copy-Item $copyright (Join-Path $staging "licenses\$package.txt")
}

# --- Compile ---
$iscc = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  $onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($onPath) { $iscc = $onPath.Source }
}
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) not found. Install it: winget install JRSoftware.InnoSetup --scope user" }

& $iscc "/DMyAppVersion=$version" "/DMyApiBaseUrl=$ApiBaseUrl" (Join-Path $PSScriptRoot "setup.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE." }
$installer = Join-Path $PSScriptRoot "output\print-automated-agent-setup-$version.exe"
Write-Host "Installer: $installer"
