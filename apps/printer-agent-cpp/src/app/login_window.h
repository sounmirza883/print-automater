#pragma once

#include <windows.h>

#include <functional>
#include <string>

namespace pa {

/// Slice 1 of the native dashboard pages: a "Login" window for staff email + password, styled
/// with the same dark palette as StatusWindow (status_window.cpp) so the two read as one app.
/// main.cpp shows this at startup whenever there is no valid staff session, alongside (not
/// instead of) StatusWindow; a successful login hides it, the same way StatusWindow's own
/// pairing form behaves on success, and leaves the session in Agent/Session for later native
/// pages (future slices) to use through ApiClient.
class LoginWindow {
 public:
  /// `log_in` is called with (email, password) on "Log in"; it returns an empty string on
  /// success or an error message to show inline on failure (the same pattern StatusWindow's own
  /// pair_error_ uses). `on_success` runs after `log_in` succeeds and the window has hidden
  /// itself.
  LoginWindow(HINSTANCE instance,
              std::function<std::string(const std::string&, const std::string&)> log_in,
              std::function<void()> on_success);
  LoginWindow(const LoginWindow&) = delete;
  LoginWindow& operator=(const LoginWindow&) = delete;
  ~LoginWindow();

  /// Shows the window (creating its controls the first time) and brings it to the foreground.
  void show();
  /// Hides the window without destroying it (mirrors StatusWindow::handle's WM_CLOSE).
  void hide();
  bool visible() const;

 private:
  static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT handle(UINT message, WPARAM wparam, LPARAM lparam);
  void create_window();
  void create_controls();
  void submit();

  HINSTANCE instance_;
  std::function<std::string(const std::string&, const std::string&)> log_in_;
  std::function<void()> on_success_;

  HWND window_ = nullptr;
  HFONT font_ = nullptr;
  HFONT bold_font_ = nullptr;
  HBRUSH background_brush_ = nullptr;

  HWND title_text_ = nullptr;
  HWND email_label_ = nullptr;
  HWND email_edit_ = nullptr;
  HWND password_label_ = nullptr;
  HWND password_edit_ = nullptr;
  HWND login_button_ = nullptr;
  HWND error_text_ = nullptr;
};

}  // namespace pa
