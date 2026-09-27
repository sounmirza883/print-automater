#include <catch2/catch_test_macros.hpp>

#include <curl/curl.h>
#include <fpdfview.h>
#include <nlohmann/json.hpp>
#include <sodium.h>
#include <sqlite3.h>

#include "app/version.h"

// 24.1: every third-party library the agent is built on actually links and initialises,
// using the same static CRT and triplet as the agent executable.

TEST_CASE("libsodium initialises and signs with Ed25519") {
  REQUIRE(sodium_init() >= 0);
  unsigned char pk[crypto_sign_PUBLICKEYBYTES];
  unsigned char sk[crypto_sign_SECRETKEYBYTES];
  REQUIRE(crypto_sign_keypair(pk, sk) == 0);
  const unsigned char message[] = "nonce";
  unsigned char signature[crypto_sign_BYTES];
  REQUIRE(crypto_sign_detached(signature, nullptr, message, sizeof message - 1, sk) == 0);
  REQUIRE(crypto_sign_verify_detached(signature, message, sizeof message - 1, pk) == 0);
}

TEST_CASE("sqlite opens an in-memory database") {
  sqlite3* db = nullptr;
  REQUIRE(sqlite3_open(":memory:", &db) == SQLITE_OK);
  REQUIRE(sqlite3_exec(db, "CREATE TABLE t (x INTEGER)", nullptr, nullptr, nullptr) == SQLITE_OK);
  sqlite3_close(db);
}

TEST_CASE("libcurl initialises with a TLS backend") {
  REQUIRE(curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK);
  const curl_version_info_data* info = curl_version_info(CURLVERSION_NOW);
  REQUIRE(info != nullptr);
  REQUIRE((info->features & CURL_VERSION_SSL) != 0);
  curl_global_cleanup();
}

TEST_CASE("nlohmann-json round-trips") {
  const auto doc = nlohmann::json::parse(R"({"status":"PRINTED"})");
  REQUIRE(doc.at("status").get<std::string>() == "PRINTED");
}

TEST_CASE("PDFium loads and initialises") {
  FPDF_LIBRARY_CONFIG config{};
  config.version = 2;
  FPDF_InitLibraryWithConfig(&config);
  // A document that is not a PDF is refused cleanly, with an error code, not a crash.
  const char not_a_pdf[] = "hello";
  FPDF_DOCUMENT doc = FPDF_LoadMemDocument(not_a_pdf, static_cast<int>(sizeof not_a_pdf), nullptr);
  REQUIRE(doc == nullptr);
  REQUIRE(FPDF_GetLastError() == FPDF_ERR_FORMAT);
  FPDF_DestroyLibrary();
}

TEST_CASE("the agent reports its version") {
  REQUIRE_FALSE(pa::agent_version().empty());
  REQUIRE(pa::dependency_versions().find("libsodium") != std::string::npos);
}
