#include "printing/print_failure.h"

namespace pa {

FailureSafety classify_print_failure(const std::exception_ptr& error) noexcept {
  if (!error) return FailureSafety::Unsafe;
  try {
    std::rethrow_exception(error);
  } catch (const PrintFailure& failure) {
    return failure.stage() == PrintStage::BeforeSpool ? FailureSafety::Safe
                                                      : FailureSafety::Unsafe;
  } catch (...) {
    return FailureSafety::Unsafe;
  }
}

}  // namespace pa
