import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useShopAuth } from "@/providers/shop-auth-provider";

/** §31's pending/printing/ready counts land here in Phase 8, once
 * there are real orders to count. */
export default function HomeScreen(): ReactNode {
  const { user } = useShopAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{user !== null ? `Welcome, ${user.name}` : "Welcome"}</Text>
      <Text style={styles.subtitle}>
        Pending, printing, and ready order counts land here in a later phase.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#6B7280" },
});
