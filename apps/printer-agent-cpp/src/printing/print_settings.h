#pragma once

#include <windows.h>

#include <nlohmann/json.hpp>

#include <optional>
#include <stdexcept>

namespace pa {

/// A job's print configuration (packages/validation printConfigurationSchema), translated to
/// what the Win32 print path needs. Ported from the Node agent's settings-mapping.ts, which
/// expressed the same table as SumatraPDF command-line tokens.
struct PrintSettings {
  /// 1-based, inclusive; nullopt = every page.
  std::optional<int> first_page;
  std::optional<int> last_page;
  int copies = 1;
  /// DMPAPER_* id; nullopt for CUSTOM (the queue's own default paper, whatever the shop loaded).
  std::optional<short> paper;
  bool landscape = false;
  bool monochrome = false;
  /// DMDUP_SIMPLEX, DMDUP_VERTICAL (long edge) or DMDUP_HORIZONTAL (short edge).
  short duplex = DMDUP_SIMPLEX;
};

class InvalidPrintConfiguration : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/// The mapping, one row per field:
///   pages {mode:"all"}              -> every page
///   pages {mode:"range",from,to}    -> that range (from <= to, both >= 1)
///   copies                          -> copies (1..500)
///   paperSize A4/A5/A3/LETTER/LEGAL -> DMPAPER_A4/A5/A3/LETTER/LEGAL; CUSTOM -> queue default
///   orientation                     -> landscape or portrait (always set, both ways)
///   color BW                        -> monochrome; COLOR -> colour
///   sides DOUBLE                    -> duplex on the long edge, or the SHORT edge when
///                                      landscape (so the back of each sheet is the right way
///                                      up); SINGLE -> simplex
/// paperType and finishing are for the people at the counter, not the printer driver.
/// Throws InvalidPrintConfiguration when a field is missing or out of range, before anything
/// is sent to the printer.
PrintSettings to_print_settings(const nlohmann::json& configuration);

}  // namespace pa
