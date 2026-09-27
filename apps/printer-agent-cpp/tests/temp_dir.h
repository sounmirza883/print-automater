#pragma once

#include <filesystem>
#include <random>
#include <string>

namespace pa::test {

/// A fresh, uniquely named folder under %TEMP%, removed when the test ends. Unique so test
/// cases that ctest runs in parallel never share one.
class TempDir {
 public:
  TempDir() {
    std::random_device random;
    const auto name = L"pa-test-" + std::to_wstring(random()) + std::to_wstring(random());
    path_ = std::filesystem::temp_directory_path() / name;
    std::filesystem::create_directories(path_);
  }
  TempDir(const TempDir&) = delete;
  TempDir& operator=(const TempDir&) = delete;
  ~TempDir() {
    std::error_code ignored;
    std::filesystem::remove_all(path_, ignored);
  }

  const std::filesystem::path& path() const { return path_; }

 private:
  std::filesystem::path path_;
};

}  // namespace pa::test
