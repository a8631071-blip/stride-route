import { requireOptionalNativeModule } from "expo-modules-core";

export type DetectedActivityType = "in_vehicle" | "on_bicycle" | "on_foot" | "running" | "still" | "tilting" | "walking" | "unknown";

export type DetectedActivitySnapshot = {
  type: DetectedActivityType;
  confidence: number;
  updatedAt: number;
};

type NativeModule = {
  startTracking(): Promise<boolean>;
  stopTracking(): Promise<boolean>;
  getCurrentActivity(): DetectedActivitySnapshot;
};

const nativeModule = requireOptionalNativeModule<NativeModule>("StrideActivityRecognition");

export async function startActivityRecognition() {
  return nativeModule ? nativeModule.startTracking() : false;
}

export async function stopActivityRecognition() {
  return nativeModule ? nativeModule.stopTracking() : false;
}

export function getCurrentActivity(): DetectedActivitySnapshot {
  return nativeModule?.getCurrentActivity() ?? { type: "unknown", confidence: 0, updatedAt: 0 };
}

export function blocksWorkoutStepCounting(snapshot: DetectedActivitySnapshot, now = Date.now()) {
  if (now - snapshot.updatedAt > 12_000 || snapshot.confidence < 70) return false;
  // STILL is not evidence that a valid walking increment is bogus. Only a
  // recent, high-confidence vehicle/bicycle result may suppress increments.
  return snapshot.type === "in_vehicle" || snapshot.type === "on_bicycle";
}
