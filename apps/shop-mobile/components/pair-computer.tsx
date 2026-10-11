import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@print-automated/design-tokens";
import type { ApiClient, PairingCode } from "@print-automated/api-client";
import { ActionForm } from "@/components/form";
import { Button, MONO, MUTED } from "@/components/ui";
import { errorMessage } from "@/lib/job-actions";

/** 23.35: a one-time code for pairing the print agent on a shop computer, as shop-web's
 * "Pair a computer" issues it. Issued only on request (each issue is audited), valid for ten
 * minutes, good for one pairing; the computer's printers then appear on their own. */
export function PairComputer({
  apiClient,
  shopId,
  offline,
}: {
  apiClient: ApiClient;
  shopId: string;
  offline: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setIssued(await apiClient.printers.issuePairingCode(shopId));
    } catch (err) {
      setError(errorMessage(err, "Could not issue a pairing code."));
    } finally {
      setBusy(false);
    }
  }

  function close(): void {
    setOpen(false);
    setIssued(null);
    setError(null);
  }

  if (!open) {
    return (
      <Button
        label="Pair a computer"
        variant="primary"
        onPress={() => setOpen(true)}
        disabled={offline}
      />
    );
  }

  return (
    <ActionForm title="Pair a computer">
      <Text>
        1. Install the Print Automated agent on the computer the printers are connected to.
      </Text>
      <Text>
        2. Open its page: it opens after installing, or click its printer icon near the clock
        (http://127.0.0.1:7171).
      </Text>
      <Text>3. Enter the pairing code there. The computer&apos;s printers then appear here.</Text>
      {error !== null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {issued === null ? (
        <Button
          label="Show a pairing code"
          variant="primary"
          busy={busy}
          disabled={offline}
          onPress={() => void issue()}
        />
      ) : (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Pairing code</Text>
          <Text
            selectable
            accessibilityLabel={`Pairing code ${issued.code.split("").join(" ")}`}
            style={styles.code}
          >
            {issued.code}
          </Text>
          <Text style={styles.codeLabel}>
            Works once, until{" "}
            {new Date(issued.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </Text>
        </View>
      )}
      <Button label={issued === null ? "Cancel" : "Done"} variant="quiet" onPress={close} />
    </ActionForm>
  );
}

const styles = StyleSheet.create({
  error: { ...theme.type.body, color: theme.tones.danger.fg },
  codeBox: {
    borderWidth: 1,
    borderColor: theme.border.default,
    borderRadius: theme.radius.md,
    backgroundColor: theme.surface.card,
    padding: theme.space.lg,
    alignItems: "center",
    gap: theme.space.xs,
  },
  codeLabel: { ...theme.type.caption, color: MUTED },
  code: {
    fontFamily: MONO,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: 6,
    color: theme.brand.accent,
    fontVariant: ["tabular-nums"],
  },
});
