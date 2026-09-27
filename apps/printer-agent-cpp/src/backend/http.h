#pragma once

#include <chrono>
#include <filesystem>
#include <map>
#include <stdexcept>
#include <string>

namespace pa {

struct HttpResponse {
  long status = 0;
  std::string body;
};

/// The request never got an HTTP answer (DNS, connect, TLS, timeout). Always retryable.
class NetworkError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

struct HttpRequest {
  std::string method = "GET";
  std::string url;
  std::map<std::string, std::string> headers;
  std::string body;  // sent when method is POST
  std::chrono::seconds timeout{30};
};

/// Thin libcurl wrapper (24.4). TLS is Windows' own (Schannel) against the Windows certificate
/// store, so certificates are trusted exactly as the machine trusts them; certificate
/// revocation is checked, but an unreachable revocation server does not fail the call.
/// Thread-safe: each call uses its own easy handle. Call http_global_init() once at startup.
void http_global_init();
HttpResponse http_send(const HttpRequest& request);

/// Shutdown: aborts every transfer in progress (a 20-second long poll included) and fails any
/// new one at once, so the agent's threads can be joined promptly when Windows signs out.
/// Irreversible; called once, as the agent stops.
void http_shutdown();

/// Streams a GET response body straight into `file` (never holds the document in memory).
/// Returns the HTTP status; on a non-2xx status the partial file is removed and the error body
/// (small JSON) is returned in `error_body`.
long http_download(const HttpRequest& request, const std::filesystem::path& file,
                   std::string& error_body);

}  // namespace pa
