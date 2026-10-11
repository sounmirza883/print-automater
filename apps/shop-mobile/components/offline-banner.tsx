import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "@print-automated/design-tokens";
import { useIsOffline } from "@/lib/use-is-offline";

export function OfflineBanner(): ReactNode {
  const isOffline = useIsOffline();
  if (!isOffline) {
    return null;
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.banner} accessibilityRole="alert">
        <Ionicons name="cloud-offline" size={18} color={theme.tones.caution.fg} />
        <Text style={styles.text}>You&apos;re offline. Some actions may not work right now.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.tones.caution.bg },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.tones.caution.border,
  },
  text: { ...theme.type.caption, color: theme.tones.caution.fg, fontWeight: "700", flexShrink: 1 },
});
