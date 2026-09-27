#include <catch2/catch_test_macros.hpp>

#include "printing/print_failure.h"

namespace {

std::exception_ptr thrown(auto exception) {
  try {
    throw exception;
  } catch (...) {
    return std::current_exception();
  }
}

}  // namespace

TEST_CASE("a failure before anything reached the spooler is safe to retry") {
  CHECK(pa::classify_print_failure(thrown(pa::PrintFailure(pa::PrintStage::BeforeSpool, "no DC"))) ==
        pa::FailureSafety::Safe);
}

TEST_CASE("a failure after StartDoc is unsafe: paper may have come out") {
  CHECK(pa::classify_print_failure(thrown(pa::PrintFailure(pa::PrintStage::Spooling, "EndPage"))) ==
        pa::FailureSafety::Unsafe);
}

TEST_CASE("anything unrecognised is treated as unsafe") {
  CHECK(pa::classify_print_failure(thrown(std::runtime_error("?"))) == pa::FailureSafety::Unsafe);
  CHECK(pa::classify_print_failure(thrown(42)) == pa::FailureSafety::Unsafe);
  CHECK(pa::classify_print_failure(nullptr) == pa::FailureSafety::Unsafe);
}
