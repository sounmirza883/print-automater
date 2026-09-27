#include <catch2/catch_test_macros.hpp>

#include <windows.h>
#include <aclapi.h>
#include <sddl.h>

#include <fstream>
#include <stdexcept>

#include "app/win.h"
#include "documents/job_document.h"
#include "temp_dir.h"

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

void write(const fs::path& file, std::string_view bytes) {
  std::ofstream(file, std::ios::binary) << bytes;
}

}  // namespace

TEST_CASE("the document is deleted when its job's scope ends, normally or by an exception") {
  pa::test::TempDir tmp;
  const auto file = pa::job_document_path(tmp.path(), "3f0c2a4e-1b7d-4c55-9a51-0d6c1a7e9b10");
  {
    auto document = pa::fetch_job_document(tmp.path(), "3f0c2a4e-1b7d-4c55-9a51-0d6c1a7e9b10",
                                           [](const fs::path& f) { write(f, "%PDF-1.7"); });
    CHECK(fs::exists(document.file()));
    CHECK(document.file() == file);
  }
  CHECK_FALSE(fs::exists(file));

  CHECK_THROWS_AS(
      [&] {
        auto document = pa::fetch_job_document(tmp.path(), "job-2",
                                               [](const fs::path& f) { write(f, "%PDF-1.7"); });
        throw std::runtime_error("the printer refused it");
      }(),
      std::runtime_error);
  CHECK_FALSE(fs::exists(tmp.path() / "job-2.pdf"));
}

TEST_CASE("a download that fails part way leaves no file behind") {
  pa::test::TempDir tmp;
  CHECK_THROWS_AS(pa::fetch_job_document(tmp.path(), "job-3",
                                         [](const fs::path& f) {
                                           write(f, "%PDF-1.7 partial");
                                           throw std::runtime_error("connection reset");
                                         }),
                  std::runtime_error);
  CHECK(fs::is_empty(tmp.path()));
}

TEST_CASE("a job id that is not a plain id can never name a path") {
  pa::test::TempDir tmp;
  for (const char* id : {"", "..\\..\\evil", "../x", "a/b", "C:x", "job 1", "job.pdf"}) {
    CHECK_THROWS_AS(pa::job_document_path(tmp.path(), id), std::invalid_argument);
  }
  CHECK_THROWS_AS(pa::job_document_path(tmp.path(), std::string(65, 'a')), std::invalid_argument);
}

TEST_CASE("only a file that starts with the PDF signature is treated as a PDF") {
  pa::test::TempDir tmp;
  write(tmp.path() / "a.pdf", "%PDF-1.4\n...");
  write(tmp.path() / "b.pdf", "\x89PNG\r\n");
  write(tmp.path() / "c.pdf", "%PD");
  CHECK(pa::is_pdf_file(tmp.path() / "a.pdf"));
  CHECK_FALSE(pa::is_pdf_file(tmp.path() / "b.pdf"));
  CHECK_FALSE(pa::is_pdf_file(tmp.path() / "c.pdf"));
  CHECK_FALSE(pa::is_pdf_file(tmp.path() / "missing.pdf"));
}

TEST_CASE("a private file's only access entry is the current user, and nothing is inherited") {
  pa::test::TempDir tmp;
  const auto file = tmp.path() / "private.pdf";
  { auto handle = pa::create_private_file(file); }
  CHECK_THROWS_AS(pa::create_private_file(file), pa::Win32Error);  // never reuses a file

  PACL dacl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  REQUIRE(GetNamedSecurityInfoW(file.c_str(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr,
                                nullptr, &dacl, nullptr, &descriptor) == ERROR_SUCCESS);
  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0;
  REQUIRE(GetSecurityDescriptorControl(descriptor, &control, &revision));
  CHECK((control & SE_DACL_PROTECTED) != 0);
  REQUIRE(dacl != nullptr);
  CHECK(dacl->AceCount == 1);
  void* ace = nullptr;
  REQUIRE(GetAce(dacl, 0, &ace));
  auto* allowed = static_cast<ACCESS_ALLOWED_ACE*>(ace);
  CHECK(allowed->Header.AceType == ACCESS_ALLOWED_ACE_TYPE);
  wchar_t* sid = nullptr;
  REQUIRE(ConvertSidToStringSidW(&allowed->SidStart, &sid));
  CHECK(std::wstring(sid) == pa::current_user_sid());
  LocalFree(sid);
  LocalFree(descriptor);
}

TEST_CASE("the startup sweep removes every temp file; the hourly one only old ones") {
  pa::test::TempDir tmp;
  write(tmp.path() / "old.pdf", "x");
  write(tmp.path() / "new.pdf", "x");
  const auto now = fs::file_time_type::clock::now();
  fs::last_write_time(tmp.path() / "old.pdf", now - 2h);

  CHECK(pa::sweep_temp_files(tmp.path(), 60min, now) == 1);
  CHECK_FALSE(fs::exists(tmp.path() / "old.pdf"));
  CHECK(fs::exists(tmp.path() / "new.pdf"));

  CHECK(pa::sweep_temp_files(tmp.path(), 0min) == 1);
  CHECK(fs::is_empty(tmp.path()));
  CHECK(pa::sweep_temp_files(tmp.path() / "missing", 0min) == 0);
}
