#include <windows.h>

#include "app/version.h"

// 24.1: the entry point exists so the toolchain, the static CRT and every dependency are
// proven to link into the real executable. The agent itself (loops, tray, pairing page) is
// wired in by the later sub-phases.
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  const std::string version = pa::agent_version();
  return version.empty() ? 1 : 0;
}
