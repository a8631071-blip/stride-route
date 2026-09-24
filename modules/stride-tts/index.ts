import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type WorkoutRuntimePoint = {
  sequence: number;
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
  altitude: number | null;
  segmentIndex: number;
  source: "native";
};

export type WorkoutRuntimeSnapshot = {
  workoutId: string | null;
  workoutType: string;
  status: string;
  startedAt: number;
  pausedAt: number;
  pausedMillis: number;
  segmentIndex: number;
  distanceMeters: number;
  maxSpeedMps: number;
  lastLocationAt: number;
  lastAccuracy: number | null;
  acceptedPoints: number;
  rejectedPoints: number;
  maxGapMs: number;
  sequence: number;
  nextTimeCueMs: number;
  nextDistanceCueMeters: number;
  wakeLockHeld: boolean;
};

export type WorkoutRuntimeConfig = {
  workoutId: string;
  workoutType: "walk" | "run" | "shopping" | "bike";
  startedAt: number;
  segmentIndex: number;
  voiceEnabled: boolean;
  cueBasis: "time" | "distance";
  intervalMinutes: number;
  intervalMeters: number;
  voiceMode: "single" | "bilingual";
  primaryLocale: string;
  primaryEngine: string;
  secondaryLocale: string;
  secondaryEngine: string;
  notificationTitle: string;
  notificationBody: string;
};

export type TtsEngineMatch = {
  available: boolean;
  enginePackage: string | null;
  engineLabel: string | null;
  status: number;
};

type NativeStrideTtsModule = {
  findEngineForLanguage(languageTag: string): Promise<TtsEngineMatch>;
  speak(text: string, languageTag: string, enginePackage: string): Promise<boolean>;
  hasPackagedTaigiVoice(): Promise<boolean>;
  playTaigiTokens(tokens: string[]): Promise<boolean>;
  startWorkoutRuntime(configJson: string): Promise<boolean>;
  pauseWorkoutRuntime(): Promise<boolean>;
  resumeWorkoutRuntime(segmentIndex: number, configJson: string): Promise<boolean>;
  updateWorkoutRuntimeVoice(configJson: string): Promise<boolean>;
  stopWorkoutRuntime(): Promise<WorkoutRuntimeSnapshot>;
  getWorkoutRuntimeSnapshot(): WorkoutRuntimeSnapshot;
  readWorkoutRuntimePoints(sinceSequence: number): WorkoutRuntimePoint[];
  stop(): Promise<boolean>;
  openTtsSettings(): Promise<boolean>;
  installTtsData(): Promise<boolean>;
  openPlayStore(packageName: string): Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule<NativeStrideTtsModule>("StrideTts");

export async function findTtsEngineForLanguage(languageTag: string): Promise<TtsEngineMatch> {
  if (Platform.OS !== "android" || !nativeModule) return { available: false, enginePackage: null, engineLabel: null, status: -99 };
  return nativeModule.findEngineForLanguage(languageTag);
}

export async function speakNativeTts(text: string, languageTag: string, enginePackage?: string | null) {
  if (Platform.OS !== "android" || !nativeModule) return false;
  return nativeModule.speak(text, languageTag, enginePackage ?? "");
}

export async function hasPackagedTaigiVoice() {
  return Platform.OS === "android" && nativeModule ? nativeModule.hasPackagedTaigiVoice() : false;
}

export async function playPackagedTaigiTokens(tokens: string[]) {
  if (Platform.OS !== "android" || !nativeModule || !tokens.length) return false;
  return nativeModule.playTaigiTokens(tokens);
}

export async function startWorkoutRuntime(config: WorkoutRuntimeConfig) {
  return Platform.OS === "android" && nativeModule ? nativeModule.startWorkoutRuntime(JSON.stringify(config)) : false;
}

export async function pauseWorkoutRuntime() {
  return Platform.OS === "android" && nativeModule ? nativeModule.pauseWorkoutRuntime() : false;
}

export async function resumeWorkoutRuntime(segmentIndex: number, config: WorkoutRuntimeConfig) {
  return Platform.OS === "android" && nativeModule ? nativeModule.resumeWorkoutRuntime(segmentIndex, JSON.stringify(config)) : false;
}

export async function updateWorkoutRuntimeVoice(config: WorkoutRuntimeConfig) {
  return Platform.OS === "android" && nativeModule ? nativeModule.updateWorkoutRuntimeVoice(JSON.stringify(config)) : false;
}

export async function stopWorkoutRuntime() {
  return Platform.OS === "android" && nativeModule ? nativeModule.stopWorkoutRuntime() : null;
}

export function getWorkoutRuntimeSnapshot(): WorkoutRuntimeSnapshot | null {
  return Platform.OS === "android" && nativeModule ? nativeModule.getWorkoutRuntimeSnapshot() : null;
}

export function readWorkoutRuntimePoints(sinceSequence: number): WorkoutRuntimePoint[] {
  return Platform.OS === "android" && nativeModule ? nativeModule.readWorkoutRuntimePoints(sinceSequence) : [];
}

export async function stopNativeTts() {
  return Platform.OS === "android" && nativeModule ? nativeModule.stop() : false;
}

export async function openSystemTtsSettings() {
  return Platform.OS === "android" && nativeModule ? nativeModule.openTtsSettings() : false;
}

export async function installSystemTtsData() {
  return Platform.OS === "android" && nativeModule ? nativeModule.installTtsData() : false;
}

export async function openTtsPlayStore(packageName: string) {
  return Platform.OS === "android" && nativeModule ? nativeModule.openPlayStore(packageName) : false;
}
