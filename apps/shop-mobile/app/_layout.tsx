import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { theme } from "@print-automated/design-tokens";
import { ShopAuthProvider } from "@/providers/shop-auth-provider";
import { OfflineBanner } from "@/components/offline-banner";

export default function RootLayout(): ReactNode {
  return (
    <ShopAuthProvider>
      <View style={styles.root}>
        <OfflineBanner />
        <Stack
          screenOptions={{
            headerShown: false,
            // Signing in and out cross-fades rather than sliding: it is a change of
            // context, not a step deeper.
            animation: "fade",
            animationDuration: theme.motion.base,
            contentStyle: { backgroundColor: theme.surface.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
        </Stack>
      </View>
    </ShopAuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.background },
});
