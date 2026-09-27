#include "printing/pdf_printer.h"

#include <fpdfview.h>
#include <winspool.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <type_traits>
#include <vector>

#include "app/win.h"
#include "printing/discovery.h"
#include "printing/print_failure.h"

namespace pa {

namespace {

// PDFium is not thread-safe: every call into it holds this lock. Initialising is idempotent in
// PDFium itself, so it is simply done under the lock on every use.
std::mutex& pdfium_mutex() {
  static std::mutex mutex;
  return mutex;
}

void ensure_pdfium() {
  FPDF_LIBRARY_CONFIG config{};
  config.version = 2;
  FPDF_InitLibraryWithConfig(&config);
}

using Document = std::unique_ptr<std::remove_pointer_t<FPDF_DOCUMENT>, decltype(&FPDF_CloseDocument)>;
using Page = std::unique_ptr<std::remove_pointer_t<FPDF_PAGE>, decltype(&FPDF_ClosePage)>;

[[noreturn]] void refuse(const std::string& message) {
  throw PrintFailure(PrintStage::BeforeSpool, message);
}

/// Reads the PDF through a Win32 handle, so the path never goes through a narrow encoding.
class PdfFile {
 public:
  explicit PdfFile(const std::filesystem::path& file)
      : handle_(CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr)) {
    if (!handle_.valid()) refuse("The document could not be opened.");
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle_.get(), &size) || size.QuadPart <= 0 ||
        size.QuadPart > 0x7FFFFFFF) {
      refuse("The document is empty or too large to print.");
    }
    access_.m_FileLen = static_cast<unsigned long>(size.QuadPart);
    access_.m_GetBlock = &PdfFile::read_block;
    access_.m_Param = this;
  }
  PdfFile(const PdfFile&) = delete;
  PdfFile& operator=(const PdfFile&) = delete;

  /// Caller holds the PDFium lock. The PdfFile must outlive the returned document.
  Document open() {
    Document document(FPDF_LoadCustomDocument(&access_, nullptr), &FPDF_CloseDocument);
    if (!document) {
      switch (FPDF_GetLastError()) {
        case FPDF_ERR_PASSWORD:
          refuse("The document is password-protected.");
        case FPDF_ERR_SECURITY:
          refuse("The document uses a protection this printer cannot open.");
        default:
          refuse("The document is not a readable PDF.");
      }
    }
    return document;
  }

 private:
  static int read_block(void* param, unsigned long position, unsigned char* buffer,
                        unsigned long size) {
    auto* self = static_cast<PdfFile*>(param);
    OVERLAPPED at{};
    at.Offset = position;
    DWORD read = 0;
    return ReadFile(self->handle_.get(), buffer, size, &read, &at) && read == size ? 1 : 0;
  }

  UniqueHandle handle_;
  FPDF_FILEACCESS access_{};
};

class PrinterHandle {
 public:
  explicit PrinterHandle(std::wstring& name) {
    if (!OpenPrinterW(name.data(), &handle_, nullptr)) {
      handle_ = nullptr;
      refuse("The printer \"" + narrow(name) + "\" is not installed on this computer.");
    }
  }
  PrinterHandle(const PrinterHandle&) = delete;
  PrinterHandle& operator=(const PrinterHandle&) = delete;
  ~PrinterHandle() {
    if (handle_ != nullptr) ClosePrinter(handle_);
  }
  HANDLE get() const { return handle_; }

 private:
  HANDLE handle_ = nullptr;
};

struct DcDeleter {
  void operator()(HDC dc) const { DeleteDC(dc); }
};
using PrinterDc = std::unique_ptr<std::remove_pointer_t<HDC>, DcDeleter>;

std::wstring port_of(HANDLE printer) {
  DWORD needed = 0;
  GetPrinterW(printer, 2, nullptr, 0, &needed);
  if (needed == 0) return {};
  std::vector<BYTE> buffer(needed);
  if (!GetPrinterW(printer, 2, buffer.data(), needed, &needed)) return {};
  const auto* info = reinterpret_cast<const PRINTER_INFO_2W*>(buffer.data());
  return info->pPortName != nullptr ? info->pPortName : L"";
}

/// The standard Windows form name for a DMPAPER size.
const wchar_t* form_name(short paper) {
  switch (paper) {
    case DMPAPER_A4: return L"A4";
    case DMPAPER_A5: return L"A5";
    case DMPAPER_A3: return L"A3";
    case DMPAPER_LETTER: return L"Letter";
    case DMPAPER_LEGAL: return L"Legal";
    default: return L"";
  }
}

const char* paper_name(short paper) {
  switch (paper) {
    case DMPAPER_A4: return "A4";
    case DMPAPER_A5: return "A5";
    case DMPAPER_A3: return "A3";
    case DMPAPER_LETTER: return "Letter";
    case DMPAPER_LEGAL: return "Legal";
    default: return "the requested";
  }
}

/// The queue's own defaults with our settings merged in and validated by the driver.
class JobDevMode {
 public:
  JobDevMode(HANDLE printer, std::wstring& name, const std::wstring& port,
             const PrintSettings& settings, int pages_in_range)
      : printer_(printer), name_(name) {
    const LONG size = DocumentPropertiesW(nullptr, printer, name.data(), nullptr, nullptr, 0);
    if (size <= 0) refuse("The printer driver would not describe its settings.");
    requested_.resize(static_cast<size_t>(size));
    merged_.resize(static_cast<size_t>(size));
    auto* dm = reinterpret_cast<DEVMODEW*>(requested_.data());
    if (DocumentPropertiesW(nullptr, printer, name.data(), dm, nullptr, DM_OUT_BUFFER) != IDOK) {
      refuse("The printer driver would not describe its settings.");
    }

    dm->dmFields |= DM_ORIENTATION | DM_COLOR | DM_DUPLEX | DM_COPIES;
    dm->dmOrientation = static_cast<short>(settings.landscape ? DMORIENT_LANDSCAPE : DMORIENT_PORTRAIT);
    dm->dmColor = static_cast<short>(settings.monochrome ? DMCOLOR_MONOCHROME : DMCOLOR_COLOR);
    dm->dmDuplex = settings.duplex;
    if (settings.paper) {
      dm->dmFields |= DM_PAPERSIZE;
      dm->dmFields &= ~(DM_PAPERLENGTH | DM_PAPERWIDTH | DM_FORMNAME);  // these override it
      dm->dmPaperSize = *settings.paper;
    }

    if (!settings.monochrome &&
        DeviceCapabilitiesW(name.c_str(), port.c_str(), DC_COLORDEVICE, nullptr, dm) == 0) {
      refuse("This printer cannot print in colour.");
    }

    // Copies: the driver's own (one spooled copy, faster) only when it can collate them, or
    // when there is a single page so collation cannot matter.
    const int driver_max = DeviceCapabilitiesW(name.c_str(), port.c_str(), DC_COPIES, nullptr, dm);
    const bool collates =
        DeviceCapabilitiesW(name.c_str(), port.c_str(), DC_COLLATE, nullptr, dm) == 1;
    driver_copies_ = settings.copies > 1 && driver_max >= settings.copies &&
                     (collates || pages_in_range == 1);
    dm->dmCopies = static_cast<short>(driver_copies_ ? settings.copies : 1);
    if (driver_copies_ && collates) {
      dm->dmFields |= DM_COLLATE;
      dm->dmCollate = DMCOLLATE_TRUE;
    }
    merge();
    if (driver_copies_ && merged()->dmCopies != settings.copies) {
      driver_copies_ = false;  // it did not take: render the copies here instead
      dm->dmCopies = 1;
      merge();
    }
    if (!driver_copies_ && (merged()->dmFields & DM_COPIES) != 0 && merged()->dmCopies > 1) {
      refuse("The printer driver insists on printing extra copies.");
    }

    // A setting the driver dropped would print something other than what was ordered. Some
    // drivers answer with the form's name instead of the paper id; that is the same paper.
    if (settings.paper) {
      const DEVMODEW* result = merged();
      const bool paper_kept =
          (result->dmFields & DM_PAPERSIZE) != 0 && result->dmPaperSize == *settings.paper;
      const bool form_kept = (result->dmFields & DM_FORMNAME) != 0 &&
                             _wcsicmp(result->dmFormName, form_name(*settings.paper)) == 0;
      if (!paper_kept && !form_kept) {
        refuse(std::string("This printer does not offer ") + paper_name(*settings.paper) +
               " paper.");
      }
    }
    if (settings.duplex != DMDUP_SIMPLEX &&
        ((merged()->dmFields & DM_DUPLEX) == 0 || merged()->dmDuplex != settings.duplex)) {
      refuse("This printer cannot print double-sided.");
    }
  }

  const DEVMODEW* merged() const { return reinterpret_cast<const DEVMODEW*>(merged_.data()); }
  bool driver_copies() const { return driver_copies_; }

 private:
  void merge() {
    if (DocumentPropertiesW(nullptr, printer_, name_.data(),
                            reinterpret_cast<DEVMODEW*>(merged_.data()),
                            reinterpret_cast<DEVMODEW*>(requested_.data()),
                            DM_IN_BUFFER | DM_OUT_BUFFER) != IDOK) {
      refuse("The printer driver rejected the print settings.");
    }
  }

  HANDLE printer_;
  std::wstring& name_;
  std::vector<BYTE> requested_;
  std::vector<BYTE> merged_;
  bool driver_copies_ = false;
};

SheetGeometry sheet_of(HDC dc) {
  SheetGeometry sheet;
  sheet.dpi_x = GetDeviceCaps(dc, LOGPIXELSX);
  sheet.dpi_y = GetDeviceCaps(dc, LOGPIXELSY);
  sheet.width = GetDeviceCaps(dc, PHYSICALWIDTH);
  sheet.height = GetDeviceCaps(dc, PHYSICALHEIGHT);
  sheet.offset_x = GetDeviceCaps(dc, PHYSICALOFFSETX);
  sheet.offset_y = GetDeviceCaps(dc, PHYSICALOFFSETY);
  if (sheet.width <= 0 || sheet.height <= 0) {  // not a paper device: its drawable area
    sheet.width = GetDeviceCaps(dc, HORZRES);
    sheet.height = GetDeviceCaps(dc, VERTRES);
    sheet.offset_x = sheet.offset_y = 0;
  }
  return sheet;
}

}  // namespace

PagePlacement place_page(double page_width_pt, double page_height_pt, const SheetGeometry& sheet) {
  PagePlacement placement;
  double width = page_width_pt;
  double height = page_height_pt;
  const bool page_landscape = width > height;
  const bool sheet_landscape = sheet.width > sheet.height;
  if (page_landscape != sheet_landscape && width != height && sheet.width != sheet.height) {
    placement.rotate = 1;
    std::swap(width, height);
  }
  double width_px = width / 72.0 * sheet.dpi_x;
  double height_px = height / 72.0 * sheet.dpi_y;
  const double scale = std::min({1.0, sheet.width / width_px, sheet.height / height_px});
  width_px *= scale;
  height_px *= scale;
  placement.width = static_cast<int>(std::lround(width_px));
  placement.height = static_cast<int>(std::lround(height_px));
  placement.x = (sheet.width - placement.width) / 2 - sheet.offset_x;
  placement.y = (sheet.height - placement.height) / 2 - sheet.offset_y;
  return placement;
}

int pdf_page_count(const std::filesystem::path& document) {
  std::lock_guard lock(pdfium_mutex());
  ensure_pdfium();
  try {
    PdfFile file(document);
    auto doc = file.open();
    return FPDF_GetPageCount(doc.get());
  } catch (const PrintFailure& failure) {
    throw std::runtime_error(failure.what());
  }
}

SubmittedPrint print_pdf(const std::filesystem::path& document, const std::string& printer_name,
                         const PrintSettings& settings, const std::wstring& document_name,
                         const std::optional<std::filesystem::path>& output_file) {
  std::lock_guard lock(pdfium_mutex());
  ensure_pdfium();

  // --- Before the spooler: every failure here is safe. ---
  PdfFile file(document);
  Document doc = file.open();
  const int page_count = FPDF_GetPageCount(doc.get());
  if (page_count <= 0) refuse("The document has no pages.");
  const int first = settings.first_page.value_or(1);
  const int last = settings.last_page.value_or(page_count);
  if (last > page_count) {
    refuse("The job asks for pages " + std::to_string(first) + "-" + std::to_string(last) +
           " but the document has " + std::to_string(page_count) + ".");
  }
  for (int index = first - 1; index < last; ++index) {
    Page page(FPDF_LoadPage(doc.get(), index), &FPDF_ClosePage);
    if (!page) refuse("Page " + std::to_string(index + 1) + " of the document is damaged.");
  }

  std::wstring name;
  try {
    name = widen(printer_name);
  } catch (const std::exception&) {
    refuse("The printer name is not valid text.");
  }
  PrinterHandle printer(name);
  const std::wstring port = port_of(printer.get());
  if (saves_to_file(port) && !output_file) {
    // Its driver would open a Save dialog that nobody is there to answer.
    refuse("This printer saves to a file instead of printing on paper.");
  }
  const int pages_in_range = last - first + 1;
  JobDevMode devmode(printer.get(), name, port, settings, pages_in_range);

  PrinterDc dc(CreateDCW(L"WINSPOOL", name.c_str(), nullptr, devmode.merged()));
  if (!dc) refuse("Windows could not open the printer for drawing.");
  const SheetGeometry sheet = sheet_of(dc.get());
  if (sheet.dpi_x <= 0 || sheet.dpi_y <= 0) refuse("The printer reported no resolution.");

  const std::wstring output = output_file ? output_file->wstring() : std::wstring();
  DOCINFOW info{};
  info.cbSize = sizeof info;
  info.lpszDocName = document_name.c_str();
  info.lpszOutput = output_file ? output.c_str() : nullptr;
  const int job_id = StartDocW(dc.get(), &info);
  if (job_id <= 0) refuse("The printer refused to start the job.");

  // --- Spooling: pages may reach paper from here on, so failures are unsafe. ---
  SubmittedPrint submitted;
  submitted.spool_job_id = static_cast<DWORD>(job_id);
  const auto fail = [&](const std::string& message) {
    AbortDoc(dc.get());
    throw PrintFailure(PrintStage::Spooling, message);
  };
  const int flags = FPDF_ANNOT | FPDF_PRINTING | (settings.monochrome ? FPDF_GRAYSCALE : 0);
  const int rendered_copies = devmode.driver_copies() ? 1 : settings.copies;
  const bool blank_between_copies =
      settings.duplex != DMDUP_SIMPLEX && pages_in_range % 2 == 1 && rendered_copies > 1;

  for (int copy = 0; copy < rendered_copies; ++copy) {
    for (int index = first - 1; index < last; ++index) {
      Page page(FPDF_LoadPage(doc.get(), index), &FPDF_ClosePage);
      if (!page) fail("Page " + std::to_string(index + 1) + " could not be loaded while printing.");
      const PagePlacement at = place_page(FPDF_GetPageWidthF(page.get()),
                                          FPDF_GetPageHeightF(page.get()), sheet);
      if (StartPage(dc.get()) <= 0) fail("The printer refused a page.");
      FPDF_RenderPage(dc.get(), page.get(), at.x, at.y, at.width, at.height, at.rotate, flags);
      if (EndPage(dc.get()) <= 0) fail("The printer refused a page.");
      ++submitted.sheets_rendered;
    }
    if (blank_between_copies && copy + 1 < rendered_copies) {
      if (StartPage(dc.get()) <= 0 || EndPage(dc.get()) <= 0) fail("The printer refused a page.");
    }
  }
  if (EndDoc(dc.get()) <= 0) fail("The printer did not accept the end of the job.");
  return submitted;
}

}  // namespace pa
