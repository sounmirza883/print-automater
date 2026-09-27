#include <catch2/catch_test_macros.hpp>

#include "printing/print_settings.h"

using nlohmann::json;

namespace {

json base_config() {
  return json{{"pages", {{"mode", "all"}}},
              {"copies", 1},
              {"paperSize", "A4"},
              {"color", "COLOR"},
              {"sides", "SINGLE"},
              {"orientation", "PORTRAIT"}};
}

}  // namespace

TEST_CASE("the everyday job: all pages, one colour copy, A4 portrait, one-sided") {
  const auto settings = pa::to_print_settings(base_config());
  CHECK_FALSE(settings.first_page.has_value());
  CHECK_FALSE(settings.last_page.has_value());
  CHECK(settings.copies == 1);
  CHECK(settings.paper == static_cast<short>(DMPAPER_A4));
  CHECK_FALSE(settings.landscape);
  CHECK_FALSE(settings.monochrome);
  CHECK(settings.duplex == DMDUP_SIMPLEX);
}

TEST_CASE("a page range, copies, black and white") {
  auto config = base_config();
  config["pages"] = {{"mode", "range"}, {"from", 3}, {"to", 7}};
  config["copies"] = 25;
  config["color"] = "BW";
  const auto settings = pa::to_print_settings(config);
  CHECK(settings.first_page == 3);
  CHECK(settings.last_page == 7);
  CHECK(settings.copies == 25);
  CHECK(settings.monochrome);
}

TEST_CASE("double-sided flips on the long edge, or the short edge when landscape") {
  auto config = base_config();
  config["sides"] = "DOUBLE";
  CHECK(pa::to_print_settings(config).duplex == DMDUP_VERTICAL);
  config["orientation"] = "LANDSCAPE";
  const auto landscape = pa::to_print_settings(config);
  CHECK(landscape.landscape);
  CHECK(landscape.duplex == DMDUP_HORIZONTAL);
}

TEST_CASE("every paper size maps to its DMPAPER id; CUSTOM leaves the queue's own paper") {
  auto config = base_config();
  const std::pair<const char*, int> sizes[] = {{"A4", DMPAPER_A4},
                                               {"A5", DMPAPER_A5},
                                               {"A3", DMPAPER_A3},
                                               {"LETTER", DMPAPER_LETTER},
                                               {"LEGAL", DMPAPER_LEGAL}};
  for (const auto& [name, id] : sizes) {
    config["paperSize"] = name;
    CHECK(pa::to_print_settings(config).paper == static_cast<short>(id));
  }
  config["paperSize"] = "CUSTOM";
  CHECK_FALSE(pa::to_print_settings(config).paper.has_value());
}

TEST_CASE("paper type and finishing do not affect the printer settings") {
  auto config = base_config();
  config["paperType"] = "CARD";
  config["finishing"] = json::array({"STAPLING", "LAMINATION"});
  CHECK(pa::to_print_settings(config).paper == static_cast<short>(DMPAPER_A4));
}

TEST_CASE("a configuration the printer must not guess at is refused before printing") {
  auto missing = base_config();
  missing.erase("copies");
  CHECK_THROWS_AS(pa::to_print_settings(missing), pa::InvalidPrintConfiguration);

  auto backwards = base_config();
  backwards["pages"] = {{"mode", "range"}, {"from", 5}, {"to", 2}};
  CHECK_THROWS_AS(pa::to_print_settings(backwards), pa::InvalidPrintConfiguration);

  auto zero_page = base_config();
  zero_page["pages"] = {{"mode", "range"}, {"from", 0}, {"to", 2}};
  CHECK_THROWS_AS(pa::to_print_settings(zero_page), pa::InvalidPrintConfiguration);

  for (const auto& [field, value] : {std::pair<const char*, json>{"copies", 0},
                                     {"copies", 501},
                                     {"copies", 1.5},
                                     {"paperSize", "TABLOID"},
                                     {"color", "SEPIA"},
                                     {"sides", "TRIPLE"},
                                     {"orientation", "DIAGONAL"}}) {
    auto config = base_config();
    config[field] = value;
    CHECK_THROWS_AS(pa::to_print_settings(config), pa::InvalidPrintConfiguration);
  }
  CHECK_THROWS_AS(pa::to_print_settings(json::array()), pa::InvalidPrintConfiguration);
}
