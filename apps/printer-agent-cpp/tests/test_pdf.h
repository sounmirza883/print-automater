#pragma once

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace pa::test {

/// Writes a small, valid PDF (correct cross-reference table) with `pages` pages of the given
/// size in points, each with a line drawn on it, so tests need no fixture files.
inline void write_test_pdf(const std::filesystem::path& file, int pages, double width_pt = 595,
                           double height_pt = 842) {
  std::string pdf = "%PDF-1.4\n";
  std::vector<size_t> offsets;
  const auto object = [&](const std::string& body) {
    offsets.push_back(pdf.size());
    pdf += std::to_string(offsets.size()) + " 0 obj\n" + body + "\nendobj\n";
  };
  object("<< /Type /Catalog /Pages 2 0 R >>");
  std::string kids;
  for (int i = 0; i < pages; ++i) kids += std::to_string(3 + 2 * i) + " 0 R ";
  object("<< /Type /Pages /Kids [" + kids + "] /Count " + std::to_string(pages) + " >>");
  char box[64];
  std::snprintf(box, sizeof box, "[0 0 %.2f %.2f]", width_pt, height_pt);
  for (int i = 0; i < pages; ++i) {
    object("<< /Type /Page /Parent 2 0 R /MediaBox " + std::string(box) + " /Contents " +
           std::to_string(4 + 2 * i) + " 0 R >>");
    const std::string content = "4 w 36 36 m " + std::to_string(static_cast<int>(width_pt) - 36) +
                                " " + std::to_string(static_cast<int>(height_pt) - 36) + " l S";
    object("<< /Length " + std::to_string(content.size()) + " >>\nstream\n" + content +
           "\nendstream");
  }
  const size_t xref = pdf.size();
  pdf += "xref\n0 " + std::to_string(offsets.size() + 1) + "\n0000000000 65535 f \n";
  for (const size_t offset : offsets) {
    char entry[21];
    std::snprintf(entry, sizeof entry, "%010zu 00000 n \n", offset);
    pdf += entry;
  }
  pdf += "trailer\n<< /Size " + std::to_string(offsets.size() + 1) + " /Root 1 0 R >>\nstartxref\n" +
         std::to_string(xref) + "\n%%EOF\n";
  std::ofstream(file, std::ios::binary) << pdf;
}

}  // namespace pa::test
