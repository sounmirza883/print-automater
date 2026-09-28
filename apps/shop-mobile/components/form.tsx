import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tokens } from "@print-automated/design-tokens";
import type { Choice } from "@/lib/job-actions";
import { MUTED } from "@/components/ui";

/** Pick one of a few options (a radio group, large enough to tap on a phone). */
export function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            onPress={() => onChange(option.value)}
            style={[styles.option, checked && styles.optionChecked]}
          >
            <View style={[styles.dot, checked && styles.dotChecked]} />
            <Text style={styles.optionText}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NoteField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): ReactNode {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        maxLength={500}
        style={styles.input}
      />
    </View>
  );
}

/** The frame around an inline action form under a job or the order. */
export function ActionForm({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "danger";
  children: ReactNode;
}): ReactNode {
  return (
    <View style={[styles.form, tone === "danger" && styles.formDanger]}>
      <Text style={styles.formTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  label: { color: MUTED, fontSize: 13 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  optionChecked: { borderColor: tokens.colors.primaryAction, backgroundColor: "#EFF6FF" },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#9CA3AF" },
  dotChecked: {
    borderColor: tokens.colors.primaryAction,
    backgroundColor: tokens.colors.primaryAction,
  },
  optionText: { flexShrink: 1 },
  input: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  form: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 12,
    gap: 10,
    backgroundColor: "#F9FAFB",
  },
  formDanger: { borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  formTitle: { fontWeight: "700" },
});
