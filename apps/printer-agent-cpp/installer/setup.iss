; 24.14: the native agent's installer. Built by build-installer.ps1 from the files it stages in
; installer\staging (the release build plus the licences of everything linked into it).
;
; Reuses the Node agent's structure (apps/printer-agent/installer/setup.iss) with these changes:
;  - per-user: no UAC prompt. The agent is a per-user tray app whose state, DPAPI-sealed key
;    and autostart all belong to one Windows user, so it installs into that user's
;    %LOCALAPPDATA%\Programs like any per-user app;
;  - one native exe plus pdfium.dll: no pkg bundle, no SumatraPDF, no GPLv3 text;
;  - config.json is written into the agent's state folder (only if there is none yet);
;  - a running agent is asked to quit (through its tray window) before files are replaced or
;    removed, instead of the install failing on locked files.

#define MyAppName "Print Automated Agent"
#define MyAppPublisher "Print Automated"
#define MyAppExeName "print-automated-agent.exe"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
; One backend for every shop, baked in per release (build-installer.ps1 -ApiBaseUrl), so pairing
; is the only thing shop staff ever do. The agent refuses a non-https URL unless it is localhost.
#ifndef MyApiBaseUrl
  #define MyApiBaseUrl "http://localhost:3000"
#endif

[Setup]
; Fixed forever: identifies upgrades of the native agent. (Not the Node agent's id: that one
; installed per-machine, and this one must not try to take over its Program Files folder.)
AppId={{3E0F6F2B-8C54-4F3B-9F6E-0B7D4A1C2E91}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion={#MyAppVersion}
DefaultDirName={autopf}\PrintAutomatedAgent
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=output
OutputBaseFilename=print-automated-agent-setup-{#MyAppVersion}
SetupIconFile=..\resources\agent.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Files are replaced only after the running agent has quit (see [Code]); never ask to restart.
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "staging\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "staging\pdfium.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "staging\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--pair"

[Registry]
; Starts with Windows for this user. The value name is the Node agent's, so installing the
; native agent also replaces a Node agent's autostart.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PrintAutomatedAgent"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue

[Run]
; --pair opens the pairing page, the one step left for the person installing.
Filename: "{app}\{#MyAppExeName}"; Parameters: "--pair"; Description: "Start the agent and open its pairing page"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Everything the agent ever wrote lives in this one folder: identity, ledger, logs, documents
; in flight, config.json.
Type: filesandordirs; Name: "{localappdata}\PrintAutomated"

[Code]
const
  WM_CLOSE = $0010;
  TrayWindowClass = 'PrintAutomatedAgentTray';

{ Asks a running agent to quit exactly as its tray menu's Quit does, and waits (up to 15 s)
  for it to finish its current step. Returns False if it is still running. }
function StopRunningAgent(): Boolean;
var
  Wnd: HWND;
  Waited: Integer;
begin
  Wnd := FindWindowByClassName(TrayWindowClass);
  if Wnd <> 0 then
    PostMessage(Wnd, WM_CLOSE, 0, 0);
  Waited := 0;
  while (FindWindowByClassName(TrayWindowClass) <> 0) and (Waited < 15000) do
  begin
    Sleep(250);
    Waited := Waited + 250;
  end;
  Result := FindWindowByClassName(TrayWindowClass) = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopRunningAgent() then
    Result := 'The Print Automated agent is still running. Quit it from its icon near the clock, then run Setup again.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopRunningAgent();
  if not Result then
    MsgBox('The Print Automated agent is still running. Quit it from its icon near the clock, then uninstall again.', mbError, MB_OK);
end;

{ The agent's settings: the API this release was built for. Written only when there is no
  config.json yet, so an upgrade or reinstall keeps whatever the shop has. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDir: String;
  ConfigFile: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDir := ExpandConstant('{localappdata}\PrintAutomated');
    ConfigFile := ConfigDir + '\config.json';
    if not FileExists(ConfigFile) then
    begin
      ForceDirectories(ConfigDir);
      SaveStringToFile(ConfigFile, '{"apiBaseUrl": "{#MyApiBaseUrl}", "ledgerRetentionDays": 30}' + #13#10, False);
    end;
  end;
end;
