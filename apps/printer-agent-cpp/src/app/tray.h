#pragma once

#include <windows.h>

#include <functional>
#include <mutex>
#include <string>

namespace pa {

/// 24.12: the notification-area icon, replacing the Node agent's `systray` package (whose icon
/// never rendered, and whose unguarded JSON parsing of its helper's output once crashed the
/// whole agent). Plain Shell_NotifyIcon with the icon compiled into the exe:
///  - click, or "Open agent page" in the menu: the pairing/status page in the browser;
///  - right-click: a menu with the current status, "Open agent page" and "Quit";
///  - the tooltip shows the status too;
///  - the icon comes back if Explorer restarts (TaskbarCreated).
/// It lives on the thread that calls run(); set_status() and quit() may be called from any.
class Tray {
 public:
  Tray(HINSTANCE instance, std::wstring page_url, std::function<void()> on_quit);
  Tray(const Tray&) = delete;
  Tray& operator=(const Tray&) = delete;
  ~Tray();

  /// Runs the message loop until Quit (or Windows ending the session). Returns the exit code.
  int run();
  void set_status(std::wstring status);
  void quit();

 private:
  static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT handle(UINT message, WPARAM wparam, LPARAM lparam);
  void add_icon();
  void update_tooltip();
  void show_menu();
  void open_page() const;
  void shut_down();

  HINSTANCE instance_;
  std::wstring page_url_;
  std::function<void()> on_quit_;
  HWND window_ = nullptr;
  HICON icon_ = nullptr;
  UINT taskbar_created_ = 0;
  bool shut_down_ = false;
  mutable std::mutex mutex_;
  std::wstring status_ = L"Starting";
};

}  // namespace pa
