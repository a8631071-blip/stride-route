import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { maybeAnnounceWorkoutProgress } from "./speech";
import { readLanguageSetting, resolveLanguage, translate } from "@/lib/i18n-core";
import { appendPointsToActiveWorkout, logDiagnosticEvent } from "./storage";
import type { RoutePoint } from "./types";

export const BACKGROUND_LOCATION_TASK = "stride-route.background-location.v3";

const asRoutePoint = (location: Location.LocationObject): RoutePoint => ({
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  timestamp: location.timestamp,
  accuracy: location.coords.accuracy,
  speed: location.coords.speed,
  altitude: location.coords.altitude,
  segmentIndex: 0,
  source: "background",
});

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      await logDiagnosticEvent("background-location", error.message ?? "background location task error");
      return;
    }
    if (!data) return;
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    if (!locations.length) return;
    try {
      const updated = await appendPointsToActiveWorkout(locations.map(asRoutePoint));
      if (updated) await maybeAnnounceWorkoutProgress(updated).catch(() => undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "background location write failed";
      await logDiagnosticEvent("background-location", message);
      // 背景工作不能把例外拋回作業系統；下次前景恢復會重新讀取 SQLite。
    }
  });
}

export async function startBackgroundLocationTracking() {
  if (Platform.OS === "web") return false;
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) return true;
  const locale = resolveLanguage(await readLanguageSetting());
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 5,
    timeInterval: 5_000,
    deferredUpdatesDistance: 10,
    deferredUpdatesInterval: 10_000,
    foregroundService: {
      notificationTitle: translate("background.notificationTitle", {}, locale),
      notificationBody: translate("background.notificationBody", {}, locale),
      notificationColor: "#1479FF",
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
  return true;
}

export async function stopBackgroundLocationTracking() {
  if (Platform.OS === "web") return;
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
