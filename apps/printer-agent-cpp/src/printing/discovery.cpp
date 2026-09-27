#include "printing/discovery.h"

#include <winspool.h>

#include <algorithm>

#include "app/win.h"

namespace pa {

namespace {

constexpr DWORD kNeedsAttention =
    PRINTER_STATUS_ERROR | PRINTER_STATUS_OFFLINE | PRINTER_STATUS_PAPER_JAM |
    PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_PAPER_PROBLEM | PRINTER_STATUS_DOOR_OPEN |
    PRINTER_STATUS_NO_TONER | PRINTER_STATUS_USER_INTERVENTION | PRINTER_STATUS_NOT_AVAILABLE |
    PRINTER_STATUS_PENDING_DELETION | PRINTER_STATUS_SERVER_UNKNOWN | PRINTER_STATUS_PAUSED;

bool has_paper(const std::vector<WORD>& papers, WORD wanted) {
  return std::find(papers.begin(), papers.end(), wanted) != papers.end();
}

std::optional<bool> ask_flag(const wchar_t* printer, const wchar_t* port, WORD capability) {
  const int answer = DeviceCapabilitiesW(printer, port, capability, nullptr, nullptr);
  if (answer < 0) return std::nullopt;
  return answer > 0;
}

std::optional<std::vector<WORD>> ask_papers(const wchar_t* printer, const wchar_t* port) {
  const int count = DeviceCapabilitiesW(printer, port, DC_PAPERS, nullptr, nullptr);
  if (count <= 0) return std::nullopt;
  std::vector<WORD> papers(static_cast<size_t>(count));
  if (DeviceCapabilitiesW(printer, port, DC_PAPERS, reinterpret_cast<wchar_t*>(papers.data()),
                          nullptr) < 0) {
    return std::nullopt;
  }
  return papers;
}

std::string narrow_or_empty(const wchar_t* text) {
  if (text == nullptr) return {};
  try {
    return narrow(text);
  } catch (...) {
    return {};
  }
}

bool same_text(std::wstring_view a, std::wstring_view b) {
  return a.size() == b.size() &&
         CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                              static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

}  // namespace

bool saves_to_file(std::wstring_view port) {
  return same_text(port, L"PORTPROMPT:") || same_text(port, L"FILE:");
}

bool prints_unattended(std::wstring_view port, DWORD attributes, bool file_queues_allowed) {
  if ((attributes & PRINTER_ATTRIBUTE_FAX) != 0) return false;
  if (same_text(port, L"SHRFAX:")) return false;
  // Output to NUL: never becomes paper (Send To OneNote and similar hand it to an app).
  if (same_text(port, L"NUL:") || same_text(port, L"NUL")) return false;
  if (saves_to_file(port)) return file_queues_allowed;
  return true;
}

std::optional<std::wstring> queue_port(const std::string& printer_name) {
  std::wstring name;
  try {
    name = widen(printer_name);
  } catch (const std::exception&) {
    return std::nullopt;
  }
  HANDLE printer = nullptr;
  if (!OpenPrinterW(name.data(), &printer, nullptr)) return std::nullopt;
  DWORD needed = 0;
  GetPrinterW(printer, 2, nullptr, 0, &needed);
  std::optional<std::wstring> port;
  if (needed > 0) {
    std::vector<BYTE> buffer(needed);
    if (GetPrinterW(printer, 2, buffer.data(), needed, &needed)) {
      const auto* info = reinterpret_cast<const PRINTER_INFO_2W*>(buffer.data());
      port = info->pPortName != nullptr ? info->pPortName : L"";
    }
  }
  ClosePrinter(printer);
  return port;
}

DiscoveredPrinter to_discovered_printer(std::string name, std::string driver_name,
                                        std::string port_name, DWORD status, DWORD attributes,
                                        const RawCapabilities& capabilities) {
  DiscoveredPrinter printer;
  printer.name = std::move(name);
  printer.driver_name = std::move(driver_name);
  printer.port_name = std::move(port_name);
  printer.online = (status & kNeedsAttention) == 0 && (attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) == 0;
  printer.capabilities.color = capabilities.color.value_or(false);
  printer.capabilities.duplex = capabilities.duplex.value_or(false);
  if (capabilities.papers) {
    printer.capabilities.a4 = has_paper(*capabilities.papers, DMPAPER_A4);
    printer.capabilities.a3 = has_paper(*capabilities.papers, DMPAPER_A3);
  } else {
    printer.capabilities.a4 = true;
    printer.capabilities.a3 = false;
  }
  return printer;
}

std::vector<DiscoveredPrinter> discover_printers(bool include_file_queues) {
  const DWORD flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
  DWORD needed = 0;
  DWORD returned = 0;
  EnumPrintersW(flags, nullptr, 2, nullptr, 0, &needed, &returned);
  if (needed == 0) {
    if (GetLastError() == ERROR_INSUFFICIENT_BUFFER || GetLastError() == ERROR_SUCCESS) return {};
    throw_last_error("EnumPrintersW");
  }
  std::vector<BYTE> buffer(needed);
  if (!EnumPrintersW(flags, nullptr, 2, buffer.data(), needed, &needed, &returned)) {
    throw_last_error("EnumPrintersW");
  }
  const auto* infos = reinterpret_cast<const PRINTER_INFO_2W*>(buffer.data());

  std::vector<DiscoveredPrinter> printers;
  printers.reserve(returned);
  for (DWORD i = 0; i < returned; ++i) {
    const PRINTER_INFO_2W& info = infos[i];
    if (info.pPrinterName == nullptr) continue;
    if (!prints_unattended(info.pPortName != nullptr ? info.pPortName : L"", info.Attributes,
                           include_file_queues)) {
      continue;
    }
    RawCapabilities raw;
    raw.color = ask_flag(info.pPrinterName, info.pPortName, DC_COLORDEVICE);
    raw.duplex = ask_flag(info.pPrinterName, info.pPortName, DC_DUPLEX);
    raw.papers = ask_papers(info.pPrinterName, info.pPortName);
    printers.push_back(to_discovered_printer(narrow_or_empty(info.pPrinterName),
                                             narrow_or_empty(info.pDriverName),
                                             narrow_or_empty(info.pPortName), info.Status,
                                             info.Attributes, raw));
  }
  return printers;
}

}  // namespace pa
