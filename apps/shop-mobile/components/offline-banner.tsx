import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIsOffline } from "@/lib/use-is-offline";

export function OfflineBanner(): ReactNode {
  const isOffline = useIsOffline();
  if (!isOffline) {
    return null;
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>You&apos;re offline. Some actions may not work right now.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#DC2626",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "600",
  },
});
