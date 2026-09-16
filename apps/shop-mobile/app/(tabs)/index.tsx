import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { tokens } from "@print-automated/design-tokens";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useShopOrders } from "@/lib/use-shop-orders";
import { usePrinters } from "@/lib/use-printers";

/** §31's Shop Home: pending/printing/ready/failure counts, and whether
 * any printer is online -- answered at a glance, polled every 5s
 * (8.5's own Done-when). */
export default function HomeScreen(): ReactNode {
  const { user, shopId, shopName, apiClient } = useShopAuth();
  const orders = useShopOrders(apiClient, shopId);
  const printers = usePrinters(apiClient, shopId);

  if (shopId === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{user !== null ? `Welcome, ${user.name}` : "Welcome"}</Text>
        <Text style={styles.subtitle}>You aren&apos;t registered as staff at any shop yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{shopName ?? "Your shop"}</Text>

      {orders.phase === "loading" && <ActivityIndicator />}
      {orders.phase === "error" && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {orders.message}
        </Text>
      )}
      {orders.phase === "ready" && (
        <View style={styles.countsRow}>
          <CountCard label="Needs attention" value={orders.data.needsAttention.length} />
          <CountCard label="Printing" value={orders.data.printing.length} />
          <CountCard label="Ready" value={orders.data.ready.length} />
          <CountCard
            label="Failed"
            value={orders.data.failed.length}
            tone={orders.data.failed.length > 0 ? "error" : undefined}
          />
        </View>
      )}

      <View style={styles.printerSection}>
        <Text style={styles.sectionLabel}>Printers</Text>
        {printers.phase === "loading" && <ActivityIndicator />}
        {printers.phase === "error" && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {printers.message}
          </Text>
        )}
        {printers.phase === "ready" && <PrinterSummary printers={printers.printers} />}
      </View>
    </View>
  );
}

function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "error";
}): ReactNode {
  return (
    <View style={styles.countCard}>
      <Text style={[styles.countValue, tone === "error" && value > 0 && styles.countValueError]}>
        {value}
      </Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function PrinterSummary({ printers }: { printers: { status: string }[] }): ReactNode {
  if (printers.length === 0) {
    return <Text style={styles.subtitle}>No printers registered yet.</Text>;
  }
  const onlineCount = printers.filter((p) => p.status === "ONLINE").length;
  const anyOnline = onlineCount > 0;
  return (
    <View style={styles.printerRow}>
      <View
        style={[
          styles.statusDot,
          { backgroundColor: anyOnline ? tokens.colors.success : tokens.colors.neutral },
        ]}
      />
      <Text style={styles.subtitle}>
        {onlineCount} of {printers.length} online
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 20 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#6B7280" },
  errorText: { color: tokens.colors.error },
  countsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  countCard: {
    minWidth: 120,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 16,
    gap: 4,
  },
  countValue: { fontSize: 28, fontWeight: "700" },
  countValueError: { color: tokens.colors.error },
  countLabel: { color: "#6B7280" },
  printerSection: { gap: 8 },
  sectionLabel: { fontWeight: "600" },
  printerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
