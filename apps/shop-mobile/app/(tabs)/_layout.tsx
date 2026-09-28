import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Permission } from "@print-automated/types";
import { useShopAuth } from "@/providers/shop-auth-provider";

/** §30 MVP navigation: Home / Production (23.33) / Orders / Printers / More. Uses the
 * standard (stable) `Tabs` from `expo-router` rather than the newer
 * `unstable-native-tabs` API -- this scaffold can't be visually
 * verified on a device or simulator in this environment, so the
 * long-established, widely-used API is the safer choice over an
 * explicitly "unstable" one; revisit once real hardware is available
 * (§9's printer phase already requires it). */
export default function TabsLayout(): ReactNode {
  const { isLoading, isAuthenticated, can } = useShopAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      {/* 23.33: the production floor, for roles with the operator view; hidden otherwise. */}
      <Tabs.Screen
        name="production"
        options={{
          title: "Production",
          href: can(Permission.VIEW_OPERATOR_DASHBOARD) ? undefined : null,
        }}
      />
      {/* headerShown: false -- orders/_layout.tsx's own Stack renders
       * the header for its two screens (list and detail); showing
       * this tab-level one too would double it up. */}
      <Tabs.Screen name="orders" options={{ title: "Orders", headerShown: false }} />
      <Tabs.Screen name="printers" options={{ title: "Printers" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
