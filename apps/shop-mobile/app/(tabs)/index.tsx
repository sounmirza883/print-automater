import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@print-automated/design-tokens";
import {
  BrandMark,
  Button,
  Card,
  FocusedStatusBar,
  MONO,
  PressableScale,
  Reveal,
  StateView,
  TONES,
  type IconName,
} from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { useShopOrders } from "@/lib/use-shop-orders";
import { usePrinters } from "@/lib/use-printers";

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** §31's Shop Home: pending/printing/ready/failure counts, and whether
 * any printer is online -- answered at a glance, polled every 5s
 * (8.5's own Done-when). */
export default function HomeScreen(): ReactNode {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, shopId, shopName, apiClient } = useShopAuth();
  const orders = useShopOrders(apiClient, shopId);
  const printers = usePrinters(apiClient, shopId);
  const firstName = user?.name.split(" ")[0] ?? null;

  if (shopId === null) {
    return (
      <View style={styles.root}>
        <FocusedStatusBar style="dark" />
        <StateView
          kind="empty"
          icon="storefront-outline"
          title={user !== null ? `Welcome, ${user.name}` : "Welcome"}
          message="This account isn't part of any business yet. Ask the business owner to invite you, then sign in again."
          action={
            <Button
              label="Open Settings"
              icon="settings-outline"
              onPress={() => router.push("/settings")}
            />
          }
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      bounces={false}
      showsVerticalScrollIndicator={false}
    >
      <FocusedStatusBar style="light" />
      <View style={[styles.hero, { paddingTop: insets.top + theme.space.lg }]}>
        <View style={styles.heroTop}>
          <BrandMark size={40} />
          <View style={styles.heroCopy}>
            <Text style={styles.greeting}>
              {greeting()}
              {firstName !== null ? `, ${firstName}` : ""}
            </Text>
            <Text accessibilityRole="header" numberOfLines={2} style={styles.shopName}>
              {shopName ?? "Your business"}
            </Text>
          </View>
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Scan order"
          accessibilityHint="Opens the camera to scan a customer's order QR code"
          onPress={() => router.push("/orders/scan")}
          scaleTo={0.98}
          contentStyle={styles.scan}
        >
          <View style={styles.scanIcon}>
            <Ionicons name="qr-code" size={28} color={theme.brand.accent} />
          </View>
          <View style={styles.scanText}>
            <Text style={styles.scanTitle}>Scan order</Text>
            <Text style={styles.scanSub}>Customer arrived? Scan their QR to open the order.</Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color={theme.text.onColor} />
        </PressableScale>
      </View>

      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Today at a glance
        </Text>
        {orders.phase === "loading" && (
          <View style={styles.loading}>
            <StateView kind="loading" />
          </View>
        )}
        {orders.phase === "error" && (
          <Card edge={TONES.danger.solid}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {orders.message}
            </Text>
          </Card>
        )}
        {orders.phase === "ready" && (
          <View style={styles.tiles}>
            <Reveal style={styles.tileCell}>
              <Tile
                label="Needs attention"
                icon="notifications"
                value={orders.data.needsAttention.length}
                tone="caution"
                onPress={() => router.push("/orders")}
              />
            </Reveal>
            <Reveal delay={50} style={styles.tileCell}>
              <Tile
                label="Printing"
                icon="print"
                value={orders.data.printing.length}
                tone="accent"
                onPress={() => router.push("/orders")}
              />
            </Reveal>
            <Reveal delay={100} style={styles.tileCell}>
              <Tile
                label="Ready"
                icon="checkmark-done"
                value={orders.data.ready.length}
                tone="good"
                onPress={() => router.push("/orders")}
              />
            </Reveal>
            <Reveal delay={150} style={styles.tileCell}>
              <Tile
                label="Failed"
                icon="alert-circle"
                value={orders.data.failed.length}
                tone="danger"
                onPress={() => router.push("/orders")}
              />
            </Reveal>
          </View>
        )}

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Printers
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Printers"
          onPress={() => router.push("/printers")}
          scaleTo={0.985}
        >
          <Card>
            {printers.phase === "loading" && <StateView kind="loading" />}
            {printers.phase === "error" && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {printers.message}
              </Text>
            )}
            {printers.phase === "ready" && <PrinterSummary printers={printers.printers} />}
          </Card>
        </PressableScale>
      </View>
    </ScrollView>
  );
}

function Tile({
  label,
  value,
  icon,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  icon: IconName;
  tone: "caution" | "accent" | "good" | "danger";
  onPress: () => void;
}): ReactNode {
  // Zero is calm grey; anything to do takes its status colour.
  const colour = value > 0 ? TONES[tone] : TONES.neutral;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      contentStyle={[styles.tile, { backgroundColor: colour.bg, borderColor: colour.border }]}
    >
      <View style={styles.tileTop}>
        <View style={styles.tileIcon}>
          <Ionicons name={icon} size={18} color={colour.solid} />
        </View>
        <Text style={[styles.tileValue, { color: colour.fg }]}>{value}</Text>
      </View>
      <Text style={[styles.tileLabel, { color: colour.fg }]}>{label}</Text>
    </PressableScale>
  );
}

function PrinterSummary({ printers }: { printers: { status: string }[] }): ReactNode {
  if (printers.length === 0) {
    return (
      <View style={styles.printerRow}>
        <View style={[styles.printerBadge, { backgroundColor: theme.surface.subtle }]}>
          <Ionicons name="print-outline" size={22} color={theme.text.muted} />
        </View>
        <Text style={styles.printerText}>No printers yet. Open Printers to pair a computer.</Text>
        <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
      </View>
    );
  }
  const onlineCount = printers.filter((p) => p.status === "ONLINE").length;
  const anyOnline = onlineCount > 0;
  const colour = anyOnline ? TONES.good : TONES.neutral;
  return (
    <View style={styles.printerRow}>
      <View style={[styles.printerBadge, { backgroundColor: colour.bg }]}>
        <Ionicons name="print" size={22} color={colour.solid} />
      </View>
      <View style={styles.printerCopy}>
        <Text style={styles.printerTitle}>
          {onlineCount} of {printers.length} online
        </Text>
        <Text style={styles.printerText}>
          {anyOnline ? "Ready to take jobs." : "Nothing can print until one comes online."}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.text.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.background },
  content: { paddingBottom: theme.space.xxl },
  hero: {
    backgroundColor: theme.surface.inverse,
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.xxl,
    borderBottomLeftRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.xl,
    gap: theme.space.xl,
  },
  heroTop: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  heroCopy: { flex: 1, gap: 2 },
  greeting: { ...theme.type.caption, color: theme.brand.onInkMuted },
  shopName: { ...theme.type.title, color: theme.brand.onInk },
  scan: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    minHeight: 88,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.brand.accent,
    borderWidth: 1,
    borderColor: theme.palette.brand[500],
    ...theme.shadow.raised,
  },
  scanIcon: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.surface.card,
    alignItems: "center",
    justifyContent: "center",
  },
  scanText: { flex: 1, gap: 2 },
  scanTitle: { ...theme.type.title, color: theme.text.onColor },
  scanSub: { ...theme.type.caption, color: theme.palette.brand[100] },
  body: { padding: theme.space.xl, gap: theme.space.md },
  sectionLabel: {
    ...theme.type.overline,
    color: theme.text.secondary,
    textTransform: "uppercase",
    marginTop: theme.space.sm,
  },
  loading: { minHeight: 120 },
  errorText: { ...theme.type.body, color: theme.tones.danger.fg },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.md },
  tileCell: { flexGrow: 1, flexBasis: "46%" },
  tile: {
    minHeight: 104,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    padding: theme.space.md,
    justifyContent: "space-between",
    gap: theme.space.sm,
  },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface.card,
    alignItems: "center",
    justifyContent: "center",
  },
  tileValue: { fontFamily: MONO, fontSize: 34, lineHeight: 40, fontWeight: "700" },
  tileLabel: { ...theme.type.caption, fontWeight: "700" },
  printerRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  printerBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  printerCopy: { flex: 1 },
  printerTitle: { ...theme.type.heading, color: theme.text.primary },
  printerText: { ...theme.type.caption, color: theme.text.muted, flex: 1 },
});
