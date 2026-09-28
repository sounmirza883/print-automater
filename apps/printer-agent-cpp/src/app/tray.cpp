#include "app/tray.h"

#include <shellapi.h>

#include "app/resource.h"
#include "app/win.h"

namespace pa {

namespace {

constexpr UINT kTrayMessage = WM_APP + 1;
constexpr UINT kStatusMessage = WM_APP + 2;
constexpr UINT kIconId = 1;
constexpr UINT_PTR kShowCommand = 1;
constexpr UINT_PTR kOpenCommand = 2;
constexpr UINT_PTR kQuitCommand = 3;
constexpr wchar_t kWindowClass[] = L"PrintAutomatedAgentTray";

}  // namespace

Tray::Tray(HINSTANCE instance, std::wstring page_url, std::function<void()> on_show_window,
          std::function<void()> on_quit)
    : instance_(instance),
      page_url_(std::move(page_url)),
      on_show_window_(std::move(on_show_window)),
      on_quit_(std::move(on_quit)) {
  taskbar_created_ = RegisterWindowMessageW(L"TaskbarCreated");
  icon_ = static_cast<HICON>(LoadImageW(instance_, MAKEINTRESOURCEW(IDI_AGENT), IMAGE_ICON,
                                        GetSystemMetrics(SM_CXSMICON),
                                        GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR));
  if (icon_ == nullptr) icon_ = LoadIconW(nullptr, IDI_APPLICATION);

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof window_class;
  window_class.lpfnWndProc = &Tray::window_proc;
  window_class.hInstance = instance_;
  window_class.lpszClassName = kWindowClass;
  window_class.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(IDI_AGENT));
  RegisterClassExW(&window_class);
  // A hidden top-level window (not message-only, which would miss the TaskbarCreated broadcast).
  window_ = CreateWindowExW(0, kWindowClass, L"Print Automated agent", WS_OVERLAPPED, 0, 0, 0, 0,
                            nullptr, nullptr, instance_, this);
  if (window_ == nullptr) throw_last_error("CreateWindowExW");
}

Tray::~Tray() {
  if (window_ != nullptr) DestroyWindow(window_);
  UnregisterClassW(kWindowClass, instance_);
}

LRESULT CALLBACK Tray::window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  auto* self = reinterpret_cast<Tray*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (self == nullptr) return DefWindowProcW(window, message, wparam, lparam);
  if (message == WM_NCCREATE) self->window_ = window;
  return self->handle(message, wparam, lparam);
}

void Tray::add_icon() {
  NOTIFYICONDATAW data{};
  data.cbSize = sizeof data;
  data.hWnd = window_;
  data.uID = kIconId;
  data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
  data.uCallbackMessage = kTrayMessage;
  data.hIcon = icon_;
  Shell_NotifyIconW(NIM_ADD, &data);
  data.uVersion = NOTIFYICON_VERSION_4;
  Shell_NotifyIconW(NIM_SETVERSION, &data);
  update_tooltip();
}

void Tray::update_tooltip() {
  NOTIFYICONDATAW data{};
  data.cbSize = sizeof data;
  data.hWnd = window_;
  data.uID = kIconId;
  data.uFlags = NIF_TIP | NIF_SHOWTIP;
  std::wstring tip;
  {
    std::lock_guard lock(mutex_);
    tip = L"Print Automated agent: " + status_;
  }
  if (tip.size() >= ARRAYSIZE(data.szTip)) tip = tip.substr(0, ARRAYSIZE(data.szTip) - 2) + L"…";
  wcsncpy_s(data.szTip, tip.c_str(), _TRUNCATE);
  Shell_NotifyIconW(NIM_MODIFY, &data);
}

void Tray::show_menu() {
  HMENU menu = CreatePopupMenu();
  if (menu == nullptr) return;
  std::wstring status;
  {
    std::lock_guard lock(mutex_);
    status = status_;
  }
  AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, status.c_str());
  AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(menu, MF_STRING, kShowCommand, L"Show agent window");
  AppendMenuW(menu, MF_STRING, kOpenCommand, L"Open in browser");
  AppendMenuW(menu, MF_STRING, kQuitCommand, L"Quit Print Automated agent");
  SetMenuDefaultItem(menu, static_cast<UINT>(kShowCommand), FALSE);
  POINT at{};
  GetCursorPos(&at);
  SetForegroundWindow(window_);  // so the menu closes when the user clicks elsewhere
  TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, at.x, at.y, 0, window_, nullptr);
  PostMessageW(window_, WM_NULL, 0, 0);
  DestroyMenu(menu);
}

void Tray::show_window() const {
  if (on_show_window_) on_show_window_();
}

void Tray::open_page() const {
  ShellExecuteW(nullptr, L"open", page_url_.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void Tray::shut_down() {
  if (shut_down_) return;
  shut_down_ = true;
  if (on_quit_) on_quit_();
}

LRESULT Tray::handle(UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == taskbar_created_ && taskbar_created_ != 0) {
    add_icon();  // Explorer restarted and forgot every icon
    return 0;
  }
  switch (message) {
    case WM_CREATE:
      add_icon();
      return 0;
    case kTrayMessage:
      switch (LOWORD(lparam)) {
        case NIN_SELECT:
        case NIN_KEYSELECT:
          show_window();
          return 0;
        case WM_CONTEXTMENU:
          show_menu();
          return 0;
        default:
          return 0;
      }
    case kStatusMessage:
      update_tooltip();
      return 0;
    case WM_COMMAND:
      if (LOWORD(wparam) == kShowCommand) show_window();
      if (LOWORD(wparam) == kOpenCommand) open_page();
      if (LOWORD(wparam) == kQuitCommand) DestroyWindow(window_);
      return 0;
    case WM_QUERYENDSESSION:
      return TRUE;
    case WM_ENDSESSION:
      // Windows is signing out or shutting down: stop cleanly now; there may be no WM_DESTROY.
      if (wparam) shut_down();
      return 0;
    case WM_CLOSE:
      DestroyWindow(window_);
      return 0;
    case WM_DESTROY: {
      NOTIFYICONDATAW data{};
      data.cbSize = sizeof data;
      data.hWnd = window_;
      data.uID = kIconId;
      Shell_NotifyIconW(NIM_DELETE, &data);
      shut_down();
      window_ = nullptr;
      PostQuitMessage(0);
      return 0;
    }
    default:
      return DefWindowProcW(window_, message, wparam, lparam);
  }
}

int Tray::run() {
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return static_cast<int>(message.wParam);
}

void Tray::set_status(std::wstring status) {
  {
    std::lock_guard lock(mutex_);
    if (status_ == status) return;
    status_ = std::move(status);
  }
  if (window_ != nullptr) PostMessageW(window_, kStatusMessage, 0, 0);
}

void Tray::quit() {
  if (window_ != nullptr) PostMessageW(window_, WM_CLOSE, 0, 0);
}

}  // namespace pa
