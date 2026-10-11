import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@print-automated/design-tokens";
import { Button, Field } from "@/components/ui";
import { findOrderByScan } from "@/lib/scan-order";
import { useShopAuth } from "@/providers/shop-auth-provider";

const FRAME = 248;
const BRACKET = 36;
const BRACKET_WIDTH = 5;
// ink-950 (#080d21) at 60%: dims the camera outside the viewfinder.
const DIM = "rgba(8, 13, 33, 0.6)";

/** Scan a customer's order QR (customer-web's guest flow) and open that order,
 * where staff can record payment. A typed order number is the fallback for a
 * denied/absent camera or a cracked screen. Full-bleed camera behind a dimmed
 * viewfinder; the manual entry sits in a bottom sheet that rides above the keyboard. */
export default function ScanOrderScreen(): ReactNode {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { shopId, apiClient } = useShopAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  // The camera fires onBarcodeScanned many times a second for one QR; a ref
  // (not state) gates re-entry synchronously.
  const handling = useRef(false);
  // A cyan scan line sweeps the viewfinder while the camera is live.
  const [sweep] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  async function resolve(code: string): Promise<void> {
    if (code.trim().length === 0) return;
    if (handling.current || shopId === null) return;
    handling.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const order = await findOrderByScan(apiClient, shopId, code);
      if (order === null) {
        setMessage(`No order "${code.trim()}" at this shop.`);
        return;
      }
      router.replace(`/orders/${order.id}`);
    } catch {
      setMessage("Couldn't look that order up. Check your connection and try again.");
    } finally {
      setBusy(false);
      // Brief cooldown so the same failing QR doesn't loop the request.
      setTimeout(() => {
        handling.current = false;
      }, 1500);
    }
  }

  const granted = permission?.granted === true;
  // Once the OS stops showing the prompt, only the Settings app can grant access.
  const needsSettings = permission !== null && !permission.granted && !permission.canAskAgain;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.root}
    >
      <StatusBar style="light" />
      {granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => void resolve(data)}
        />
      )}

      <View style={styles.viewfinderArea} pointerEvents={granted ? "none" : "auto"}>
        {permission === null && <ActivityIndicator size="large" color={theme.brand.onInk} />}
        {granted && (
          <>
            <View style={[styles.dim, styles.dimTop, { paddingTop: insets.top }]} />
            <View style={styles.middleRow}>
              <View style={styles.dim} />
              <View style={styles.frame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [
                        {
                          translateY: sweep.interpolate({
                            inputRange: [0, 1],
                            outputRange: [BRACKET, FRAME - BRACKET],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              </View>
              <View style={styles.dim} />
            </View>
            <View style={[styles.dim, styles.dimBottom]}>
              <Text style={styles.frameHint}>Point at the order QR code</Text>
            </View>
          </>
        )}
        {permission !== null && !granted && (
          <View style={styles.permission}>
            <View style={styles.permissionIcon}>
              <Ionicons name="camera-outline" size={36} color={theme.brand.onInk} />
            </View>
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionText}>
              {needsSettings
                ? "Camera access is turned off for this app. Turn it on in Settings to scan order QR codes, or type the order number below."
                : "Allow the camera to scan order QR codes, or type the order number below."}
            </Text>
            {needsSettings ? (
              <Button
                label="Open Settings"
                variant="primary"
                icon="settings-outline"
                onPress={() => void Linking.openSettings()}
              />
            ) : (
              <Button
                label="Allow camera"
                variant="primary"
                icon="camera"
                onPress={() => void requestPermission()}
              />
            )}
          </View>
        )}
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.space.lg }]}>
        <View style={styles.grabber} />
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Or enter the order number
        </Text>
        {busy && (
          <View style={styles.status} accessibilityRole="progressbar">
            <ActivityIndicator color={theme.brand.accent} />
            <Text style={styles.statusText}>Looking up order…</Text>
          </View>
        )}
        {message !== null && (
          <View accessibilityRole="alert" style={styles.error}>
            <Ionicons name="alert-circle" size={18} color={theme.tones.danger.solid} />
            <Text style={styles.errorText}>{message}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Field
            icon="receipt-outline"
            accessibilityLabel="Order number"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Order number"
            returnKeyType="search"
            style={styles.input}
            onSubmitEditing={() => void resolve(typed)}
          />
          <View style={styles.find}>
            <Button
              label="Find"
              variant="primary"
              disabled={typed.trim().length === 0 || busy}
              onPress={() => void resolve(typed)}
            />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.inverse },
  viewfinderArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  dim: { flex: 1, alignSelf: "stretch", backgroundColor: DIM },
  dimTop: { justifyContent: "flex-end" },
  dimBottom: { alignItems: "center", paddingTop: theme.space.lg },
  middleRow: { flexDirection: "row", height: FRAME },
  frame: { width: FRAME, height: FRAME },
  corner: {
    position: "absolute",
    width: BRACKET,
    height: BRACKET,
    borderColor: theme.overlay.frame,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: BRACKET_WIDTH,
    borderLeftWidth: BRACKET_WIDTH,
    borderTopLeftRadius: theme.radius.md,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: BRACKET_WIDTH,
    borderRightWidth: BRACKET_WIDTH,
    borderTopRightRadius: theme.radius.md,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: BRACKET_WIDTH,
    borderLeftWidth: BRACKET_WIDTH,
    borderBottomLeftRadius: theme.radius.md,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: BRACKET_WIDTH,
    borderRightWidth: BRACKET_WIDTH,
    borderBottomRightRadius: theme.radius.md,
  },
  scanLine: {
    position: "absolute",
    left: BRACKET / 2,
    right: BRACKET / 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.accents.cyan,
  },
  frameHint: {
    ...theme.type.bodyStrong,
    color: theme.brand.onInk,
    backgroundColor: theme.surface.inverse,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  permission: {
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xxl,
    paddingTop: 72,
  },
  permissionIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  permissionTitle: { ...theme.type.title, color: theme.brand.onInk, textAlign: "center" },
  permissionText: {
    ...theme.type.body,
    color: theme.brand.onInkMuted,
    textAlign: "center",
    maxWidth: 320,
  },
  sheet: {
    backgroundColor: theme.surface.card,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.md,
    gap: theme.space.md,
    ...theme.shadow.raised,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border.strong,
  },
  sheetTitle: { ...theme.type.heading, color: theme.text.primary },
  status: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  statusText: { ...theme.type.caption, color: theme.text.muted },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.tones.danger.bg,
    borderWidth: 1,
    borderColor: theme.tones.danger.border,
  },
  errorText: { ...theme.type.body, color: theme.tones.danger.fg, flex: 1 },
  row: { flexDirection: "row", gap: theme.space.sm, alignItems: "center" },
  input: { flex: 1 },
  find: { flexShrink: 0 },
});
