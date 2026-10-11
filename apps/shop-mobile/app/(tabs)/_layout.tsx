import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Permission } from "@print-automated/types";
import { theme } from "@print-automated/design-tokens";
import { TabBar } from "@/components/tab-bar";
import { StateView } from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";

/** §30 MVP navigation: Home / Production (23.33) / Orders / Printers / Settings. Uses the
 * standard (stable) `Tabs` from `expo-router` rather than the newer `unstable-native-tabs`
 * API, with `components/tab-bar.tsx` as the animated bar. Every tab screen draws its own
 * header (`ScreenHeader`), so the navigator shows none. */
export default function TabsLayout(): ReactNode {
  const { isLoading, isAuthenticated, can } = useShopAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <StateView kind="loading" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Switching tabs cross-fades the scenes.
        animation: "fade",
        sceneStyle: { backgroundColor: theme.surface.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      {/* 23.33: the production floor, for roles with the operator view; hidden otherwise. */}
      <Tabs.Screen
        name="production"
        options={{
          title: "Production",
          href: can(Permission.VIEW_OPERATOR_DASHBOARD) ? undefined : null,
        }}
      />
      {/* orders/_layout.tsx's own Stack holds the list, scan and detail screens. */}
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="printers" options={{ title: "Printers" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: theme.surface.background },
});
