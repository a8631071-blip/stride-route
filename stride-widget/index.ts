import { requireOptionalNativeModule } from "expo-modules-core";

export type StrideStepSnapshot = {
  dateKey: string;
  steps: number;
  updatedAt: number;
  rawCounter: number | null;
  available: boolean;
  workoutId: string | null;
  workoutSteps: number;
};

type Subscription = { remove: () => void };

type NativeWidgetModule = {
  updateWidget(steps: number, goal: number, updatedAt: number, dateKey: string): Promise<boolean>;
  startStepCounter(dateKey: string, seedSteps: number): Promise<boolean>;
  seedDailySteps(dateKey: string, steps: number): Promise<boolean>;
  getStepSnapshot(): StrideStepSnapshot;
  refreshWidget(): Promise<boolean>;
  setLocale(locale: string): Promise<boolean>;
  startWorkoutStepSession(workoutId: string): Promise<boolean>;
  restoreWorkoutStepSession(workoutId: string, active: boolean, persistedSteps: number): Promise<boolean>;
  seedWorkoutSteps(workoutId: string, steps: number): Promise<boolean>;
  pauseWorkoutStepSession(workoutId: string): Promise<boolean>;
  resumeWorkoutStepSession(workoutId: string, persistedSteps: number): Promise<boolean>;
  stopWorkoutStepSession(workoutId: string): Promise<boolean>;
  addListener(eventName: "onDailyStepsChanged", listener: (snapshot: StrideStepSnapshot) => void): Subscription;
};

const nativeModule = requireOptionalNativeModule<NativeWidgetModule>("StrideWidgetBridge");

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function updateStrideWidget(steps: number, goal: number, updatedAt: number) {
  if (!nativeModule) return false;
  return nativeModule.updateWidget(Math.max(0, Math.round(steps)), Math.max(1, Math.round(goal)), Math.round(updatedAt), localDateKey(updatedAt));
}

export async function startStrideStepCounter(dateKey: string, seedSteps: number) {
  return nativeModule ? nativeModule.startStepCounter(dateKey, Math.max(0, Math.round(seedSteps))) : false;
}

export async function seedStrideDailySteps(dateKey: string, steps: number) {
  return nativeModule ? nativeModule.seedDailySteps(dateKey, Math.max(0, Math.round(steps))) : false;
}

export function getStrideStepSnapshot(): StrideStepSnapshot {
  return nativeModule?.getStepSnapshot() ?? { dateKey: "", steps: 0, updatedAt: 0, rawCounter: null, available: false, workoutId: null, workoutSteps: 0 };
}

export async function refreshStrideWidget() {
  return nativeModule ? nativeModule.refreshWidget() : false;
}

export async function setStrideWidgetLocale(locale: string) {
  return nativeModule ? nativeModule.setLocale(locale) : false;
}

export function subscribeStrideSteps(listener: (snapshot: StrideStepSnapshot) => void): Subscription | null {
  return nativeModule?.addListener("onDailyStepsChanged", listener) ?? null;
}

export async function startStrideWorkoutStepSession(workoutId: string) {
  return nativeModule ? nativeModule.startWorkoutStepSession(workoutId) : false;
}

export async function restoreStrideWorkoutStepSession(workoutId: string, active: boolean, persistedSteps: number) {
  return nativeModule ? nativeModule.restoreWorkoutStepSession(workoutId, active, Math.max(0, Math.round(persistedSteps))) : false;
}

export async function seedStrideWorkoutSteps(workoutId: string, steps: number) {
  return nativeModule ? nativeModule.seedWorkoutSteps(workoutId, Math.max(0, Math.round(steps))) : false;
}

export async function pauseStrideWorkoutStepSession(workoutId: string) {
  return nativeModule ? nativeModule.pauseWorkoutStepSession(workoutId) : false;
}

export async function resumeStrideWorkoutStepSession(workoutId: string, persistedSteps: number) {
  return nativeModule ? nativeModule.resumeWorkoutStepSession(workoutId, Math.max(0, Math.round(persistedSteps))) : false;
}

export async function stopStrideWorkoutStepSession(workoutId: string) {
  return nativeModule ? nativeModule.stopWorkoutStepSession(workoutId) : false;
}
