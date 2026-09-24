import { useEffect } from "react";
import { Tabs, usePathname, useRouter } from "expo-router";
import { BackHandler, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

export default function TabLayout() {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const isHome = pathname === "/" || pathname === "/index";
      if (isHome) return false;
      router.replace("/(tabs)" as never);
      return true;
    });
    return () => subscription.remove();
  }, [pathname, router]);

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.tint,
      headerShown: false,
      tabBarButton: HapticTab,
      tabBarStyle: { paddingTop: 8, paddingBottom: bottomPadding, height: 56 + bottomPadding, backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: 0.5 },
    }}>
      <Tabs.Screen name="index" options={{ title: t("tabs.today"), tabBarIcon: ({ color }) => <IconSymbol size={27} name="house.fill" color={color} /> }} />
      <Tabs.Screen name="analysis" options={{ title: t("tabs.analysis"), tabBarIcon: ({ color }) => <IconSymbol size={27} name="chart.bar.fill" color={color} /> }} />
      <Tabs.Screen name="workout" options={{ title: t("tabs.workout"), tabBarIcon: ({ color }) => <IconSymbol size={29} name="figure.walk" color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: t("tabs.history"), tabBarIcon: ({ color }) => <IconSymbol size={27} name="clock.arrow.circlepath" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings"), tabBarIcon: ({ color }) => <IconSymbol size={27} name="gearshape.fill" color={color} /> }} />
    </Tabs>
  );
}
