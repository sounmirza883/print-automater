/**
 * Roving-focus target for a WAI-ARIA tablist. Arrow keys wrap in both axes
 * (the preview's sidebar is vertical at desktop width, but users reach for
 * either pair); Home/End jump to the ends. Returns null for any other key so
 * the caller leaves the event alone.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
