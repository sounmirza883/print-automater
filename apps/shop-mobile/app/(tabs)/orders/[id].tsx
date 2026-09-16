import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import type { ShopOrderResponse, ShopRejectionReason } from "@print-automated/api-client";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";
import { usePrinters } from "@/lib/use-printers";

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

// §37/9.14: a job is "in flight" (accepted, waiting for an agent to
// pick it up, or actively printing) from SHOP_ACCEPTED through
// PRINTING -- this screen polls only across that window, the same 5s
// cadence 8.5's dashboard already established, so staff watching an
// active print see it move to PRINTED without a manual refresh.
const IN_FLIGHT_STATUSES = new Set(["SHOP_ACCEPTED", "QUEUED_FOR_PRINT", "PRINTING"]);
const PRINTING_POLL_MS = 5_000;

// §37's own line: "page progress where the driver actually reports it
// -- otherwise the literal text 'Printing…', never a fabricated
// percentage." No page-by-page progress is reported to the backend
// anywhere in this pipeline (9.12 only reports the final PRINTING/
// PRINTED/FAILED/UNKNOWN verdict, not intermediate page counts) --
// so every in-flight state honestly renders as plain-language waiting
// text, never a number this screen has no real basis for.
const IN_FLIGHT_LABELS: Record<string, string> = {
  SHOP_ACCEPTED: "Preparing to print…",
  QUEUED_FOR_PRINT: "Waiting for the printer…",
  PRINTING: "Printing…",
};

/** §34's detail screen, §35's unmistakable payment banner, and §36's
 * accept/reject (plus 8.3's ready/complete, which have no separate
 * PRD section of their own but are the same "one action, one state
 * transition" shape). */
export default function OrderDetailScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { apiClient, shopId } = useShopAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [showRejectPicker, setShowRejectPicker] = useState(false);
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const printers = usePrinters(apiClient, shopId);

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

  const orderStatus = state.phase === "ready" ? state.order.orderStatus : null;

  useEffect(() => {
    if (orderStatus === null || !IN_FLIGHT_STATUSES.has(orderStatus)) {
      return;
    }
    const intervalId = setInterval(() => {
      apiClient.shopOrders
        .get(id)
        .then((order) => setState({ phase: "ready", order }))
        .catch(() => {
          // A single missed poll isn't worth surfacing as an error --
          // the next tick tries again, same as 8.5's dashboard.
        });
    }, PRINTING_POLL_MS);
    return () => clearInterval(intervalId);
  }, [apiClient, id, orderStatus]);

  async function runAction(action: () => Promise<ShopOrderResponse>): Promise<void> {
    setActionError(null);
    setActionInFlight(true);
    try {
      const order = await action();
      setState({ phase: "ready", order });
      setShowRejectPicker(false);
      setShowPrinterPicker(false);
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

  // §49/10.4: only PRINT_FAILED offers "Change Printer" -- it fires
  // RETRY_PRINT, which the state machine only accepts from PRINT_FAILED
  // (see order-state-machine.ts). PRINT_STATUS_UNKNOWN has no legal
  // RETRY_PRINT transition, so staff there use "It Failed" first
  // (RESOLVE_UNKNOWN_FAILED -> PRINT_FAILED), then Change Printer.
  function renderPrinterPicker(): ReactNode {
    if (!showPrinterPicker) {
      return null;
    }
    return (
      <View style={styles.printerPicker}>
        <Text style={styles.detailLabel}>Choose a printer</Text>
        {printers.phase === "loading" && <ActivityIndicator />}
        {printers.phase === "ready" && printers.printers.length === 0 && (
          <Text style={styles.printingPrinterText}>No printers registered at this shop.</Text>
        )}
        {printers.phase === "ready" &&
          printers.printers.map((printer) => (
            <Pressable
              key={printer.id}
              accessibilityRole="button"
              disabled={actionInFlight}
              onPress={() =>
                void runAction(() => apiClient.shopOrders.changePrinter(order.id, printer.id))
              }
              style={[styles.secondaryButton, actionInFlight && styles.buttonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>{printer.name}</Text>
            </Pressable>
          ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowPrinterPicker(false)}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

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

      {IN_FLIGHT_STATUSES.has(order.orderStatus) && (
        <View style={styles.printingCard}>
          <View style={styles.printingRow}>
            <ActivityIndicator size="small" color={tokens.colors.primaryAction} />
            <Text style={styles.printingStatusText}>
              {IN_FLIGHT_LABELS[order.orderStatus] ?? "Printing…"}
            </Text>
          </View>
          <Text style={styles.printingPrinterText}>
            {order.printerName ? `Printer: ${order.printerName}` : "Printer: assigning…"}
          </Text>
        </View>
      )}

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

      {order.orderStatus === "PRINT_FAILED" && (
        <View style={styles.actions}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            Printing failed. Choose how to proceed.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() => void runAction(() => apiClient.shopOrders.retryPrint(order.id))}
            style={[styles.primaryButton, actionInFlight && styles.buttonDisabled]}
          >
            {actionInFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Retry Print</Text>
            )}
          </Pressable>
          {!showPrinterPicker && (
            <Pressable
              accessibilityRole="button"
              disabled={actionInFlight}
              onPress={() => setShowPrinterPicker(true)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Change Printer</Text>
            </Pressable>
          )}
          {renderPrinterPicker()}
        </View>
      )}

      {/* §47/10.3: PRINT_STATUS_UNKNOWN is its own resolution card, not
          an error toast -- staff physically checks the printer, then
          tells the system what actually happened. */}
      {order.orderStatus === "PRINT_STATUS_UNKNOWN" && (
        <View style={styles.actions}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            We lost contact with the printer mid-job. Check the printer, then confirm what happened.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() =>
              void runAction(() =>
                apiClient.shopOrders.resolveUnknown(order.id, "CONFIRMED_PRINTED"),
              )
            }
            style={[styles.primaryButton, actionInFlight && styles.buttonDisabled]}
          >
            {actionInFlight ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>It Printed Successfully</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() =>
              void runAction(() => apiClient.shopOrders.resolveUnknown(order.id, "RETRY"))
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Retry Printing</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={actionInFlight}
            onPress={() =>
              void runAction(() => apiClient.shopOrders.resolveUnknown(order.id, "MARK_FAILED"))
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>It Failed</Text>
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
  printingCard: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 16,
    gap: 6,
  },
  printingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  printingStatusText: { fontWeight: "700", fontSize: 15 },
  printingPrinterText: { color: "#6B7280" },
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
  printerPicker: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 12,
    gap: 8,
  },
  cancelButton: { paddingVertical: 10, alignItems: "center" },
  cancelButtonText: { color: "#6B7280" },
  backLink: { marginTop: 16, alignItems: "center" },
  backLinkText: { color: tokens.colors.primaryAction, fontWeight: "600" },
});
