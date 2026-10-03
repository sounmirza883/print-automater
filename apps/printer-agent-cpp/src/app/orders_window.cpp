#include "app/orders_window.h"

#include <commctrl.h>

#include <cstdio>
#include <utility>
#include <vector>

#include "app/resource.h"
#include "app/win.h"

namespace pa {

namespace {

constexpr wchar_t kWindowClass[] = L"PrintAutomatedAgentOrdersWindow";
constexpr UINT kResultMessage = WM_APP + 4;
constexpr UINT_PTR kRefreshButtonId = 201;
constexpr UINT_PTR kListId = 202;

constexpr int kMargin = 20;
constexpr int kWindowWidth = 980;
constexpr int kWindowHeight = 600;
constexpr int kListTop = 92;

// The same palette as status_window.cpp, so the two windows read as one app.
constexpr COLORREF kBgColor = RGB(0x0d, 0x11, 0x17);
constexpr COLORREF kPanelColor = RGB(0x16, 0x1b, 0x22);
constexpr COLORREF kTextPrimary = RGB(0xe6, 0xed, 0xf3);
constexpr COLORREF kTextMuted = RGB(0x8b, 0x94, 0x9e);
constexpr COLORREF kDanger = RGB(0xf8, 0x51, 0x49);

struct Column {
  const wchar_t* title;
  int width;
};

const Column kColumns[] = {
    {L"Order", 110}, {L"Status", 140}, {L"Payment", 110}, {L"Customer", 160},
    {L"Total", 100}, {L"Created", 130}, {L"Document", 130},
};
constexpr int kColumnCount = static_cast<int>(sizeof kColumns / sizeof kColumns[0]);

/// ISO-8601 UTC ("2026-09-28T10:00:00.000Z") to a local "date time" string, the same conversion
/// status_window.cpp's `when()` does. Anything unparseable is shown as the API sent it.
std::wstring local_time(const std::string& iso) {
  if (iso.size() < 19) return widen(iso);
  try {
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
    return widen(iso);
  }
}

std::wstring to_wide_or(const std::string& text, const wchar_t* fallback) {
  try {
    return widen(text);
  } catch (...) {
    return fallback;
  }
}

/// The one-line summary under the title: how many rows are shown out of how many exist.
std::wstring summary_line(const OrdersPage& page) {
  if (page.items.empty()) return L"No orders yet. Orders appear here as customers place them.";
  wchar_t buffer[160];
  if (static_cast<std::int64_t>(page.items.size()) < page.total) {
    std::swprintf(buffer, ARRAYSIZE(buffer), L"Showing the newest %zu of %lld orders.",
                  page.items.size(), static_cast<long long>(page.total));
  } else {
    std::swprintf(buffer, ARRAYSIZE(buffer), L"%zu %ls.", page.items.size(),
                  page.items.size() == 1 ? L"order" : L"orders");
  }
  return buffer;
}

HWND make_static(HWND parent, HINSTANCE instance, int x, int y, int w, int h) {
  return CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT, x, y, w, h, parent,
                         nullptr, instance, nullptr);
}

}  // namespace

OrdersWindow::OrdersWindow(HINSTANCE instance, ApiClient& api) : instance_(instance), api_(api) {
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

OrdersWindow::~OrdersWindow() {
  // Join first: the worker posts to window_ and writes result_, both of which must outlive it.
  if (worker_.joinable()) worker_.join();
  if (window_ != nullptr) {
    DestroyWindow(window_);
    UnregisterClassW(kWindowClass, instance_);
  }
  if (font_ != nullptr) DeleteObject(font_);
  if (bold_font_ != nullptr) DeleteObject(bold_font_);
  if (background_brush_ != nullptr) DeleteObject(background_brush_);
}

LRESULT CALLBACK OrdersWindow::window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
  }
  auto* self = reinterpret_cast<OrdersWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (self == nullptr) return DefWindowProcW(window, message, wparam, lparam);
  if (message == WM_NCCREATE) self->window_ = window;
  return self->handle(message, wparam, lparam);
}

void OrdersWindow::create_window() {
  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof window_class;
  window_class.lpfnWndProc = &OrdersWindow::window_proc;
  window_class.hInstance = instance_;
  window_class.lpszClassName = kWindowClass;
  window_class.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(IDI_AGENT));
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = background_brush_;
  RegisterClassExW(&window_class);

  constexpr DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_THICKFRAME |
                          WS_MAXIMIZEBOX;
  RECT rect{0, 0, kWindowWidth, kWindowHeight};
  AdjustWindowRect(&rect, style, FALSE);
  window_ = CreateWindowExW(0, kWindowClass, L"Print Automated: Orders and queue", style,
                            CW_USEDEFAULT, CW_USEDEFAULT, rect.right - rect.left,
                            rect.bottom - rect.top, nullptr, nullptr, instance_, this);
  if (window_ == nullptr) throw_last_error("CreateWindowExW (orders window)");
  create_controls();
}

void OrdersWindow::create_controls() {
  title_ = make_static(window_, instance_, kMargin, kMargin, 400, 28);
  SetWindowTextW(title_, L"Orders and queue");

  refresh_button_ = CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                    kWindowWidth - kMargin - 120, kMargin, 120, 28, window_,
                                    reinterpret_cast<HMENU>(kRefreshButtonId), instance_, nullptr);

  status_text_ = make_static(window_, instance_, kMargin, kMargin + 40,
                             kWindowWidth - 2 * kMargin, 22);

  const DWORD list_style = WS_CHILD | WS_VISIBLE | WS_BORDER | LVS_REPORT | LVS_SINGLESEL |
                           LVS_SHOWSELALWAYS;
  list_ = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"", list_style, kMargin, kListTop,
                          kWindowWidth - 2 * kMargin, kWindowHeight - kListTop - kMargin - 40,
                          window_, reinterpret_cast<HMENU>(kListId), instance_, nullptr);
  if (list_ == nullptr) throw_last_error("CreateWindowExW (orders list)");
  ListView_SetExtendedListViewStyle(list_, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
  // Dark rows to match the window. The header keeps the system style: without a visual-styles
  // manifest the header cannot be recolored by these messages.
  ListView_SetBkColor(list_, kPanelColor);
  ListView_SetTextBkColor(list_, kPanelColor);
  ListView_SetTextColor(list_, kTextPrimary);

  for (int i = 0; i < kColumnCount; ++i) {
    LVCOLUMNW column{};
    column.mask = LVCF_TEXT | LVCF_WIDTH | LVCF_SUBITEM;
    column.pszText = const_cast<wchar_t*>(kColumns[i].title);
    column.cx = kColumns[i].width;
    column.iSubItem = i;
    ListView_InsertColumn(list_, i, &column);
  }

  if (font_ != nullptr) {
    HWND all[] = {refresh_button_, status_text_, list_};
    for (HWND control : all) SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
  }
  if (bold_font_ != nullptr) {
    SendMessageW(title_, WM_SETFONT, reinterpret_cast<WPARAM>(bold_font_), TRUE);
  }
}

void OrdersWindow::show() {
  if (window_ == nullptr) {
    INITCOMMONCONTROLSEX common{sizeof common, ICC_LISTVIEW_CLASSES};
    InitCommonControlsEx(&common);
    create_window();
  }
  ShowWindow(window_, SW_SHOW);
  SetForegroundWindow(window_);
  start_fetch();
}

void OrdersWindow::start_fetch() {
  if (loading_) return;
  loading_ = true;
  EnableWindow(refresh_button_, FALSE);
  set_status(L"Loading orders…", false);

  // A finished worker has already posted its result; joining it here is immediate and makes
  // the thread object reusable.
  if (worker_.joinable()) worker_.join();
  const HWND target = window_;
  worker_ = std::thread([this, target] {
    FetchResult result;
    try {
      OrdersClient client(api_);
      result.page = client.fetch();
      result.ok = true;
    } catch (const BackendError& error) {
      result.error = error.error_code() == "NOT_SIGNED_IN" ? "Sign in to see the orders."
                                                          : error.what();
    } catch (const std::exception& error) {
      result.error = std::string("Could not load the orders: ") + error.what();
    }
    {
      std::lock_guard lock(result_mutex_);
      result_ = std::move(result);
    }
    PostMessageW(target, kResultMessage, 0, 0);
  });
}

void OrdersWindow::apply_result() {
  std::optional<FetchResult> result;
  {
    std::lock_guard lock(result_mutex_);
    result = std::exchange(result_, std::nullopt);
  }
  loading_ = false;
  EnableWindow(refresh_button_, TRUE);
  if (!result) return;

  if (result->ok) {
    fill_list(result->page);
    set_status(summary_line(result->page), false);
  } else {
    ListView_DeleteAllItems(list_);
    set_status(to_wide_or(result->error, L"The orders could not be loaded."), true);
  }
}

void OrdersWindow::fill_list(const OrdersPage& page) {
  ListView_DeleteAllItems(list_);
  int row = 0;
  for (const OrderSummary& order : page.items) {
    const std::wstring total =
        order.total_minor ? to_wide_or(format_money(*order.total_minor, order.currency), L"")
                          : std::wstring();
    std::vector<std::wstring> cells = {
        to_wide_or(order.order_number, L""),
        to_wide_or(order_status_label(order.order_status), L""),
        to_wide_or(order_status_label(order.payment_status), L""),
        to_wide_or(order.customer_name, L""),
        total,
        local_time(order.created_at),
        to_wide_or(order.document_filename, L""),
    };

    LVITEMW item{};
    item.mask = LVIF_TEXT;
    item.iItem = row;
    item.pszText = cells[0].data();
    ListView_InsertItem(list_, &item);
    for (int column = 1; column < kColumnCount; ++column) {
      ListView_SetItemText(list_, row, column, cells[column].data());
    }
    ++row;
  }
}

void OrdersWindow::set_status(const std::wstring& text, bool is_error) {
  status_is_error_ = is_error;
  SetWindowTextW(status_text_, text.c_str());
  InvalidateRect(status_text_, nullptr, TRUE);
}

LRESULT OrdersWindow::handle(UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case kResultMessage:
      apply_result();
      return 0;
    case WM_COMMAND:
      if (LOWORD(wparam) == kRefreshButtonId && HIWORD(wparam) == BN_CLICKED) start_fetch();
      return 0;
    case WM_CTLCOLORSTATIC: {
      HDC dc = reinterpret_cast<HDC>(wparam);
      HWND control = reinterpret_cast<HWND>(lparam);
      SetBkMode(dc, TRANSPARENT);
      COLORREF color = kTextMuted;
      if (control == title_) color = kTextPrimary;
      if (control == status_text_ && status_is_error_) color = kDanger;
      SetTextColor(dc, color);
      return reinterpret_cast<LRESULT>(background_brush_);
    }
    case WM_CLOSE:
      // Hidden, not destroyed, like StatusWindow: show() brings it back and reloads.
      ShowWindow(window_, SW_HIDE);
      return 0;
    default:
      return DefWindowProcW(window_, message, wparam, lparam);
  }
}

}  // namespace pa
