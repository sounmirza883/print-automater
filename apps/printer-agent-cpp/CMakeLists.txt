cmake_minimum_required(VERSION 3.20)

# The static CRT (/MT) must be chosen before project() so it applies everywhere, matching
# vcpkg's x64-windows-static triplet: the agent is one exe plus pdfium.dll, nothing else.
cmake_policy(SET CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

project(print_automated_agent VERSION 0.1.0 DESCRIPTION "Print Automated printer agent"
        LANGUAGES C CXX)

if(NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The printer agent targets Windows x64 with MSVC.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(cmake/Pdfium.cmake)

find_package(CURL CONFIG REQUIRED)
find_package(unofficial-sodium CONFIG REQUIRED)
find_package(unofficial-sqlite3 CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(Catch2 3 CONFIG REQUIRED)

# Settings shared by every target built from this project's own sources. The compiler flags
# are C/C++ only, so the resource compiler (agent.rc) is not handed /W4 and friends.
add_library(pa_options INTERFACE)
target_compile_options(pa_options INTERFACE
  "$<$<COMPILE_LANGUAGE:C,CXX>:/W4;/WX;/permissive-;/utf-8;/EHsc;/Zc:__cplusplus;/Zc:preprocessor;/sdl>")
target_compile_definitions(pa_options INTERFACE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00 WINVER=0x0A00
  PA_VERSION="${PROJECT_VERSION}")

# Everything except the entry point, so the tests link the same code the agent runs.
add_library(agent_core STATIC
  src/app/version.cpp
  # 24.2 paths and configuration
  src/app/win.cpp
  src/config/paths.cpp
  src/config/config.cpp
  # 24.3 identity
  src/identity/base64url.cpp
  src/identity/identity.cpp
  # 24.6 ledger
  src/ledger/ledger.cpp
  # 24.4 API client
  src/backend/http.cpp
  src/backend/backend_client.cpp
  src/backend/access_tokens.cpp
  # 24.11 status reporting
  src/backend/status_reporter.cpp
  # 24.10 failure classification and the spooler verdict
  src/printing/print_failure.cpp
  src/printing/job_tracker.cpp
  # 24.5 heartbeat and printer discovery
  src/printing/heartbeat.cpp
  src/printing/discovery.cpp
  # 24.8 job documents (and 24.13's temp sweep)
  src/documents/job_document.cpp
  # 24.9 PDFium printing, 24.10 spooler monitoring
  src/printing/print_settings.cpp
  src/printing/pdf_printer.cpp
  src/printing/print_monitor.cpp)
target_include_directories(agent_core PUBLIC src)
target_link_libraries(agent_core
  PUBLIC pa_options pdfium CURL::libcurl unofficial-sodium::sodium unofficial::sqlite3::sqlite3
         nlohmann_json::nlohmann_json crypt32 ws2_32 winspool shell32)

add_executable(print-automated-agent WIN32 src/main.cpp)
target_link_libraries(print-automated-agent PRIVATE agent_core)
pa_copy_pdfium_dll(print-automated-agent)

enable_testing()
add_executable(agent_tests
  tests/dependencies_test.cpp
  tests/config_test.cpp
  tests/identity_test.cpp
  tests/ledger_test.cpp
  tests/backoff_test.cpp
  tests/status_reporter_test.cpp
  tests/print_failure_test.cpp
  tests/job_tracker_test.cpp
  tests/heartbeat_test.cpp
  tests/discovery_test.cpp
  tests/job_document_test.cpp
  tests/print_settings_test.cpp
  tests/pdf_printer_test.cpp)
target_link_libraries(agent_tests PRIVATE agent_core Catch2::Catch2WithMain)
pa_copy_pdfium_dll(agent_tests)
include(Catch)
catch_discover_tests(agent_tests DISCOVERY_MODE PRE_TEST)
