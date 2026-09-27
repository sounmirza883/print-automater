# PDFium is not in vcpkg, so the agent uses the prebuilt binaries from
# github.com/bblanchon/pdfium-binaries (PDFium itself is BSD-3-Clause; the licences of its
# bundled libraries ship in the archive's licenses/ folder and go into the installer).
#
# Pinned to ONE release and verified by SHA-256, per the plan's risk note: the archive is
# downloaded once into a cache OUTSIDE the build tree (so a clean build does not re-download)
# and CMake refuses a file whose hash differs. Bumping PDFium = changing both values below.
set(PA_PDFIUM_RELEASE "chromium/8057" CACHE STRING "pdfium-binaries release tag")
set(PA_PDFIUM_SHA256 "e307d519e42f2e69b1b531f0c2a32dffcdf3891ec0eba60328ba51a57cec01ed"
    CACHE STRING "SHA-256 of pdfium-win-x64.tgz for that release")

if(DEFINED ENV{LOCALAPPDATA})
  set(_pa_cache_root "$ENV{LOCALAPPDATA}/PrintAutomatedBuild")
else()
  set(_pa_cache_root "${CMAKE_BINARY_DIR}/_deps")
endif()
string(REPLACE "/" "-" _pa_release_dir "${PA_PDFIUM_RELEASE}")
set(PA_PDFIUM_DIR "${_pa_cache_root}/pdfium-${_pa_release_dir}" CACHE PATH "Extracted PDFium")

set(_pa_archive "${_pa_cache_root}/pdfium-${_pa_release_dir}-win-x64.tgz")
if(NOT EXISTS "${PA_PDFIUM_DIR}/include/fpdfview.h")
  if(NOT EXISTS "${_pa_archive}")
    message(STATUS "Downloading PDFium ${PA_PDFIUM_RELEASE}")
    file(DOWNLOAD
      "https://github.com/bblanchon/pdfium-binaries/releases/download/${PA_PDFIUM_RELEASE}/pdfium-win-x64.tgz"
      "${_pa_archive}"
      EXPECTED_HASH SHA256=${PA_PDFIUM_SHA256}
      TLS_VERIFY ON
      SHOW_PROGRESS)
  endif()
  file(SHA256 "${_pa_archive}" _pa_actual)
  if(NOT _pa_actual STREQUAL PA_PDFIUM_SHA256)
    file(REMOVE "${_pa_archive}")
    message(FATAL_ERROR "PDFium archive hash mismatch (got ${_pa_actual}); refusing to use it.")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${_pa_archive}" DESTINATION "${PA_PDFIUM_DIR}")
endif()

add_library(pdfium SHARED IMPORTED GLOBAL)
set_target_properties(pdfium PROPERTIES
  IMPORTED_LOCATION "${PA_PDFIUM_DIR}/bin/pdfium.dll"
  IMPORTED_IMPLIB "${PA_PDFIUM_DIR}/lib/pdfium.dll.lib"
  INTERFACE_INCLUDE_DIRECTORIES "${PA_PDFIUM_DIR}/include")

# Copies pdfium.dll next to a target's executable after every build.
function(pa_copy_pdfium_dll target)
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${PA_PDFIUM_DIR}/bin/pdfium.dll" "$<TARGET_FILE_DIR:${target}>"
    VERBATIM)
endfunction()
