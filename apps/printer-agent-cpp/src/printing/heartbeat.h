#pragma once

#include <nlohmann/json.hpp>

#include <map>
#include <string>
#include <vector>

namespace pa {

/// The four capabilities the frozen heartbeat contract carries (packages/validation
/// printerCapabilitiesSchema). 24.5 fills them from the driver, not hardcoded guesses.
struct PrinterCapabilities {
  bool color = false;
  bool duplex = false;
  bool a4 = false;
  bool a3 = false;
  bool operator==(const PrinterCapabilities&) const = default;
};

/// One installed print queue as discovery sees it.
struct DiscoveredPrinter {
  std::string name;
  std::string driver_name;
  std::string port_name;
  bool online = false;  // the heartbeat's status is binary: ONLINE or ERROR
  PrinterCapabilities capabilities;
};

/// What this process last put on the wire for one printer.
struct LastReportedPrinter {
  PrinterCapabilities capabilities;
  std::string driver_name;
  std::string port_name;
};

/// Ported from discovery.ts toHeartbeatPrinters: the heartbeat body's `printers` array. A field
/// is included only when it differs from what this process last reported for that printer,
/// because the API keeps its stored value when a field is omitted. Resending an unchanged value
/// every beat would overwrite a staff member's manual capability override within seconds.
/// Updates `last_reported` to what is returned.
nlohmann::json heartbeat_printers(const std::vector<DiscoveredPrinter>& discovered,
                                  std::map<std::string, LastReportedPrinter>& last_reported);

}  // namespace pa
