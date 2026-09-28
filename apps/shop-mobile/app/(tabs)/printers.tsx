import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { tokens } from "@print-automated/design-tokens";
import {
  humanizeEnum,
  type PrinterCapabilities,
  type PrinterResponse,
} from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { PairComputer } from "@/components/pair-computer";

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
  ONLINE: tokens.colors.success,
  BUSY: tokens.colors.primaryAction,
  OFFLINE: "#9CA3AF",
  ERROR: tokens.colors.error,
  PAUSED: tokens.colors.warning,
  MAINTENANCE: tokens.colors.warning,
  UNKNOWN: "#9CA3AF",
  DISABLED: "#9CA3AF",
};

/** §38's printer status list plus register/rename/enable-disable/
 * remove -- all inline against a tapped row, no separate modal. 23.35: pairing a computer's
 * agent, and every change here, only for roles that may manage printers; others see the
 * list. */
export default function PrintersScreen(): ReactNode {
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
      <View style={styles.container}>
        <Text style={styles.subtitle}>You aren&apos;t registered as staff at any shop yet.</Text>
      </View>
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
      {manage && <PairComputer apiClient={apiClient} shopId={activeShopId} offline={isOffline} />}
      {manage && (
        <View style={styles.addRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New printer name"
            style={styles.input}
            editable={!registering}
          />
          <Pressable
            accessibilityRole="button"
            disabled={registerBlocked}
            onPress={() => void handleRegister()}
            style={[styles.registerButton, registerBlocked && styles.buttonDisabled]}
          >
            {registering ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.registerButtonText}>Register</Text>
            )}
          </Pressable>
        </View>
      )}
      {formError !== null && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {formError}
        </Text>
      )}

      {printers.phase === "loading" && <ActivityIndicator />}
      {printers.phase === "error" && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {printers.message}
        </Text>
      )}
      {printers.phase === "ready" && printers.printers.length === 0 && (
        <Text style={styles.subtitle}>
          {manage
            ? "No printers yet. Pair a computer and the printers it finds appear here."
            : "No printers yet."}
        </Text>
      )}
      {printers.phase === "ready" && printers.printers.length > 0 && (
        <FlatList
          data={printers.printers}
          keyExtractor={(printer) => printer.id}
          contentContainerStyle={styles.listContent}
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

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole={manage ? "button" : undefined}
        disabled={!manage}
        onPress={onToggleExpanded}
        style={styles.cardHeaderRow}
      >
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: STATUS_COLOR[printer.status] ?? "#9CA3AF" },
            ]}
          />
          <Text style={styles.printerName}>{printer.name}</Text>
        </View>
        <Text style={styles.statusLabel}>{humanizeEnum(printer.status)}</Text>
      </Pressable>

      {manage && expanded && (
        <View style={styles.expandedSection}>
          {error !== null && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          <View style={styles.renameRow}>
            <TextInput value={name} onChangeText={setName} style={styles.input} editable={!busy} />
            <Pressable
              accessibilityRole="button"
              disabled={blocked || name.trim().length === 0}
              onPress={() =>
                void run(() => apiClient.printers.update(printer.id, { name: name.trim() }))
              }
              style={[styles.smallButton, blocked && styles.buttonDisabled]}
            >
              <Text style={styles.smallButtonText}>Save name</Text>
            </Pressable>
          </View>
          <View style={styles.capabilitiesSection}>
            <Text style={styles.capabilitiesTitle}>
              Capabilities{printer.capabilities === null ? " (not yet detected)" : ""}
            </Text>
            {CAPABILITY_LABELS.map(({ key, label }) => (
              <View key={key} style={styles.capabilityRow}>
                <Text style={styles.capabilityLabel}>{label}</Text>
                <Switch
                  value={(printer.capabilities ?? DEFAULT_CAPABILITIES)[key]}
                  onValueChange={(value) => void toggleCapability(key, value)}
                  disabled={capsBusyKey !== null || isOffline}
                />
              </View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={blocked}
              onPress={() =>
                void run(() =>
                  apiClient.printers.update(printer.id, {
                    enabled: printer.status !== "DISABLED" ? false : true,
                  }),
                )
              }
              style={[styles.smallButton, blocked && styles.buttonDisabled]}
            >
              <Text style={styles.smallButtonText}>
                {printer.status === "DISABLED" ? "Enable" : "Disable"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={blocked}
              onPress={() => void run(() => apiClient.printers.remove(printer.id))}
              style={[styles.removeButton, blocked && styles.buttonDisabled]}
            >
              {busy ? <ActivityIndicator /> : <Text style={styles.removeButtonText}>Remove</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  subtitle: { color: "#6B7280" },
  errorText: { color: tokens.colors.error },
  addRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  registerButton: {
    backgroundColor: tokens.colors.primaryAction,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  registerButtonText: { color: "#fff", fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  listContent: { gap: 8, paddingBottom: 24 },
  card: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 14,
    gap: 10,
  },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  printerName: { fontWeight: "700" },
  statusLabel: { color: "#6B7280" },
  expandedSection: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: tokens.borders.color,
    paddingTop: 10,
  },
  renameRow: { flexDirection: "row", gap: 8 },
  capabilitiesSection: { gap: 4 },
  capabilitiesTitle: { fontWeight: "600", color: "#6B7280", fontSize: 13 },
  capabilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  capabilityLabel: { fontWeight: "500" },
  actionRow: { flexDirection: "row", gap: 8 },
  smallButton: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
  },
  smallButtonText: { fontWeight: "600" },
  removeButton: {
    borderWidth: 1,
    borderColor: tokens.colors.error,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
  },
  removeButtonText: { color: tokens.colors.error, fontWeight: "600" },
});
