#include "app/login_window.h"

#include "app/resource.h"
#include "app/win.h"

namespace pa {

namespace {

constexpr wchar_t kWindowClass[] = L"PrintAutomatedAgentLoginWindow";
constexpr UINT_PTR kLoginButtonId = 201;
constexpr UINT_PTR kEmailEditId = 202;
constexpr UINT_PTR kPasswordEditId = 203;

constexpr int kMargin = 24;
constexpr int kWindowWidth = 400;
constexpr int kWindowHeight = 300;

// Copied from status_window.cpp's own palette (the shop-web console's dark surface/accent/
// danger tokens) so the two native windows read as one app, not two different native dialogs.
constexpr COLORREF kBgColor = RGB(0x0d, 0x11, 0x17);
constexpr COLORREF kTextPrimary = RGB(0xe6, 0xed, 0xf3);
constexpr COLORREF kTextMuted = RGB(0x8b, 0x94, 0x9e);
constexpr COLORREF kDanger = RGB(0xf8, 0x51, 0x49);
constexpr COLORREF kAccent = RGB(0x2f, 0x81, 0xf7);

HWND make_static(HWND parent, HINSTANCE instance, int x, int y, int w, int h) {
  return CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT, x, y, w, h, parent,
                         nullptr, instance, nullptr);
}

}  // namespace

LoginWindow::LoginWindow(HINSTANCE instance,
                         std::function<std::string(const std::string&, const std::string&)> log_in,
                         std::function<void()> on_success)
    : instance_(instance), log_in_(std::move(log_in)), on_success_(std::move(on_success)) {
  NONCLIENTMETRICSW metrics{};
  metrics.cbSize = sizeof metrics;
  if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof metrics, &metrics, 0)) {
    font_ = CreateFontIndirectW(&metrics.lfMessageFont);
    LOGFONTW bold = metrics.lfMessageFont;
    bold.lfWeight = FW_SEMIBOLD;
    bold.lfHeight = (bold.lfHeight * 13) / 10;
    bold_font_ = CreateFontIndirectW(&bold);
  }
  background_brush_ = CreateSolidBrush(kBgColor);
}

LoginWindow::~LoginWindow() {
  if (window_ != nullptr) {
    DestroyWindow(window_);
    UnregisterClassW(kWindowClass, instance_);
  }
  if (font_ != nullptr) DeleteObject(font_);
  if (bold_font_ != nullptr) DeleteObject(bold_font_);
  if (background_brush_ != nullptr) DeleteObject(background_brush_);
}

LRESULT CALLBACK LoginWindow::window_proc(HWND window, UINT message, WPARAM wparam,
                                          LPARAM lparam) {
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  auto* self = reinterpret_cast<LoginWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (self == nullptr) return DefWindowProcW(window, message, wparam, lparam);
  if (message == WM_NCCREATE) self->window_ = window;
  return self->handle(message, wparam, lparam);
}

void LoginWindow::create_window() {
  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof window_class;
  window_class.lpfnWndProc = &LoginWindow::window_proc;
  window_class.hInstance = instance_;
  window_class.lpszClassName = kWindowClass;
  window_class.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(IDI_AGENT));
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = background_brush_;
  RegisterClassExW(&window_class);

  constexpr DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
  RECT rect{0, 0, kWindowWidth, kWindowHeight};
  AdjustWindowRect(&rect, style, FALSE);
  window_ = CreateWindowExW(0, kWindowClass, L"Sign in - Print Automated", style, CW_USEDEFAULT,
                            CW_USEDEFAULT, rect.right - rect.left, rect.bottom - rect.top, nullptr,
                            nullptr, instance_, this);
  if (window_ == nullptr) throw_last_error("CreateWindowExW (login window)");
  create_controls();
}

void LoginWindow::create_controls() {
  int y = kMargin;
  title_text_ = make_static(window_, instance_, kMargin, y, kWindowWidth - 2 * kMargin, 28);
  SetWindowTextW(title_text_, L"Sign in to Print Automated");
  y += 44;

  email_label_ = make_static(window_, instance_, kMargin, y, kWindowWidth - 2 * kMargin, 18);
  SetWindowTextW(email_label_, L"Email");
  y += 22;
  email_edit_ = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"",
                                WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, kMargin, y,
                                kWindowWidth - 2 * kMargin, 26, window_,
                                reinterpret_cast<HMENU>(kEmailEditId), instance_, nullptr);
  y += 38;

  password_label_ = make_static(window_, instance_, kMargin, y, kWindowWidth - 2 * kMargin, 18);
  SetWindowTextW(password_label_, L"Password");
  y += 22;
  password_edit_ =
      CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_PASSWORD,
                      kMargin, y, kWindowWidth - 2 * kMargin, 26, window_,
                      reinterpret_cast<HMENU>(kPasswordEditId), instance_, nullptr);
  y += 40;

  login_button_ = CreateWindowExW(0, L"BUTTON", L"Log in", WS_CHILD | WS_VISIBLE | BS_OWNERDRAW,
                                  kMargin, y, kWindowWidth - 2 * kMargin, 32, window_,
                                  reinterpret_cast<HMENU>(kLoginButtonId), instance_, nullptr);
  y += 44;

  error_text_ = make_static(window_, instance_, kMargin, y, kWindowWidth - 2 * kMargin, 40);

  if (font_ != nullptr) {
    HWND all[] = {email_label_, email_edit_, password_label_, password_edit_, error_text_};
    for (HWND control : all) SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
  }
  if (bold_font_ != nullptr) {
    SendMessageW(title_text_, WM_SETFONT, reinterpret_cast<WPARAM>(bold_font_), TRUE);
  }
}

void LoginWindow::submit() {
  wchar_t email_buffer[256]{};
  wchar_t password_buffer[256]{};
  GetWindowTextW(email_edit_, email_buffer, ARRAYSIZE(email_buffer));
  GetWindowTextW(password_edit_, password_buffer, ARRAYSIZE(password_buffer));

  std::string email;
  std::string password;
  try {
    email = narrow(email_buffer);
    password = narrow(password_buffer);
  } catch (...) {
    SetWindowTextW(error_text_, L"That text has characters this agent can't read.");
    ShowWindow(error_text_, SW_SHOW);
    return;
  }
  // Wiped as soon as it has been copied into the std::string used below.
  SecureZeroMemory(password_buffer, sizeof password_buffer);

  if (email.empty() || password.empty()) {
    SetWindowTextW(error_text_, L"Enter your email and password.");
    ShowWindow(error_text_, SW_SHOW);
    return;
  }

  EnableWindow(login_button_, FALSE);
  SetWindowTextW(error_text_, L"");
  std::string error;
  try {
    error = log_in_(email, password);
  } catch (const std::exception& exception) {
    error = exception.what();
  } catch (...) {
    error = "Sign-in failed unexpectedly.";
  }
  EnableWindow(login_button_, TRUE);

  if (error.empty()) {
    SetWindowTextW(password_edit_, L"");
    hide();
    if (on_success_) on_success_();
    return;
  }
  try {
    SetWindowTextW(error_text_, widen(error).c_str());
  } catch (...) {
    SetWindowTextW(error_text_, L"Sign-in failed.");
  }
  ShowWindow(error_text_, SW_SHOW);
}

LRESULT LoginWindow::handle(UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_COMMAND:
      if (LOWORD(wparam) == kLoginButtonId && HIWORD(wparam) == BN_CLICKED) {
        submit();
      }
      return 0;
    case WM_CTLCOLORSTATIC: {
      HDC dc = reinterpret_cast<HDC>(wparam);
      HWND control = reinterpret_cast<HWND>(lparam);
      SetBkMode(dc, TRANSPARENT);
      COLORREF color = kTextPrimary;
      if (control == error_text_) {
        color = kDanger;
      } else if (control == email_label_ || control == password_label_) {
        color = kTextMuted;
      }
      SetTextColor(dc, color);
      return reinterpret_cast<LRESULT>(background_brush_);
    }
    case WM_DRAWITEM: {
      auto* item = reinterpret_cast<DRAWITEMSTRUCT*>(lparam);
      if (item->CtlID != kLoginButtonId) return FALSE;
      const bool pressed = (item->itemState & ODS_SELECTED) != 0;
      HBRUSH fill = CreateSolidBrush(pressed ? RGB(0x25, 0x6b, 0xd1) : kAccent);
      FillRect(item->hDC, &item->rcItem, fill);
      DeleteObject(fill);
      SetBkMode(item->hDC, TRANSPARENT);
      SetTextColor(item->hDC, RGB(0xff, 0xff, 0xff));
      HFONT previous = font_ != nullptr
                           ? static_cast<HFONT>(SelectObject(item->hDC, font_))
                           : nullptr;
      wchar_t text[64];
      GetWindowTextW(item->hwndItem, text, ARRAYSIZE(text));
      DrawTextW(item->hDC, text, -1, &item->rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
      if (previous != nullptr) SelectObject(item->hDC, previous);
      return TRUE;
    }
    case WM_CLOSE:
      // Hidden, not destroyed: main.cpp owns deciding when a window should reappear (e.g. if a
      // session unexpectedly becomes invalid later), the same way StatusWindow behaves.
      ShowWindow(window_, SW_HIDE);
      return 0;
    default:
      return DefWindowProcW(window_, message, wparam, lparam);
  }
}

void LoginWindow::show() {
  if (window_ == nullptr) {
    create_window();
  }
  SetWindowTextW(error_text_, L"");
  ShowWindow(window_, SW_SHOW);
  SetForegroundWindow(window_);
  SetFocus(email_edit_);
}

void LoginWindow::hide() {
  if (window_ != nullptr) ShowWindow(window_, SW_HIDE);
}

bool LoginWindow::visible() const { return window_ != nullptr && IsWindowVisible(window_); }

}  // namespace pa
