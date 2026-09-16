import type { ReactNode } from "react";
import { Stack } from "expo-router/stack";

/** Wraps `index` (§32's list) and `[id]` (§34's detail) in their own
 * push/pop stack, nested inside the Orders tab -- without this,
 * navigating from the list to a specific order has no back button or
 * header of its own. */
export default function OrdersLayout(): ReactNode {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Orders" }} />
      <Stack.Screen name="[id]" options={{ title: "Order" }} />
    </Stack>
  );
}
