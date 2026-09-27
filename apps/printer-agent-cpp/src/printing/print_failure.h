#pragma once

#include <exception>
#include <stdexcept>
#include <string>

namespace pa {

/// How far a print attempt got before it failed (24.10, replacing the Node agent's
/// failure-classifier.ts, which had to infer this from how a child process died).
enum class PrintStage {
  /// Nothing reached the spooler: the document would not open, the printer could not be
  /// opened, the device context or settings were refused, or StartDoc failed.
  BeforeSpool,
  /// StartDoc had returned a job id: pages may already be on their way to paper.
  Spooling,
};

class PrintFailure : public std::runtime_error {
 public:
  PrintFailure(PrintStage stage, const std::string& message)
      : std::runtime_error(message), stage_(stage) {}
  PrintStage stage() const noexcept { return stage_; }

 private:
  PrintStage stage_;
};

enum class FailureSafety { Safe, Unsafe };

/// Safe = nothing could have printed, so it may be retried automatically and recorded FAILED.
/// Unsafe = paper may have come out: never retried automatically, recorded UNKNOWN for a person
/// to resolve. Anything that is not a PrintFailure is Unsafe, the direction that can never
/// itself cause a duplicate print.
FailureSafety classify_print_failure(const std::exception_ptr& error) noexcept;

}  // namespace pa
