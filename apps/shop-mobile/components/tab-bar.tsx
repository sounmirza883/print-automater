import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@print-automated/design-tokens";
import type { IconName } from "@/components/ui";

/** Outline icon when idle, solid when active, so the current tab reads without colour alone. */
const TAB_ICONS: Record<string, { active: IconName; idle: IconName }> = {
  index: { active: "home", idle: "home-outline" },
  production: { active: "layers", idle: "layers-outline" },
  orders: { active: "receipt", idle: "receipt-outline" },
  printers: { active: "print", idle: "print-outline" },
  settings: { active: "settings", idle: "settings-outline" },
};
const FALLBACK_ICON = { active: "ellipse", idle: "ellipse-outline" } as const;

const INDICATOR_WIDTH = 32;

/** Bottom navigation: icon + label per tab, a brand-blue indicator that springs between tabs,
 * a soft pill and a spring scale on the active icon, and a CMYK-yellow spark on the indicator.
 * Tabs hidden by the layout (`href: null`) are skipped, so the indicator tracks visible tabs. */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps): ReactNode {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const visible = state.routes.filter((route) => {
    const hidden = StyleSheet.flatten(descriptors[route.key]?.options.tabBarItemStyle);
    return hidden?.display !== "none";
  });
  const activeKey = state.routes[state.index]?.key;
  const activeSlot = Math.max(
    0,
    visible.findIndex((route) => route.key === activeKey),
  );
  const slotWidth = visible.length > 0 ? width / visible.length : 0;
  const [indicatorX] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: activeSlot * slotWidth + (slotWidth - INDICATOR_WIDTH) / 2,
      useNativeDriver: true,
      speed: 16,
      bounciness: 9,
    }).start();
  }, [activeSlot, slotWidth, indicatorX]);

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, theme.space.sm) }]}
    >
      {slotWidth > 0 && (
        <Animated.View style={[styles.indicator, { transform: [{ translateX: indicatorX }] }]}>
          <View style={styles.spark} />
        </Animated.View>
      )}
      <View style={styles.row}>
        {visible.map((route) => {
          const options = descriptors[route.key]?.options;
          const focused = route.key === activeKey;
          const label = options?.title ?? route.name;
          return (
            <TabItem
              key={route.key}
              label={label}
              focused={focused}
              icon={TAB_ICONS[route.name] ?? FALLBACK_ICON}
              accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  label,
  focused,
  icon,
  accessibilityLabel,
  onPress,
  onLongPress,
}: {
  label: string;
  focused: boolean;
  icon: { active: IconName; idle: IconName };
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress: () => void;
}): ReactNode {
  // One 0..1 value drives the pill, the icon scale/lift and the label weight colour.
  const [progress] = useState(() => new Animated.Value(focused ? 1 : 0));
  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 12,
    }).start();
  }, [focused, progress]);
  const colour = focused ? theme.brand.accent : theme.text.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}
    >
      <View style={styles.iconSlot}>
        <Animated.View
          style={[
            styles.pill,
            {
              opacity: progress,
              transform: [
                { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={{
            transform: [
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
            ],
          }}
        >
          <Ionicons name={focused ? icon.active : icon.idle} size={22} color={colour} />
        </Animated.View>
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: colour }, focused && styles.labelOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: theme.surface.card,
    borderTopWidth: 1,
    borderTopColor: theme.border.default,
    ...theme.shadow.raised,
    shadowOpacity: 0.08,
  },
  row: { flexDirection: "row" },
  indicator: {
    position: "absolute",
    top: 0,
    left: 0,
    width: INDICATOR_WIDTH,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: theme.brand.accent,
    alignItems: "flex-end",
  },
  spark: {
    width: 8,
    height: 3,
    borderBottomRightRadius: 3,
    backgroundColor: theme.accents.yellow,
  },
  item: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.space.sm,
    gap: 2,
  },
  iconSlot: { width: 52, height: 30, alignItems: "center", justifyContent: "center" },
  pill: {
    position: "absolute",
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.surface.accentSubtle,
  },
  label: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
  labelOn: { fontWeight: "800" },
});
