import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import { humanizeEnum, priorityLabel, type ShopOrderResponse } from "@print-automated/api-client";
import { JobPanel, type JobActionKind, type RunAction } from "@/components/job-panel";
import { OrderActions } from "@/components/order-actions";
import { MUTED, Pill, SectionTitle, TONES } from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";
import { errorMessage } from "@/lib/job-actions";
import { usePrinters } from "@/lib/use-printers";
import { inFlightLabel, isInFlight } from "@/lib/order-status";
import { useIsOffline } from "@/lib/use-is-offline";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; order: ShopOrderResponse }
  | { phase: "error"; message: string };

// In-flight polling + labels live in lib/order-status.ts (exhaustive
// over OrderStatus). Same 5s cadence 8.5's dashboard established.
const PRINTING_POLL_MS = 5_000;

function isOrderResponse(value: unknown): value is ShopOrderResponse {
  return (
    typeof value === "object" && value !== null && "orderStatus" in value && "printJobs" in value
  );
}

/** §34's detail screen and §35's unmistakable payment banner, rebuilt in 23.34 for orders of
 * several jobs: the order's own actions and every live job with its own, all from the rules
 * shop-web uses (23.30) and the person's role (23.32). */
export default function OrderDetailScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { apiClient, shopId, can } = useShopAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openJob, setOpenJob] = useState<{ jobId: string; kind: JobActionKind } | null>(null);
  const printers = usePrinters(apiClient, shopId);
  // §89/§90/10.7: both effects below skip entirely while offline (no wasted requests,
  // last-known state kept) and re-run the moment the connection returns; every action is
  // disabled meanwhile (§90's "blocks duplicate operations").
  const isOffline = useIsOffline();

  useEffect(() => {
    if (isOffline) {
      return;
    }
    let cancelled = false;
    apiClient.shopOrders
      .get(id)
      .then((order) => !cancelled && setState({ phase: "ready", order }))
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ phase: "error", message: errorMessage(error, "Could not load this order.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, id, isOffline]);

  const orderStatus = state.phase === "ready" ? state.order.orderStatus : null;

  useEffect(() => {
    if (isOffline || orderStatus === null || !isInFlight(orderStatus)) {
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
  }, [apiClient, id, orderStatus, isOffline]);

  /** Runs one action. Order actions answer with the order; job actions answer with the job,
   * so the order is fetched again. `onError` may take over a refusal (the late-print one). */
  const run: RunAction = async (action, onError) => {
    setActionError(null);
    setBusy(true);
    try {
      const result = await action();
      setOpenJob(null);
      if (isOrderResponse(result)) {
        setState({ phase: "ready", order: result });
      } else {
        const fresh = await apiClient.shopOrders.get(id).catch(() => null);
        if (fresh !== null) setState({ phase: "ready", order: fresh });
      }
      return true;
    } catch (error) {
      if (!(onError?.(error) ?? false)) {
        setActionError(errorMessage(error));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

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
  const priority = order.priority ?? 0;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.orderNumber}>{order.publicOrderNumber}</Text>
        {priority > 0 && (
          <Pill
            badge={{
              label: `${priorityLabel(priority)} priority`,
              tone: priority >= 20 ? "danger" : "caution",
            }}
          />
        )}
      </View>

      {isOffline && (
        <View
          style={[
            styles.notice,
            { backgroundColor: TONES.caution.bg, borderColor: TONES.caution.border },
          ]}
        >
          <Text style={{ color: TONES.caution.fg }}>
            You are offline. Actions are paused until the connection is back.
          </Text>
        </View>
      )}

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

      {isInFlight(order.orderStatus) && (
        <View style={styles.printingCard}>
          <View style={styles.printingRow}>
            {/* Nothing is moving while paused: no spinner then. */}
            {order.orderStatus !== "PAUSED" && (
              <ActivityIndicator size="small" color={tokens.colors.primaryAction} />
            )}
            <Text style={styles.printingStatusText}>
              {inFlightLabel(order.orderStatus) ?? "Printing…"}
            </Text>
          </View>
          <Text style={styles.muted}>
            {order.printerName ? `Printer: ${order.printerName}` : "Printer: assigning…"}
          </Text>
        </View>
      )}

      {order.orderStatus === "PRINT_STATUS_UNKNOWN" && (
        <View
          style={[
            styles.notice,
            { backgroundColor: TONES.danger.bg, borderColor: TONES.danger.border },
          ]}
        >
          <Text accessibilityRole="alert" style={{ color: TONES.danger.fg }}>
            We lost track of a print. Check the printer, then resolve the job below.
          </Text>
        </View>
      )}

      <Row label="Customer" value={order.customerName} />
      <Row label="Document" value={order.documentFilename} />
      <Row label="Configuration" value={summarizeConfiguration(order.printConfiguration)} />
      <Row label="Total" value={formatOrderTotal(order)} />
      <Row label="Status" value={humanizeEnum(order.orderStatus)} />

      {actionError !== null && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {actionError}
        </Text>
      )}

      <OrderActions
        order={order}
        can={can}
        apiClient={apiClient}
        run={run}
        busy={busy}
        offline={isOffline}
        printers={printers}
      />

      <SectionTitle title="Print jobs" count={order.printJobs.length} />
      {order.printJobs.length === 0 ? (
        <Text style={styles.muted}>Jobs are created when the order is accepted.</Text>
      ) : (
        order.printJobs.map((job) => (
          <JobPanel
            key={job.id}
            job={job}
            order={order}
            can={can}
            shopId={shopId ?? ""}
            apiClient={apiClient}
            open={openJob?.jobId === job.id ? openJob.kind : null}
            onOpen={(kind) => {
              setActionError(null);
              setOpenJob(kind === null ? null : { jobId: job.id, kind });
            }}
            run={run}
            busy={busy}
            offline={isOffline}
            printers={printers}
          />
        ))
      )}

      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backLink}>
        <Text style={styles.backLinkText}>Back to orders</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 20, gap: 12 },
  errorText: { color: tokens.colors.error },
  muted: { color: MUTED },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  orderNumber: { fontSize: 20, fontWeight: "700" },
  notice: { borderWidth: 1, borderRadius: tokens.radius.md, padding: 12 },
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
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailValue: { fontWeight: "600", flexShrink: 1, textAlign: "right" },
  backLink: { marginTop: 16, alignItems: "center" },
  backLinkText: { color: tokens.colors.primaryAction, fontWeight: "600" },
});
