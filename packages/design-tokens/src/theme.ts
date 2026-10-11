/** Native palette and layout scales for the shop app, taken from the marketing site's
 * theme (apps/marketing-web globals.css): the brand blue scale with brand-600 as the one
 * primary action colour, the "ink" navy neutrals, and the CMYK registration-mark accents
 * (cyan, magenta, yellow) used sparingly for the logo mark, active indicators and empty-state
 * artwork. Kept apart from `tokens` (whose shape drives the web CSS variables) so native apps
 * share one visual identity without changing what web emits. */

export type ToneName = "neutral" | "good" | "caution" | "danger" | "accent";

export interface ToneColors {
  bg: string;
  fg: string;
  border: string;
  /** Solid colour for icons, dots and card edge stripes of this tone. */
  solid: string;
}

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700" | "800";
  letterSpacing?: number;
}

export type BrandScale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;
export type InkScale = Record<
  50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950,
  string
>;

interface ShadowStyle {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export interface Theme {
  /** The marketing site's raw scales, for the rare place a semantic slot does not fit. */
  palette: {
    brand: BrandScale;
    ink: InkScale;
    cmyk: { cyan: string; magenta: string; yellow: string };
  };
  /** Font families. Inter is the site's body face; until it is bundled the system face is
   * used (`sans` is undefined so React Native picks it). `mono` is for order numbers and
   * amounts (JetBrains Mono on the site; the platform monospace here). */
  fonts: { sans: string | undefined; mono: { ios: string; android: string } };
  /** Animation durations in milliseconds. */
  motion: { fast: number; base: number; slow: number };
  surface: {
    /** Screen background (ink-50). */
    background: string;
    /** Cards, sheets, inputs. */
    card: string;
    /** Subtle fills (form panels, selected options). */
    subtle: string;
    accentSubtle: string;
    /** Dark chrome fill (hero panels, camera framing). */
    inverse: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    onColor: string;
  };
  border: {
    default: string;
    strong: string;
  };
  brand: {
    /** Primary actions, active tab, links (brand-600). */
    accent: string;
    /** Pressed primary (brand-700). */
    accentPressed: string;
    /** Deep ink for hero panels and dark chrome. */
    ink: string;
    /** Text/icon colour on `ink`. */
    onInk: string;
    /** Secondary text on `ink`. */
    onInkMuted: string;
  };
  /** Dark overlay chrome for camera framing. */
  overlay: { scrim: string; frame: string };
  /** CMYK accents: logo mark, active indicator, illustrations. Never for text. */
  accents: { cyan: string; magenta: string; yellow: string };
  /** Printer/device status dots. */
  inactive: string;
  tones: Record<ToneName, ToneColors>;
  /** 4px-grid spacing steps. */
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  /** Corner radii: controls, cards, sheets. */
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  /** One type scale for the whole app. */
  type: {
    display: TypeStyle;
    title: TypeStyle;
    heading: TypeStyle;
    body: TypeStyle;
    bodyStrong: TypeStyle;
    caption: TypeStyle;
    overline: TypeStyle;
  };
  /** Spread into a style object; cross-platform (iOS shadow* plus Android elevation). */
  shadow: { card: ShadowStyle; raised: ShadowStyle };
  /** Minimum touch target edge. */
  touch: number;
}

const brand: BrandScale = {
  50: "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",
  600: "#2563eb",
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
};

const ink: InkScale = {
  50: "#f4f6fb",
  100: "#e6eaf3",
  200: "#ccd4e4",
  300: "#a3afc9",
  400: "#7382a5",
  500: "#52618a",
  600: "#3b4870",
  700: "#2a3556",
  800: "#1a2340",
  900: "#0f1630",
  950: "#080d21",
};

const cmyk = { cyan: "#00aeef", magenta: "#ec008c", yellow: "#ffd400" };

export const theme: Theme = {
  palette: { brand, ink, cmyk },
  fonts: { sans: undefined, mono: { ios: "Menlo", android: "monospace" } },
  motion: { fast: 140, base: 240, slow: 380 },
  surface: {
    background: ink[50],
    card: "#FFFFFF",
    subtle: ink[100],
    accentSubtle: brand[50],
    inverse: ink[900],
  },
  text: {
    primary: ink[900],
    secondary: ink[600],
    muted: ink[500],
    onColor: "#FFFFFF",
  },
  border: {
    default: ink[100],
    strong: ink[200],
  },
  brand: {
    accent: brand[600],
    accentPressed: brand[700],
    ink: ink[900],
    onInk: "#FFFFFF",
    onInkMuted: ink[300],
  },
  overlay: { scrim: ink[950], frame: "#FFFFFF" },
  accents: cmyk,
  inactive: ink[300],
  // Status tones are harmonised with the palette: caution leans toward the CMYK yellow,
  // danger toward the magenta, accent is the brand blue.
  tones: {
    neutral: { bg: ink[100], fg: ink[600], border: ink[200], solid: ink[400] },
    good: { bg: "#E8F8F0", fg: "#0B5D3B", border: "#B3E6CD", solid: "#0E9F6E" },
    caution: { bg: "#FFF6D6", fg: "#6B4E00", border: "#FFE27A", solid: "#E0A800" },
    danger: { bg: "#FDECF3", fg: "#9F1239", border: "#F8BBD3", solid: "#D61F5C" },
    accent: { bg: brand[50], fg: brand[800], border: brand[200], solid: brand[600] },
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 9999 },
  type: {
    display: { fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.6 },
    title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.3 },
    heading: { fontSize: 17, lineHeight: 24, fontWeight: "700", letterSpacing: -0.1 },
    body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
    bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
    overline: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.8 },
  },
  shadow: {
    card: {
      shadowColor: ink[900],
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    raised: {
      shadowColor: ink[900],
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
  },
  touch: 48,
};
