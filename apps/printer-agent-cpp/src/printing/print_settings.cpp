#include "printing/print_settings.h"

#include <string>

namespace pa {

namespace {

const nlohmann::json& require(const nlohmann::json& object, const char* field) {
  if (!object.is_object() || !object.contains(field)) {
    throw InvalidPrintConfiguration(std::string("print configuration is missing ") + field);
  }
  return object.at(field);
}

std::string require_string(const nlohmann::json& object, const char* field) {
  const auto& value = require(object, field);
  if (!value.is_string()) {
    throw InvalidPrintConfiguration(std::string("print configuration ") + field +
                                    " is not a string");
  }
  return value.get<std::string>();
}

int require_int(const nlohmann::json& object, const char* field, int min, int max) {
  const auto& value = require(object, field);
  if (!value.is_number_integer()) {
    throw InvalidPrintConfiguration(std::string("print configuration ") + field +
                                    " is not a whole number");
  }
  const auto number = value.get<long long>();
  if (number < min || number > max) {
    throw InvalidPrintConfiguration(std::string("print configuration ") + field +
                                    " is out of range");
  }
  return static_cast<int>(number);
}

std::optional<short> paper_for(const std::string& size) {
  if (size == "A4") return static_cast<short>(DMPAPER_A4);
  if (size == "A5") return static_cast<short>(DMPAPER_A5);
  if (size == "A3") return static_cast<short>(DMPAPER_A3);
  if (size == "LETTER") return static_cast<short>(DMPAPER_LETTER);
  if (size == "LEGAL") return static_cast<short>(DMPAPER_LEGAL);
  if (size == "CUSTOM") return std::nullopt;
  throw InvalidPrintConfiguration("unknown paper size " + size);
}

}  // namespace

PrintSettings to_print_settings(const nlohmann::json& configuration) {
  PrintSettings settings;

  const auto& pages = require(configuration, "pages");
  const auto mode = require_string(pages, "mode");
  if (mode == "range") {
    constexpr int kMaxPage = 1'000'000;
    settings.first_page = require_int(pages, "from", 1, kMaxPage);
    settings.last_page = require_int(pages, "to", 1, kMaxPage);
    if (*settings.first_page > *settings.last_page) {
      throw InvalidPrintConfiguration("print configuration page range ends before it starts");
    }
  } else if (mode != "all") {
    throw InvalidPrintConfiguration("unknown page selection " + mode);
  }

  settings.copies = require_int(configuration, "copies", 1, 500);
  settings.paper = paper_for(require_string(configuration, "paperSize"));

  const auto orientation = require_string(configuration, "orientation");
  if (orientation != "PORTRAIT" && orientation != "LANDSCAPE") {
    throw InvalidPrintConfiguration("unknown orientation " + orientation);
  }
  settings.landscape = orientation == "LANDSCAPE";

  const auto color = require_string(configuration, "color");
  if (color != "BW" && color != "COLOR") throw InvalidPrintConfiguration("unknown color " + color);
  settings.monochrome = color == "BW";

  const auto sides = require_string(configuration, "sides");
  if (sides == "DOUBLE") {
    settings.duplex = static_cast<short>(settings.landscape ? DMDUP_HORIZONTAL : DMDUP_VERTICAL);
  } else if (sides == "SINGLE") {
    settings.duplex = DMDUP_SIMPLEX;
  } else {
    throw InvalidPrintConfiguration("unknown sides " + sides);
  }

  return settings;
}

}  // namespace pa
