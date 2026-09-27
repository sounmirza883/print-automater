#include <catch2/catch_test_macros.hpp>

#include <stdexcept>
#include <vector>

#include "backend/status_reporter.h"

using namespace std::chrono_literals;

TEST_CASE("a report is retried with the same idempotency key until it gets through") {
  std::vector<std::string> keys;
  std::vector<std::chrono::milliseconds> waits;
  int calls = 0;
  const bool sent = pa::report_status_with_retry(
      [&](const std::string& key) {
        keys.push_back(key);
        if (++calls < 3) throw std::runtime_error("offline");
      },
      "job-42", pa::ReportedStatus::Printed, std::stop_token{}, {1ms, 3ms, std::nullopt},
      [&](const std::exception&, int, std::chrono::milliseconds wait) { waits.push_back(wait); });
  CHECK(sent);
  CHECK(calls == 3);
  CHECK(keys == std::vector<std::string>(3, "job-42:PRINTED"));
  CHECK(waits == std::vector<std::chrono::milliseconds>{1ms, 2ms});
}

TEST_CASE("waits are capped at the maximum") {
  std::vector<std::chrono::milliseconds> waits;
  int calls = 0;
  pa::report_status_with_retry(
      [&](const std::string&) {
        if (++calls < 6) throw std::runtime_error("offline");
      },
      "j", pa::ReportedStatus::Failed, std::stop_token{}, {1ms, 4ms, std::nullopt},
      [&](const std::exception&, int, std::chrono::milliseconds wait) { waits.push_back(wait); });
  CHECK(waits == std::vector<std::chrono::milliseconds>{1ms, 2ms, 4ms, 4ms, 4ms});
}

TEST_CASE("the last error is rethrown once the attempt limit is reached") {
  CHECK_THROWS_AS(pa::report_status_with_retry(
                      [](const std::string&) { throw std::runtime_error("down"); }, "j",
                      pa::ReportedStatus::Unknown, std::stop_token{}, {1ms, 1ms, 2}),
                  std::runtime_error);
}

TEST_CASE("shutdown stops the retrying") {
  std::stop_source source;
  int calls = 0;
  const bool sent = pa::report_status_with_retry(
      [&](const std::string&) {
        ++calls;
        source.request_stop();
        throw std::runtime_error("down");
      },
      "j", pa::ReportedStatus::Printing, source.get_token(), {1000ms, 1000ms, std::nullopt});
  CHECK_FALSE(sent);
  CHECK(calls == 1);
}

TEST_CASE("a permanent refusal is not retried; a 401, 429 or retryable error is") {
  int calls = 0;
  CHECK_THROWS_AS(pa::report_status_with_retry(
                      [&](const std::string&) {
                        ++calls;
                        throw pa::BackendError("No such print job for this agent.", "JOB_NOT_FOUND",
                                               false, 404);
                      },
                      "j", pa::ReportedStatus::Printed, std::stop_token{}, {1ms, 1ms, 5}),
                  pa::BackendError);
  CHECK(calls == 1);

  for (const auto& transient : {pa::BackendError("expired", "UNAUTHORIZED", false, 401),
                                pa::BackendError("slow down", "RATE_LIMITED", false, 429),
                                pa::BackendError("busy", "CONFLICT", true, 409),
                                pa::BackendError("down", "INTERNAL", false, 503),
                                pa::BackendError("offline", "NETWORK_ERROR", true, 0)}) {
    CHECK_FALSE(pa::is_permanent_refusal(transient));
  }
  CHECK(pa::is_permanent_refusal(pa::BackendError("bad", "VALIDATION_ERROR", false, 400)));
  CHECK_FALSE(pa::is_permanent_refusal(std::runtime_error("not an API answer")));
}
