/** A minimal solid-color 16x16 `.ico` -- a single PNG-compressed icon
 * directory entry (supported natively since Windows Vista's icon
 * loader), generated and round-trip-verified (the embedded PNG's
 * IDAT was inflated back and diffed against the source pixels before
 * this constant was committed) rather than the hand-rolled classic
 * BMP/DIB-in-ICO encoding this file originally held -- that encoding
 * had a real bug (a malformed AND-mask/DIB header combination) that
 * the platform's native icon loader rejected outright, and `systray`'s
 * own readline handler has no try/catch around its `JSON.parse` of
 * the native binary's stderr line, so that load failure became an
 * *uncaught exception that crashed the whole agent process* -- not a
 * benign, swallowed tray error. See tray.ts's own crash-isolation
 * comment for the belt-and-suspenders fix on the process side; this
 * fixes the actual root cause. Replace with a real brand icon before
 * 13.3's installer build. */
export const TRAY_ICON_BASE64 =
  "AAABAAEAEBAAAAEAIABSAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAABlJREFUeNpjUCi48J8SzDBqwKgBowYMFwMAxbFfH1qym6YAAAAASUVORK5CYII=";
