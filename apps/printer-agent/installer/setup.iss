; §13.3: wraps the packaged agent + bundled SumatraPDF into a single
; Windows installer with autostart, and an uninstaller that removes
; the agent's own data directory (identity, job ledger, temp files,
; logs -- everything lives under one folder per config/paths.ts's own
; "the whole agent's state is exactly one directory" design) alongside
; the installed program files.
;
; Compiled by scripts/package-installer.ps1 (ISCC.exe /Ooutput
; setup.iss) against files staged into installer/staging/ -- this
; script's own [Files] section assumes that staging layout, not a
; fresh checkout's own src/ tree.

#define MyAppName "Print Automated Agent"
#define MyAppVersion "0.0.0"
#define MyAppPublisher "Print Automated"
#define MyAppExeName "print-automated-agent.exe"
; This is a multi-tenant marketplace (many independent print shops
; against ONE backend, §12.7/§12.8's own single deployed environment),
; not a self-hosted per-shop system -- so unlike SUMATRA_PATH below,
; there IS one single correct value for every copy of this installer:
; whichever backend THIS release was built against. Baked in at build
; time (package-installer.ps1's own -ApiBaseUrl, passed through as
; ISCC's /DMyApiBaseUrl) precisely so shop staff never have to touch
; configuration at all -- §13.3's own "without a developer present"
; means pairing-code entry is the only human step, not a config edit.
#ifndef MyApiBaseUrl
  #define MyApiBaseUrl "http://localhost:3000"
#endif

[Setup]
; Generated once and fixed forever for this app -- identifies upgrades
; to the SAME product across versions; a placeholder here since no
; prior installer release exists yet to keep this consistent with.
AppId={{B6C9B6B6-3B0C-4C5D-9F2A-6B1C6B6C9B6C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PrintAutomatedAgent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; A dedicated shop PC's own one-time setup -- admin elevation for the
; install itself is expected and normal; nothing after this needs it
; (autostart below is a per-user Run key, not a service).
PrivilegesRequired=admin
OutputDir=..\installer\output
OutputBaseFilename=print-automated-agent-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "staging\print-automated-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "staging\SumatraPDF.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "staging\SumatraPDF-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

[Registry]
; Per-user autostart (§13.3's own "autostart") -- a Run key survives
; reboots without needing a Windows service, matching this agent's own
; tray-app design (9.5) rather than a background service account.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PrintAutomatedAgent"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; config/paths.ts's own CONFIG_DIR (%LOCALAPPDATA%\PrintAutomated) --
; identity.json, ledger.sqlite, logs\, tmp\ -- everything this app
; ever wrote outside {app} itself, all under the one directory that
; design already established. Inno's own uninstaller only ever removes
; what [Files] installed into {app}; this is what removes the rest.
Type: filesandordirs; Name: "{localappdata}\PrintAutomated"

[Code]
// index.ts's own first import is "dotenv/config" (confirmed in the
// compiled output), which loads a .env from the process's own working
// directory -- Explorer/the Run key both launch {#MyAppExeName} with
// {app} as that working directory, so a .env dropped here is exactly
// what the packaged agent reads its config from, no different from
// how every other env-driven service in this project already works
// in dev. Both values are fully known at build time -- SUMATRA_PATH
// because {app} is known once compiled, API_BASE_URL because this
// installer's own MyApiBaseUrl (above) is baked in per release, not
// per shop -- so this file needs no runtime prompt or manual edit.
procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvPath: string;
  EnvContent: string;
begin
  if CurStep = ssPostInstall then
  begin
    EnvPath := ExpandConstant('{app}\.env');
    if not FileExists(EnvPath) then
    begin
      EnvContent :=
        'SUMATRA_PATH=' + ExpandConstant('{app}') + '\SumatraPDF.exe' + #13#10 +
        'API_BASE_URL={#MyApiBaseUrl}' + #13#10;
      SaveStringToFile(EnvPath, EnvContent, False);
    end;
  end;
end;
