import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@print-automated/design-tokens";
import { describeBlockedReason, type Tone } from "@print-automated/api-client";
import type { Badge } from "@/lib/job-view";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Tone colours (light; the app has one theme). The same five tones shop-web uses. */
export const TONES: Record<Tone, { bg: string; fg: string; border: string; solid: string }> =
  theme.tones;

export const MUTED = theme.text.muted;

/** Monospace face for order numbers, amounts and codes (JetBrains Mono on the marketing site). */
export const MONO = Platform.select({
  ios: theme.fonts.mono.ios,
  default: theme.fonts.mono.android,
});

const TONE_ICON: Record<Tone, IconName> = {
  neutral: "ellipse-outline",
  good: "checkmark-circle",
  caution: "alert-circle",
  danger: "warning",
  accent: "information-circle",
};

/** Springs a child to 0.97 while pressed; the shared tactile feedback for cards and buttons. */
export function PressableScale({
  children,
  style,
  contentStyle,
  disabled,
  scaleTo = 0.97,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "style" | "children"> & {
  children: ReactNode;
  /** Outer (layout) style; the scaled view fills it. */
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
}): ReactNode {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number): void => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      style={style}
      {...props}
    >
      <Animated.View style={[contentStyle, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Fades and lifts its children in on mount; `delay` staggers siblings. */
export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: theme.motion.slow,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Status bar that only speaks while its screen is focused (tabs stay mounted). */
export function FocusedStatusBar({ style }: { style: "light" | "dark" }): ReactNode {
  const focused = useIsFocused();
  return focused ? <StatusBar style={style} /> : null;
}

/** The product mark: a brand-blue tile with a printer and the CMYK registration dots. */
export function BrandMark({ size = 44 }: { size?: number }): ReactNode {
  const dot = Math.max(5, Math.round(size / 8));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size, borderRadius: Math.round(size * 0.3) }]}
    >
      <Ionicons name="print" size={Math.round(size * 0.5)} color={theme.text.onColor} />
      <View style={styles.markDots}>
        {[theme.accents.cyan, theme.accents.magenta, theme.accents.yellow].map((colour) => (
          <View
            key={colour}
            style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: colour }}
          />
        ))}
      </View>
    </View>
  );
}

/** Title block at the top of a tab screen: safe-area aware, with an optional trailing action. */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
}): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + theme.space.md }]}>
      <FocusedStatusBar style="dark" />
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          {title}
        </Text>
        {subtitle !== undefined && subtitle !== null && (
          <Text numberOfLines={1} style={styles.headerSub}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
}

export function Pill({ badge }: { badge: Badge }): ReactNode {
  const tone = TONES[badge.tone];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <View style={[styles.pillDot, { backgroundColor: tone.solid }]} />
      <Text style={[styles.pillText, { color: tone.fg }]}>{badge.label}</Text>
    </View>
  );
}

export function Pills({ badges }: { badges: Badge[] }): ReactNode {
  return (
    <View style={styles.pills}>
      {badges.map((badge) => (
        <Pill key={badge.label} badge={badge} />
      ))}
    </View>
  );
}

/** Why a job is parked and what to do, in the words shop-web uses (23.31). */
export function BlockedNote({ reason }: { reason: string | null }): ReactNode {
  const blocked = describeBlockedReason(reason);
  if (blocked === null) {
    return null;
  }
  const tone = TONES[blocked.tone];
  return (
    <View
      accessibilityRole="summary"
      style={[styles.note, { backgroundColor: tone.bg, borderColor: tone.border }]}
    >
      <Ionicons name={TONE_ICON[blocked.tone]} size={20} color={tone.solid} />
      <View style={styles.noteBody}>
        <Text style={[styles.noteTitle, { color: tone.fg }]}>{blocked.label}</Text>
        <Text style={[styles.noteText, { color: tone.fg }]}>{blocked.hint}</Text>
      </View>
    </View>
  );
}

export function SectionTitle({ title, count }: { title: string; count?: number }): ReactNode {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionBar} />
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {count !== undefined && (
        <View style={styles.sectionCount}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

/** White rounded surface; `edge` paints a status-coloured stripe down its left side. */
export function Card({
  children,
  edge,
  style,
}: {
  children: ReactNode;
  edge?: string;
  style?: object;
}): ReactNode {
  return (
    <View style={[styles.card, style]}>
      {edge !== undefined && <View style={[styles.cardEdge, { backgroundColor: edge }]} />}
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

/** A white panel of label/value rows (details, account info). */
export function Group({ children }: { children: ReactNode }): ReactNode {
  return <View style={styles.group}>{children}</View>;
}

export function InfoRow({
  icon,
  label,
  value,
  mono = false,
  last = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}): ReactNode {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.infoRow, !last && styles.infoRowDivider]}
    >
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={theme.brand.accent} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, mono && styles.infoMono]}>{value}</Text>
      </View>
    </View>
  );
}

/** Loading, error, offline and empty states share one look: CMYK-ringed icon badge, title,
 * explanation, optional action. */
export function StateView({
  kind,
  title,
  message,
  icon,
  action,
}: {
  kind: "loading" | "error" | "empty";
  title?: string;
  message?: string;
  icon?: IconName;
  action?: ReactNode;
}): ReactNode {
  if (kind === "loading") {
    return (
      <View style={styles.state} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator size="large" color={theme.brand.accent} />
        {title !== undefined && <Text style={styles.stateMessage}>{title}</Text>}
      </View>
    );
  }
  const tone = kind === "error" ? TONES.danger : TONES.accent;
  return (
    <Reveal style={styles.state}>
      <View accessibilityRole={kind === "error" ? "alert" : undefined} style={styles.stateInner}>
        <View style={styles.art}>
          <View style={[styles.artRing, { borderColor: tone.border }]} />
          <View style={[styles.artDisc, { backgroundColor: tone.bg }]}>
            <Ionicons
              name={icon ?? (kind === "error" ? "cloud-offline-outline" : "file-tray-outline")}
              size={36}
              color={tone.solid}
            />
          </View>
          <View style={[styles.artDot, styles.artCyan]} />
          <View style={[styles.artDot, styles.artMagenta]} />
          <View style={[styles.artDot, styles.artYellow]} />
        </View>
        {title !== undefined && <Text style={styles.stateTitle}>{title}</Text>}
        {message !== undefined && <Text style={styles.stateMessage}>{message}</Text>}
        {action !== undefined && <View style={styles.stateAction}>{action}</View>}
      </View>
    </Reveal>
  );
}

/** Rounded text input with an optional leading icon and a brand focus ring. */
export function Field({
  icon,
  style,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof TextInput>, "style"> & {
  icon?: IconName;
  style?: ViewStyle;
}): ReactNode {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused, style]}>
      {icon !== undefined && (
        <Ionicons name={icon} size={20} color={focused ? theme.brand.accent : theme.text.muted} />
      )}
      <TextInput
        placeholderTextColor={theme.palette.ink[400]}
        style={styles.fieldInput}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  busy = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "quiet";
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
}): ReactNode {
  const off = disabled || busy;
  const onColour = variant === "primary" || variant === "danger";
  const fg = onColour
    ? theme.text.onColor
    : variant === "quiet"
      ? theme.text.muted
      : theme.text.primary;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      scaleTo={0.98}
      contentStyle={[
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "danger" && styles.buttonDanger,
        variant === "quiet" && styles.buttonQuiet,
        off && styles.buttonOff,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon !== undefined && <Ionicons name={icon} size={20} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  mark: {
    backgroundColor: theme.brand.accent,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  markDots: { position: "absolute", bottom: 5, flexDirection: "row", gap: 2 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingBottom: theme.space.md,
    backgroundColor: theme.surface.background,
  },
  headerCopy: { flex: 1, gap: 2 },
  headerTitle: { ...theme.type.display, color: theme.text.primary },
  headerSub: { ...theme.type.caption, color: theme.text.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm - 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...theme.type.caption, fontWeight: "700", fontSize: 12, lineHeight: 16 },
  note: {
    flexDirection: "row",
    gap: theme.space.md,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  noteBody: { flex: 1, gap: 2 },
  noteTitle: { ...theme.type.bodyStrong, fontWeight: "700" },
  noteText: { ...theme.type.caption },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    marginTop: theme.space.sm,
  },
  sectionBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: theme.brand.accent,
  },
  sectionTitle: { ...theme.type.overline, color: theme.text.secondary, textTransform: "uppercase" },
  sectionCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: theme.surface.subtle,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCountText: { ...theme.type.overline, letterSpacing: 0, color: theme.text.secondary },
  card: {
    flexDirection: "row",
    backgroundColor: theme.surface.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border.default,
    overflow: "hidden",
    ...theme.shadow.card,
  },
  cardEdge: { width: 5 },
  cardBody: { flex: 1, padding: theme.space.lg, gap: theme.space.sm },
  group: {
    backgroundColor: theme.surface.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border.default,
    paddingHorizontal: theme.space.lg,
    ...theme.shadow.card,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    minHeight: 60,
    paddingVertical: theme.space.md,
  },
  infoRowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.default },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.surface.accentSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCopy: { flex: 1, gap: 1 },
  infoLabel: { ...theme.type.caption, color: theme.text.muted },
  infoValue: { ...theme.type.bodyStrong, color: theme.text.primary },
  infoMono: { fontFamily: MONO, fontSize: 13 },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.xxl,
    gap: theme.space.md,
  },
  stateInner: { alignItems: "center", gap: theme.space.md },
  art: { width: 132, height: 132, alignItems: "center", justifyContent: "center" },
  artRing: {
    position: "absolute",
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  artDisc: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  artDot: { position: "absolute", width: 12, height: 12, borderRadius: 6 },
  artCyan: { top: 8, right: 14, backgroundColor: theme.accents.cyan },
  artMagenta: { bottom: 14, left: 4, backgroundColor: theme.accents.magenta },
  artYellow: { bottom: 2, right: 30, backgroundColor: theme.accents.yellow },
  stateTitle: { ...theme.type.title, color: theme.text.primary, textAlign: "center" },
  stateMessage: {
    ...theme.type.body,
    color: theme.text.muted,
    textAlign: "center",
    maxWidth: 320,
  },
  stateAction: { alignSelf: "stretch", marginTop: theme.space.sm },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touch,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.border.strong,
    backgroundColor: theme.surface.card,
  },
  fieldFocused: { borderColor: theme.brand.accent, backgroundColor: theme.surface.accentSubtle },
  fieldInput: {
    flex: 1,
    minHeight: theme.touch,
    fontSize: 16,
    color: theme.text.primary,
  },
  button: {
    minHeight: theme.touch,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.border.strong,
    backgroundColor: theme.surface.card,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  buttonPrimary: { backgroundColor: theme.brand.accent, borderColor: theme.brand.accent },
  buttonDanger: {
    backgroundColor: theme.tones.danger.solid,
    borderColor: theme.tones.danger.solid,
  },
  buttonQuiet: { borderColor: "transparent", backgroundColor: "transparent" },
  buttonOff: { opacity: 0.5 },
  buttonText: { ...theme.type.bodyStrong, fontWeight: "700" },
});
