import { useState, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { theme } from "@print-automated/design-tokens";
import {
  Button,
  Group,
  InfoRow,
  PressableScale,
  Reveal,
  ScreenHeader,
  SectionTitle,
  type IconName,
} from "@/components/ui";
import { useShopAuth } from "@/providers/shop-auth-provider";
import { API_BASE_URL } from "@/lib/env";
import { roleLabel } from "@/lib/permissions";

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

/** Account, business and app details, shortcuts, and log out. Replaces the old More tab; the
 * only thing More ever held besides these was log out, and pairing a computer lives on the
 * Printers screen (linked from here). */
export default function SettingsScreen(): ReactNode {
  const router = useRouter();
  const { user, logout, role, shopName } = useShopAuth();
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
    <View style={styles.root}>
      <ScreenHeader title="Settings" subtitle={shopName} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {user !== null && (
          <Reveal>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(user.name)}</Text>
              </View>
              <View style={styles.profileCopy}>
                <Text numberOfLines={1} style={styles.name}>
                  {user.name}
                </Text>
                <Text numberOfLines={1} style={styles.email}>
                  {user.email}
                </Text>
              </View>
              <View style={styles.rolePill}>
                <Text style={styles.roleText}>{roleLabel(role)}</Text>
              </View>
            </View>
          </Reveal>
        )}

        <Reveal delay={60} style={styles.section}>
          <SectionTitle title="Account" />
          <Group>
            <InfoRow icon="person-outline" label="Name" value={user?.name ?? "Signed in"} />
            <InfoRow icon="mail-outline" label="Email" value={user?.email ?? "Not available"} />
            <InfoRow icon="id-card-outline" label="Your role" value={roleLabel(role)} />
            <InfoRow
              icon="storefront-outline"
              label="Business"
              value={shopName ?? "No business yet"}
              last
            />
          </Group>
        </Reveal>

        <Reveal delay={120} style={styles.section}>
          <SectionTitle title="Shortcuts" />
          <Group>
            <LinkRow
              icon="print-outline"
              label="Printers and pairing"
              hint="Pair a computer, register or manage printers"
              onPress={() => router.push("/printers")}
            />
            <LinkRow
              icon="camera-outline"
              label="Camera and device permissions"
              hint="Opens this app's page in the system Settings"
              onPress={() => void Linking.openSettings()}
              last
            />
          </Group>
        </Reveal>

        <Reveal delay={180} style={styles.section}>
          <SectionTitle title="About this app" />
          <Group>
            <InfoRow
              icon="information-circle-outline"
              label="App version"
              value={Constants.expoConfig?.version ?? "Unknown"}
              mono
            />
            <InfoRow icon="server-outline" label="API address" value={API_BASE_URL} mono last />
          </Group>
        </Reveal>

        <Reveal delay={240}>
          <Button
            label="Log out"
            icon="log-out-outline"
            variant="danger"
            busy={loggingOut}
            onPress={() => void handleLogout()}
          />
        </Reveal>
      </ScrollView>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  hint,
  onPress,
  last = false,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
}): ReactNode {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      scaleTo={0.99}
      contentStyle={[styles.linkRow, !last && styles.linkDivider]}
    >
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={18} color={theme.brand.accent} />
      </View>
      <View style={styles.linkCopy}>
        <Text style={styles.linkLabel}>{label}</Text>
        <Text style={styles.linkHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.text.muted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface.background },
  content: { padding: theme.space.lg, gap: theme.space.xl, paddingBottom: theme.space.xxl },
  section: { gap: theme.space.md },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    backgroundColor: theme.surface.inverse,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    ...theme.shadow.card,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.brand.accent,
    borderWidth: 2,
    borderColor: theme.accents.yellow,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...theme.type.heading, color: theme.text.onColor },
  profileCopy: { flex: 1, gap: 2 },
  name: { ...theme.type.heading, color: theme.brand.onInk },
  email: { ...theme.type.caption, color: theme.brand.onInkMuted },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.palette.ink[700],
  },
  roleText: { ...theme.type.caption, fontWeight: "700", color: theme.brand.onInk },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    minHeight: 64,
    paddingVertical: theme.space.md,
  },
  linkDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.default },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.surface.accentSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  linkCopy: { flex: 1, gap: 1 },
  linkLabel: { ...theme.type.bodyStrong, color: theme.text.primary },
  linkHint: { ...theme.type.caption, color: theme.text.muted },
});
