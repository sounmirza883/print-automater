import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import type { ShopOrderResponse, ShopRejectionReason } from "@print-automated/api-client";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; order: ShopOrderResponse }
  | { phase: "error"; message: string };

const REJECTION_REASONS: { value: ShopRejectionReason; label: string }[] = [
  { value: "PRINTER_UNAVAILABLE", label: "Printer unavailable" },
  { value: "CAPABILITY_UNAVAILABLE", label: "Requested capability unavailable" },
  { value: "SHOP_UNAVAILABLE", label: "Shop temporarily unavailable" },
  { value: "DOCUMENT_ISSUE", label: "Document issue" },
];

/** §34's detail screen, §35's unmistakable payment banner, and §36's
 * accept/reject (plus 8.3's ready/complete, which have no separate
 * PRD section of their own but are the same "one action, one state
 * transition" shape). */
export default function OrderDetailScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { apiClient } = useShopAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [showRejectPicker, setShowRejectPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const order = await apiClient.shopOrders.get(id);
        if (!cancelled) {
          setState({ phase: "ready", order });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load this order.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiClient, id]);

  async function runAction(action: () => Promise<ShopOrderResponse>): Promise<void> {
    setActionError(null);
    setActionInFlight(true);
    try {
      const order = await action();
      setState({ phase: "ready", order });
      setShowRejectPicker(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That action failed.");
    } finally {
      setActionInFlight(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.phase === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { order } = state;
  const paid = order.paymentStatus === "PAID";

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.orderNumber}>{order.publicOrderNumber}</Text>

      <View
        style={[
          styles.paymentBanner,
          paid ? styles.paymentBannerPaid : styles.paymentBannerPending,
        ]}
      >
        <Text style={styles.paymentBannerText}>
          {paid ? "PAYMENT VERIFIED" : "PAYMENT PENDING"}
        </Text>
        {paid && <Text style={styles.paymentBannerAmount}>✓ {formatOrderTotal(order)}</Text>}
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Customer</Text>
        <Text style={styles.detailValue}>{order.customerName}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Document</Text>
        <Text style={styles.detailValue}>{order.documentFilename}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Configuration</Text>
        <Text style={styles.detailValue}>{summarizeConfiguration(order.printConfiguration)}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Total</Text>
        <Text style={styles.detailValue}>{formatOrderTotal(order)}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Status</Text>
        <Text style={styles.detailValue}>{order.orderStatus}</Text>
      </View>

      {actionError !== null && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {actionError}
        </Text>
      )}

      {order.orderStatus === "WAITING_FOR_SHOP" && !showRejectPicker && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={!paid || actionInFlight}
            onPress={() => void runAction(() => apiClient.shopOrders.accept(order.id))}
            style={[styles.primaryButton, (!paid || actionInFlight) && styles.buttonDisabled]}
          >
            {actionInFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Accept & Print</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() => setShowRejectPicker(true)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Reject Order</Text>
          </Pressable>
        </View>
      )}

      {order.orderStatus === "WAITING_FOR_SHOP" && showRejectPicker && (
        <View style={styles.actions}>
          <Text style={styles.detailLabel}>Reason for rejecting</Text>
          {REJECTION_REASONS.map((reason) => (
            <Pressable
              key={reason.value}
              accessibilityRole="button"
              disabled={actionInFlight}
              onPress={() =>
                void runAction(() => apiClient.shopOrders.reject(order.id, reason.value))
              }
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{reason.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowRejectPicker(false)}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {order.orderStatus === "PRINTED" && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() => void runAction(() => apiClient.shopOrders.markReady(order.id))}
            style={[styles.primaryButton, actionInFlight && styles.buttonDisabled]}
          >
            {actionInFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Mark Ready for Collection</Text>
            )}
          </Pressable>
        </View>
      )}

      {order.orderStatus === "READY_FOR_COLLECTION" && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() => void runAction(() => apiClient.shopOrders.complete(order.id))}
            style={[styles.primaryButton, actionInFlight && styles.buttonDisabled]}
          >
            {actionInFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Complete</Text>
            )}
          </Pressable>
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backLink}>
        <Text style={styles.backLinkText}>Back to orders</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 24, gap: 12 },
  errorText: { color: tokens.colors.error },
  orderNumber: { fontSize: 20, fontWeight: "700" },
  paymentBanner: { borderRadius: tokens.radius.md, padding: 16, gap: 4 },
  paymentBannerPaid: { backgroundColor: "#DCFCE7" },
  paymentBannerPending: { backgroundColor: "#FEF3C7" },
  paymentBannerText: { fontWeight: "800", fontSize: 16 },
  paymentBannerAmount: { fontWeight: "700" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailLabel: { color: "#6B7280" },
  detailValue: { fontWeight: "600", flexShrink: 1, textAlign: "right" },
  actions: { gap: 10, marginTop: 12 },
  primaryButton: {
    backgroundColor: tokens.colors.primaryAction,
    borderRadius: tokens.radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: { fontWeight: "600" },
  cancelButton: { paddingVertical: 10, alignItems: "center" },
  cancelButtonText: { color: "#6B7280" },
  backLink: { marginTop: 16, alignItems: "center" },
  backLinkText: { color: tokens.colors.primaryAction, fontWeight: "600" },
});
