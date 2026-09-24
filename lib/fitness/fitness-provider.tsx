import { type PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";

import { startActivityRecognition, stopActivityRecognition } from "@/modules/stride-activity-recognition";
import { translate } from "@/lib/i18n-core";
import {
  getStrideStepSnapshot,
  pauseStrideWorkoutStepSession,
  refreshStrideWidget,
  restoreStrideWorkoutStepSession,
  resumeStrideWorkoutStepSession,
  seedStrideDailySteps,
  seedStrideWorkoutSteps,
  startStrideStepCounter,
  startStrideWorkoutStepSession,
  stopStrideWorkoutStepSession,
  subscribeStrideSteps,
  updateStrideWidget,
  type StrideStepSnapshot,
} from "@/modules/stride-widget";
import { startBackgroundLocationTracking, stopBackgroundLocationTracking } from "./background-location";
import { buildNativeWorkoutVoiceConfig, maybeAnnounceWorkoutProgress } from "./speech";
import { getWorkoutRuntimeSnapshot, pauseWorkoutRuntime, readWorkoutRuntimePoints, resumeWorkoutRuntime, startWorkoutRuntime, stopWorkoutRuntime, type WorkoutRuntimeConfig } from "@/modules/stride-tts";
import { dateKey, GPS_PROFILES } from "./math";
import {
  completeWorkoutRecord,
  createWorkout,
  deleteWorkoutRecord,
  initFitnessStorage,
  insertWorkout,
  pauseWorkoutRecord,
  readActiveWorkout,
  readDailySteps,
  readSettings,
  readStepHistory,
  readWorkoutSession,
  readWorkoutSessions,
  readWorkoutActiveIntervals,
  resumeWorkoutRecord,
  updateWorkoutSteps,
  writeDailySteps,
  writeSettings,
  appendPointsToActiveWorkout,
  flushRouteMutations,
  logDiagnosticEvent,
} from "./storage";
import {
  getHealthConnectState,
  readHealthConnectDailySteps,
  readHealthConnectStepsBetween,
  requestHealthConnectStepsPermission,
} from "./health-connect";
import { prepareV7StepPolicy, writeAuthoritativeHealthSteps } from "./step-policy";
import type { AppSettings, DailyStepHistory, HealthConnectState, RoutePoint, WorkoutSession, WorkoutType } from "./types";

type PermissionState = "unknown" | "granted" | "denied" | "unavailable";
export type GpsFixState = "off" | "searching" | "fixed" | "weak" | "paused";

type FitnessContextValue = {
  isReady: boolean;
  settings: AppSettings;
  sessions: WorkoutSession[];
  activeWorkout: WorkoutSession | null;
  dailySteps: number | null;
  stepHistory: DailyStepHistory;
  liveWorkoutSteps: number;
  pedometerState: PermissionState;
  healthConnectState: HealthConnectState;
  locationState: PermissionState;
  backgroundLocationState: PermissionState;
  gpsFixState: GpsFixState;
  locationMessage: string | null;
  pedometerMessage: string | null;
  enableStepTracking: () => Promise<boolean>;
  syncDailySteps: () => Promise<void>;
  requestForegroundLocation: () => Promise<boolean>;
  setBackgroundTrackingEnabled: (enabled: boolean) => Promise<boolean>;
  setDailyStepGoal: (goal: number) => Promise<void>;
  setHeightCm: (heightCm: number | null) => Promise<void>;
  setWeightKg: (weightKg: number | null) => Promise<void>;
  markGpsRecommendationShown: () => Promise<void>;
  startWorkout: (type: WorkoutType) => Promise<WorkoutSession>;
  pauseWorkout: () => Promise<void>;
  resumeWorkout: () => Promise<void>;
  completeWorkout: () => Promise<WorkoutSession | null>;
  deleteWorkout: (id: string) => Promise<void>;
  loadWorkout: (id: string) => Promise<WorkoutSession | null>;
  refreshSessions: () => Promise<void>;
  refreshStepHistory: () => Promise<void>;
};

const FitnessContext = createContext<FitnessContextValue | null>(null);

const toRoutePoint = (location: Location.LocationObject): RoutePoint => ({
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  timestamp: location.timestamp,
  accuracy: location.coords.accuracy,
  speed: location.coords.speed,
  altitude: location.coords.altitude,
  segmentIndex: 0,
  source: "foreground",
});

export function FitnessProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({ dailyStepGoal: 10_000, backgroundTrackingEnabled: false, gpsRecommendationShown: false, heightCm: null, weightKg: null });
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null);
  const [dailySteps, setDailySteps] = useState<number | null>(null);
  const [stepHistory, setStepHistory] = useState<DailyStepHistory>({});
  const [liveWorkoutSteps, setLiveWorkoutSteps] = useState(0);
  const [pedometerState, setPedometerState] = useState<PermissionState>("unknown");
  const [healthConnectState, setHealthConnectState] = useState<HealthConnectState>("unknown");
  const [locationState, setLocationState] = useState<PermissionState>("unknown");
  const [backgroundLocationState, setBackgroundLocationState] = useState<PermissionState>("unknown");
  const [gpsFixState, setGpsFixState] = useState<GpsFixState>("searching");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [pedometerMessage, setPedometerMessage] = useState<string | null>(null);

  const foregroundSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const nativeRuntimeSequenceRef = useRef(0);
  const nativeStepSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const nativeStepStartedRef = useRef(false);
  const activeWorkoutRef = useRef<WorkoutSession | null>(null);
  const settingsRef = useRef(settings);
  const backgroundLocationStateRef = useRef(backgroundLocationState);
  const healthConnectStateRef = useRef(healthConnectState);
  const persistedDailyStepsRef = useRef(0);
  const dailyDisplayStepsRef = useRef(0);
  const lastPersistedWorkoutStepsRef = useRef(0);

  useEffect(() => { activeWorkoutRef.current = activeWorkout; }, [activeWorkout]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { backgroundLocationStateRef.current = backgroundLocationState; }, [backgroundLocationState]);
  useEffect(() => { healthConnectStateRef.current = healthConnectState; }, [healthConnectState]);

  const refreshPermissionStates = useCallback(async () => {
    if (Platform.OS === "web") {
      setPedometerState("unavailable"); setBackgroundLocationState("unavailable"); setLocationState("unavailable"); setHealthConnectState("unavailable");
      return;
    }
    const [pedometerAvailable, pedometerPermission, foregroundPermission, backgroundPermission, hcState, servicesEnabled] = await Promise.all([
      Pedometer.isAvailableAsync().catch(() => false),
      Pedometer.getPermissionsAsync().catch(() => null),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
      getHealthConnectState(),
      Location.hasServicesEnabledAsync().catch(() => true),
    ]);
    setPedometerState(pedometerAvailable ? (pedometerPermission?.granted ? "granted" : "denied") : "unavailable");
    setLocationState(foregroundPermission.granted ? "granted" : "denied");
    setBackgroundLocationState(backgroundPermission.granted ? "granted" : "denied");
    setHealthConnectState(hcState);
    if (!servicesEnabled) setGpsFixState("off");
  }, []);

  const refreshSessions = useCallback(async () => {
    const [summary, active] = await Promise.all([readWorkoutSessions(), readActiveWorkout()]);
    setSessions(summary);
    setActiveWorkout(active);
    activeWorkoutRef.current = active;
    if (active) {
      lastPersistedWorkoutStepsRef.current = active.steps;
      setLiveWorkoutSteps(active.type === "bike" ? 0 : active.steps);
    } else {
      setLiveWorkoutSteps(0);
    }
  }, []);

  const applyNativeStepSnapshot = useCallback((snapshot: StrideStepSnapshot) => {
    const todayKey = dateKey();
    if (snapshot.dateKey === todayKey) {
      const next = Math.max(0, Math.round(snapshot.steps));
      persistedDailyStepsRef.current = next;
      dailyDisplayStepsRef.current = next;
      setDailySteps(next);
      setStepHistory((current) => ({ ...current, [todayKey]: next }));
      void writeDailySteps({ dateKey: todayKey, steps: next, source: "sensor", updatedAt: snapshot.updatedAt || Date.now() }).catch(() => undefined);
    }

    const active = activeWorkoutRef.current;
    if (active?.type !== "bike" && snapshot.workoutId === active?.id) {
      const nextWorkoutSteps = Math.max(active.steps, Math.round(snapshot.workoutSteps));
      setLiveWorkoutSteps(nextWorkoutSteps);
      if (Math.abs(nextWorkoutSteps - lastPersistedWorkoutStepsRef.current) >= 5) {
        lastPersistedWorkoutStepsRef.current = nextWorkoutSteps;
        void updateWorkoutSteps(active.id, nextWorkoutSteps).catch(() => undefined);
      }
    }
  }, []);

  const startNativeStepCounter = useCallback(async () => {
    if (Platform.OS !== "android" || nativeStepStartedRef.current) return nativeStepStartedRef.current;
    const permission = await Pedometer.getPermissionsAsync().catch(() => null);
    if (!permission?.granted) return false;
    const today = await readDailySteps();
    const started = await startStrideStepCounter(today.dateKey, today.steps).catch(() => false);
    if (!started) return false;
    nativeStepStartedRef.current = true;
    if (!nativeStepSubscriptionRef.current) nativeStepSubscriptionRef.current = subscribeStrideSteps(applyNativeStepSnapshot);
    applyNativeStepSnapshot(getStrideStepSnapshot());
    return true;
  }, [applyNativeStepSnapshot]);

  const refreshStepHistory = useCallback(async () => {
    const [history, today] = await Promise.all([readStepHistory(), readDailySteps()]);
    if (Platform.OS === "android") await seedStrideDailySteps(today.dateKey, today.steps).catch(() => false);
    const native = Platform.OS === "android" ? getStrideStepSnapshot() : null;
    const displaySteps = native?.dateKey === today.dateKey ? Math.max(today.steps, Math.round(native.steps)) : today.steps;
    if (displaySteps > today.steps) await writeDailySteps({ dateKey: today.dateKey, steps: displaySteps, source: "sensor" }).catch(() => undefined);
    const nextHistory = { ...history, [today.dateKey]: Math.max(history[today.dateKey] ?? 0, displaySteps) };
    setStepHistory(nextHistory);
    persistedDailyStepsRef.current = displaySteps;
    dailyDisplayStepsRef.current = displaySteps;
    setDailySteps(displaySteps);
    void updateStrideWidget(displaySteps, settingsRef.current.dailyStepGoal, Date.now()).catch(() => undefined);
  }, []);

  const syncDailySteps = useCallback(async () => {
    if (Platform.OS !== "android" || healthConnectStateRef.current !== "granted") {
      await refreshStepHistory();
      return;
    }
    try {
      const daily = await readHealthConnectDailySteps(30);
      await writeAuthoritativeHealthSteps(daily);
      const today = await readDailySteps();
      await seedStrideDailySteps(today.dateKey, today.steps).catch(() => false);
      await refreshStepHistory();
    } catch {
      await refreshStepHistory();
    }
  }, [refreshStepHistory]);

  const requestPedometerPermission = useCallback(async () => {
    if (Platform.OS === "web") { setPedometerState("unavailable"); return false; }
    const available = await Pedometer.isAvailableAsync().catch(() => false);
    if (!available) { setPedometerState("unavailable"); return false; }
    const permission = await Pedometer.requestPermissionsAsync();
    if (!permission.granted) { setPedometerState("denied"); return false; }
    setPedometerState("granted");
    setPedometerMessage(null);
    await startActivityRecognition().catch(() => false);
    await startNativeStepCounter();
    return true;
  }, [startNativeStepCounter]);

  const enableStepTracking = useCallback(async () => {
    let healthGranted = healthConnectStateRef.current === "granted";
    if (Platform.OS === "android" && !healthGranted) {
      healthGranted = await requestHealthConnectStepsPermission();
      const nextState = healthGranted ? "granted" : await getHealthConnectState();
      setHealthConnectState(nextState);
      healthConnectStateRef.current = nextState;
    }
    const sensorGranted = await requestPedometerPermission();
    if (healthGranted) await syncDailySteps();
    return healthGranted || sensorGranted;
  }, [requestPedometerPermission, syncDailySteps]);

  const requestForegroundLocation = useCallback(async () => {
    if (Platform.OS === "web") { setLocationState("unavailable"); return false; }
    const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!servicesEnabled) {
      setGpsFixState("off");
      setLocationMessage(translate("provider.gpsOff"));
      return false;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) { setLocationMessage(translate("provider.locationDenied")); setLocationState("denied"); return false; }
    setLocationMessage(null); setLocationState("granted"); setGpsFixState("searching"); return true;
  }, []);

  const recordRoutePoint = useCallback(async (point: RoutePoint) => {
    const active = activeWorkoutRef.current;
    if (active) {
      const maxAccuracy = GPS_PROFILES[active.type].maxAccuracyMeters;
      if (point.accuracy != null && point.accuracy > maxAccuracy) setGpsFixState("weak");
      else setGpsFixState("fixed");
    }
    const updated = await appendPointsToActiveWorkout([point]);
    if (updated) {
      setActiveWorkout(updated);
      activeWorkoutRef.current = updated;
      void maybeAnnounceWorkoutProgress(updated).catch(() => undefined);
    }
  }, []);

  const nativeRuntimeConfig = useCallback(async (session: WorkoutSession): Promise<WorkoutRuntimeConfig> => {
    const voice = await buildNativeWorkoutVoiceConfig();
    return {
      workoutId: session.id,
      workoutType: session.type,
      startedAt: session.startedAt,
      segmentIndex: session.currentSegmentIndex,
      ...voice,
      notificationTitle: translate("background.notificationTitle"),
      notificationBody: translate("background.notificationBody"),
    };
  }, []);

  const syncNativeWorkoutRuntime = useCallback(async () => {
    if (Platform.OS !== "android") return null;
    const active = activeWorkoutRef.current;
    if (!active) return null;

    const points = readWorkoutRuntimePoints(nativeRuntimeSequenceRef.current);
    if (points.length) {
      nativeRuntimeSequenceRef.current = Math.max(
        nativeRuntimeSequenceRef.current,
        ...points.map((point) => point.sequence),
      );
      await appendPointsToActiveWorkout(points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: point.timestamp,
        accuracy: point.accuracy,
        speed: point.speed,
        altitude: point.altitude,
        segmentIndex: point.segmentIndex,
        source: "background" as const,
      })));
    }

    const updated = await readActiveWorkout();
    if (updated) {
      setActiveWorkout(updated);
      activeWorkoutRef.current = updated;
      const snapshot = getWorkoutRuntimeSnapshot();
      if (snapshot?.lastLocationAt) {
        if (Date.now() - snapshot.lastLocationAt > 20_000) {
          setGpsFixState("weak");
        } else if (snapshot.lastAccuracy != null && snapshot.lastAccuracy > GPS_PROFILES[updated.type].maxAccuracyMeters) {
          setGpsFixState("weak");
        } else {
          setGpsFixState("fixed");
        }
      }
    }
    return updated;
  }, []);

  const startForegroundTracking = useCallback(async () => {
    foregroundSubscriptionRef.current?.remove();
    setGpsFixState("searching");
    foregroundSubscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 5_000, mayShowUserSettingsDialog: true },
      (location) => { void recordRoutePoint(toRoutePoint(location)).catch(() => undefined); },
      (error) => { setLocationMessage(error); setGpsFixState("searching"); },
    );
  }, [recordRoutePoint]);

  const stopAllLocationTracking = useCallback(async () => {
    foregroundSubscriptionRef.current?.remove();
    foregroundSubscriptionRef.current = null;
    await stopBackgroundLocationTracking().catch(() => undefined);
  }, []);

  const startLocationWriter = useCallback(async () => {
    foregroundSubscriptionRef.current?.remove();
    foregroundSubscriptionRef.current = null;
    setGpsFixState("searching");

    if (Platform.OS === "android") {
      await stopBackgroundLocationTracking().catch(() => undefined);
      const session = activeWorkoutRef.current;
      if (!session) return;
      const config = await nativeRuntimeConfig(session);
      const started = await startWorkoutRuntime(config);
      if (!started) throw new Error("native workout runtime start failed");
      setLocationMessage(null);
      await syncNativeWorkoutRuntime().catch(() => undefined);
      return;
    }

    if (settingsRef.current.backgroundTrackingEnabled && backgroundLocationStateRef.current === "granted") {
      try {
        await startBackgroundLocationTracking();
        setLocationMessage(null);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "background location start failed";
        await logDiagnosticEvent("background-location-start", message).catch(() => undefined);
        await stopBackgroundLocationTracking().catch(() => undefined);
        await startForegroundTracking();
        setLocationMessage(translate("provider.backgroundFailed"));
        return;
      }
    }
    await stopBackgroundLocationTracking().catch(() => undefined);
    await startForegroundTracking();
    setLocationMessage(settingsRef.current.backgroundTrackingEnabled ? translate("provider.backgroundMissing") : null);
  }, [nativeRuntimeConfig, startForegroundTracking, syncNativeWorkoutRuntime]);

  const setBackgroundTrackingEnabled = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      const next = { ...settingsRef.current, backgroundTrackingEnabled: false };
      settingsRef.current = next; setSettings(next); await writeSettings(next);
      if (activeWorkoutRef.current?.status === "active") await startLocationWriter();
      return true;
    }
    if (Platform.OS === "web") { setBackgroundLocationState("unavailable"); return false; }
    if (!await requestForegroundLocation()) return false;
    const permission = await Location.requestBackgroundPermissionsAsync();
    if (!permission.granted) { setBackgroundLocationState("denied"); backgroundLocationStateRef.current = "denied"; return false; }
    setBackgroundLocationState("granted"); backgroundLocationStateRef.current = "granted";
    const next = { ...settingsRef.current, backgroundTrackingEnabled: true };
    settingsRef.current = next; setSettings(next); await writeSettings(next);
    if (activeWorkoutRef.current?.status === "active") await startLocationWriter();
    return true;
  }, [requestForegroundLocation, startLocationWriter]);

  const setDailyStepGoal = useCallback(async (goal: number) => {
    const next = { ...settingsRef.current, dailyStepGoal: Math.max(1_000, Math.min(Math.round(goal), 50_000)) };
    settingsRef.current = next; setSettings(next); await writeSettings(next);
    void updateStrideWidget(dailyDisplayStepsRef.current, next.dailyStepGoal, Date.now()).catch(() => undefined);
  }, []);

  const setHeightCm = useCallback(async (heightCm: number | null) => {
    const value = heightCm == null ? null : Math.max(100, Math.min(Math.round(heightCm), 230));
    const next = { ...settingsRef.current, heightCm: value };
    settingsRef.current = next; setSettings(next); await writeSettings(next);
  }, []);

  const setWeightKg = useCallback(async (weightKg: number | null) => {
    const value = weightKg == null ? null : Math.max(30, Math.min(Math.round(weightKg * 10) / 10, 250));
    const next = { ...settingsRef.current, weightKg: value };
    settingsRef.current = next; setSettings(next); await writeSettings(next);
  }, []);

  const markGpsRecommendationShown = useCallback(async () => {
    if (settingsRef.current.gpsRecommendationShown) return;
    const next = { ...settingsRef.current, gpsRecommendationShown: true };
    settingsRef.current = next; setSettings(next); await writeSettings(next);
  }, []);

  const readWorkoutStepsFromHealthConnect = useCallback(async (workoutId: string, openEndedAt: number) => {
    if (healthConnectStateRef.current !== "granted") return null;
    const intervals = await readWorkoutActiveIntervals(workoutId, openEndedAt);
    if (!intervals.length) return 0;
    let total = 0;
    for (const interval of intervals) {
      const value = await readHealthConnectStepsBetween(interval.startedAt, interval.endedAt);
      if (value == null) return null;
      total += value;
    }
    return total;
  }, []);

  const syncActiveWorkoutStepsFromHealthConnect = useCallback(async () => {
    const active = activeWorkoutRef.current;
    if (!active || active.type === "bike" || healthConnectStateRef.current !== "granted") return;
    const fromHealth = await readWorkoutStepsFromHealthConnect(active.id, Date.now());
    if (fromHealth == null) return;
    const native = getStrideStepSnapshot();
    const nativeSteps = native.workoutId === active.id ? native.workoutSteps : 0;
    const nextSteps = Math.max(active.steps, nativeSteps, fromHealth);
    lastPersistedWorkoutStepsRef.current = nextSteps;
    setLiveWorkoutSteps(nextSteps);
    await seedStrideWorkoutSteps(active.id, nextSteps).catch(() => false);
    await updateWorkoutSteps(active.id, nextSteps);
  }, [readWorkoutStepsFromHealthConnect]);

  const startWorkout = useCallback(async (type: WorkoutType) => {
    if (activeWorkoutRef.current) throw new Error(translate("provider.activeExists"));
    if (!await requestForegroundLocation()) throw new Error(translate("provider.startNeedsGps"));
    if (type !== "bike") {
      const pedometerGranted = await requestPedometerPermission().catch(() => false);
      if (!pedometerGranted) setPedometerMessage(translate("provider.stepsUnavailable"));
    }

    setGpsFixState("searching");
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
    const maxAccuracy = GPS_PROFILES[type].maxAccuracyMeters;
    const stableInitialPosition = position?.coords.accuracy != null && position.coords.accuracy <= Math.min(20, maxAccuracy) ? position : null;
    if (stableInitialPosition) setGpsFixState("fixed");
    else if (position?.coords.accuracy != null) {
      setGpsFixState("weak");
      setLocationMessage(translate("provider.gpsWeakStart"));
    } else {
      setLocationMessage(translate("provider.gpsSearchingStart"));
    }

    const workout = createWorkout(type, stableInitialPosition ? { ...toRoutePoint(stableInitialPosition), source: "initial" } : null);
    nativeRuntimeSequenceRef.current = 0;
    lastPersistedWorkoutStepsRef.current = 0;
    setLiveWorkoutSteps(0);
    await insertWorkout(workout);
    if (type !== "bike") await startStrideWorkoutStepSession(workout.id).catch(() => false);
    const persisted = await readActiveWorkout();
    setActiveWorkout(persisted ?? workout); activeWorkoutRef.current = persisted ?? workout;
    try {
      await startLocationWriter();
    } catch (error) {
      await stopAllLocationTracking().catch(() => undefined);
      if (type !== "bike") await stopStrideWorkoutStepSession(workout.id).catch(() => false);
      await deleteWorkoutRecord(workout.id).catch(() => undefined);
      setActiveWorkout(null); activeWorkoutRef.current = null; setLiveWorkoutSteps(0);
      throw error;
    }
    return persisted ?? workout;
  }, [requestForegroundLocation, requestPedometerPermission, startLocationWriter, stopAllLocationTracking]);

  const pauseWorkout = useCallback(async () => {
    const active = activeWorkoutRef.current;
    if (!active || active.status !== "active") return;
    if (active.type !== "bike") await pauseStrideWorkoutStepSession(active.id).catch(() => false);
    if (Platform.OS === "android") {
      await pauseWorkoutRuntime().catch(() => false);
      await syncNativeWorkoutRuntime().catch(() => undefined);
    } else {
      await stopAllLocationTracking();
    }
    setGpsFixState("paused");
    await flushRouteMutations();
    const pausedAt = Date.now();
    const native = getStrideStepSnapshot();
    let steps = active.type === "bike" ? 0 : Math.max(active.steps, native.workoutId === active.id ? native.workoutSteps : 0, liveWorkoutSteps);
    if (active.type !== "bike" && healthConnectStateRef.current === "granted") {
      const healthSteps = await readWorkoutStepsFromHealthConnect(active.id, pausedAt);
      if (healthSteps != null) steps = Math.max(steps, healthSteps);
    }
    lastPersistedWorkoutStepsRef.current = steps;
    setLiveWorkoutSteps(steps);
    if (active.type !== "bike") await seedStrideWorkoutSteps(active.id, steps).catch(() => false);
    await pauseWorkoutRecord(active.id, steps, pausedAt);
    const updated = await readActiveWorkout();
    setActiveWorkout(updated); activeWorkoutRef.current = updated;
  }, [liveWorkoutSteps, readWorkoutStepsFromHealthConnect, stopAllLocationTracking]);

  const resumeWorkout = useCallback(async () => {
    const active = activeWorkoutRef.current;
    if (!active || active.status !== "paused") return;
    await resumeWorkoutRecord(active.id);
    const updated = await readActiveWorkout();
    if (!updated) return;
    if (updated.type !== "bike") await resumeStrideWorkoutStepSession(updated.id, updated.steps).catch(() => false);
    setLiveWorkoutSteps(updated.type === "bike" ? 0 : updated.steps);
    lastPersistedWorkoutStepsRef.current = updated.steps;
    setActiveWorkout(updated); activeWorkoutRef.current = updated;
    setGpsFixState("searching");
    if (Platform.OS === "android") {
      const config = await nativeRuntimeConfig(updated);
      await resumeWorkoutRuntime(updated.currentSegmentIndex, config);
      await syncNativeWorkoutRuntime().catch(() => undefined);
    } else {
      await startLocationWriter();
    }
  }, [nativeRuntimeConfig, startLocationWriter, syncNativeWorkoutRuntime]);

  const completeWorkout = useCallback(async () => {
    const active = activeWorkoutRef.current;
    if (!active) return null;
    if (active.type !== "bike") await pauseStrideWorkoutStepSession(active.id).catch(() => false);
    if (Platform.OS === "android") {
      await stopWorkoutRuntime().catch(() => undefined);
      await syncNativeWorkoutRuntime().catch(() => undefined);
    } else {
      await stopAllLocationTracking();
    }
    await flushRouteMutations();
    const endedAt = Date.now();
    const native = getStrideStepSnapshot();
    let steps = active.type === "bike" ? 0 : Math.max(active.steps, native.workoutId === active.id ? native.workoutSteps : 0, liveWorkoutSteps);
    if (active.type !== "bike" && healthConnectStateRef.current === "granted") {
      const healthSteps = await readWorkoutStepsFromHealthConnect(active.id, endedAt);
      if (healthSteps != null) steps = Math.max(steps, healthSteps);
    }
    const completed = await completeWorkoutRecord(active.id, steps, endedAt, settingsRef.current.weightKg);
    if (active.type !== "bike") await stopStrideWorkoutStepSession(active.id).catch(() => false);
    setActiveWorkout(null); activeWorkoutRef.current = null; setLiveWorkoutSteps(0); setGpsFixState("searching");
    setPedometerMessage(null);
    await refreshSessions();
    await syncDailySteps().catch(() => undefined);
    return completed;
  }, [liveWorkoutSteps, readWorkoutStepsFromHealthConnect, refreshSessions, stopAllLocationTracking, syncDailySteps]);

  const deleteWorkout = useCallback(async (id: string) => {
    if (activeWorkoutRef.current?.id === id) {
      if (Platform.OS === "android") await stopWorkoutRuntime().catch(() => undefined);
      await stopAllLocationTracking();
      await flushRouteMutations();
      await stopStrideWorkoutStepSession(id).catch(() => false);
    }
    await deleteWorkoutRecord(id);
    await refreshSessions();
  }, [refreshSessions, stopAllLocationTracking]);

  const loadWorkout = useCallback((id: string) => readWorkoutSession(id), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await prepareV7StepPolicy().catch(() => undefined);
      await initFitnessStorage();
      const [savedSettings, summary, active, today, history] = await Promise.all([
        readSettings(), readWorkoutSessions(), readActiveWorkout(), readDailySteps(), readStepHistory(),
      ]);
      if (cancelled) return;
      settingsRef.current = savedSettings; setSettings(savedSettings);
      setSessions(summary); setActiveWorkout(active); activeWorkoutRef.current = active;
      setDailySteps(today.steps); dailyDisplayStepsRef.current = today.steps; setStepHistory(history); persistedDailyStepsRef.current = today.steps;
      if (active) { lastPersistedWorkoutStepsRef.current = active.steps; setLiveWorkoutSteps(active.type === "bike" ? 0 : active.steps); }
      await refreshPermissionStates().catch(() => undefined);
      const hcState = await getHealthConnectState();
      if (!cancelled) { setHealthConnectState(hcState); healthConnectStateRef.current = hcState; }
      if (Platform.OS !== "web") {
        const pedometerPermission = await Pedometer.getPermissionsAsync().catch(() => null);
        if (pedometerPermission?.granted) {
          await startActivityRecognition().catch(() => false);
          await startNativeStepCounter().catch(() => false);
          if (active && active.type !== "bike") {
            await restoreStrideWorkoutStepSession(active.id, active.status === "active", active.steps).catch(() => false);
            applyNativeStepSnapshot(getStrideStepSnapshot());
          }
        }
      }
      if (hcState === "granted") {
        await syncDailySteps().catch(() => undefined);
        if (active && active.type !== "bike") await syncActiveWorkoutStepsFromHealthConnect().catch(() => undefined);
      }
      void updateStrideWidget(dailyDisplayStepsRef.current, savedSettings.dailyStepGoal, Date.now()).catch(() => undefined);
      if (active?.status === "active") await startLocationWriter().catch(() => undefined);
      if (active?.status === "paused") setGpsFixState("paused");
      if (!cancelled) setIsReady(true);
    };
    void load();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void refreshStrideWidget().catch(() => false);
        return;
      }
      void (async () => {
        await refreshPermissionStates().catch(() => undefined);
        await syncNativeWorkoutRuntime().catch(() => undefined);
        await refreshSessions().catch(() => undefined);
        await startNativeStepCounter().catch(() => false);
        applyNativeStepSnapshot(getStrideStepSnapshot());
        const stateNow = await getHealthConnectState();
        setHealthConnectState(stateNow); healthConnectStateRef.current = stateNow;
        if (stateNow === "granted") await syncDailySteps().catch(() => undefined);
        await syncActiveWorkoutStepsFromHealthConnect().catch(() => undefined);
        const current = activeWorkoutRef.current;
        if (current?.type !== "bike" && current) {
          await restoreStrideWorkoutStepSession(current.id, current.status === "active", current.steps).catch(() => false);
          applyNativeStepSnapshot(getStrideStepSnapshot());
        }
        if (current?.status === "active") await startLocationWriter().catch(() => undefined);
        else if (current?.status === "paused") setGpsFixState("paused");
        void refreshStrideWidget().catch(() => false);
      })();
    });

    return () => {
      cancelled = true;
      subscription.remove();
      foregroundSubscriptionRef.current?.remove();
      nativeStepSubscriptionRef.current?.remove();
      nativeStepSubscriptionRef.current = null;
      void stopActivityRecognition().catch(() => undefined);
    };
  }, [applyNativeStepSnapshot, refreshPermissionStates, refreshSessions, startLocationWriter, startNativeStepCounter, syncActiveWorkoutStepsFromHealthConnect, syncDailySteps]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") {
        applyNativeStepSnapshot(getStrideStepSnapshot());
        void refreshStrideWidget().catch(() => false);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [applyNativeStepSnapshot]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && healthConnectStateRef.current === "granted") {
        void syncDailySteps().catch(() => undefined);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [syncDailySteps]);

  useEffect(() => {
    if (!activeWorkout || activeWorkout.status !== "active") return;
    const timer = setInterval(() => {
      void (async () => {
        if (Platform.OS === "android") await syncNativeWorkoutRuntime().catch(() => undefined);
        return readActiveWorkout();
      })().then((updated) => {
        if (!updated || updated.id !== activeWorkoutRef.current?.id) return;
        setActiveWorkout(updated); activeWorkoutRef.current = updated;
        void maybeAnnounceWorkoutProgress(updated).catch(() => undefined);
        const latest = updated.route.at(-1);
        if (!latest) {
          setGpsFixState("searching");
        } else if (Date.now() - latest.timestamp > 20_000) {
          setGpsFixState("weak");
        } else {
          const maxAccuracy = GPS_PROFILES[updated.type].maxAccuracyMeters;
          setGpsFixState(latest.accuracy != null && latest.accuracy > maxAccuracy ? "weak" : "fixed");
        }
      }).catch(() => undefined);
    }, 2_500);
    return () => clearInterval(timer);
  }, [activeWorkout?.id, activeWorkout?.status, syncNativeWorkoutRuntime]);

  const value = useMemo<FitnessContextValue>(() => ({
    isReady, settings, sessions, activeWorkout, dailySteps, stepHistory, liveWorkoutSteps,
    pedometerState, healthConnectState, locationState, backgroundLocationState, gpsFixState, locationMessage, pedometerMessage,
    enableStepTracking, syncDailySteps, requestForegroundLocation, setBackgroundTrackingEnabled, setDailyStepGoal, setHeightCm, setWeightKg, markGpsRecommendationShown,
    startWorkout, pauseWorkout, resumeWorkout, completeWorkout, deleteWorkout, loadWorkout, refreshSessions, refreshStepHistory,
  }), [
    isReady, settings, sessions, activeWorkout, dailySteps, stepHistory, liveWorkoutSteps,
    pedometerState, healthConnectState, locationState, backgroundLocationState, gpsFixState, locationMessage, pedometerMessage,
    enableStepTracking, syncDailySteps, requestForegroundLocation, setBackgroundTrackingEnabled, setDailyStepGoal, setHeightCm, setWeightKg, markGpsRecommendationShown,
    startWorkout, pauseWorkout, resumeWorkout, completeWorkout, deleteWorkout, loadWorkout, refreshSessions, refreshStepHistory,
  ]);

  return <FitnessContext.Provider value={value}>{children}</FitnessContext.Provider>;
}

export function useFitness() {
  const context = useContext(FitnessContext);
  if (!context) throw new Error("useFitness 必須在 FitnessProvider 內使用。");
  return context;
}
