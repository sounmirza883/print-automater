import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { ShopAuthProvider } from "@/providers/shop-auth-provider";
import { OfflineBanner } from "@/components/offline-banner";

export default function RootLayout(): ReactNode {
  return (
    <ShopAuthProvider>
      <View style={styles.root}>
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
        </Stack>
      </View>
    </ShopAuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
