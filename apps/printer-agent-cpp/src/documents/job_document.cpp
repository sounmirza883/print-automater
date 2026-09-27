#include "documents/job_document.h"

#include <array>
#include <fstream>
#include <stdexcept>

namespace pa {

JobDocument::~JobDocument() {
  if (file_.empty()) return;
  std::error_code ignored;
  std::filesystem::remove(file_, ignored);
}

std::filesystem::path job_document_path(const std::filesystem::path& tmp_dir,
                                        const std::string& job_id) {
  const bool safe = !job_id.empty() && job_id.size() <= 64 &&
                    job_id.find_first_not_of("abcdefghijklmnopqrstuvwxyz"
                                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-") ==
                        std::string::npos;
  if (!safe) throw std::invalid_argument("The API sent a job id that is not a plain id.");
  return tmp_dir / (std::wstring(job_id.begin(), job_id.end()) + L".pdf");
}

JobDocument fetch_job_document(const std::filesystem::path& tmp_dir, const std::string& job_id,
                               const std::function<void(const std::filesystem::path&)>& download) {
  JobDocument document(job_document_path(tmp_dir, job_id));
  download(document.file());
  return document;
}

bool is_pdf_file(const std::filesystem::path& file) {
  std::ifstream in(file, std::ios::binary);
  std::array<char, 5> head{};
  if (!in.read(head.data(), static_cast<std::streamsize>(head.size()))) return false;
  return std::string_view(head.data(), head.size()) == "%PDF-";
}

int sweep_temp_files(const std::filesystem::path& tmp_dir, std::chrono::minutes min_age,
                     std::filesystem::file_time_type now) {
  std::error_code error;
  std::filesystem::directory_iterator entries(tmp_dir, error);
  if (error) return 0;
  int removed = 0;
  for (const auto& entry : entries) {
    std::error_code entry_error;
    if (!entry.is_regular_file(entry_error)) continue;
    if (min_age.count() > 0) {
      const auto written = entry.last_write_time(entry_error);
      if (entry_error || now - written < min_age) continue;
    }
    if (std::filesystem::remove(entry.path(), entry_error)) ++removed;
  }
  return removed;
}

}  // namespace pa
