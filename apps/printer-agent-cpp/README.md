# Print Automated printer agent (native C++)

The Windows agent that pairs a shop's PC with Print Automated, reports its printers, claims print
jobs and prints them. It replaces the Node agent in `apps/printer-agent` (Phase 24 of
`docs/architecture/2026-09-22-prd-v2-alignment.md`); the Node agent stays until this one passes
the parity gate (24.15).

## What it is built from

| Piece               | Choice                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / compiler | C++20, MSVC x64 (Visual Studio 2019 Build Tools or later)                                                                                     |
| Build               | CMake + Ninja (Visual Studio's own "C++ CMake tools") via `CMakePresets.json`                                                                 |
| Libraries           | vcpkg manifest (`vcpkg.json`, pinned baseline): libcurl (Schannel TLS), libsodium, SQLite, nlohmann-json, Catch2                              |
| PDF rendering       | PDFium, in-process. Prebuilt from `bblanchon/pdfium-binaries`, one release pinned by SHA-256 in `cmake/Pdfium.cmake` (PDFium is not in vcpkg) |
| Runtime             | static CRT (`x64-windows-static`): the agent is `print-automated-agent.exe` plus `pdfium.dll`                                                 |

This project is deliberately not part of the pnpm/turbo workspace (it has no `package.json`): it
needs the Windows C++ toolchain, which the Linux CI and most developer machines do not have.

## Build

Prerequisites, once per machine:

1. Visual Studio 2019 or later (Build Tools is enough) with **Desktop development with C++**, a
   **Windows 10/11 SDK** and **C++ CMake tools for Windows**.
2. vcpkg: `git clone https://github.com/microsoft/vcpkg %USERPROFILE%\vcpkg` then
   `%USERPROFILE%\vcpkg\bootstrap-vcpkg.bat -disableMetrics`. (Or set `VCPKG_ROOT` to another clone.)

Then, from this folder:

```powershell
./build.ps1              # configure + build + run the tests (release)
./build.ps1 -Debug       # debug build
./build.ps1 -SkipTests
./build.ps1 -Target agent_tests
```

A few tests print for real, through PDFium, the Windows spooler and the built-in **Microsoft
Print to PDF** driver (tagged `[spooler]`), so they need that queue installed, as it is on every
Windows 10/11 machine by default.

The first build compiles the vcpkg libraries and downloads PDFium, so it takes several minutes;
later builds reuse vcpkg's binary cache and the PDFium cache in
`%LOCALAPPDATA%\PrintAutomatedBuild`.

Output: `build/windows-x64/print-automated-agent.exe` (+ `pdfium.dll`) and `agent_tests.exe`.

## Where it keeps its state

Everything is under `%LOCALAPPDATA%\PrintAutomated`, the same folder the Node agent used:

| File            | What                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`   | `{"apiBaseUrl": "https://…", "ledgerRetentionDays": 30}`, written by the installer. `API_BASE_URL` / `LEDGER_RETENTION_DAYS` environment variables override it. The API must be https (plain http only for localhost). |
| `identity.dat`  | The device id and Ed25519 key pair, sealed with Windows DPAPI for this user. A Node agent's plaintext `identity.json` is imported, sealed and then deleted on first start, so the machine does not re-pair.            |
| `ledger.sqlite` | The duplicate-print ledger, same table as the Node agent's.                                                                                                                                                            |
| `logs\`, `tmp\` | Logs (JSON lines, one file per UTC day, 10 MB a day, 14 days kept), and job documents while they print (private to this Windows user).                                                                                 |

## Running it

`print-automated-agent.exe` runs in the notification area. Click the icon (or choose **Open agent
page**) for the local page at `http://127.0.0.1:7171`, where the computer is paired with the
8-character code from the Print Automated app and its status is shown. `--pair` opens that page
at start, which the installer uses on first launch. A second start just opens the page of the one
already running.

Once paired it:

1. sends a heartbeat every 30 s: every print queue it can print to unattended, with the
   driver's own answers for colour, duplex, A4 and A3 (fax queues, `NUL:` ports and queues that
   ask where to save a file are left out);
2. long-polls for jobs, claims one, writes it to the ledger **before** printing, downloads the
   PDF, renders it with PDFium straight to the printer and watches the spooler for the result;
3. reports `PRINTING`, then `PRINTED`, `FAILED` or `UNKNOWN`, retrying until the API has it.

A job that a previous run claimed but never finished is marked `UNKNOWN`, reported, and never
printed again. `FAILED` is only reported when nothing more can print; anything uncertain is
`UNKNOWN`, for a person to check the printer.

### Trying it without touching this machine's real agent

```powershell
$env:PRINT_AUTOMATED_AGENT_HOME = "C:\agent-trial"   # a whole separate state folder
# C:\agent-trial\config.json:
#   {"apiBaseUrl": "http://localhost:3000", "printToFileDir": "C:\\agent-trial\\printed"}
.\build\windows-x64\print-automated-agent.exe --pair
```

`printToFileDir` (for trials and demonstrations only) offers save-to-file queues such as
Microsoft Print to PDF as printers, and writes a job sent to one into that folder as
`<jobId>.pdf` instead of opening a Save dialog.

## How it differs from the Node agent

Same API contract, same ledger file, same folder. Deliberate differences:

- The private key is sealed with DPAPI instead of sitting in a plaintext file.
- PDFium renders in-process: no SumatraPDF child process and no GPLv3 question.
- The spooler's own job id comes back from `StartDoc`, so the monitor watches exactly this job,
  and a job that showed an error and then left the queue is `UNKNOWN`, not `FAILED` (it may have
  printed once the jam was cleared).
- A setting the driver silently drops (double-sided, the paper size, colour) refuses the job
  before anything prints, instead of printing something other than what was ordered.
- A failed document download is `FAILED` (nothing reached a printer), not `UNKNOWN`.
- Jobs left unresolved by a crash are reported `UNKNOWN` at the next start, not left for the
  API's timeout sweep.
- The pairing page checks the Host header (DNS rebinding) and refuses cross-site requests, and
  it no longer accepts a caller-supplied API address.
- A status report the API refuses for good (404) no longer blocks the job loop forever.
