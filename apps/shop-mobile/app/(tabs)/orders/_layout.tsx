import type { ReactNode } from "react";
import { Stack } from "expo-router/stack";
import { theme } from "@print-automated/design-tokens";

/** Wraps `index` (§32's list), `scan` and `[id]` (§34's detail) in their own
 * push/pop stack, nested inside the Orders tab -- without this,
 * navigating from the list to a specific order has no back button or
 * header of its own. The list draws its own header; detail slides in from the right under a
 * native back header; the scanner rises from the bottom over a transparent one. */
export default function OrdersLayout(): ReactNode {
  return (
    <Stack
      screenOptions={{
        animation: "slide_from_right",
        animationDuration: theme.motion.base,
        contentStyle: { backgroundColor: theme.surface.background },
        headerStyle: { backgroundColor: theme.surface.background },
        headerTitleStyle: { ...theme.type.heading, color: theme.text.primary },
        headerTintColor: theme.brand.accent,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="scan"
        options={{
          title: "Scan order",
          animation: "slide_from_bottom",
          headerTransparent: true,
          headerTintColor: theme.brand.onInk,
          headerTitleStyle: { ...theme.type.heading, color: theme.brand.onInk },
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{ title: "Order", headerBackButtonDisplayMode: "minimal" }}
      />
    </Stack>
  );
}
