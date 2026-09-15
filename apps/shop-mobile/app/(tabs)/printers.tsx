import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

/** §38's printer status list (Online / Offline / Error, register/
 * rename/enable/disable/remove) lands here in Phase 8, once
 * `GET/POST/PATCH/DELETE /shop/printers` exist to back it. */
export default function PrintersScreen(): ReactNode {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Printers</Text>
      <Text style={styles.subtitle}>Your shop&apos;s registered printers will appear here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#6B7280" },
});
