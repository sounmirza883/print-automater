#include "backend/http.h"

#include <curl/curl.h>
#include <fcntl.h>
#include <io.h>

#include <atomic>
#include <cstdio>
#include <memory>
#include <mutex>

#include "app/version.h"
#include "app/win.h"

namespace pa {

namespace {

std::atomic<bool> g_shutting_down{false};

int abort_on_shutdown(void*, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
  return g_shutting_down.load() ? 1 : 0;  // non-zero aborts the transfer
}

struct CurlDeleter {
  void operator()(CURL* curl) const { curl_easy_cleanup(curl); }
};
struct HeaderListDeleter {
  void operator()(curl_slist* list) const { curl_slist_free_all(list); }
};

size_t append_to_string(char* data, size_t size, size_t count, void* target) {
  static_cast<std::string*>(target)->append(data, size * count);
  return size * count;
}

size_t write_to_file(char* data, size_t size, size_t count, void* target) {
  return std::fwrite(data, size, count, static_cast<std::FILE*>(target)) * size;
}

std::unique_ptr<CURL, CurlDeleter> make_handle(const HttpRequest& request,
                                               std::unique_ptr<curl_slist, HeaderListDeleter>& headers) {
  if (g_shutting_down.load()) throw NetworkError("The agent is shutting down.");
  std::unique_ptr<CURL, CurlDeleter> curl(curl_easy_init());
  if (!curl) throw NetworkError("Could not start an HTTP request (out of memory).");
  CURL* c = curl.get();
  curl_easy_setopt(c, CURLOPT_NOPROGRESS, 0L);
  curl_easy_setopt(c, CURLOPT_XFERINFOFUNCTION, &abort_on_shutdown);
  curl_easy_setopt(c, CURLOPT_URL, request.url.c_str());
  curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 10L);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, static_cast<long>(request.timeout.count()));
  curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 0L);  // the API never redirects the agent
  curl_easy_setopt(c, CURLOPT_PROTOCOLS_STR, "http,https");
  curl_easy_setopt(c, CURLOPT_SSL_OPTIONS,
                   static_cast<long>(CURLSSLOPT_NATIVE_CA | CURLSSLOPT_REVOKE_BEST_EFFORT));
  const std::string agent = "PrintAutomatedAgent/" + agent_version();
  curl_easy_setopt(c, CURLOPT_USERAGENT, agent.c_str());

  curl_slist* list = nullptr;
  for (const auto& [name, value] : request.headers) {
    list = curl_slist_append(list, (name + ": " + value).c_str());
  }
  headers.reset(list);
  if (list != nullptr) curl_easy_setopt(c, CURLOPT_HTTPHEADER, list);

  if (request.method == "POST") {
    curl_easy_setopt(c, CURLOPT_POST, 1L);
    curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(request.body.size()));
    curl_easy_setopt(c, CURLOPT_COPYPOSTFIELDS, request.body.c_str());
  } else if (request.method != "GET") {
    // PATCH (and any other non-GET, non-POST verb): a custom verb with libcurl still needs
    // POSTFIELDS explicitly to carry a body -- it is only implied for CURLOPT_POST.
    curl_easy_setopt(c, CURLOPT_CUSTOMREQUEST, request.method.c_str());
    if (!request.body.empty()) {
      curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(request.body.size()));
      curl_easy_setopt(c, CURLOPT_COPYPOSTFIELDS, request.body.c_str());
    }
  }
  return curl;
}

std::string describe(CURLcode code, const char* detail) {
  std::string message = "Could not reach the API: ";
  message += (detail != nullptr && detail[0] != '\0') ? detail : curl_easy_strerror(code);
  return message;
}

}  // namespace

void http_global_init() {
  static std::once_flag once;
  std::call_once(once, [] {
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
      throw NetworkError("libcurl could not initialise.");
    }
  });
}

void http_shutdown() {
  g_shutting_down.store(true);
}

HttpResponse http_send(const HttpRequest& request) {
  std::unique_ptr<curl_slist, HeaderListDeleter> headers;
  auto curl = make_handle(request, headers);
  HttpResponse response;
  char error[CURL_ERROR_SIZE] = {};
  curl_easy_setopt(curl.get(), CURLOPT_ERRORBUFFER, error);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, &append_to_string);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, &response.body);
  const CURLcode code = curl_easy_perform(curl.get());
  if (code != CURLE_OK) throw NetworkError(describe(code, error));
  curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &response.status);
  return response;
}

long http_download(const HttpRequest& request, const std::filesystem::path& file,
                   std::string& error_body) {
  std::unique_ptr<curl_slist, HeaderListDeleter> headers;
  auto curl = make_handle(request, headers);
  // Created private to this Windows user (24.8): it briefly holds a customer's document in
  // plaintext, outside the API's encryption at rest.
  UniqueHandle handle = create_private_file(file);
  const int fd = _open_osfhandle(reinterpret_cast<intptr_t>(handle.get()), _O_WRONLY | _O_BINARY);
  if (fd == -1) throw std::runtime_error("Could not open the downloaded document for writing.");
  handle.release();  // the CRT descriptor owns it now
  std::FILE* out = _fdopen(fd, "wb");
  if (out == nullptr) {
    _close(fd);
    std::error_code ignored;
    std::filesystem::remove(file, ignored);
    throw std::runtime_error("Could not open the downloaded document for writing.");
  }
  // Far above any real print document; stops a runaway response from filling the disk.
  curl_easy_setopt(curl.get(), CURLOPT_MAXFILESIZE_LARGE, static_cast<curl_off_t>(2) << 30);
  char error[CURL_ERROR_SIZE] = {};
  curl_easy_setopt(curl.get(), CURLOPT_ERRORBUFFER, error);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, &write_to_file);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, out);
  const CURLcode code = curl_easy_perform(curl.get());
  const bool flushed = std::fflush(out) == 0;
  std::fclose(out);
  long status = 0;
  curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &status);

  std::error_code ignored;
  if (code != CURLE_OK) {
    std::filesystem::remove(file, ignored);
    throw NetworkError(describe(code, error));
  }
  if (status < 200 || status >= 300) {
    // The body of an error answer is the API's small JSON error, not a document.
    std::FILE* in = nullptr;
    if (_wfopen_s(&in, file.c_str(), L"rb") == 0 && in != nullptr) {
      char buffer[4096];
      const size_t read = std::fread(buffer, 1, sizeof buffer, in);
      error_body.assign(buffer, read);
      std::fclose(in);
    }
    std::filesystem::remove(file, ignored);
    return status;
  }
  if (!flushed) {
    std::filesystem::remove(file, ignored);
    throw std::runtime_error("Could not finish writing the downloaded document.");
  }
  return status;
}

}  // namespace pa
