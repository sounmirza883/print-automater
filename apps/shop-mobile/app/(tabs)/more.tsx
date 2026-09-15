import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { tokens } from "@print-automated/design-tokens";
import { useShopAuth } from "@/providers/shop-auth-provider";

export default function MoreScreen(): ReactNode {
  const router = useRouter();
  const { user, logout } = useShopAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.replace("/login");
    }
  }

  return (
    <View style={styles.container}>
      {user !== null && (
        <View style={styles.profile}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => void handleLogout()}
        disabled={loggingOut}
        style={styles.logoutButton}
      >
        {loggingOut ? <ActivityIndicator /> : <Text style={styles.logoutText}>Log out</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24 },
  profile: { gap: 4 },
  name: { fontSize: 18, fontWeight: "600" },
  email: { color: "#6B7280" },
  logoutButton: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutText: { fontWeight: "600" },
});
