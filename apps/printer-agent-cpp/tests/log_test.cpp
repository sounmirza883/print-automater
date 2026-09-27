#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <nlohmann/json.hpp>

#include <fstream>
#include <sstream>

#include "app/log.h"
#include "temp_dir.h"

namespace fs = std::filesystem;
using Catch::Matchers::ContainsSubstring;

namespace {

std::vector<fs::path> logs_in(const fs::path& dir) {
  std::vector<fs::path> files;
  for (const auto& entry : fs::directory_iterator(dir)) files.push_back(entry.path());
  return files;
}

std::string read_all(const fs::path& file) {
  std::ifstream in(file, std::ios::binary);
  std::ostringstream out;
  out << in.rdbuf();
  return out.str();
}

}  // namespace

TEST_CASE("each line is one JSON object with time, level, message and the fields") {
  pa::test::TempDir tmp;
  {
    pa::FileLogger log(tmp.path());
    log.info("job claimed", {{"jobId", "j-1"}});
    log.error("print failed", {{"jobId", "j-1"}, {"error", "paper jam"}});
  }
  const auto files = logs_in(tmp.path());
  REQUIRE(files.size() == 1);
  CHECK(files[0].filename().wstring().starts_with(L"agent-"));
  std::istringstream lines(read_all(files[0]));
  std::string line;
  std::vector<nlohmann::json> parsed;
  while (std::getline(lines, line)) parsed.push_back(nlohmann::json::parse(line));
  REQUIRE(parsed.size() == 2);
  CHECK(parsed[0]["msg"] == "job claimed");
  CHECK(parsed[0]["level"] == "info");
  CHECK(parsed[0]["jobId"] == "j-1");
  CHECK(parsed[1]["level"] == "error");
  CHECK(parsed[1]["error"] == "paper jam");
  CHECK(parsed[1]["time"].get<std::string>().size() == 24);
}

TEST_CASE("a day's log stops growing at its size limit, with one marker line") {
  pa::test::TempDir tmp;
  {
    pa::FileLogger log(tmp.path(), 1000);
    for (int i = 0; i < 100; ++i) log.info("a fairly ordinary line of agent logging", {{"i", i}});
  }
  const auto files = logs_in(tmp.path());
  REQUIRE(files.size() == 1);
  const auto text = read_all(files[0]);
  CHECK(text.size() < 1200);
  CHECK_THAT(text, ContainsSubstring("daily log size limit reached"));
}

TEST_CASE("only the newest days of logs are kept") {
  pa::test::TempDir tmp;
  for (const char* day : {"2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"}) {
    std::ofstream(tmp.path() / (std::string("agent-") + day + ".log")) << "{}\n";
  }
  std::ofstream(tmp.path() / "unrelated.txt") << "keep me";
  {
    pa::FileLogger log(tmp.path(), 10u << 20, 3);
    log.info("start");
  }
  const auto files = logs_in(tmp.path());
  CHECK(fs::exists(tmp.path() / "unrelated.txt"));
  CHECK_FALSE(fs::exists(tmp.path() / "agent-2020-01-01.log"));
  CHECK_FALSE(fs::exists(tmp.path() / "agent-2020-01-02.log"));
  CHECK(fs::exists(tmp.path() / "agent-2020-01-04.log"));
  CHECK(files.size() == 4);  // three logs (two old + today) and the unrelated file
}
