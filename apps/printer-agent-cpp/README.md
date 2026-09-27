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
```

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
| `logs\`, `tmp\` | Logs, and job documents while they print.                                                                                                                                                                              |
