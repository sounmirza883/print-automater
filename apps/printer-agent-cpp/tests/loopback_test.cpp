#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <nlohmann/json.hpp>

#include "agent/pairing.h"
#include "server/loopback.h"

using Catch::Matchers::ContainsSubstring;

namespace {

constexpr int kPort = 7171;

struct Fake {
  pa::AgentStatus status;
  std::vector<std::string> paired_with;
  std::function<void(std::string_view)> on_pair;

  pa::LoopbackHandlers handlers() {
    return {[this] { return status; },
            [this](std::string_view code) {
              paired_with.emplace_back(code);
              if (on_pair) on_pair(code);
            }};
  }
};

pa::LocalRequest get(std::string target) {
  pa::LocalRequest request;
  request.method = "GET";
  request.target = std::move(target);
  request.headers["host"] = "127.0.0.1:7171";
  return request;
}

pa::LocalRequest pair_request(std::string body = R"({"pairingCode":"K7M2XQ9P"})") {
  pa::LocalRequest request;
  request.method = "POST";
  request.target = "/api/pair";
  request.headers["host"] = "127.0.0.1:7171";
  request.headers["content-type"] = "application/json";
  request.headers["origin"] = "http://127.0.0.1:7171";
  request.headers["sec-fetch-site"] = "same-origin";
  request.body = std::move(body);
  return request;
}

}  // namespace

TEST_CASE("pairing codes: case, spaces and dashes are forgiven; look-alikes are not codes") {
  CHECK(pa::normalize_pairing_code("K7M2XQ9P") == "K7M2XQ9P");
  CHECK(pa::normalize_pairing_code(" k7m2-xq9p ") == "K7M2XQ9P");
  CHECK_FALSE(pa::normalize_pairing_code("K7M2XQ9").has_value());    // too short
  CHECK_FALSE(pa::normalize_pairing_code("K7M2XQ9PA").has_value());  // too long
  CHECK_FALSE(pa::normalize_pairing_code("K7M2XQ0P").has_value());   // 0 is never issued
  CHECK_FALSE(pa::normalize_pairing_code("K7M2XQIP").has_value());   // nor I
  CHECK_FALSE(pa::normalize_pairing_code("K7M2XQ9<").has_value());
  CHECK_FALSE(pa::normalize_pairing_code("").has_value());
}

TEST_CASE("the page, its script and styles, and the status are served") {
  Fake fake;
  fake.status.paired = true;
  fake.status.device_id = "device-1";
  fake.status.shop_id = "shop-1";
  fake.status.printers = 2;

  const auto page = pa::handle_local_request(get("/"), fake.handlers(), kPort);
  CHECK(page.status == 200);
  CHECK_THAT(page.content_type, ContainsSubstring("text/html"));
  CHECK_THAT(page.body, ContainsSubstring("/app.js"));
  CHECK(pa::handle_local_request(get("/app.js"), fake.handlers(), kPort).status == 200);
  CHECK(pa::handle_local_request(get("/app.css"), fake.handlers(), kPort).status == 200);

  const auto status = pa::handle_local_request(get("/api/status"), fake.handlers(), kPort);
  REQUIRE(status.status == 200);
  const auto body = nlohmann::json::parse(status.body);
  CHECK(body["paired"] == true);
  CHECK(body["shopId"] == "shop-1");
  CHECK(body["printers"] == 2);
  CHECK(body.contains("version"));

  CHECK(pa::handle_local_request(get("/missing"), fake.handlers(), kPort).status == 404);
}

TEST_CASE("the page script only ever sets text, never HTML") {
  Fake fake;
  const auto js = pa::handle_local_request(get("/app.js"), fake.handlers(), kPort).body;
  CHECK_THAT(js, !ContainsSubstring("innerHTML"));
  CHECK_THAT(js, !ContainsSubstring("outerHTML"));
  CHECK_THAT(js, !ContainsSubstring("insertAdjacentHTML"));
  CHECK_THAT(js, !ContainsSubstring("document.write"));
}

TEST_CASE("a request for another host name is refused (DNS rebinding)") {
  Fake fake;
  for (const char* host : {"evil.example:7171", "127.0.0.1", "127.0.0.1:80", ""}) {
    auto request = get("/api/status");
    request.headers["host"] = host;
    CHECK(pa::handle_local_request(request, fake.handlers(), kPort).status == 403);
  }
  auto localhost = get("/api/status");
  localhost.headers["host"] = "LOCALHOST:7171";
  CHECK(pa::handle_local_request(localhost, fake.handlers(), kPort).status == 200);
}

TEST_CASE("pairing from the agent's own page works") {
  Fake fake;
  const auto response = pa::handle_local_request(pair_request(), fake.handlers(), kPort);
  CHECK(response.status == 200);
  CHECK(fake.paired_with == std::vector<std::string>{"K7M2XQ9P"});
}

TEST_CASE("another web site cannot pair this computer") {
  Fake fake;
  auto cross_origin = pair_request();
  cross_origin.headers["origin"] = "https://evil.example";
  CHECK(pa::handle_local_request(cross_origin, fake.handlers(), kPort).status == 403);

  auto cross_site = pair_request();
  cross_site.headers.erase("origin");
  cross_site.headers["sec-fetch-site"] = "cross-site";
  CHECK(pa::handle_local_request(cross_site, fake.handlers(), kPort).status == 403);

  auto form_post = pair_request("pairingCode=K7M2XQ9P");
  form_post.headers["content-type"] = "application/x-www-form-urlencoded";
  CHECK(pa::handle_local_request(form_post, fake.handlers(), kPort).status == 415);

  auto text_post = pair_request();
  text_post.headers["content-type"] = "text/plain";  // a "simple" request needs no preflight
  CHECK(pa::handle_local_request(text_post, fake.handlers(), kPort).status == 415);

  CHECK(fake.paired_with.empty());
}

TEST_CASE("the Node agent's backend override is gone: only the code is used") {
  Fake fake;
  const auto response = pa::handle_local_request(
      pair_request(R"({"pairingCode":"K7M2XQ9P","backendBaseUrl":"https://evil.example"})"),
      fake.handlers(), kPort);
  CHECK(response.status == 200);
  CHECK(fake.paired_with == std::vector<std::string>{"K7M2XQ9P"});
}

TEST_CASE("a pairing failure is answered with its status and message") {
  Fake fake;
  fake.on_pair = [](std::string_view) {
    throw pa::PairingError("That pairing code has expired.", 422);
  };
  const auto response = pa::handle_local_request(pair_request(), fake.handlers(), kPort);
  CHECK(response.status == 422);
  CHECK(nlohmann::json::parse(response.body)["message"] == "That pairing code has expired.");

  auto malformed = pair_request("{not json");
  CHECK(pa::handle_local_request(malformed, fake.handlers(), kPort).status == 422);
}

TEST_CASE("other methods are refused") {
  Fake fake;
  auto request = get("/api/status");
  request.method = "DELETE";
  CHECK(pa::handle_local_request(request, fake.handlers(), kPort).status == 405);
}

TEST_CASE("every response forbids framing, sniffing and caching") {
  const auto raw = pa::serialize_local_response({200, "text/html; charset=utf-8", "<p>"});
  CHECK_THAT(raw, ContainsSubstring("HTTP/1.1 200 OK\r\n"));
  CHECK_THAT(raw, ContainsSubstring("X-Frame-Options: DENY"));
  CHECK_THAT(raw, ContainsSubstring("frame-ancestors 'none'"));
  CHECK_THAT(raw, ContainsSubstring("script-src 'self'"));
  CHECK_THAT(raw, ContainsSubstring("X-Content-Type-Options: nosniff"));
  CHECK_THAT(raw, ContainsSubstring("Cache-Control: no-store"));
  CHECK_THAT(raw, !ContainsSubstring("Access-Control-Allow-Origin"));
  CHECK_THAT(raw, ContainsSubstring("Content-Length: 3\r\n"));
}

TEST_CASE("request parsing: complete, partial, malformed and oversized") {
  pa::LocalRequest request;
  CHECK(pa::parse_local_request("GET / HTTP/1.1\r\nHost: 127.0.0.1:7171\r\n\r\n", request) ==
        pa::ParseState::Complete);
  CHECK(request.method == "GET");
  CHECK(request.target == "/");
  CHECK(request.headers.at("host") == "127.0.0.1:7171");

  CHECK(pa::parse_local_request("GET / HTTP/1.1\r\nHost: x", request) == pa::ParseState::NeedMore);

  const std::string post =
      "POST /api/pair HTTP/1.1\r\nHost: 127.0.0.1:7171\r\nContent-Type: application/json\r\n"
      "Content-Length: 26\r\n\r\n{\"pairingCode\":\"K7M2XQ9P\"}";
  CHECK(pa::parse_local_request(post.substr(0, post.size() - 5), request) ==
        pa::ParseState::NeedMore);
  REQUIRE(pa::parse_local_request(post, request) == pa::ParseState::Complete);
  CHECK(request.body == R"({"pairingCode":"K7M2XQ9P"})");

  CHECK(pa::parse_local_request("GARBAGE\r\n\r\n", request) == pa::ParseState::Invalid);
  CHECK(pa::parse_local_request("GET / HTTP/2\r\n\r\n", request) == pa::ParseState::Invalid);
  CHECK(pa::parse_local_request("GET http://x/ HTTP/1.1\r\n\r\n", request) ==
        pa::ParseState::Invalid);
  CHECK(pa::parse_local_request("GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n", request) ==
        pa::ParseState::Invalid);
  CHECK(pa::parse_local_request(
            "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n", request) ==
        pa::ParseState::Invalid);
  CHECK(pa::parse_local_request("POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n", request) ==
        pa::ParseState::Invalid);
  CHECK(pa::parse_local_request("POST / HTTP/1.1\r\nContent-Length: 99999\r\n\r\n", request) ==
        pa::ParseState::TooLarge);
  CHECK(pa::parse_local_request(std::string(20000, 'a'), request) == pa::ParseState::TooLarge);
}
