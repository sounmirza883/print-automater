import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@print-automated/design-tokens";
import { describeBlockedReason, type Tone } from "@print-automated/api-client";
import type { Badge } from "@/lib/job-view";

/** Tone colours (light; the app has one theme). The same five tones shop-web uses. */
export const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "#F3F4F6", fg: "#374151", border: "#E5E7EB" },
  good: { bg: "#DCFCE7", fg: "#166534", border: "#BBF7D0" },
  caution: { bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A" },
  danger: { bg: "#FEE2E2", fg: "#991B1B", border: "#FECACA" },
  accent: { bg: "#DBEAFE", fg: "#1E40AF", border: "#BFDBFE" },
};

export const MUTED = "#6B7280";

export function Pill({ badge }: { badge: Badge }): ReactNode {
  const tone = TONES[badge.tone];
  return (
    <Text style={[styles.pill, { backgroundColor: tone.bg, color: tone.fg }]}>{badge.label}</Text>
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
      <Text style={[styles.noteTitle, { color: tone.fg }]}>{blocked.label}</Text>
      <Text style={[styles.noteText, { color: tone.fg }]}>{blocked.hint}</Text>
    </View>
  );
}

export function SectionTitle({ title, count }: { title: string; count?: number }): ReactNode {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {title}
      {count !== undefined ? ` (${count})` : ""}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "quiet";
  disabled?: boolean;
  busy?: boolean;
}): ReactNode {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={[
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "danger" && styles.buttonDanger,
        variant === "quiet" && styles.buttonQuiet,
        off && styles.buttonOff,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? "#fff" : MUTED} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            (variant === "primary" || variant === "danger") && styles.buttonTextOnColour,
            variant === "quiet" && styles.buttonTextQuiet,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tokens.radius.full,
    overflow: "hidden",
  },
  note: { borderWidth: 1, borderRadius: tokens.radius.md, padding: 10, gap: 2 },
  noteTitle: { fontWeight: "700" },
  noteText: { fontSize: 13 },
  sectionTitle: { fontWeight: "700", fontSize: 15, color: "#111827", marginTop: 8 },
  button: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: tokens.colors.primaryAction,
    borderColor: tokens.colors.primaryAction,
  },
  buttonDanger: { backgroundColor: tokens.colors.error, borderColor: tokens.colors.error },
  buttonQuiet: { borderColor: "transparent" },
  buttonOff: { opacity: 0.5 },
  buttonText: { fontWeight: "600", color: "#111827" },
  buttonTextOnColour: { color: "#fff", fontWeight: "700" },
  buttonTextQuiet: { color: MUTED },
});
