import { useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@print-automated/design-tokens";
import {
  humanizeEnum,
  type PrinterCapabilities,
  type PrinterResponse,
} from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { PairComputer } from "@/components/pair-computer";
import { Button, Card, Field, ScreenHeader, StateView } from "@/components/ui";

const CAPABILITY_LABELS: Array<{ key: keyof PrinterCapabilities; label: string }> = [
  { key: "color", label: "Color" },
  { key: "duplex", label: "Duplex" },
  { key: "a4", label: "A4" },
  { key: "a3", label: "A3" },
];

const DEFAULT_CAPABILITIES: PrinterCapabilities = {
  color: false,
  duplex: false,
  a4: false,
  a3: false,
};
import { useShopAuth } from "@/providers/shop-auth-provider";
import { usePrinters } from "@/lib/use-printers";
import { useIsOffline } from "@/lib/use-is-offline";

// Every PrinterStatus (15.3 added BUSY, PAUSED, MAINTENANCE and UNKNOWN); anything newer
// still reads as words, in grey.
const STATUS_COLOR: Record<string, string> = {
  ONLINE: theme.tones.good.solid,
  BUSY: theme.brand.accent,
  OFFLINE: theme.inactive,
  ERROR: theme.tones.danger.solid,
  PAUSED: theme.tones.caution.solid,
  MAINTENANCE: theme.tones.caution.solid,
  UNKNOWN: theme.inactive,
  DISABLED: theme.inactive,
};

/** §38's printer status list plus register/rename/enable-disable/
 * remove -- all inline against a tapped row, no separate modal. 23.35: pairing a computer's
 * agent, and every change here, only for roles that may manage printers; others see the
 * list. */
function PrintersBody(): ReactNode {
  const { shopId, apiClient, can } = useShopAuth();
  const manage = can(Permission.MANAGE_PRINTERS);
  const printers = usePrinters(apiClient, shopId);
  const [newName, setNewName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // §90/10.7: registering a printer while offline would just fail into
  // formError on tap -- blocking it outright is the honest state,
  // matching [id].tsx's own actionBlocked treatment.
  const isOffline = useIsOffline();
  const registerBlocked = registering || newName.trim().length === 0 || isOffline;

  if (shopId === null) {
    return (
      <StateView
        kind="empty"
        icon="storefront-outline"
        title="No business yet"
        message="This account isn't registered as staff at any business, so there are no printers to show."
      />
    );
  }

  // Captured as a plain non-null local -- narrowing from the early
  // `if (shopId === null)` return above doesn't carry into
  // `handleRegister`'s own, separately-analyzed function scope.
  const activeShopId = shopId;

  async function handleRegister(): Promise<void> {
    if (newName.trim().length === 0) {
      return;
    }
    setFormError(null);
    setRegistering(true);
    try {
      await apiClient.printers.register({ shopId: activeShopId, name: newName.trim() });
      setNewName("");
      printers.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not register this printer.");
    } finally {
      setRegistering(false);
    }
  }

  return (
    <View style={styles.container}>
      {manage && (
        <View style={styles.manage}>
          <PairComputer apiClient={apiClient} shopId={activeShopId} offline={isOffline} />
          <View style={styles.addRow}>
            <Field
              icon="print-outline"
              accessibilityLabel="New printer name"
              value={newName}
              onChangeText={setNewName}
              placeholder="New printer name"
              editable={!registering}
              style={styles.addField}
              onSubmitEditing={() => void handleRegister()}
            />
            <View style={styles.addButton}>
              <Button
                label="Register"
                variant="primary"
                busy={registering}
                disabled={registerBlocked}
                onPress={() => void handleRegister()}
              />
            </View>
          </View>
        </View>
      )}
      {formError !== null && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {formError}
        </Text>
      )}

      {printers.phase === "loading" && <StateView kind="loading" title="Loading printers" />}
      {printers.phase === "error" && (
        <StateView kind="error" title="Couldn't load printers" message={printers.message} />
      )}
      {printers.phase === "ready" && printers.printers.length === 0 && (
        <StateView
          kind="empty"
          icon="print-outline"
          title="No printers yet"
          message={
            manage
              ? "Pair a computer and the printers it finds appear here."
              : "Someone who manages printers can pair a computer to add them."
          }
        />
      )}
      {printers.phase === "ready" && printers.printers.length > 0 && (
        <FlatList
          data={printers.printers}
          keyExtractor={(printer) => printer.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PrinterRow
              printer={item}
              manage={manage}
              expanded={expandedId === item.id}
              onToggleExpanded={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onChanged={printers.refresh}
            />
          )}
        />
      )}
    </View>
  );
}

function PrinterRow({
  printer,
  manage,
  expanded,
  onToggleExpanded,
  onChanged,
}: {
  printer: PrinterResponse;
  /** May change it (MANAGE_PRINTERS); otherwise the row does not open. */
  manage: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChanged: () => void;
}): ReactNode {
  const { apiClient } = useShopAuth();
  const [name, setName] = useState(printer.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsBusyKey, setCapsBusyKey] = useState<keyof PrinterCapabilities | null>(null);
  const isOffline = useIsOffline();
  const blocked = busy || isOffline;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  // §9.6's "manual override toggles in the Shop app where the driver
  // lies" -- the agent's own WMI probe (discovery.ts) is a best-effort
  // guess (Windows print-queue capability reporting is inconsistent
  // across drivers, per the plan's own named risk), so staff can
  // correct any single flag without retyping the other three.
  // updatePrinterSchema requires all four booleans together -- a
  // partial capabilities object would be indistinguishable from
  // "the other three are false" -- so every toggle sends the full,
  // merged set.
  async function toggleCapability(key: keyof PrinterCapabilities, value: boolean): Promise<void> {
    setError(null);
    setCapsBusyKey(key);
    try {
      const next = { ...(printer.capabilities ?? DEFAULT_CAPABILITIES), [key]: value };
      await apiClient.printers.update(printer.id, { capabilities: next });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that capability.");
    } finally {
      setCapsBusyKey(null);
    }
  }

  const statusColor = STATUS_COLOR[printer.status] ?? theme.inactive;
  return (
    <Card edge={statusColor}>
      <Pressable
        accessibilityRole={manage ? "button" : undefined}
        accessibilityLabel={`${printer.name}, ${humanizeEnum(printer.status)}`}
        accessibilityState={manage ? { expanded } : undefined}
        disabled={!manage}
        onPress={onToggleExpanded}
        style={styles.cardHeaderRow}
      >
        <View style={styles.statusRow}>
          <View style={styles.printerIcon}>
            <Ionicons name="print" size={22} color={statusColor} />
          </View>
          <View style={styles.nameCol}>
            <Text style={styles.printerName}>{printer.name}</Text>
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.statusLabel}>{humanizeEnum(printer.status)}</Text>
            </View>
          </View>
        </View>
        {manage && (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={20}
            color={theme.text.muted}
          />
        )}
      </Pressable>

      {manage && expanded && (
        <View style={styles.expandedSection}>
          {error !== null && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          <View style={styles.renameRow}>
            <Field
              accessibilityLabel="Printer name"
              value={name}
              onChangeText={setName}
              editable={!busy}
              style={styles.addField}
            />
            <View style={styles.addButton}>
              <Button
                label="Save name"
                disabled={blocked || name.trim().length === 0}
                onPress={() =>
                  void run(() => apiClient.printers.update(printer.id, { name: name.trim() }))
                }
              />
            </View>
          </View>
          <View style={styles.capabilitiesSection}>
            <Text style={styles.capabilitiesTitle}>
              Capabilities{printer.capabilities === null ? " (not yet detected)" : ""}
            </Text>
            {CAPABILITY_LABELS.map(({ key, label }) => (
              <View key={key} style={styles.capabilityRow}>
                <Text style={styles.capabilityLabel}>{label}</Text>
                <Switch
                  accessibilityLabel={label}
                  value={(printer.capabilities ?? DEFAULT_CAPABILITIES)[key]}
                  onValueChange={(value) => void toggleCapability(key, value)}
                  disabled={capsBusyKey !== null || isOffline}
                  trackColor={{ true: theme.brand.accent, false: theme.border.strong }}
                />
              </View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <View style={styles.actionCell}>
              <Button
                label={printer.status === "DISABLED" ? "Enable" : "Disable"}
                icon={printer.status === "DISABLED" ? "play-outline" : "pause-outline"}
                disabled={blocked}
                onPress={() =>
                  void run(() =>
                    apiClient.printers.update(printer.id, {
                      enabled: printer.status !== "DISABLED" ? false : true,
                    }),
                  )
                }
              />
            </View>
            <View style={styles.actionCell}>
              <Button
                label="Remove"
                icon="trash-outline"
                variant="danger"
                busy={busy}
                disabled={blocked}
                onPress={() => void run(() => apiClient.printers.remove(printer.id))}
              />
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.surface.background },
  container: { flex: 1, padding: theme.space.lg, gap: theme.space.md },
  errorText: { ...theme.type.body, color: theme.tones.danger.fg },
  manage: { gap: theme.space.md },
  addRow: { flexDirection: "row", gap: theme.space.sm, alignItems: "center" },
  addField: { flex: 1 },
  addButton: { flexShrink: 0 },
  listContent: { gap: theme.space.md, paddingBottom: theme.space.xxl },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md, flex: 1 },
  printerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface.subtle,
    alignItems: "center",
    justifyContent: "center",
  },
  nameCol: { flex: 1, gap: 2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  printerName: { ...theme.type.heading, color: theme.text.primary },
  statusLabel: { ...theme.type.caption, color: theme.text.muted },
  expandedSection: {
    gap: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.border.default,
    paddingTop: theme.space.md,
  },
  renameRow: { flexDirection: "row", gap: theme.space.sm, alignItems: "center" },
  capabilitiesSection: { gap: theme.space.xs },
  capabilitiesTitle: {
    ...theme.type.overline,
    color: theme.text.muted,
    textTransform: "uppercase",
  },
  capabilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },
  capabilityLabel: { ...theme.type.bodyStrong, color: theme.text.primary },
  actionRow: { flexDirection: "row", gap: theme.space.sm },
  actionCell: { flex: 1 },
});

export default function PrintersScreen(): ReactNode {
  const { shopName } = useShopAuth();
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Printers" subtitle={shopName} />
      <PrintersBody />
    </View>
  );
}
