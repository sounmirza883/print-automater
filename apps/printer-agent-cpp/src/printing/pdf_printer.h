#pragma once

#include <windows.h>

#include <filesystem>
#include <optional>
#include <string>

#include "printing/print_settings.h"

namespace pa {

struct SubmittedPrint {
  DWORD spool_job_id = 0;  // the spooler's own id for the job (StartDoc's return value)
  int sheets_rendered = 0;  // pages sent, counting every copy we rendered ourselves
};

/// 24.9: prints a PDF in-process with PDFium, straight to a Win32 printer device context. This
/// replaces the Node agent's SumatraPDF child process (and its GPLv3 licence question).
///
///   open the PDF (PDFium) -> check the page range -> load every page in it
///   -> the queue's DEVMODE with our settings merged in by the driver -> CreateDC
///   -> StartDoc (the spooler job id) -> per copy, per page: StartPage, render, EndPage
///   -> EndDoc
///
/// Everything up to StartDoc throws PrintFailure(BeforeSpool): nothing reached the spooler, so
/// it is safe to retry and to report FAILED. That includes a driver that silently drops a
/// setting the customer paid for (double-sided, the paper size, colour): the job is refused
/// rather than printed differently. Anything after StartDoc throws PrintFailure(Spooling) after
/// AbortDoc, because pages may already be on their way to paper.
///
/// Pages print at their actual size, centred on the sheet; a page larger than the sheet is
/// shrunk to fit rather than cut off, and one whose orientation differs from the sheet's is
/// turned to match. Black-and-white jobs are also rendered in greyscale, so a driver that
/// ignores the colour setting still cannot put colour on the page. Copies are left to the
/// driver when it can collate them; otherwise they are rendered here, with a blank back page
/// between copies of an odd-length double-sided job so each copy starts on its own sheet.
///
/// `output_file` makes a print-to-file queue (Microsoft Print to PDF) write there instead of
/// asking where to save; the job loop never sets it (tests and the parity check do).
SubmittedPrint print_pdf(const std::filesystem::path& document, const std::string& printer_name,
                         const PrintSettings& settings, const std::wstring& document_name,
                         const std::optional<std::filesystem::path>& output_file = std::nullopt);

/// Number of pages in a PDF (tests and diagnostics). Throws std::runtime_error when PDFium
/// cannot open it.
int pdf_page_count(const std::filesystem::path& document);

/// The sheet as the printer's device context describes it, in device pixels.
struct SheetGeometry {
  int dpi_x = 0;
  int dpi_y = 0;
  int width = 0;     // PHYSICALWIDTH: the whole sheet
  int height = 0;    // PHYSICALHEIGHT
  int offset_x = 0;  // PHYSICALOFFSETX: the unprintable margin the DC's origin sits inside
  int offset_y = 0;
};

/// Where FPDF_RenderPage draws one page, in the DC's coordinates, and its quarter turns.
struct PagePlacement {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int rotate = 0;  // 0, or 1 (90 degrees clockwise) when the page and sheet orientations differ
  bool operator==(const PagePlacement&) const = default;
};

/// Pure: actual size, centred on the sheet, shrunk (never enlarged) only when larger than the
/// sheet, turned a quarter when its orientation differs from the sheet's. `page_width_pt` and
/// `page_height_pt` are PDF points (1/72 inch) as PDFium reports them (already rotated by the
/// page's own /Rotate).
PagePlacement place_page(double page_width_pt, double page_height_pt, const SheetGeometry& sheet);

}  // namespace pa
