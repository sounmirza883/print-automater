#include <catch2/catch_test_macros.hpp>

#include "backend/backoff.h"

using namespace std::chrono_literals;

TEST_CASE("backoff doubles on failure up to the ceiling and resets on success") {
  pa::ReconnectBackoff backoff(5s, 60s);
  CHECK(backoff.record_failure() == 5s);
  CHECK(backoff.record_failure() == 10s);
  CHECK(backoff.record_failure() == 20s);
  CHECK(backoff.record_failure() == 40s);
  CHECK(backoff.record_failure() == 60s);
  CHECK(backoff.record_failure() == 60s);
  CHECK(backoff.record_success());         // ended an outage
  CHECK_FALSE(backoff.record_success());   // a healthy tick is not a reconnect
  CHECK(backoff.record_failure() == 5s);   // reset for the next outage
}
