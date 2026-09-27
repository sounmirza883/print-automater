#include <catch2/catch_test_macros.hpp>

#include <fstream>
#include <functional>
#include <optional>

#include "printing/pdf_printer.h"
#include "printing/print_failure.h"
#include "printing/print_monitor.h"
#include "temp_dir.h"
#include "test_pdf.h"

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

// 600 dpi A4 portrait with a quarter-inch unprintable margin.
constexpr pa::SheetGeometry kA4{600, 600, 4961, 7016, 150, 150};
constexpr const char* kPdfPrinter = "Microsoft Print to PDF";

pa::PrintSettings plain() {
  pa::PrintSettings settings;
  settings.paper = static_cast<short>(DMPAPER_A4);
  return settings;
}

/// The stage of the PrintFailure `print` throws; nullopt when it does not throw one.
std::optional<pa::PrintStage> stage_of(const std::function<void()>& print) {
  try {
    print();
  } catch (const pa::PrintFailure& failure) {
    return failure.stage();
  }
  return std::nullopt;
}

/// Prints to Microsoft Print to PDF (a real driver through the real spooler), waits for the
/// spooler's verdict, and returns the page count of the PDF it wrote.
int print_to_pdf(const fs::path& document, const pa::PrintSettings& settings,
                 const fs::path& output) {
  const auto submitted = pa::print_pdf(document, kPdfPrinter, settings, L"agent test", output);
  CHECK(submitted.spool_job_id > 0);
  const auto verdict = pa::monitor_spooler_job(kPdfPrinter, submitted.spool_job_id, {},
                                               {250ms, 60s});
  CHECK(verdict == pa::JobResult::Printed);
  REQUIRE(fs::exists(output));
  return pa::pdf_page_count(output);
}

}  // namespace

TEST_CASE("a page the size of the sheet fills it exactly, drawn from the sheet's corner") {
  const auto at = pa::place_page(595.28, 841.89, kA4);
  CHECK(at.rotate == 0);
  CHECK(at.width == 4961);
  CHECK(at.height == 7016);
  CHECK(at.x == -150);  // the DC's origin is inside the margin; the sheet's corner is not
  CHECK(at.y == -150);
}

TEST_CASE("a smaller page prints at actual size, centred") {
  const auto at = pa::place_page(419.53, 595.28, kA4);  // A5
  CHECK(at.rotate == 0);
  CHECK(at.width == 3496);
  CHECK(at.height == 4961);
  CHECK(at.x == (4961 - 3496) / 2 - 150);
  CHECK(at.y == (7016 - 4961) / 2 - 150);
}

TEST_CASE("a larger page is shrunk to the sheet instead of being cut off") {
  const auto at = pa::place_page(841.89, 1190.55, kA4);  // A3 on A4
  CHECK(at.rotate == 0);
  CHECK(at.width <= 4961);
  CHECK(at.height <= 7016);
  CHECK(at.height == 7016);  // limited by the tighter side, aspect kept
}

TEST_CASE("a landscape page on a portrait sheet is turned to fit") {
  const auto at = pa::place_page(841.89, 595.28, kA4);
  CHECK(at.rotate == 1);
  CHECK(at.width == 4961);
  CHECK(at.height == 7016);
}

TEST_CASE("the test PDF helper writes a PDF PDFium can read") {
  pa::test::TempDir tmp;
  pa::test::write_test_pdf(tmp.path() / "three.pdf", 3);
  CHECK(pa::pdf_page_count(tmp.path() / "three.pdf") == 3);
}

TEST_CASE("problems found before the spooler are safe failures") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 2);

  std::ofstream(tmp.path() / "not.pdf") << "<html></html>";
  CHECK(stage_of([&] { pa::print_pdf(tmp.path() / "not.pdf", kPdfPrinter, plain(), L"t"); }) ==
        pa::PrintStage::BeforeSpool);

  CHECK(stage_of([&] { pa::print_pdf(tmp.path() / "missing.pdf", kPdfPrinter, plain(), L"t"); }) ==
        pa::PrintStage::BeforeSpool);

  auto beyond = plain();
  beyond.first_page = 2;
  beyond.last_page = 5;
  CHECK(stage_of([&] { pa::print_pdf(pdf, kPdfPrinter, beyond, L"t"); }) ==
        pa::PrintStage::BeforeSpool);

  CHECK(stage_of([&] { pa::print_pdf(pdf, "No Such Printer 7c1d", plain(), L"t"); }) ==
        pa::PrintStage::BeforeSpool);

  // A save-to-file queue with nowhere to save would open a Save dialog: refused instead.
  CHECK(stage_of([&] { pa::print_pdf(pdf, kPdfPrinter, plain(), L"t"); }) ==
        pa::PrintStage::BeforeSpool);
}

TEST_CASE("PDFium -> printer DC -> spooler -> a real driver: every page arrives",
          "[spooler]") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 3);
  CHECK(print_to_pdf(pdf, plain(), tmp.path() / "out.pdf") == 3);
}

TEST_CASE("only the requested page range is printed", "[spooler]") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 5);
  auto settings = plain();
  settings.first_page = 2;
  settings.last_page = 4;
  CHECK(print_to_pdf(pdf, settings, tmp.path() / "out.pdf") == 3);
}

TEST_CASE("copies are all printed", "[spooler]") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 2);
  auto settings = plain();
  settings.copies = 3;
  CHECK(print_to_pdf(pdf, settings, tmp.path() / "out.pdf") == 6);
}

TEST_CASE("landscape and black-and-white jobs print", "[spooler]") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 1, 842, 595);
  auto settings = plain();
  settings.landscape = true;
  settings.monochrome = true;
  CHECK(print_to_pdf(pdf, settings, tmp.path() / "out.pdf") == 1);
}

TEST_CASE("a printer that cannot print double-sided refuses a double-sided job before spooling",
          "[spooler]") {
  pa::test::TempDir tmp;
  const auto pdf = tmp.path() / "doc.pdf";
  pa::test::write_test_pdf(pdf, 2);
  auto settings = plain();
  settings.duplex = DMDUP_VERTICAL;
  CHECK(stage_of([&] {
          pa::print_pdf(pdf, kPdfPrinter, settings, L"t", tmp.path() / "out.pdf");
        }) == pa::PrintStage::BeforeSpool);
  CHECK_FALSE(fs::exists(tmp.path() / "out.pdf"));
}

TEST_CASE("a spooler job id that does not exist reads as gone") {
  const auto view = pa::query_spooler_job(kPdfPrinter, 0x7FFFFFF0);
  REQUIRE(view.has_value());
  CHECK_FALSE(view->present);
  CHECK_FALSE(pa::query_spooler_job("No Such Printer 7c1d", 1).has_value());
}
