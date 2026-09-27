<#
.SYNOPSIS
  Configure, build and test the C++ printer agent with MSVC + Ninja + vcpkg.

.DESCRIPTION
  Finds Visual Studio (2019 or later, with the C++ x64 tools, the Windows SDK and the C++
  CMake tools), loads its x64 developer environment into this process, and runs the CMake
  presets. VCPKG_ROOT defaults to %USERPROFILE%\vcpkg.

.EXAMPLE
  ./build.ps1                 # release: configure + build + test
  ./build.ps1 -Debug          # debug build
  ./build.ps1 -SkipTests
#>
param(
  [switch]$Debug,
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "Visual Studio Installer (vswhere.exe) not found." }
$vs = & $vswhere -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.CMake.Project `
  -property installationPath
if (-not $vs) { throw "No Visual Studio with the C++ x64 tools and the C++ CMake tools was found." }

# Import vcvars64 into this PowerShell session (cl, link, the Windows SDK, cmake, ninja).
# vcvars looks vswhere.exe up on PATH, and prints harmless warnings on stderr, so it runs with
# the installer folder on PATH and outside the strict error mode.
$env:PATH = "$(Split-Path $vswhere);$env:PATH"
$vcvars = Join-Path $vs "VC\Auxiliary\Build\vcvars64.bat"
$ErrorActionPreference = "Continue"
$vcEnv = cmd /c "`"$vcvars`" >nul 2>&1 && set"
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -ne 0) { throw "vcvars64.bat failed." }
$vcEnv | ForEach-Object {
  if ($_ -match "^([^=]+)=(.*)$") { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
if (-not (Get-Command cl -ErrorAction SilentlyContinue)) { throw "cl.exe is not available after vcvars64." }
# Build Tools' vcvars does not always put the bundled CMake / Ninja on PATH.
$vsCMake = Join-Path $vs "Common7\IDE\CommonExtensions\Microsoft\CMake"
foreach ($tool in @(@{ Exe = "cmake"; Dir = "CMake\bin" }, @{ Exe = "ninja"; Dir = "Ninja" })) {
  if (-not (Get-Command $tool.Exe -ErrorAction SilentlyContinue)) {
    $env:PATH = "$(Join-Path $vsCMake $tool.Dir);$env:PATH"
  }
  if (-not (Get-Command $tool.Exe -ErrorAction SilentlyContinue)) { throw "$($tool.Exe) not found (install 'C++ CMake tools for Windows')." }
}

if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = Join-Path $env:USERPROFILE "vcpkg" }
if (-not (Test-Path (Join-Path $env:VCPKG_ROOT "vcpkg.exe"))) {
  throw "vcpkg not found at $env:VCPKG_ROOT (clone https://github.com/microsoft/vcpkg and run bootstrap-vcpkg.bat)."
}

$preset = if ($Debug) { "windows-x64-debug" } else { "windows-x64" }
cmake --preset $preset
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build --preset $preset
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not $SkipTests) {
  ctest --preset $preset
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
