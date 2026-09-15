/** §94's entire token list, and nothing beyond it: Typography, Spacing,
 * Radius, Elevation, Borders, and five semantic colors (Primary action,
 * Success, Warning, Error, Neutral). No per-color shade ramps, no extra
 * categories -- there is no component built against this package yet
 * (that starts at 3.3/3.4) to justify inventing more than the PRD asks
 * for. This object is the single source of truth; `toCssVariables()`
 * derives web's form from it rather than duplicating the values. */

export interface TypeScaleStep {
  fontSize: number;
  lineHeight: number;
}

export interface Typography {
  fontFamily: string;
  fontWeight: {
    regular: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  scale: {
    xs: TypeScaleStep;
    sm: TypeScaleStep;
    base: TypeScaleStep;
    lg: TypeScaleStep;
    xl: TypeScaleStep;
    "2xl": TypeScaleStep;
    "3xl": TypeScaleStep;
  };
}

export interface SemanticColors {
  primaryAction: string;
  success: string;
  warning: string;
  error: string;
  neutral: string;
}

export interface DesignTokens {
  typography: Typography;
  /** Steps on a 4px grid, keyed by multiplier (spacing["4"] === 16). */
  spacing: Record<"0" | "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12" | "16", number>;
  radius: {
    none: number;
    sm: number;
    md: number;
    lg: number;
    full: number;
  };
  /** Unitless levels, not pre-baked box-shadow/native-shadow strings --
   * translating a level into a web box-shadow or an RN
   * elevation/shadowRadius is a per-platform concern for whichever
   * component (3.3/3.4) first needs one, not something to guess at
   * without a real surface to validate it against. */
  elevation: {
    level0: number;
    level1: number;
    level2: number;
    level3: number;
    level4: number;
  };
  borders: {
    width: {
      none: number;
      thin: number;
      medium: number;
      thick: number;
    };
    color: string;
  };
  colors: SemanticColors;
}

export const tokens: DesignTokens = {
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontWeight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    scale: {
      xs: { fontSize: 12, lineHeight: 16 },
      sm: { fontSize: 14, lineHeight: 20 },
      base: { fontSize: 16, lineHeight: 24 },
      lg: { fontSize: 18, lineHeight: 28 },
      xl: { fontSize: 20, lineHeight: 28 },
      "2xl": { fontSize: 24, lineHeight: 32 },
      "3xl": { fontSize: 30, lineHeight: 36 },
    },
  },
  spacing: {
    "0": 0,
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 20,
    "6": 24,
    "8": 32,
    "10": 40,
    "12": 48,
    "16": 64,
  },
  radius: {
    none: 0,
    sm: 4,
    md: 8,
    lg: 16,
    full: 9999,
  },
  elevation: {
    level0: 0,
    level1: 1,
    level2: 2,
    level3: 4,
    level4: 8,
  },
  borders: {
    width: {
      none: 0,
      thin: 1,
      medium: 2,
      thick: 4,
    },
    color: "#E5E7EB",
  },
  colors: {
    primaryAction: "#2563EB",
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    neutral: "#6B7280",
  },
};
