#pragma once

#include <chrono>
#include <filesystem>
#include <functional>
#include <string>

namespace pa {

/// 24.8 (ported from documents/document-fetch.ts withJobDocument): a job's document exists on
/// disk only while this object does. The destructor deletes it on every path out of the scope,
/// success or exception, so the only way a document outlives its job is a hard kill of the
/// process, and the startup temp sweep (24.13) removes those.
class JobDocument {
 public:
  explicit JobDocument(std::filesystem::path file) : file_(std::move(file)) {}
  JobDocument(const JobDocument&) = delete;
  JobDocument& operator=(const JobDocument&) = delete;
  JobDocument(JobDocument&& other) noexcept : file_(std::move(other.file_)) { other.file_.clear(); }
  JobDocument& operator=(JobDocument&&) = delete;
  ~JobDocument();

  const std::filesystem::path& file() const { return file_; }

 private:
  std::filesystem::path file_;
};

/// tmp\<jobId>.pdf. The id comes from the API; anything but letters, digits and '-' (a UUID) is
/// refused, so a job id can never name a file outside the temp folder.
std::filesystem::path job_document_path(const std::filesystem::path& tmp_dir,
                                        const std::string& job_id);

/// Downloads the job's document with `download` (which creates the file private to this user;
/// see http_download) and returns the guard that owns it. A download that throws leaves no file.
JobDocument fetch_job_document(const std::filesystem::path& tmp_dir, const std::string& job_id,
                               const std::function<void(const std::filesystem::path&)>& download);

/// True when the file starts with the PDF signature "%PDF-". The API only ever sends PDF (the
/// worker converts images and Word files first), so anything else is refused, not printed.
bool is_pdf_file(const std::filesystem::path& file);

/// 24.13 (ported from documents/temp-sweep.ts). Deletes files in `tmp_dir`:
///  - at startup, `min_age` zero: every file there predates this process, so none can be in use;
///  - hourly, `min_age` one hour: this process is creating and deleting documents as jobs run,
///    so only files older than any real print job are orphans.
/// Returns how many files were deleted; one that cannot be deleted is skipped, not fatal.
int sweep_temp_files(const std::filesystem::path& tmp_dir, std::chrono::minutes min_age,
                     std::filesystem::file_time_type now = std::filesystem::file_time_type::clock::now());

}  // namespace pa
