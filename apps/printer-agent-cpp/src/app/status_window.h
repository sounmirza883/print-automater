#pragma once

#include <windows.h>

#include <functional>
#include <string>
#include <string_view>

#include "agent/agent.h"

namespace pa {

/// 28 (added alongside the browser pairing page, not replacing it -- see
/// server/pairing_page.cpp and loopback.cpp, whose URL stays the pairing
/// instructions shown in shop-mobile/shop-web/marketing-web, the README and
/// the installer, and the only way a second launched instance can show a
/// running instance's state).
///
/// The same fields as the HTML page -- state, shop, device, last heartbeat,
/// printer count, last job, last error, and the pairing-code form -- as
/// plain Win32 controls in-process. No HTTP round trip and no polling timer:
/// `on_status_changed()` is pushed from Agent's own status listener exactly
/// the way Tray::set_status() already is, so the window is always current
/// the instant it's shown.
class StatusWindow {
 public:
  /// `open_orders` runs when the "Orders" button is clicked (slice 2: shows the Orders/Queue
  /// window). The button is always shown, since the Orders window explains a missing sign-in.
  /// `log_out` runs when "Log out" is clicked (slice 2.5); it is always shown too, and it is the
  /// caller's job (main.cpp) to make it a no-op when there is nothing to clear.
  StatusWindow(HINSTANCE instance, std::function<AgentStatus()> get_status,
               std::function<void(std::string_view)> pair, std::function<void()> open_orders,
               std::function<void()> log_out);
  StatusWindow(const StatusWindow&) = delete;
  StatusWindow& operator=(const StatusWindow&) = delete;
  ~StatusWindow();

  /// Shows the window (creating its controls the first time) and brings it
  /// to the foreground. Safe to call repeatedly -- later calls just re-show.
  void show();

  /// Thread-safe: call from any thread whenever the agent's status changes.
  /// Refreshes the window's own fields if it has been created; harmless if
  /// show() has never been called.
  void on_status_changed();

  // Shop / This computer / Last heartbeat / Printers found / Last job, in that order. Public:
  // status_window.cpp's own free-function label table is sized off this too.
  static constexpr int kDetailRowCount = 5;

 private:
  static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT handle(UINT message, WPARAM wparam, LPARAM lparam);
  void create_window();
  void create_controls();
  void refresh();
  void submit_pairing_code();

  HINSTANCE instance_;
  std::function<AgentStatus()> get_status_;
  std::function<void(std::string_view)> pair_;
  std::function<void()> open_orders_;
  std::function<void()> log_out_;

  HWND window_ = nullptr;
  HWND orders_button_ = nullptr;
  HWND logout_button_ = nullptr;
  HFONT font_ = nullptr;
  HFONT bold_font_ = nullptr;
  HBRUSH background_brush_ = nullptr;
  // 0 = neutral/not paired, 1 = paired (good), 2 = pairing (caution) -- which color
  // status_text_ draws in, set by refresh() and read back in WM_CTLCOLORSTATIC/WM_DRAWITEM.
  int status_tone_ = 0;
  HWND status_text_ = nullptr;

  HWND detail_labels_[kDetailRowCount] = {};
  HWND detail_values_[kDetailRowCount] = {};

  HWND problem_text_ = nullptr;

  HWND pair_label_ = nullptr;
  HWND pair_hint_ = nullptr;
  HWND pair_edit_ = nullptr;
  HWND pair_button_ = nullptr;
  HWND pair_error_ = nullptr;

  HWND version_text_ = nullptr;
};

}  // namespace pa
