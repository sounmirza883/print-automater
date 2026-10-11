import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "@print-automated/design-tokens";
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
        placeholderTextColor={theme.inactive}
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
  group: { gap: theme.space.sm },
  label: { ...theme.type.caption, color: MUTED },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    borderWidth: 1.5,
    borderColor: theme.border.default,
    backgroundColor: theme.surface.card,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    minHeight: theme.touch,
  },
  optionChecked: {
    borderColor: theme.brand.accent,
    backgroundColor: theme.surface.accentSubtle,
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.inactive },
  dotChecked: {
    borderColor: theme.brand.accent,
    borderWidth: 6,
    backgroundColor: theme.surface.card,
  },
  optionText: { ...theme.type.body, flexShrink: 1, color: theme.text.primary },
  input: {
    borderWidth: 1.5,
    borderColor: theme.border.strong,
    backgroundColor: theme.surface.card,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    minHeight: theme.touch,
    fontSize: 16,
    color: theme.text.primary,
  },
  form: {
    borderWidth: 1,
    borderColor: theme.border.default,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.md,
    backgroundColor: theme.surface.subtle,
  },
  formDanger: { borderColor: theme.tones.danger.border, backgroundColor: theme.tones.danger.bg },
  formTitle: { ...theme.type.heading, color: theme.text.primary },
});
