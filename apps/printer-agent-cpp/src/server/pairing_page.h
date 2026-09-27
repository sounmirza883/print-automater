#pragma once

#include <string>

namespace pa {

/// The local pairing page at http://127.0.0.1:7171: static HTML, script and styles (the
/// Content-Security-Policy allows only these, from the same origin). The script reads
/// /api/status every two seconds and posts the code to /api/pair; it only ever sets text.
const std::string& pairing_page_html();
const std::string& pairing_page_js();
const std::string& pairing_page_css();

}  // namespace pa
