#include "app/status_window.h"

#include "agent/pairing.h"
#include "app/resource.h"
#include "app/version.h"
#include "app/win.h"

namespace pa {

namespace {

constexpr wchar_t kWindowClass[] = L"PrintAutomatedAgentStatusWindow";
constexpr UINT kStatusMessage = WM_APP + 3;
constexpr UINT_PTR kPairButtonId = 101;
constexpr UINT_PTR kPairEditId = 102;
constexpr UINT_PTR kOrdersButtonId = 103;

constexpr int kMargin = 20;
constexpr int kWindowWidth = 460;
constexpr int kWindowHeight = 480;
constexpr int kDetailRowHeight = 26;
constexpr int kBodyTop = 104;

const wchar_t* const kDetailLabels[StatusWindow::kDetailRowCount] = {
    L"Shop", L"This computer", L"Last heartbeat", L"Printers found", L"Last job"};

// The same palette family as the shop-web console (apps/shop-web's dark surface/good/caution/
// danger/accent tokens), so the agent's own window and the business dashboard read as one
// product rather than a native dialog bolted onto a modern web app.
constexpr COLORREF kBgColor = RGB(0x0d, 0x11, 0x17);
constexpr COLORREF kTextPrimary = RGB(0xe6, 0xed, 0xf3);
constexpr COLORREF kTextMuted = RGB(0x8b, 0x94, 0x9e);
constexpr COLORREF kGood = RGB(0x3f, 0xb9, 0x7a);
constexpr COLORREF kCaution = RGB(0xd2, 0x99, 0x22);
constexpr COLORREF kDanger = RGB(0xf8, 0x51, 0x49);
constexpr COLORREF kAccent = RGB(0x2f, 0x81, 0xf7);

/// ISO-8601 UTC ("2026-09-28T10:00:00.000Z") to a locale-formatted local string, the
/// same conversion pairing_page.cpp's own JS `when()` does client-side. Never throws:
/// anything unparseable falls back to the raw string, and a widen() failure to "Unknown".
std::wstring when(const std::string& iso) {
  if (iso.empty()) return L"Not yet";
  try {
    if (iso.size() < 19) return widen(iso);
    const auto digits = [&](size_t pos, size_t len) { return std::stoi(iso.substr(pos, len)); };
    SYSTEMTIME utc{};
    utc.wYear = static_cast<WORD>(digits(0, 4));
    utc.wMonth = static_cast<WORD>(digits(5, 2));
    utc.wDay = static_cast<WORD>(digits(8, 2));
    utc.wHour = static_cast<WORD>(digits(11, 2));
    utc.wMinute = static_cast<WORD>(digits(14, 2));
    utc.wSecond = static_cast<WORD>(digits(17, 2));
    SYSTEMTIME local{};
    if (!SystemTimeToTzSpecificLocalTime(nullptr, &utc, &local)) return widen(iso);
    wchar_t date_buf[64];
    wchar_t time_buf[64];
    GetDateFormatEx(LOCALE_NAME_USER_DEFAULT, DATE_SHORTDATE, &local, nullptr, date_buf,
                    ARRAYSIZE(date_buf), nullptr);
    GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT, TIME_NOSECONDS, &local, nullptr, time_buf,
                    ARRAYSIZE(time_buf));
    return std::wstring(date_buf) + L" " + time_buf;
  } catch (...) {
    return L"Unknown";
  }
}

HWND make_static(HWND parent, HINSTANCE instance, int x, int y, int w, int h) {
  return CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT, x, y, w, h, parent,
                         nullptr, instance, nullptr);
}

}  // namespace

StatusWindow::StatusWindow(HINSTANCE instance, std::function<AgentStatus()> get_status,
                           std::function<void(std::string_view)> pair,
                           std::function<void()> open_orders)
    : instance_(instance),
      get_status_(std::move(get_status)),
      pair_(std::move(pair)),
      open_orders_(std::move(open_orders)) {
  NONCLIENTMETRICSW metrics{};
  metrics.cbSize = sizeof metrics;
  if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof metrics, &metrics, 0)) {
    font_ = CreateFontIndirectW(&metrics.lfMessageFont);
    LOGFONTW bold = metrics.lfMessageFont;
    bold.lfWeight = FW_SEMIBOLD;
    bold.lfHeight = (bold.lfHeight * 13) / 10;  // ~30% larger, matching the web header's weight
    bold_font_ = CreateFontIndirectW(&bold);
  }
  background_brush_ = CreateSolidBrush(kBgColor);
}

StatusWindow::~StatusWindow() {
  if (window_ != nullptr) {
    DestroyWindow(window_);
    UnregisterClassW(kWindowClass, instance_);
  }
  if (font_ != nullptr) DeleteObject(font_);
  if (bold_font_ != nullptr) DeleteObject(bold_font_);
  if (background_brush_ != nullptr) DeleteObject(background_brush_);
}

LRESULT CALLBACK StatusWindow::window_proc(HWND window, UINT message, WPARAM wparam,
                                           LPARAM lparam) {
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  auto* self = reinterpret_cast<StatusWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (self == nullptr) return DefWindowProcW(window, message, wparam, lparam);
  if (message == WM_NCCREATE) self->window_ = window;
  return self->handle(message, wparam, lparam);
}

void StatusWindow::create_window() {
  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof window_class;
  window_class.lpfnWndProc = &StatusWindow::window_proc;
  window_class.hInstance = instance_;
  window_class.lpszClassName = kWindowClass;
  window_class.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(IDI_AGENT));
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = background_brush_;
  RegisterClassExW(&window_class);

  constexpr DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
  RECT rect{0, 0, kWindowWidth, kWindowHeight};
  AdjustWindowRect(&rect, style, FALSE);
  window_ = CreateWindowExW(0, kWindowClass, L"Print Automated agent", style, CW_USEDEFAULT,
                            CW_USEDEFAULT, rect.right - rect.left, rect.bottom - rect.top, nullptr,
                            nullptr, instance_, this);
  if (window_ == nullptr) throw_last_error("CreateWindowExW (status window)");
  create_controls();
  refresh();
}

void StatusWindow::create_controls() {
  status_text_ = make_static(window_, instance_, kMargin, kMargin, kWindowWidth - 2 * kMargin - 130, 24);

  orders_button_ = CreateWindowExW(0, L"BUTTON", L"Orders", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                   kWindowWidth - kMargin - 120, kMargin - 2, 120, 28, window_,
                                   reinterpret_cast<HMENU>(kOrdersButtonId), instance_, nullptr);

  for (int i = 0; i < kDetailRowCount; ++i) {
    const int y = kBodyTop + i * kDetailRowHeight;
    detail_labels_[i] = make_static(window_, instance_, kMargin, y, 140, 20);
    SetWindowTextW(detail_labels_[i], kDetailLabels[i]);
    detail_values_[i] =
        make_static(window_, instance_, kMargin + 150, y, kWindowWidth - 2 * kMargin - 150, 20);
  }

  problem_text_ = make_static(window_, instance_, kMargin,
                              kBodyTop + kDetailRowCount * kDetailRowHeight + 10,
                              kWindowWidth - 2 * kMargin, 40);

  pair_label_ = make_static(window_, instance_, kMargin, kBodyTop, 200, 20);
  SetWindowTextW(pair_label_, L"Pairing code");
  pair_hint_ = make_static(window_, instance_, kMargin, kBodyTop + 24, kWindowWidth - 2 * kMargin, 48);
  SetWindowTextW(pair_hint_,
                L"In the Print Automated app, open Printers and choose Pair a computer. Enter "
                L"the 8-character code it shows.");

  pair_edit_ = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"",
                               WS_CHILD | WS_VISIBLE | ES_UPPERCASE | ES_AUTOHSCROLL, kMargin,
                               kBodyTop + 78, 160, 26, window_,
                               reinterpret_cast<HMENU>(kPairEditId), instance_, nullptr);
  SendMessageW(pair_edit_, EM_SETLIMITTEXT, 12, 0);

  pair_button_ = CreateWindowExW(0, L"BUTTON", L"Pair this computer",
                                 WS_CHILD | WS_VISIBLE | BS_OWNERDRAW, kMargin + 170,
                                 kBodyTop + 78, 180, 28, window_,
                                 reinterpret_cast<HMENU>(kPairButtonId), instance_, nullptr);

  pair_error_ = make_static(window_, instance_, kMargin, kBodyTop + 112, kWindowWidth - 2 * kMargin, 40);

  version_text_ =
      make_static(window_, instance_, kMargin, kWindowHeight - 40, kWindowWidth - 2 * kMargin, 20);

  if (font_ != nullptr) {
    HWND all[] = {problem_text_, pair_label_, pair_hint_,
                 pair_edit_,    pair_error_, version_text_};
    for (HWND control : all) SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
    for (int i = 0; i < kDetailRowCount; ++i) {
      SendMessageW(detail_labels_[i], WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
      SendMessageW(detail_values_[i], WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
    }
  }
  if (bold_font_ != nullptr) {
    SendMessageW(status_text_, WM_SETFONT, reinterpret_cast<WPARAM>(bold_font_), TRUE);
  }
}

void StatusWindow::refresh() {
  if (window_ == nullptr) return;
  AgentStatus status;
  try {
    status = get_status_();
  } catch (...) {
    return;
  }

  const std::wstring state = status.pairing ? L"Pairing…" : status.paired ? L"Paired" : L"Not paired";
  SetWindowTextW(status_text_, (L"Status: " + state).c_str());
  status_tone_ = status.paired ? 1 : (status.pairing ? 2 : 0);
  InvalidateRect(status_text_, nullptr, TRUE);  // repaint now, not just on the next natural redraw

  for (int i = 0; i < kDetailRowCount; ++i) {
    ShowWindow(detail_labels_[i], status.paired ? SW_SHOW : SW_HIDE);
    ShowWindow(detail_values_[i], status.paired ? SW_SHOW : SW_HIDE);
  }
  if (status.paired) {
    try {
      SetWindowTextW(detail_values_[0], widen(status.shop_id).c_str());
      SetWindowTextW(detail_values_[1], widen(status.device_id).c_str());
    } catch (...) {
      SetWindowTextW(detail_values_[0], L"(unavailable)");
      SetWindowTextW(detail_values_[1], L"(unavailable)");
    }
    SetWindowTextW(detail_values_[2], when(status.last_heartbeat_at).c_str());
    SetWindowTextW(detail_values_[3], std::to_wstring(status.printers).c_str());
    try {
      SetWindowTextW(detail_values_[4],
                     status.last_job.empty() ? L"None yet" : widen(status.last_job).c_str());
    } catch (...) {
      SetWindowTextW(detail_values_[4], L"(unavailable)");
    }
  }

  const bool show_problem = !status.last_error.empty();
  ShowWindow(problem_text_, show_problem ? SW_SHOW : SW_HIDE);
  if (show_problem) {
    try {
      SetWindowTextW(problem_text_, widen(status.last_error).c_str());
    } catch (...) {
      SetWindowTextW(problem_text_, L"There was a problem. See the agent's log.");
    }
  }

  const bool show_pair_form = !status.paired;
  HWND pair_controls[] = {pair_label_, pair_hint_, pair_edit_, pair_button_};
  for (HWND control : pair_controls) ShowWindow(control, show_pair_form ? SW_SHOW : SW_HIDE);
  if (!show_pair_form) {
    ShowWindow(pair_error_, SW_HIDE);
    SetWindowTextW(pair_error_, L"");
  }

  try {
    SetWindowTextW(version_text_, (L"Version " + widen(agent_version())).c_str());
  } catch (...) {
    SetWindowTextW(version_text_, L"");
  }
}

void StatusWindow::submit_pairing_code() {
  wchar_t buffer[32]{};
  GetWindowTextW(pair_edit_, buffer, ARRAYSIZE(buffer));
  std::string code;
  try {
    code = narrow(buffer);
  } catch (...) {
    SetWindowTextW(pair_error_, L"That code has characters this agent can't read.");
    ShowWindow(pair_error_, SW_SHOW);
    return;
  }

  EnableWindow(pair_button_, FALSE);
  SetWindowTextW(pair_error_, L"");
  try {
    pair_(code);
    SetWindowTextW(pair_edit_, L"");
  } catch (const PairingError& error) {
    try {
      SetWindowTextW(pair_error_, widen(error.what()).c_str());
    } catch (...) {
      SetWindowTextW(pair_error_, L"Pairing failed.");
    }
    ShowWindow(pair_error_, SW_SHOW);
  } catch (const std::exception&) {
    SetWindowTextW(pair_error_, L"Pairing failed unexpectedly. See the agent's log.");
    ShowWindow(pair_error_, SW_SHOW);
  }
  EnableWindow(pair_button_, TRUE);
  refresh();
}

LRESULT StatusWindow::handle(UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case kStatusMessage:
      refresh();
      return 0;
    case WM_COMMAND:
      if (LOWORD(wparam) == kPairButtonId && HIWORD(wparam) == BN_CLICKED) {
        submit_pairing_code();
      } else if (LOWORD(wparam) == kOrdersButtonId && HIWORD(wparam) == BN_CLICKED && open_orders_) {
        open_orders_();
      }
      return 0;
    case WM_CTLCOLORSTATIC: {
      HDC dc = reinterpret_cast<HDC>(wparam);
      HWND control = reinterpret_cast<HWND>(lparam);
      SetBkMode(dc, TRANSPARENT);
      COLORREF color = kTextPrimary;
      if (control == status_text_) {
        color = status_tone_ == 1 ? kGood : status_tone_ == 2 ? kCaution : kTextMuted;
      } else if (control == problem_text_ || control == pair_error_) {
        color = kDanger;
      } else if (control == pair_hint_ || control == version_text_) {
        color = kTextMuted;
      } else {
        for (HWND label : detail_labels_) {
          if (control == label) {
            color = kTextMuted;
            break;
          }
        }
      }
      SetTextColor(dc, color);
      return reinterpret_cast<LRESULT>(background_brush_);
    }
    case WM_DRAWITEM: {
      // The pairing button is owner-drawn purely for a flat accent fill matching the web
      // console's buttons -- Win32's stock push button has no clean way to recolor itself.
      auto* item = reinterpret_cast<DRAWITEMSTRUCT*>(lparam);
      if (item->CtlID != kPairButtonId) return FALSE;
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
      // Hidden, not destroyed: the tray's "Show agent window" brings it right back,
      // and the agent keeps running in the background either way (Tray owns quitting).
      ShowWindow(window_, SW_HIDE);
      return 0;
    default:
      return DefWindowProcW(window_, message, wparam, lparam);
  }
}

void StatusWindow::show() {
  if (window_ == nullptr) {
    create_window();
  } else {
    refresh();
  }
  ShowWindow(window_, SW_SHOW);
  SetForegroundWindow(window_);
}

void StatusWindow::on_status_changed() {
  if (window_ != nullptr) PostMessageW(window_, kStatusMessage, 0, 0);
}

}  // namespace pa
