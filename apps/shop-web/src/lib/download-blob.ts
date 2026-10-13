/** Hands a Blob to the browser as a file download (the report exports come through the
 * authenticated API as a Blob, so there is no URL to simply link to). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next turn so the browser has started the download first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
