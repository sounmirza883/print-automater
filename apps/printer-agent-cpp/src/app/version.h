#pragma once

#include <string>

namespace pa {

/// The agent's own version (from CMake's project version), sent nowhere yet but shown on the
/// local status page and in the log so a support call can say which build is running.
std::string agent_version();

/// Versions of the linked libraries, one line each, for the startup log.
std::string dependency_versions();

}  // namespace pa
