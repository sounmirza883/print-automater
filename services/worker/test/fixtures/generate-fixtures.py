"""One-time generator for test/fixtures/*.pdf, run manually (not part of
the build or test pipeline). Produces a minimal valid PDF and a
password-protected PDF for document-processing.e2e-spec.ts's fixture
suite (2.7's Done-when needs a real encrypted PDF -- pdf-lib can create
PDFs but cannot encrypt them).
"""

from pypdf import PdfWriter

writer = PdfWriter()
writer.add_blank_page(width=612, height=792)
with open("valid.pdf", "wb") as f:
    writer.write(f)

writer = PdfWriter()
writer.add_blank_page(width=612, height=792)
writer.encrypt(user_password="test-password-123", owner_password="test-owner-password-456")
with open("password-protected.pdf", "wb") as f:
    writer.write(f)

print("Generated valid.pdf and password-protected.pdf")
