import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import {
  describeBlockedReason,
  isHeldByLatePrint,
  priorityLabel,
  type ShopOrderResponse,
} from "@print-automated/api-client";
import { Pills } from "@/components/ui";
import type { Badge } from "@/lib/job-view";
import { qrAwaitingPaymentBadge } from "@/lib/order-status";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useShopOrders } from "@/lib/use-shop-orders";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";

interface Section {
  title: string;
  data: ShopOrderResponse[];
}

/** §32's sectioned list. Empty groups are omitted rather than shown
 * with a "(0)" count -- a counter employee scanning for actionable
 * work has no use for five always-visible empty headers. */
export default function OrdersScreen(): ReactNode {
  const { shopId, apiClient } = useShopAuth();
  const orders = useShopOrders(apiClient, shopId);

  if (shopId === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>You aren&apos;t registered as staff at any shop yet.</Text>
      </View>
    );
  }

  if (orders.phase === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (orders.phase === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          {orders.message}
        </Text>
      </View>
    );
  }

  const sections: Section[] = [
    { title: "Needs Attention", data: orders.data.needsAttention },
    { title: "Printing", data: orders.data.printing },
    { title: "Ready", data: orders.data.ready },
    { title: "Completed", data: orders.data.completed },
    { title: "Failed", data: orders.data.failed },
  ].filter((section) => section.data.length > 0);

  if (sections.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>No orders yet.</Text>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      sections={sections}
      keyExtractor={(order) => order.id}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeader}>
          {section.title} ({section.data.length})
        </Text>
      )}
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

/** 23.34: what a counter or floor person should notice on the card without opening it. */
function orderBadges(order: ShopOrderResponse): Badge[] {
  const badges: Badge[] = [];
  const qr = qrAwaitingPaymentBadge(order);
  if (qr !== null) badges.push(qr);
  const priority = order.priority ?? 0;
  if (priority > 0) {
    badges.push({
      label: `${priorityLabel(priority)} priority`,
      tone: priority >= 20 ? "danger" : "caution",
    });
  }
  if (order.printJobs.some((job) => isHeldByLatePrint(job.blockedReason))) {
    badges.push({ label: "Held by late print", tone: "danger" });
  } else {
    const blocked = order.printJobs.find((job) => job.blockedReason !== null);
    const view = blocked !== undefined ? describeBlockedReason(blocked.blockedReason) : null;
    if (view !== null) badges.push({ label: view.label, tone: view.tone });
  }
  return badges;
}

/** §33's order card. */
function OrderCard({ order }: { order: ShopOrderResponse }): ReactNode {
  const router = useRouter();
  const paid = order.paymentStatus === "PAID";
  const badges = orderBadges(order);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/orders/${order.id}`)}
      style={styles.card}
    >
      <View style={styles.cardHeaderRow}>
        <Text style={styles.orderNumber}>{order.publicOrderNumber}</Text>
        <Text style={styles.total}>{formatOrderTotal(order)}</Text>
      </View>
      {badges.length > 0 && <Pills badges={badges} />}
      <Text style={styles.summary}>{summarizeConfiguration(order.printConfiguration)}</Text>
      <View style={styles.cardFooterRow}>
        <Text style={[styles.paymentBadge, paid ? styles.paymentPaid : styles.paymentPending]}>
          {paid ? "Payment ✓ Verified" : "Payment Pending"}
        </Text>
        <Text style={styles.reviewLink}>Review</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  subtitle: { color: "#6B7280" },
  errorText: { color: tokens.colors.error },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 8 },
  sectionHeader: {
    fontWeight: "700",
    fontSize: 14,
    marginTop: 12,
    marginBottom: 6,
    color: "#374151",
  },
  card: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 14,
    gap: 6,
    marginBottom: 8,
  },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between" },
  orderNumber: { fontWeight: "700" },
  total: { fontWeight: "700" },
  summary: { color: "#6B7280" },
  cardFooterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  paymentBadge: { fontWeight: "600", fontSize: 13 },
  paymentPaid: { color: tokens.colors.success },
  paymentPending: { color: tokens.colors.warning },
  reviewLink: { color: tokens.colors.primaryAction, fontWeight: "600" },
});
