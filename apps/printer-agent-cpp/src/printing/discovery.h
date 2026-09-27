#pragma once

#include <windows.h>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "printing/heartbeat.h"

namespace pa {

/// What a driver answered to DeviceCapabilities; nullopt where it would not answer.
struct RawCapabilities {
  std::optional<bool> color;               // DC_COLORDEVICE
  std::optional<bool> duplex;              // DC_DUPLEX
  std::optional<std::vector<WORD>> papers;  // DC_PAPERS (DMPAPER_* ids)
};

/// 24.5, pure: one queue's PRINTER_INFO_2 status + its driver's answers -> the heartbeat view.
///  - ONLINE unless a spooler status flag says it needs attention (error, offline, paper out or
///    jam, door open, no toner, user intervention, not available, pending deletion) or the queue
///    is set to "use printer offline". A busy, printing, warming-up or power-saving printer is
///    fine. (The heartbeat is binary on purpose: OFFLINE is what the API infers from missed
///    heartbeats, never something the agent claims about a queue it can still see.)
///  - capabilities are the driver's own answers. A4 / A3 come from the paper sizes it accepts.
///    Where a driver will not answer, the Node agent's cautious defaults apply: colour and
///    duplex false, A4 true (near universal), A3 false (claiming A3 wrongly means failed jobs);
///    staff can still override capabilities in the back office.
DiscoveredPrinter to_discovered_printer(std::string name, std::string driver_name,
                                        std::string port_name, DWORD status, DWORD attributes,
                                        const RawCapabilities& capabilities);

/// True for a port that asks where to save a file instead of printing (PORTPROMPT:, FILE:):
/// Microsoft Print to PDF, the XPS writer and similar.
bool saves_to_file(std::wstring_view port);

/// Whether the agent can print to a queue with nobody at the screen, onto paper. A fax queue
/// would open the fax wizard, and a save-to-file queue a Save dialog, either stalling the job
/// loop behind a window nobody sees; a queue on the NUL: port (Send To OneNote and the like)
/// never produces paper at all. None of them is reported to the API, so the allocation engine
/// can never pick one. Save-to-file queues are allowed only when the agent is configured to write
/// their output to a folder (AgentConfig::print_to_file_dir, for trials).
bool prints_unattended(std::wstring_view port, DWORD attributes, bool file_queues_allowed);

/// Every installed print queue (local and connected) the agent can print to unattended, with
/// its driver's capabilities. Throws Win32Error if the spooler cannot be enumerated at all; a
/// single printer whose driver will not answer still appears, with the defaults above.
std::vector<DiscoveredPrinter> discover_printers(bool include_file_queues = false);

/// A queue's port name; nullopt when the queue cannot be opened.
std::optional<std::wstring> queue_port(const std::string& printer_name);

}  // namespace pa
