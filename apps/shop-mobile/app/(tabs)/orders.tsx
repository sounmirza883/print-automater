import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

/** §32's sectioned order list (Needs Attention / Printing / Ready /
 * Completed / Failed) lands here in Phase 8, once `GET /shop/orders`
 * exists to populate it. */
export default function OrdersScreen(): ReactNode {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Orders</Text>
      <Text style={styles.subtitle}>Orders assigned to your shop will appear here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#6B7280" },
});
