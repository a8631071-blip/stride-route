import "@/global.css";
import "react-native-reanimated";
import "@/lib/_core/nativewind-pressable";
import "@/lib/fitness/background-location";

import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { checkForPlayUpdate, installDownloadedPlayUpdate } from "@/lib/app-update";
import { readFeatureSettings } from "@/lib/feature-settings";
import { FitnessProvider } from "@/lib/fitness/fitness-provider";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme-provider";

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  useEffect(() => {
    void readFeatureSettings().then((settings) => {
      void installDownloadedPlayUpdate();
      if (settings.autoUpdateCheckEnabled) void checkForPlayUpdate(true);
    }).catch(() => undefined);
  }, []);

  return (
    <I18nProvider>
      <ThemeProvider>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <FitnessProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="history/[id]" />
            </Stack>
            <StatusBar style="auto" />
          </FitnessProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
