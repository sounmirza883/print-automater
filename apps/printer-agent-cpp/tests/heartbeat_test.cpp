#include <catch2/catch_test_macros.hpp>

#include "printing/heartbeat.h"

namespace {

pa::DiscoveredPrinter front_desk() {
  return pa::DiscoveredPrinter{"Front desk", "HP Universal", "USB001", true,
                               pa::PrinterCapabilities{true, true, true, false}};
}

}  // namespace

TEST_CASE("the first beat reports everything about each printer") {
  std::map<std::string, pa::LastReportedPrinter> last;
  const auto beat = pa::heartbeat_printers({front_desk()}, last);
  REQUIRE(beat.size() == 1);
  CHECK(beat[0]["name"] == "Front desk");
  CHECK(beat[0]["status"] == "ONLINE");
  CHECK(beat[0]["capabilities"] ==
        nlohmann::json({{"color", true}, {"duplex", true}, {"a4", true}, {"a3", false}}));
  CHECK(beat[0]["driverName"] == "HP Universal");
  CHECK(beat[0]["portName"] == "USB001");
}

TEST_CASE("an unchanged printer sends only name and status, so staff overrides stick") {
  std::map<std::string, pa::LastReportedPrinter> last;
  pa::heartbeat_printers({front_desk()}, last);
  const auto beat = pa::heartbeat_printers({front_desk()}, last);
  CHECK(beat[0] == nlohmann::json({{"name", "Front desk"}, {"status", "ONLINE"}}));
}

TEST_CASE("each changed field is sent on its own") {
  std::map<std::string, pa::LastReportedPrinter> last;
  pa::heartbeat_printers({front_desk()}, last);
  auto moved = front_desk();
  moved.port_name = "IP_10.0.0.5";
  moved.online = false;
  const auto beat = pa::heartbeat_printers({moved}, last);
  CHECK(beat[0]["status"] == "ERROR");
  CHECK(beat[0]["portName"] == "IP_10.0.0.5");
  CHECK_FALSE(beat[0].contains("driverName"));
  CHECK_FALSE(beat[0].contains("capabilities"));
}

TEST_CASE("an empty driver or port name is never sent (the API requires non-empty)") {
  std::map<std::string, pa::LastReportedPrinter> last;
  auto odd = front_desk();
  odd.driver_name.clear();
  const auto beat = pa::heartbeat_printers({odd}, last);
  CHECK_FALSE(beat[0].contains("driverName"));
}
