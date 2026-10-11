import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "@print-automated/design-tokens";
import { BrandMark, Button, Field, Reveal, TONES } from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";

export default function LoginScreen(): ReactNode {
  const router = useRouter();
  const { login } = useShopAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Incorrect email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.hero}>
          <Reveal style={styles.brandRow}>
            <BrandMark size={64} />
            <View style={styles.registration}>
              <View style={[styles.regDot, { backgroundColor: theme.accents.cyan }]} />
              <View style={[styles.regDot, { backgroundColor: theme.accents.magenta }]} />
              <View style={[styles.regDot, { backgroundColor: theme.accents.yellow }]} />
            </View>
          </Reveal>
          <Text style={styles.brand}>Print Automated</Text>
          <Text style={styles.tagline}>Run the counter and the print floor from your phone.</Text>
        </View>

        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            Business sign in
          </Text>
          <Field
            icon="mail-outline"
            accessibilityLabel="Email"
            placeholder="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Field
            icon="lock-closed-outline"
            accessibilityLabel="Password"
            placeholder="Password"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void handleSubmit()}
          />
          {error !== null && (
            <View accessibilityRole="alert" style={styles.error}>
              <Ionicons name="alert-circle" size={18} color={TONES.danger.solid} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Button
            label="Log in"
            variant="primary"
            busy={submitting}
            onPress={() => void handleSubmit()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.inverse },
  scroll: { flexGrow: 1 },
  hero: {
    flex: 1,
    minHeight: 260,
    justifyContent: "flex-end",
    paddingHorizontal: theme.space.xxl,
    paddingTop: 72,
    paddingBottom: theme.space.xxl,
    gap: theme.space.sm,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.lg,
    marginBottom: theme.space.sm,
  },
  registration: { flexDirection: "row", gap: 6 },
  regDot: { width: 10, height: 10, borderRadius: 5 },
  brand: { ...theme.type.display, color: theme.brand.onInk },
  tagline: { ...theme.type.body, color: theme.brand.onInkMuted, maxWidth: 300 },
  sheet: {
    backgroundColor: theme.surface.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.space.xxl,
    paddingBottom: theme.space.xxl + theme.space.lg,
    gap: theme.space.lg,
  },
  title: { ...theme.type.title, color: theme.text.primary },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.tones.danger.bg,
    borderWidth: 1,
    borderColor: theme.tones.danger.border,
  },
  errorText: { ...theme.type.body, color: theme.tones.danger.fg, flex: 1 },
});
