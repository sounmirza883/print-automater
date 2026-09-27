#include <catch2/catch_test_macros.hpp>

#include <windows.h>
#include <winspool.h>

#include <algorithm>

#include "printing/discovery.h"

TEST_CASE("a ready printer is ONLINE with the capabilities its driver reports") {
  pa::RawCapabilities raw;
  raw.color = true;
  raw.duplex = true;
  raw.papers = std::vector<WORD>{DMPAPER_LETTER, DMPAPER_A4, DMPAPER_A3};
  const auto printer = pa::to_discovered_printer("Front desk", "HP", "USB001", 0, 0, raw);
  CHECK(printer.online);
  CHECK(printer.capabilities == pa::PrinterCapabilities{true, true, true, true});
}

TEST_CASE("a printer without A3 in its paper list does not claim A3; one without A4 not A4") {
  pa::RawCapabilities raw;
  raw.color = false;
  raw.duplex = false;
  raw.papers = std::vector<WORD>{DMPAPER_LETTER, DMPAPER_LEGAL};
  const auto printer = pa::to_discovered_printer("US office", "", "", 0, 0, raw);
  CHECK_FALSE(printer.capabilities.a4);
  CHECK_FALSE(printer.capabilities.a3);
}

TEST_CASE("a driver that will not answer gets the cautious defaults (A4 yes, A3 no)") {
  const auto printer = pa::to_discovered_printer("Silent", "", "", 0, 0, pa::RawCapabilities{});
  CHECK(printer.capabilities == pa::PrinterCapabilities{false, false, true, false});
}

TEST_CASE("a printer that needs attention, or is set to work offline, is ERROR") {
  for (DWORD status : {PRINTER_STATUS_PAPER_JAM, PRINTER_STATUS_OFFLINE, PRINTER_STATUS_ERROR,
                       PRINTER_STATUS_NO_TONER, PRINTER_STATUS_PAUSED}) {
    CHECK_FALSE(pa::to_discovered_printer("P", "", "", status, 0, {}).online);
  }
  CHECK_FALSE(pa::to_discovered_printer("P", "", "", 0, PRINTER_ATTRIBUTE_WORK_OFFLINE, {}).online);
  // Busy is not a problem.
  CHECK(pa::to_discovered_printer("P", "", "", PRINTER_STATUS_PRINTING | PRINTER_STATUS_WARMING_UP,
                                  0, {})
            .online);
}

TEST_CASE("fax queues and save-to-file queues are not offered as printers") {
  CHECK(pa::prints_unattended(L"USB001", 0, false));
  CHECK(pa::prints_unattended(L"IP_192.168.1.20", 0, false));
  CHECK_FALSE(pa::prints_unattended(L"SHRFAX:", 0, false));
  CHECK_FALSE(pa::prints_unattended(L"nul:", 0, true));  // Send To OneNote
  CHECK_FALSE(pa::prints_unattended(L"USB001", PRINTER_ATTRIBUTE_FAX, true));
  CHECK_FALSE(pa::prints_unattended(L"PORTPROMPT:", 0, false));
  CHECK_FALSE(pa::prints_unattended(L"file:", 0, false));
  // ... unless the agent is set up to print those to a folder (trials).
  CHECK(pa::prints_unattended(L"PORTPROMPT:", 0, true));
  CHECK(pa::saves_to_file(L"portprompt:"));
  CHECK_FALSE(pa::saves_to_file(L"nul:"));
}

TEST_CASE("discovery on this machine: Microsoft Print to PDF only when file queues are allowed") {
  const auto is_pdf = [](const pa::DiscoveredPrinter& p) { return p.name == "Microsoft Print to PDF"; };

  const auto normal = pa::discover_printers();
  CHECK(std::none_of(normal.begin(), normal.end(), is_pdf));

  const auto trial = pa::discover_printers(true);
  const auto pdf = std::find_if(trial.begin(), trial.end(), is_pdf);
  REQUIRE(pdf != trial.end());
  CHECK_FALSE(pdf->driver_name.empty());
  CHECK(pdf->port_name == "PORTPROMPT:");
  CHECK(pdf->capabilities.a4);  // the PDF printer accepts A4
  CHECK(pa::queue_port("Microsoft Print to PDF") == std::wstring(L"PORTPROMPT:"));
  CHECK_FALSE(pa::queue_port("No Such Printer 7c1d").has_value());
}
