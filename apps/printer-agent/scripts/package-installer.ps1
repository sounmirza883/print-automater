<#
.SYNOPSIS
  §13.3: builds print-automated-agent.exe (via @yao-pkg/pkg), downloads
  and stages the real SumatraPDF portable executable plus its GPLv3
  license text, and -- if Inno Setup's ISCC.exe is available -- compiles
  the final Windows installer.

.DESCRIPTION
  Every artifact this script produces is a build output, not source
  (see .gitignore's own apps/printer-agent/installer/{staging,output}
  entries) -- SumatraPDF itself is downloaded fresh from its own
  official release rather than committed to this repo as a binary,
  matching this project's own "aggregation, not linking" GPLv3 stance
  (§17's own risk table) and ordinary binary-artifact hygiene.

  Run from apps/printer-agent/ (or anywhere -- paths below are
  script-relative, not cwd-relative).

.PARAMETER ApiBaseUrl
  The real backend this installer's own agents will pair against --
  baked into every install's own .env by setup.iss's [Code] section, so
  shop staff never touch configuration (§13.3's own "without a
  developer present" -- only pairing-code entry is a human step).
  Defaults to setup.iss's own localhost default, for a local test build.
#>

param(
    [string]$ApiBaseUrl
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1's own Invoke-WebRequest renders a live
# progress bar by default, which -- for this file's real ~10MB size --
# makes it take upward of 30s where curl takes a couple; this is a
# well-documented PS 5.1 performance quirk, not a network problem.
$ProgressPreference = "SilentlyContinue"

$RepoRoot = Resolve-Path "$PSScriptRoot\..\..\..\"
$AgentDir = Resolve-Path "$PSScriptRoot\.."
$StagingDir = Join-Path $AgentDir "installer\staging"
$OutputDir = Join-Path $AgentDir "installer\output"

$SumatraVersion = "3.6.1"
$SumatraZipUrl = "https://www.sumatrapdfreader.org/dl/rel/$SumatraVersion/SumatraPDF-$SumatraVersion-64.zip"
$GplLicenseUrl = "https://www.gnu.org/licenses/gpl-3.0.txt"

Write-Host "==> Building and packaging the agent (pnpm run package:win)"
Push-Location $AgentDir
try {
    pnpm run package:win
    if ($LASTEXITCODE -ne 0) { throw "pnpm run package:win failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

Write-Host "==> Staging installer inputs in $StagingDir"
Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $StagingDir | Out-Null

Copy-Item (Join-Path $AgentDir "dist-pkg\print-automated-agent.exe") $StagingDir

Write-Host "==> Downloading SumatraPDF $SumatraVersion (portable, GPLv3) from its own official release"
$sumatraZip = Join-Path $env:TEMP "SumatraPDF-$SumatraVersion-64.zip"
Invoke-WebRequest -Uri $SumatraZipUrl -OutFile $sumatraZip
Expand-Archive -Path $sumatraZip -DestinationPath $StagingDir -Force
# The portable zip's own single entry is named "SumatraPDF-<version>-64.exe" --
# renamed here to the fixed name packages/config's own SUMATRA_PATH default expects.
Move-Item (Join-Path $StagingDir "SumatraPDF-$SumatraVersion-64.exe") (Join-Path $StagingDir "SumatraPDF.exe") -Force
Remove-Item $sumatraZip

Write-Host "==> Fetching the GPLv3 license text (SumatraPDF's own license -- not bundled in its portable zip)"
Invoke-WebRequest -Uri $GplLicenseUrl -OutFile (Join-Path $StagingDir "SumatraPDF-LICENSE.txt")

if (Get-Command ISCC.exe -ErrorAction SilentlyContinue) {
    Write-Host "==> Compiling the installer with Inno Setup (ISCC.exe)"
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $isccArgs = @((Join-Path $AgentDir "installer\setup.iss"), "/O$OutputDir")
    if ($ApiBaseUrl) {
        $isccArgs += "/DMyApiBaseUrl=$ApiBaseUrl"
    }
    & ISCC.exe @isccArgs
    if ($LASTEXITCODE -ne 0) { throw "ISCC.exe failed with exit code $LASTEXITCODE" }
    Write-Host "==> Installer built: $OutputDir\print-automated-agent-setup.exe"
}
else {
    Write-Host "==> ISCC.exe not found on PATH -- skipping installer compilation."
    Write-Host "    Install Inno Setup (https://jrsoftware.org/isdl.php) and re-run this script,"
    Write-Host "    or compile installer\setup.iss manually against the staged files in $StagingDir."
}
