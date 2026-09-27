#pragma once

#include <functional>
#include <map>
#include <stop_token>
#include <string>
#include <string_view>
#include <thread>

#include "agent/agent.h"
#include "app/log.h"

namespace pa {

/// One request to the local pairing page. Header names are lower-cased.
struct LocalRequest {
  std::string method;
  std::string target;
  std::map<std::string, std::string> headers;
  std::string body;
};

struct LocalResponse {
  int status = 200;
  std::string content_type = "application/json";
  std::string body;
};

enum class ParseState { Complete, NeedMore, Invalid, TooLarge };

/// Parses what has arrived so far. Requests are tiny (a pairing code), so anything over 16 KB,
/// or a body over 4 KB, is refused.
ParseState parse_local_request(std::string_view received, LocalRequest& out);

struct LoopbackHandlers {
  std::function<AgentStatus()> status;
  std::function<void(std::string_view code)> pair;  // throws PairingError
};

/// 24.12 (ported from server/loopback-server.ts, then hardened): the pairing page and its two
/// endpoints, GET /api/status and POST /api/pair.
///
/// The Node server answered any request that reached it. A web page the shop's staff happen to
/// open can make the browser send requests to 127.0.0.1, so this one also refuses:
///  - a Host that is not 127.0.0.1:<port> or localhost:<port> (DNS rebinding: a hostile
///    domain re-pointed at 127.0.0.1 would otherwise read the device and shop ids);
///  - a POST that is not Content-Type application/json, or whose Origin or Sec-Fetch-Site says
///    it came from another site (a cross-site form or fetch cannot pair this computer);
/// and it no longer accepts the Node server's `backendBaseUrl` override, which let such a
/// request pair the agent with a server of the attacker's choosing. Every response forbids
/// framing, sniffing and caching, and the page itself only ever sets text, never HTML.
LocalResponse handle_local_request(const LocalRequest& request, const LoopbackHandlers& handlers,
                                   int port);

/// The full HTTP/1.1 response, with the security headers, ready to send.
std::string serialize_local_response(const LocalResponse& response);

/// Listens on 127.0.0.1 only (never all interfaces), with SO_EXCLUSIVEADDRUSE so no other
/// program can bind the same port underneath it. One request at a time; a client that stops
/// sending is dropped after 5 seconds.
class LoopbackServer {
 public:
  LoopbackServer(int port, LoopbackHandlers handlers, Logger& log);
  LoopbackServer(const LoopbackServer&) = delete;
  LoopbackServer& operator=(const LoopbackServer&) = delete;
  ~LoopbackServer();

  /// Binds and starts serving. Throws std::runtime_error when the port is taken (typically
  /// another agent, the Node one included, is already running).
  void start();
  void stop();

 private:
  void serve(std::stop_token stop);
  void handle_connection(std::uintptr_t client);

  int port_;
  LoopbackHandlers handlers_;
  Logger& log_;
  std::uintptr_t listener_;
  bool winsock_ = false;
  std::jthread thread_;
};

}  // namespace pa
