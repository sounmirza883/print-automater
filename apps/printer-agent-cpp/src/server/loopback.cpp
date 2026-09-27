#include <winsock2.h>

#include "server/loopback.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>

#include "agent/pairing.h"
#include "app/version.h"
#include "server/pairing_page.h"

namespace pa {

namespace {

constexpr size_t kMaxRequestBytes = 16 * 1024;
constexpr size_t kMaxBodyBytes = 4 * 1024;

std::string lower(std::string_view text) {
  std::string out(text);
  std::transform(out.begin(), out.end(), out.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return out;
}

std::string_view trim(std::string_view text) {
  while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
  while (!text.empty() && (text.back() == ' ' || text.back() == '\t')) text.remove_suffix(1);
  return text;
}

LocalResponse json_response(int status, const nlohmann::json& body) {
  return {status, "application/json", body.dump()};
}

LocalResponse message(int status, std::string_view text) {
  return json_response(status, {{"message", text}});
}

std::string header(const LocalRequest& request, const char* name) {
  const auto found = request.headers.find(name);
  return found == request.headers.end() ? std::string() : found->second;
}

const char* reason(int status) {
  switch (status) {
    case 200: return "OK";
    case 400: return "Bad Request";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 409: return "Conflict";
    case 413: return "Payload Too Large";
    case 415: return "Unsupported Media Type";
    case 422: return "Unprocessable Content";
    case 502: return "Bad Gateway";
    default: return "Internal Server Error";
  }
}

}  // namespace

ParseState parse_local_request(std::string_view received, LocalRequest& out) {
  const size_t header_end = received.find("\r\n\r\n");
  if (header_end == std::string_view::npos) {
    return received.size() > kMaxRequestBytes ? ParseState::TooLarge : ParseState::NeedMore;
  }
  if (header_end > kMaxRequestBytes) return ParseState::TooLarge;

  LocalRequest request;
  std::string_view head = received.substr(0, header_end);
  const size_t line_end = head.find("\r\n");
  const std::string_view request_line = head.substr(0, line_end);
  const size_t first_space = request_line.find(' ');
  const size_t second_space = request_line.find(' ', first_space + 1);
  if (first_space == std::string_view::npos || second_space == std::string_view::npos) {
    return ParseState::Invalid;
  }
  request.method = std::string(request_line.substr(0, first_space));
  request.target = std::string(request_line.substr(first_space + 1, second_space - first_space - 1));
  const std::string_view version = request_line.substr(second_space + 1);
  if (version != "HTTP/1.1" && version != "HTTP/1.0") return ParseState::Invalid;
  if (request.target.empty() || request.target.front() != '/') return ParseState::Invalid;

  std::string_view rest = line_end == std::string_view::npos ? std::string_view() : head.substr(line_end + 2);
  while (!rest.empty()) {
    const size_t end = rest.find("\r\n");
    const std::string_view line = rest.substr(0, end);
    rest = end == std::string_view::npos ? std::string_view() : rest.substr(end + 2);
    const size_t colon = line.find(':');
    if (colon == std::string_view::npos || colon == 0) return ParseState::Invalid;
    const std::string name = lower(line.substr(0, colon));
    if (name.find_first_of(" \t") != std::string::npos) return ParseState::Invalid;
    if (request.headers.contains(name) && (name == "host" || name == "content-length")) {
      return ParseState::Invalid;  // two Hosts or lengths: refuse rather than pick one
    }
    request.headers[name] = std::string(trim(line.substr(colon + 1)));
  }
  if (request.headers.contains("transfer-encoding")) return ParseState::Invalid;

  size_t length = 0;
  if (const auto found = request.headers.find("content-length"); found != request.headers.end()) {
    const std::string& text = found->second;
    if (text.empty() || text.size() > 6 ||
        text.find_first_not_of("0123456789") != std::string::npos) {
      return ParseState::Invalid;
    }
    length = std::stoul(text);
    if (length > kMaxBodyBytes) return ParseState::TooLarge;
  }
  const size_t body_start = header_end + 4;
  if (received.size() < body_start + length) return ParseState::NeedMore;
  request.body = std::string(received.substr(body_start, length));
  out = std::move(request);
  return ParseState::Complete;
}

LocalResponse handle_local_request(const LocalRequest& request, const LoopbackHandlers& handlers,
                                   int port) {
  const std::string suffix = ":" + std::to_string(port);
  const std::string host = lower(header(request, "host"));
  if (host != "127.0.0.1" + suffix && host != "localhost" + suffix) {
    return message(403, "Open this page at http://127.0.0.1" + suffix + ".");
  }
  if (request.method != "GET" && request.method != "POST") {
    return message(405, "Method not allowed.");
  }

  if (request.method == "GET") {
    if (request.target == "/") return {200, "text/html; charset=utf-8", pairing_page_html()};
    if (request.target == "/app.js") return {200, "text/javascript; charset=utf-8", pairing_page_js()};
    if (request.target == "/app.css") return {200, "text/css; charset=utf-8", pairing_page_css()};
    if (request.target == "/api/status") {
      const AgentStatus s = handlers.status();
      return json_response(200, {{"paired", s.paired},
                                 {"pairing", s.pairing},
                                 {"deviceId", s.device_id},
                                 {"shopId", s.shop_id},
                                 {"lastError", s.last_error},
                                 {"lastHeartbeatAt", s.last_heartbeat_at},
                                 {"printers", s.printers},
                                 {"lastJob", s.last_job},
                                 {"version", agent_version()}});
    }
    return message(404, "Not found.");
  }

  if (request.target != "/api/pair") return message(404, "Not found.");
  const std::string origin = lower(header(request, "origin"));
  if (!origin.empty() && origin != "http://127.0.0.1" + suffix &&
      origin != "http://localhost" + suffix) {
    return message(403, "Pairing can only be started from this computer's agent page.");
  }
  const std::string fetch_site = lower(header(request, "sec-fetch-site"));
  if (!fetch_site.empty() && fetch_site != "same-origin" && fetch_site != "none") {
    return message(403, "Pairing can only be started from this computer's agent page.");
  }
  if (lower(header(request, "content-type")).rfind("application/json", 0) != 0) {
    return message(415, "Send the pairing code as JSON.");
  }
  const auto body = nlohmann::json::parse(request.body, nullptr, false);
  if (!body.is_object() || !body.contains("pairingCode") || !body["pairingCode"].is_string()) {
    return message(422, "Enter the 8-character pairing code shown in the Print Automated app.");
  }
  try {
    handlers.pair(body["pairingCode"].get<std::string>());
    return json_response(200, {{"ok", true}});
  } catch (const PairingError& error) {
    return message(error.http_status(), error.what());
  } catch (const std::exception&) {
    return message(500, "Pairing failed unexpectedly. See the agent's log.");
  }
}

std::string serialize_local_response(const LocalResponse& response) {
  std::string out = "HTTP/1.1 " + std::to_string(response.status) + " " + reason(response.status) +
                    "\r\n";
  out += "Content-Type: " + response.content_type + "\r\n";
  out += "Content-Length: " + std::to_string(response.body.size()) + "\r\n";
  out += "Cache-Control: no-store\r\n";
  out += "X-Content-Type-Options: nosniff\r\n";
  out += "X-Frame-Options: DENY\r\n";
  out += "Referrer-Policy: no-referrer\r\n";
  out += "Cross-Origin-Resource-Policy: same-origin\r\n";
  out +=
      "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; "
      "connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; "
      "frame-ancestors 'none'\r\n";
  out += "Connection: close\r\n\r\n";
  out += response.body;
  return out;
}

LoopbackServer::LoopbackServer(int port, LoopbackHandlers handlers, Logger& log)
    : port_(port), handlers_(std::move(handlers)), log_(log), listener_(INVALID_SOCKET) {}

LoopbackServer::~LoopbackServer() {
  stop();
}

void LoopbackServer::start() {
  WSADATA data;
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("Winsock could not start.");
  winsock_ = true;
  const SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (listener == INVALID_SOCKET) throw std::runtime_error("Could not create the pairing page socket.");
  BOOL exclusive = TRUE;
  setsockopt(listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive),
             sizeof exclusive);
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(static_cast<u_short>(port_));
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(listener, reinterpret_cast<const sockaddr*>(&address), sizeof address) == SOCKET_ERROR ||
      listen(listener, SOMAXCONN) == SOCKET_ERROR) {
    const int error = WSAGetLastError();
    closesocket(listener);
    if (error == WSAEADDRINUSE || error == WSAEACCES) {
      throw std::runtime_error("Port " + std::to_string(port_) +
                               " is already in use. Is another Print Automated agent running?");
    }
    throw std::runtime_error("Could not listen on 127.0.0.1:" + std::to_string(port_) +
                             " (error " + std::to_string(error) + ").");
  }
  listener_ = listener;
  thread_ = std::jthread([this](std::stop_token stop) { serve(stop); });
  log_.info("pairing page listening", {{"url", "http://127.0.0.1:" + std::to_string(port_)}});
}

void LoopbackServer::stop() {
  if (thread_.joinable()) {
    thread_.request_stop();
    thread_.join();
  }
  if (listener_ != INVALID_SOCKET) {
    closesocket(static_cast<SOCKET>(listener_));
    listener_ = INVALID_SOCKET;
  }
  if (winsock_) {
    WSACleanup();
    winsock_ = false;
  }
}

void LoopbackServer::serve(std::stop_token stop) {
  const SOCKET listener = static_cast<SOCKET>(listener_);
  while (!stop.stop_requested()) {
    fd_set readable;
    FD_ZERO(&readable);
    FD_SET(listener, &readable);
    timeval wait{0, 250'000};  // check for shutdown four times a second
    if (select(0, &readable, nullptr, nullptr, &wait) <= 0) continue;
    const SOCKET client = accept(listener, nullptr, nullptr);
    if (client == INVALID_SOCKET) continue;
    try {
      handle_connection(client);
    } catch (const std::exception& error) {
      log_.error("pairing page request failed", {{"error", error.what()}});
    }
    closesocket(client);
  }
}

void LoopbackServer::handle_connection(std::uintptr_t raw_client) {
  const SOCKET client = static_cast<SOCKET>(raw_client);
  const DWORD timeout_ms = 5000;
  setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout_ms),
             sizeof timeout_ms);
  setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout_ms),
             sizeof timeout_ms);

  std::string received;
  LocalRequest request;
  ParseState state = ParseState::NeedMore;
  char buffer[4096];
  while (state == ParseState::NeedMore) {
    const int got = recv(client, buffer, static_cast<int>(sizeof buffer), 0);
    if (got <= 0) return;  // closed or timed out before a whole request arrived
    received.append(buffer, static_cast<size_t>(got));
    state = parse_local_request(received, request);
  }

  LocalResponse response;
  if (state == ParseState::Invalid) {
    response = message(400, "Bad request.");
  } else if (state == ParseState::TooLarge) {
    response = message(413, "Request too large.");
  } else {
    response = handle_local_request(request, handlers_, port_);
  }
  const std::string out = serialize_local_response(response);
  size_t sent = 0;
  while (sent < out.size()) {
    const int n = send(client, out.data() + sent, static_cast<int>(out.size() - sent), 0);
    if (n <= 0) return;
    sent += static_cast<size_t>(n);
  }
  shutdown(client, SD_SEND);
}

}  // namespace pa
