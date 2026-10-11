import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "@print-automated/design-tokens";
import {
  availableOrderActions,
  humanizeEnum,
  priorityLabel,
  shouldSteerToReprint,
  type ShopOrderResponse,
} from "@print-automated/api-client";
import { JobPanel, type JobActionKind, type RunAction } from "@/components/job-panel";
import { OrderActions } from "@/components/order-actions";
import {
  Button,
  Card,
  MONO,
  MUTED,
  Pill,
  SectionTitle,
  StateView,
  TONES,
  type IconName,
} from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { formatOrderTotal, summarizeConfiguration } from "@/lib/format";
import { errorMessage } from "@/lib/job-actions";
import { usePrinters } from "@/lib/use-printers";
import { inFlightLabel, isInFlight, qrAwaitingPaymentBadge } from "@/lib/order-status";
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
 * shop-web uses (23.30) and the person's role (23.32). Laid out as a summary (number, total,
 * status), the payment state, grouped details and jobs, with the order's own actions pinned
 * in a footer so the next step is always under the thumb. */
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
    return <StateView kind="loading" title="Loading order" />;
  }

  if (state.phase === "error") {
    return (
      <StateView
        kind="error"
        title="Couldn't load this order"
        message={state.message}
        action={<Button label="Back to orders" icon="arrow-back" onPress={() => router.back()} />}
      />
    );
  }

  const { order } = state;
  const paid = order.paymentStatus === "PAID";
  const priority = order.priority ?? 0;
  const qrAwaitingPayment = qrAwaitingPaymentBadge(order);
  const payment = paid ? TONES.good : TONES.caution;
  const hasActions =
    Object.values(availableOrderActions(order, can)).some(Boolean) || shouldSteerToReprint(order);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroLabel}>Order</Text>
              <Text accessibilityRole="header" style={styles.orderNumber}>
                {order.publicOrderNumber}
              </Text>
            </View>
            <Pill badge={{ label: humanizeEnum(order.orderStatus), tone: "accent" }} />
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroTotal}>
            <Text style={styles.heroLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatOrderTotal(order)}</Text>
          </View>
          {(priority > 0 || qrAwaitingPayment !== null) && (
            <View style={styles.heroPills}>
              {priority > 0 && (
                <Pill
                  badge={{
                    label: `${priorityLabel(priority)} priority`,
                    tone: priority >= 20 ? "danger" : "caution",
                  }}
                />
              )}
              {qrAwaitingPayment !== null && <Pill badge={qrAwaitingPayment} />}
            </View>
          )}
        </View>

        <View
          accessibilityRole="summary"
          style={[
            styles.paymentBanner,
            { backgroundColor: payment.bg, borderColor: payment.border },
          ]}
        >
          <Ionicons name={paid ? "checkmark-circle" : "time"} size={28} color={payment.solid} />
          <View style={styles.paymentCopy}>
            <Text style={[styles.paymentBannerText, { color: payment.fg }]}>
              {paid ? "Payment verified" : "Payment pending"}
            </Text>
            <Text style={[styles.paymentBannerSub, { color: payment.fg }]}>
              {paid ? `${formatOrderTotal(order)} received` : "Collect payment before printing."}
            </Text>
          </View>
        </View>

        {isOffline && (
          <View
            style={[
              styles.notice,
              { backgroundColor: TONES.caution.bg, borderColor: TONES.caution.border },
            ]}
          >
            <Ionicons name="cloud-offline" size={20} color={TONES.caution.solid} />
            <Text style={[styles.noticeText, { color: TONES.caution.fg }]}>
              You are offline. Actions are paused until the connection is back.
            </Text>
          </View>
        )}

        {isInFlight(order.orderStatus) && (
          <Card edge={theme.brand.accent}>
            <View style={styles.printingRow}>
              {/* Nothing is moving while paused: no spinner then. */}
              {order.orderStatus !== "PAUSED" && (
                <ActivityIndicator size="small" color={theme.brand.accent} />
              )}
              <Text style={styles.printingStatusText}>
                {inFlightLabel(order.orderStatus) ?? "Printing…"}
              </Text>
            </View>
            <Text style={styles.muted}>
              {order.printerName ? `Printer: ${order.printerName}` : "Printer: assigning…"}
            </Text>
          </Card>
        )}

        {order.orderStatus === "PRINT_STATUS_UNKNOWN" && (
          <View
            style={[
              styles.notice,
              { backgroundColor: TONES.danger.bg, borderColor: TONES.danger.border },
            ]}
          >
            <Ionicons name="warning" size={20} color={TONES.danger.solid} />
            <Text accessibilityRole="alert" style={[styles.noticeText, { color: TONES.danger.fg }]}>
              We lost track of a print. Check the printer, then resolve the job below.
            </Text>
          </View>
        )}

        <SectionTitle title="Details" />
        <View style={styles.group}>
          <Row icon="person-outline" label="Customer" value={order.customerName} />
          <Row icon="document-text-outline" label="Document" value={order.documentFilename} />
          <Row
            icon="options-outline"
            label="Configuration"
            value={summarizeConfiguration(order.printConfiguration)}
            last
          />
        </View>

        {actionError !== null && (
          <View accessibilityRole="alert" style={[styles.notice, styles.errorNotice]}>
            <Ionicons name="alert-circle" size={20} color={TONES.danger.solid} />
            <Text style={[styles.noticeText, { color: TONES.danger.fg }]}>{actionError}</Text>
          </View>
        )}

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
      </ScrollView>

      {hasActions && (
        <View style={styles.footer}>
          <ScrollView
            style={styles.footerScroll}
            contentContainerStyle={styles.footerContent}
            keyboardShouldPersistTaps="handled"
          >
            <OrderActions
              order={order}
              can={can}
              apiClient={apiClient}
              run={run}
              busy={busy}
              offline={isOffline}
              printers={printers}
            />
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  last = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  last?: boolean;
}): ReactNode {
  return (
    <View style={[styles.detailRow, !last && styles.detailRowDivider]}>
      <Ionicons name={icon} size={20} color={theme.text.muted} />
      <View style={styles.detailCopy}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.background },
  scroll: { flex: 1 },
  container: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  muted: { ...theme.type.body, color: MUTED },
  hero: {
    backgroundColor: theme.surface.inverse,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
    gap: theme.space.md,
    ...theme.shadow.card,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.space.md,
  },
  heroCopy: { flexShrink: 1, gap: 2 },
  heroDivider: { height: 1, backgroundColor: theme.palette.ink[700] },
  heroTotal: { gap: 2 },
  heroLabel: { ...theme.type.overline, color: theme.brand.onInkMuted, textTransform: "uppercase" },
  orderNumber: {
    fontFamily: MONO,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: theme.brand.onInk,
  },
  totalValue: {
    fontFamily: MONO,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "700",
    color: theme.brand.onInk,
  },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  paymentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
  },
  paymentCopy: { flex: 1 },
  paymentBannerText: { ...theme.type.heading, fontWeight: "800" },
  paymentBannerSub: { ...theme.type.caption },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorNotice: { backgroundColor: theme.tones.danger.bg, borderColor: theme.tones.danger.border },
  noticeText: { ...theme.type.body, flex: 1 },
  printingRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  printingStatusText: { ...theme.type.heading, color: theme.text.primary },
  group: {
    backgroundColor: theme.surface.card,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space.lg,
    ...theme.shadow.card,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    paddingVertical: theme.space.md,
  },
  detailRowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.default },
  detailCopy: { flex: 1, gap: 2 },
  detailLabel: { ...theme.type.caption, color: theme.text.muted },
  detailValue: { ...theme.type.bodyStrong, color: theme.text.primary },
  footer: {
    backgroundColor: theme.surface.card,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: "60%",
    borderTopWidth: 1,
    borderTopColor: theme.border.default,
    ...theme.shadow.raised,
  },
  footerScroll: { flexGrow: 0 },
  footerContent: { padding: theme.space.lg, paddingBottom: theme.space.xl },
});
