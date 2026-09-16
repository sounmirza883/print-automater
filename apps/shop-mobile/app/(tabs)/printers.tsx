import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { tokens } from "@print-automated/design-tokens";
import type { PrinterResponse } from "@print-automated/api-client";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { usePrinters } from "@/lib/use-printers";

const STATUS_LABEL: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  ERROR: "Error",
  DISABLED: "Disabled",
};

const STATUS_COLOR: Record<string, string> = {
  ONLINE: tokens.colors.success,
  OFFLINE: "#9CA3AF",
  ERROR: tokens.colors.error,
  DISABLED: "#9CA3AF",
};

/** §38's printer status list plus register/rename/enable-disable/
 * remove -- all inline against a tapped row, no separate modal. */
export default function PrintersScreen(): ReactNode {
  const { shopId, apiClient } = useShopAuth();
  const printers = usePrinters(apiClient, shopId);
  const [newName, setNewName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          disabled={registering || newName.trim().length === 0}
          onPress={() => void handleRegister()}
          style={[
            styles.registerButton,
            (registering || newName.trim().length === 0) && styles.buttonDisabled,
          ]}
        >
          {registering ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.registerButtonText}>Register</Text>
          )}
        </Pressable>
      </View>
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
        <Text style={styles.subtitle}>No printers registered yet.</Text>
      )}
      {printers.phase === "ready" && printers.printers.length > 0 && (
        <FlatList
          data={printers.printers}
          keyExtractor={(printer) => printer.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <PrinterRow
              printer={item}
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
  expanded,
  onToggleExpanded,
  onChanged,
}: {
  printer: PrinterResponse;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChanged: () => void;
}): ReactNode {
  const { apiClient } = useShopAuth();
  const [name, setName] = useState(printer.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={onToggleExpanded} style={styles.cardHeaderRow}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[printer.status] }]} />
          <Text style={styles.printerName}>{printer.name}</Text>
        </View>
        <Text style={styles.statusLabel}>{STATUS_LABEL[printer.status] ?? printer.status}</Text>
      </Pressable>

      {expanded && (
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
              disabled={busy || name.trim().length === 0}
              onPress={() =>
                void run(() => apiClient.printers.update(printer.id, { name: name.trim() }))
              }
              style={[styles.smallButton, busy && styles.buttonDisabled]}
            >
              <Text style={styles.smallButtonText}>Save name</Text>
            </Pressable>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void run(() =>
                  apiClient.printers.update(printer.id, {
                    enabled: printer.status !== "DISABLED" ? false : true,
                  }),
                )
              }
              style={[styles.smallButton, busy && styles.buttonDisabled]}
            >
              <Text style={styles.smallButtonText}>
                {printer.status === "DISABLED" ? "Enable" : "Disable"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void run(() => apiClient.printers.remove(printer.id))}
              style={[styles.removeButton, busy && styles.buttonDisabled]}
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
