import type { ReactNode } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@print-automated/design-tokens";
import {
  describeBlockedReason,
  isHeldByLatePrint,
  priorityLabel,
  type ShopOrderResponse,
  type Tone,
} from "@print-automated/api-client";
import {
  Button,
  Card,
  MONO,
  PressableScale,
  Pills,
  ScreenHeader,
  StateView,
  TONES,
} from "@/components/ui";
import type { Badge } from "@/lib/job-view";
import { qrAwaitingPaymentBadge } from "@/lib/order-status";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useShopOrders } from "@/lib/use-shop-orders";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";

interface Section {
  title: string;
  tone: Tone;
  data: ShopOrderResponse[];
}

/** §32's sectioned list. Empty groups are omitted rather than shown
 * with a "(0)" count -- a counter employee scanning for actionable
 * work has no use for five always-visible empty headers. The list
 * already refreshes itself every 5s (useShopOrders), so there is no
 * pull-to-refresh: the hook exposes no reload to wire one to. */
function OrdersBody(): ReactNode {
  const router = useRouter();
  const { shopId, apiClient } = useShopAuth();
  const orders = useShopOrders(apiClient, shopId);

  if (shopId === null) {
    return (
      <StateView
        kind="empty"
        icon="storefront-outline"
        title="No business yet"
        message="This account isn't registered as staff at any business, so there are no orders to show."
      />
    );
  }

  if (orders.phase === "loading") {
    return <StateView kind="loading" title="Loading orders" />;
  }

  if (orders.phase === "error") {
    return <StateView kind="error" title="Couldn't load orders" message={orders.message} />;
  }

  const sections: Section[] = (
    [
      { title: "Needs Attention", tone: "caution", data: orders.data.needsAttention },
      { title: "Printing", tone: "accent", data: orders.data.printing },
      { title: "Ready", tone: "good", data: orders.data.ready },
      { title: "Completed", tone: "neutral", data: orders.data.completed },
      { title: "Failed", tone: "danger", data: orders.data.failed },
    ] satisfies Section[]
  ).filter((section) => section.data.length > 0);

  if (sections.length === 0) {
    return (
      <StateView
        kind="empty"
        icon="receipt-outline"
        title="No orders yet"
        message="New orders show up here as customers place them. If someone is at the counter, scan their QR code."
        action={
          <Button
            label="Scan order"
            variant="primary"
            icon="qr-code-outline"
            onPress={() => router.push("/orders/scan")}
          />
        }
      />
    );
  }

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      sections={sections}
      stickySectionHeadersEnabled
      keyExtractor={(order) => order.id}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: TONES[section.tone].solid }]} />
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {section.title}
          </Text>
          <View style={[styles.sectionCount, { backgroundColor: TONES[section.tone].bg }]}>
            <Text style={[styles.sectionCountText, { color: TONES[section.tone].fg }]}>
              {section.data.length}
            </Text>
          </View>
        </View>
      )}
      renderItem={({ item, section }) => <OrderCard order={item} tone={section.tone} />}
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
function OrderCard({ order, tone }: { order: ShopOrderResponse; tone: Tone }): ReactNode {
  const router = useRouter();
  const paid = order.paymentStatus === "PAID";
  const badges = orderBadges(order);
  const payment = paid ? TONES.good : TONES.caution;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.publicOrderNumber}, ${formatOrderTotal(order)}, payment ${paid ? "verified" : "pending"}`}
      onPress={() => router.push(`/orders/${order.id}`)}
      scaleTo={0.985}
      style={styles.cardWrap}
    >
      <Card edge={TONES[tone].solid}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.orderNumber}>{order.publicOrderNumber}</Text>
          <Text style={styles.total}>{formatOrderTotal(order)}</Text>
        </View>
        {badges.length > 0 && <Pills badges={badges} />}
        <Text style={styles.summary}>{summarizeConfiguration(order.printConfiguration)}</Text>
        <View style={styles.cardFooterRow}>
          <View style={[styles.payment, { backgroundColor: payment.bg }]}>
            <Ionicons name={paid ? "checkmark-circle" : "time"} size={16} color={payment.solid} />
            <Text style={[styles.paymentText, { color: payment.fg }]}>
              {paid ? "Payment verified" : "Payment pending"}
            </Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLink}>Review</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.brand.accent} />
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.surface.background },
  list: { flex: 1 },
  listContent: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxl },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.sm,
    backgroundColor: theme.surface.background,
  },
  sectionDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { ...theme.type.overline, color: theme.text.secondary, textTransform: "uppercase" },
  sectionCount: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCountText: { ...theme.type.overline, letterSpacing: 0 },
  cardWrap: { marginBottom: theme.space.md },
  scanButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.brand.accent,
  },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderNumber: { ...theme.type.heading, fontFamily: MONO, fontSize: 16, color: theme.text.primary },
  total: { ...theme.type.heading, fontFamily: MONO, fontSize: 16, color: theme.text.primary },
  summary: { ...theme.type.caption, color: theme.text.muted },
  cardFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: theme.space.xs,
  },
  payment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
  },
  paymentText: { ...theme.type.caption, fontWeight: "700" },
  reviewRow: { flexDirection: "row", alignItems: "center", minHeight: 32, gap: 2 },
  reviewLink: { ...theme.type.bodyStrong, color: theme.brand.accent },
});

export default function OrdersScreen(): ReactNode {
  const router = useRouter();
  const { shopName } = useShopAuth();
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Orders"
        subtitle={shopName}
        right={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Scan order QR code"
            hitSlop={8}
            onPress={() => router.push("/orders/scan")}
            contentStyle={styles.scanButton}
          >
            <Ionicons name="qr-code-outline" size={22} color={theme.text.onColor} />
          </PressableScale>
        }
      />
      <OrdersBody />
    </View>
  );
}
