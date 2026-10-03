#pragma once

#include <windows.h>

#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include "backend/api_client.h"
#include "backend/orders_client.h"

namespace pa {

/// Slice 2 of the native dashboard pages: the shop's Orders/Queue, the native counterpart of
/// apps/shop-web's Orders page. A ListView in report mode, a Refresh button and a status line,
/// in the same dark palette as StatusWindow.
///
/// Loads on show() and on Refresh, and nowhere else (no timer). The fetch runs on a worker
/// thread, so the window keeps painting and responding while the API answers; the worker posts
/// a message back to this window and the result is applied on the UI thread. Closing the window
/// hides it, like StatusWindow. The worker is joined on destruction.
class OrdersWindow {
 public:
  OrdersWindow(HINSTANCE instance, ApiClient& api);
  OrdersWindow(const OrdersWindow&) = delete;
  OrdersWindow& operator=(const OrdersWindow&) = delete;
  ~OrdersWindow();

  /// Shows the window (creating it the first time), brings it forward and reloads the list.
  void show();

 private:
  struct FetchResult {
    bool ok = false;
    OrdersPage page;
    std::string error;
  };

  static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT handle(UINT message, WPARAM wparam, LPARAM lparam);
  void create_window();
  void create_controls();
  void start_fetch();
  void apply_result();
  void fill_list(const OrdersPage& page);
  void set_status(const std::wstring& text, bool is_error);

  HINSTANCE instance_;
  ApiClient& api_;

  HWND window_ = nullptr;
  HWND title_ = nullptr;
  HWND refresh_button_ = nullptr;
  HWND status_text_ = nullptr;
  HWND list_ = nullptr;
  HFONT font_ = nullptr;
  HFONT bold_font_ = nullptr;
  HBRUSH background_brush_ = nullptr;
  bool status_is_error_ = false;

  bool loading_ = false;
  std::thread worker_;
  std::mutex result_mutex_;
  std::optional<FetchResult> result_;
};

}  // namespace pa
