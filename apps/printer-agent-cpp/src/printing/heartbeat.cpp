#include "printing/heartbeat.h"

namespace pa {

nlohmann::json heartbeat_printers(const std::vector<DiscoveredPrinter>& discovered,
                                  std::map<std::string, LastReportedPrinter>& last_reported) {
  nlohmann::json printers = nlohmann::json::array();
  for (const auto& printer : discovered) {
    const auto previous = last_reported.find(printer.name);
    const bool first = previous == last_reported.end();

    nlohmann::json entry = {{"name", printer.name}, {"status", printer.online ? "ONLINE" : "ERROR"}};
    if (first || previous->second.capabilities != printer.capabilities) {
      entry["capabilities"] = {{"color", printer.capabilities.color},
                               {"duplex", printer.capabilities.duplex},
                               {"a4", printer.capabilities.a4},
                               {"a3", printer.capabilities.a3}};
    }
    // The API requires these to be non-empty when present, so an empty value is never sent.
    if ((first || previous->second.driver_name != printer.driver_name) &&
        !printer.driver_name.empty()) {
      entry["driverName"] = printer.driver_name;
    }
    if ((first || previous->second.port_name != printer.port_name) && !printer.port_name.empty()) {
      entry["portName"] = printer.port_name;
    }
    last_reported[printer.name] =
        LastReportedPrinter{printer.capabilities, printer.driver_name, printer.port_name};
    printers.push_back(std::move(entry));
  }
  return printers;
}

}  // namespace pa
