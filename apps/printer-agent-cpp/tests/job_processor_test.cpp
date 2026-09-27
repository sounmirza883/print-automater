#include <catch2/catch_test_macros.hpp>

#include <deque>
#include <fstream>
#include <functional>
#include <stdexcept>
#include <vector>

#include "agent/job_processor.h"
#include "printing/print_failure.h"
#include "temp_dir.h"

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

pa::PrintJobSummary a_job(const std::string& id = "9b2f6c1e-2d4a-4f7b-8e3c-5a1d0f9e7c21") {
  pa::PrintJobSummary job;
  job.id = id;
  job.order_id = "order-1";
  job.printer_id = "printer-1";
  job.printer_name = "Front desk";
  job.status = "QUEUED";
  job.print_configuration = {{"pages", {{"mode", "all"}}}, {"copies", 1},
                             {"paperSize", "A4"},          {"color", "BW"},
                             {"sides", "SINGLE"},          {"orientation", "PORTRAIT"}};
  return job;
}

struct Report {
  std::string job_id;
  pa::ReportedStatus status;
  std::string key;
  std::optional<std::string> os_job_id;
};

class FakeApi final : public pa::JobApi {
 public:
  std::optional<pa::PrintJobSummary> offered = a_job();
  std::function<void()> on_claim;                      // may throw
  std::function<void(const fs::path&)> on_download = [](const fs::path& file) {
    std::ofstream(file, std::ios::binary) << "%PDF-1.7\n";
  };
  int downloads = 0;
  std::vector<Report> reports;
  std::vector<std::string> events;  // the order things happened in

  std::optional<pa::PrintJobSummary> poll(std::chrono::seconds) override { return offered; }
  pa::PrintJobSummary claim(const std::string&) override {
    events.push_back("claim");
    if (on_claim) on_claim();
    return *offered;
  }
  void download(const std::string&, const fs::path& file) override {
    ++downloads;
    events.push_back("download");
    on_download(file);
  }
  void report(const std::string& job_id, pa::ReportedStatus status, const std::string& key,
              const std::optional<std::string>& os_job_id) override {
    events.push_back(std::string("report ") + pa::to_string(status));
    reports.push_back({job_id, status, key, os_job_id});
  }
};

class FakePrinter final : public pa::JobPrinter {
 public:
  std::deque<std::function<pa::SubmittedPrint()>> attempts;
  std::optional<pa::JobResult> verdict = pa::JobResult::Printed;
  int calls = 0;
  bool document_existed_while_printing = false;
  bool ledger_row_existed_while_printing = false;
  pa::JobLedger* ledger = nullptr;
  std::vector<std::string>* events = nullptr;

  pa::SubmittedPrint print(const fs::path& document, const pa::PrintJobSummary& job,
                           const pa::PrintSettings&) override {
    ++calls;
    if (events) events->push_back("print");
    document_existed_while_printing = fs::exists(document);
    ledger_row_existed_while_printing = ledger != nullptr && ledger->get(job.id).has_value();
    if (attempts.empty()) return pa::SubmittedPrint{77, 1};
    auto next = attempts.front();
    attempts.pop_front();
    return next();
  }
  std::optional<pa::JobResult> monitor(const std::string&, DWORD, std::stop_token) override {
    if (events) events->push_back("monitor");
    return verdict;
  }
};

struct Rig {
  pa::test::TempDir dir;
  pa::JobLedger ledger{dir.path() / L"ledger.sqlite"};
  FakeApi api;
  FakePrinter printer;
  pa::MemoryLogger log;
  pa::JobProcessorOptions options;

  Rig() {
    fs::create_directories(dir.path() / L"tmp");
    options.tmp_dir = dir.path() / L"tmp";
    options.print_retry_delay = 1ms;
    options.download_retry_delay = 1ms;
    options.report = {1ms, 1ms, 3};
    printer.ledger = &ledger;
    printer.events = &api.events;
  }
  pa::ProcessResult run() {
    return pa::process_next_job(api, printer, ledger, log, options, std::stop_token{});
  }
  bool tmp_empty() const { return fs::is_empty(options.tmp_dir); }
};

pa::SubmittedPrint fail_before_spool() {
  throw pa::PrintFailure(pa::PrintStage::BeforeSpool, "the printer could not be opened");
}
pa::SubmittedPrint fail_while_spooling() {
  throw pa::PrintFailure(pa::PrintStage::Spooling, "the printer refused a page");
}

}  // namespace

TEST_CASE("nothing queued: no claim, no ledger row, no printing") {
  Rig rig;
  rig.api.offered.reset();
  CHECK(rig.run().outcome == pa::JobOutcome::NoJob);
  CHECK(rig.api.events.empty());
  CHECK(rig.printer.calls == 0);
}

TEST_CASE("the happy path: claim, ledger row before printing, PRINTING, then PRINTED") {
  Rig rig;
  const auto result = rig.run();
  CHECK(result.outcome == pa::JobOutcome::Printed);
  CHECK(result.spool_job_id == 77u);
  CHECK(rig.printer.ledger_row_existed_while_printing);  // the claim is on disk first
  CHECK(rig.printer.document_existed_while_printing);
  CHECK(rig.tmp_empty());  // and the document is gone afterwards
  CHECK(rig.api.events == std::vector<std::string>{"claim", "download", "print", "report PRINTING",
                                                   "monitor", "report PRINTED"});
  REQUIRE(rig.api.reports.size() == 2);
  CHECK(rig.api.reports[0].key == result.job_id + ":PRINTING");
  CHECK(rig.api.reports[0].os_job_id == "77");
  CHECK(rig.api.reports[1].key == result.job_id + ":PRINTED");
  CHECK(rig.ledger.get(result.job_id)->result == pa::JobResult::Printed);
}

TEST_CASE("a lost claim race backs off quietly: no download, no printing, no ledger row") {
  Rig rig;
  rig.api.on_claim = [] { throw pa::BackendError("Already claimed.", "JOB_ALREADY_CLAIMED", false, 409); };
  CHECK(rig.run().outcome == pa::JobOutcome::LostRace);
  CHECK(rig.api.downloads == 0);
  CHECK(rig.printer.calls == 0);
  CHECK_FALSE(rig.ledger.get(a_job().id).has_value());
}

TEST_CASE("any other claim error is thrown so the loop backs off") {
  Rig rig;
  rig.api.on_claim = [] { throw pa::BackendError("down", "NETWORK_ERROR", true, 0); };
  CHECK_THROWS_AS(rig.run(), pa::BackendError);
  CHECK_FALSE(rig.ledger.get(a_job().id).has_value());
}

TEST_CASE("a safe failure is retried up to the limit, then recorded and reported FAILED") {
  Rig rig;
  rig.printer.attempts = {fail_before_spool, fail_before_spool, fail_before_spool};
  const auto result = rig.run();
  CHECK(result.outcome == pa::JobOutcome::Failed);
  CHECK(rig.printer.calls == 3);
  CHECK(rig.ledger.get(result.job_id)->result == pa::JobResult::Failed);
  REQUIRE(rig.api.reports.size() == 1);
  CHECK(rig.api.reports[0].status == pa::ReportedStatus::Failed);
  CHECK(rig.tmp_empty());
}

TEST_CASE("a safe failure that clears on retry prints normally") {
  Rig rig;
  rig.printer.attempts = {fail_before_spool};
  CHECK(rig.run().outcome == pa::JobOutcome::Printed);
  CHECK(rig.printer.calls == 2);
}

TEST_CASE("an unsafe failure is NEVER retried and is recorded UNKNOWN, not FAILED") {
  Rig rig;
  rig.printer.attempts = {fail_while_spooling};
  const auto result = rig.run();
  CHECK(result.outcome == pa::JobOutcome::Unknown);
  CHECK(rig.printer.calls == 1);
  CHECK(rig.ledger.get(result.job_id)->result == pa::JobResult::Unknown);
  REQUIRE(rig.api.reports.size() == 1);
  CHECK(rig.api.reports[0].status == pa::ReportedStatus::Unknown);
  CHECK(rig.tmp_empty());
}

TEST_CASE("an unexpected exception from the printer counts as unsafe") {
  Rig rig;
  rig.printer.attempts = {[]() -> pa::SubmittedPrint { throw std::runtime_error("?"); }};
  CHECK(rig.run().outcome == pa::JobOutcome::Unknown);
  CHECK(rig.printer.calls == 1);
}

TEST_CASE("a download that keeps failing is FAILED (no printer was touched)") {
  Rig rig;
  rig.api.on_download = [](const fs::path&) { throw pa::BackendError("down", "NETWORK_ERROR", true, 0); };
  const auto result = rig.run();
  CHECK(result.outcome == pa::JobOutcome::Failed);
  CHECK(rig.api.downloads == 3);
  CHECK(rig.printer.calls == 0);
  CHECK(rig.ledger.get(result.job_id)->result == pa::JobResult::Failed);
}

TEST_CASE("a download the API refuses outright is not retried") {
  Rig rig;
  rig.api.on_download = [](const fs::path&) {
    throw pa::BackendError("Not claimed.", "JOB_NOT_CLAIMED", false, 409);
  };
  CHECK(rig.run().outcome == pa::JobOutcome::Failed);
  CHECK(rig.api.downloads == 1);
}

TEST_CASE("a document that is not a PDF, or settings that make no sense, are FAILED unprinted") {
  Rig not_pdf;
  not_pdf.api.on_download = [](const fs::path& file) { std::ofstream(file) << "<html>"; };
  CHECK(not_pdf.run().outcome == pa::JobOutcome::Failed);
  CHECK(not_pdf.printer.calls == 0);
  CHECK(not_pdf.tmp_empty());

  Rig bad_settings;
  bad_settings.api.offered->print_configuration["copies"] = 0;
  CHECK(bad_settings.run().outcome == pa::JobOutcome::Failed);
  CHECK(bad_settings.api.downloads == 0);
  CHECK(bad_settings.printer.calls == 0);
}

TEST_CASE("a job already in the ledger is never printed again") {
  Rig rig;
  rig.ledger.claim(a_job().id, "order-1", "Front desk");
  rig.ledger.record_result(a_job().id, pa::JobResult::Printed);
  const auto result = rig.run();
  CHECK(result.outcome == pa::JobOutcome::Unknown);
  CHECK(rig.printer.calls == 0);
  CHECK(rig.api.downloads == 0);
  REQUIRE(rig.api.reports.size() == 1);
  CHECK(rig.api.reports[0].status == pa::ReportedStatus::Unknown);
}

TEST_CASE("the spooler's verdict is what gets recorded and reported") {
  Rig rig;
  rig.printer.verdict = pa::JobResult::Unknown;
  CHECK(rig.run().outcome == pa::JobOutcome::Unknown);
  CHECK(rig.api.reports.back().status == pa::ReportedStatus::Unknown);
  CHECK(rig.ledger.get(a_job().id)->result == pa::JobResult::Unknown);
}

TEST_CASE("shutdown while printing leaves the row unresolved for the next start to mark UNKNOWN") {
  Rig rig;
  rig.printer.verdict = std::nullopt;
  CHECK(rig.run().outcome == pa::JobOutcome::Interrupted);
  const auto row = rig.ledger.get(a_job().id);
  REQUIRE(row.has_value());
  CHECK_FALSE(row->result.has_value());
  const auto swept = pa::mark_unresolved_as_unknown(rig.ledger);
  REQUIRE(swept.size() == 1);
  CHECK(rig.ledger.get(a_job().id)->result == pa::JobResult::Unknown);
}

TEST_CASE("a status report the API refuses for good does not stop the job loop") {
  Rig rig;
  struct RefusingApi final : pa::JobApi {
    FakeApi& inner;
    explicit RefusingApi(FakeApi& api) : inner(api) {}
    std::optional<pa::PrintJobSummary> poll(std::chrono::seconds w) override { return inner.poll(w); }
    pa::PrintJobSummary claim(const std::string& id) override { return inner.claim(id); }
    void download(const std::string& id, const fs::path& f) override { inner.download(id, f); }
    void report(const std::string&, pa::ReportedStatus, const std::string&,
                const std::optional<std::string>&) override {
      throw pa::BackendError("No such print job for this agent.", "JOB_NOT_FOUND", false, 404);
    }
  } refusing(rig.api);
  const auto result =
      pa::process_next_job(refusing, rig.printer, rig.ledger, rig.log, rig.options, {});
  CHECK(result.outcome == pa::JobOutcome::Printed);
  CHECK(rig.ledger.get(result.job_id)->result == pa::JobResult::Printed);
}
