import { numberLocale, type ResolvedLocale } from "@/lib/i18n-core";
import type { RoutePoint, WorkoutSession, WorkoutType } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const WORKOUT_LABELS: Record<WorkoutType, string> = {
  walk: "健行",
  run: "跑步",
  shopping: "逛街",
  bike: "自行車",
};

export const GPS_PROFILES: Record<WorkoutType, { maxAccuracyMeters: number; maxSpeedMps: number; minDistanceMeters: number; minTimeMs: number; driftCapMeters: number; driftAccuracyFactor: number }> = {
  // Existing profiles are intentionally unchanged. Shopping gets its own stop-and-go filter.
  walk: { maxAccuracyMeters: 40, maxSpeedMps: 4.5, minDistanceMeters: 3, minTimeMs: 1_000, driftCapMeters: 8, driftAccuracyFactor: 0.2 },
  run: { maxAccuracyMeters: 35, maxSpeedMps: 9.5, minDistanceMeters: 3, minTimeMs: 800, driftCapMeters: 8, driftAccuracyFactor: 0.2 },
  shopping: { maxAccuracyMeters: 35, maxSpeedMps: 4.5, minDistanceMeters: 4, minTimeMs: 1_200, driftCapMeters: 10, driftAccuracyFactor: 0.3 },
  bike: { maxAccuracyMeters: 50, maxSpeedMps: 22, minDistanceMeters: 4, minTimeMs: 700, driftCapMeters: 10, driftAccuracyFactor: 0.2 },
};

export function calculateDistanceBetweenPoints(from: Pick<RoutePoint, "latitude" | "longitude">, to: Pick<RoutePoint, "latitude" | "longitude">) {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateRoutePoint(previous: RoutePoint | undefined, point: RoutePoint, type: WorkoutType) {
  const profile = GPS_PROFILES[type];
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || !Number.isFinite(point.timestamp)) return { accepted: false, reason: "invalid" } as const;
  if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return { accepted: false, reason: "out_of_range" } as const;
  if (point.accuracy != null && (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > profile.maxAccuracyMeters)) return { accepted: false, reason: "poor_accuracy" } as const;
  if (!previous) return { accepted: true, reason: null, distanceMeters: 0, derivedSpeedMps: 0 } as const;

  const timeDeltaMs = point.timestamp - previous.timestamp;
  if (timeDeltaMs <= 0) return { accepted: false, reason: "out_of_order" } as const;
  if (timeDeltaMs < profile.minTimeMs) return { accepted: false, reason: "too_frequent" } as const;

  const distanceMeters = calculateDistanceBetweenPoints(previous, point);
  const accuracyUncertainty = Math.max(previous.accuracy ?? 0, point.accuracy ?? 0);
  const driftGuardMeters = Math.min(profile.driftCapMeters, Math.max(profile.minDistanceMeters, accuracyUncertainty * profile.driftAccuracyFactor));
  if (distanceMeters < driftGuardMeters) return { accepted: false, reason: "stationary_drift" } as const;

  const derivedSpeedMps = distanceMeters / (timeDeltaMs / 1000);
  if (!Number.isFinite(derivedSpeedMps) || derivedSpeedMps > profile.maxSpeedMps) return { accepted: false, reason: "impossible_jump" } as const;
  if (point.speed != null && Number.isFinite(point.speed) && point.speed > profile.maxSpeedMps * 1.25) return { accepted: false, reason: "device_speed_outlier" } as const;
  return { accepted: true, reason: null, distanceMeters, derivedSpeedMps } as const;
}

export function getElapsedSeconds(session: WorkoutSession, referenceTime = Date.now()) {
  const endTime = session.endedAt ?? (session.status === "paused" ? session.pausedAt ?? referenceTime : referenceTime);
  return Math.max(0, Math.round((endTime - session.startedAt) / 1000) - session.pausedSeconds);
}

export function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDistance(distanceMeters: number, locale: ResolvedLocale = "zh-TW") {
  if (distanceMeters < 1_000) return `${new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 0 }).format(Math.round(Math.max(0, distanceMeters)))} m`;
  const value = distanceMeters / 1_000;
  return `${new Intl.NumberFormat(numberLocale(locale), { minimumFractionDigits: value < 10 ? 2 : 1, maximumFractionDigits: value < 10 ? 2 : 1 }).format(value)} km`;
}

export function formatPace(distanceMeters: number, elapsedSeconds: number) {
  if (distanceMeters < 30 || elapsedSeconds < 1) return "—";
  const secondsPerKilometer = Math.round((elapsedSeconds / distanceMeters) * 1_000);
  return `${Math.floor(secondsPerKilometer / 60)}'${String(secondsPerKilometer % 60).padStart(2, "0")}" /km`;
}

export function formatSpeed(distanceMeters: number, elapsedSeconds: number) {
  if (distanceMeters < 10 || elapsedSeconds < 1) return "—";
  return `${((distanceMeters / elapsedSeconds) * 3.6).toFixed(1)} km/h`;
}

export function formatSpeedMps(speedMps: number) {
  return speedMps > 0 ? `${(speedMps * 3.6).toFixed(1)} km/h` : "—";
}

export function dateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function startOfLocalDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfLocalDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function formatWorkoutDate(timestamp: number, locale: ResolvedLocale = "zh-TW") {
  return new Intl.DateTimeFormat(numberLocale(locale), { month: "long", day: "numeric", weekday: "short" }).format(timestamp);
}

export function estimateStepLengthMeters(heightCm?: number | null) {
  const height = Number(heightCm);
  if (!Number.isFinite(height) || height < 100 || height > 230) return 0.72;
  return Math.max(0.45, Math.min(0.95, height * 0.00414));
}

export function estimateDistanceFromSteps(steps: number, strideMeters = 0.72) {
  return Math.max(0, steps) * strideMeters;
}

export function averageStepDistanceCm(distanceMeters: number, steps: number) {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(steps) || distanceMeters <= 0 || steps <= 0) return null;
  const value = (distanceMeters * 100) / steps;
  return value >= 20 && value <= 200 ? value : null;
}

export function averagePaceSecondsPerKm(distanceMeters: number, elapsedSeconds: number) {
  if (distanceMeters < 100 || elapsedSeconds < 1) return null;
  return (elapsedSeconds / distanceMeters) * 1000;
}

export function averageSpeedKmh(distanceMeters: number, elapsedSeconds: number) {
  if (distanceMeters < 10 || elapsedSeconds < 1) return null;
  return (distanceMeters / elapsedSeconds) * 3.6;
}

function workoutMet(type: WorkoutType, speedKmh: number) {
  if (type === "shopping") {
    // Shopping/market/night-market mode intentionally counts stop-and-go elapsed time.
    if (speedKmh < 1.5) return 2.3;
    if (speedKmh < 2.5) return 2.5;
    if (speedKmh < 3.5) return 2.8;
    return 3.3;
  }
  if (type === "walk") {
    if (speedKmh < 3.2) return 2.8;
    if (speedKmh < 4.8) return 3.5;
    if (speedKmh < 5.6) return 4.3;
    if (speedKmh < 6.4) return 5.0;
    return 6.0;
  }
  if (type === "run") {
    if (speedKmh < 6.5) return 6.0;
    if (speedKmh < 8.0) return 7.0;
    if (speedKmh < 9.7) return 8.3;
    if (speedKmh < 11.3) return 9.8;
    if (speedKmh < 12.9) return 11.0;
    return 11.8;
  }
  if (speedKmh < 16) return 4.0;
  if (speedKmh < 19) return 6.8;
  if (speedKmh < 22) return 8.0;
  if (speedKmh < 25) return 10.0;
  return 12.0;
}

export function estimateWorkoutCalories(type: WorkoutType, distanceMeters: number, durationSeconds: number, weightKg?: number | null) {
  const weight = Number(weightKg);
  if (!Number.isFinite(weight) || weight < 30 || weight > 250 || durationSeconds < 60) return null;
  const speedKmh = Math.max(0, (distanceMeters / Math.max(1, durationSeconds)) * 3.6);
  const met = workoutMet(type, speedKmh);
  const minutes = durationSeconds / 60;
  const kcal = (met * 3.5 * weight / 200) * minutes;
  return Number.isFinite(kcal) && kcal > 0 ? Math.round(kcal) : null;
}

export function recentSpeedMps(points: RoutePoint[], lookbackMs = 20_000) {
  if (points.length < 2) return 0;
  const latest = points.at(-1)!;
  const sameSegment = points.filter((point) => point.segmentIndex === latest.segmentIndex && point.timestamp <= latest.timestamp);
  if (sameSegment.length < 2) return Math.max(0, latest.speed ?? 0);
  let start = sameSegment[0];
  for (let index = sameSegment.length - 2; index >= 0; index -= 1) {
    start = sameSegment[index];
    if (latest.timestamp - start.timestamp >= lookbackMs) break;
  }
  const seconds = (latest.timestamp - start.timestamp) / 1000;
  if (seconds <= 0) return Math.max(0, latest.speed ?? 0);
  const derived = calculateDistanceBetweenPoints(start, latest) / seconds;
  const device = latest.speed != null && Number.isFinite(latest.speed) && latest.speed >= 0 ? latest.speed : null;
  return Math.max(0, device == null ? derived : (derived + device) / 2);
}

export function formatPaceFromSpeedMps(speedMps: number) {
  if (!Number.isFinite(speedMps) || speedMps <= 0.2) return "—";
  const secondsPerKilometer = Math.round(1_000 / speedMps);
  return `${Math.floor(secondsPerKilometer / 60)}'${String(secondsPerKilometer % 60).padStart(2, "0")}" /km`;
}

export function simplifyRoute(points: RoutePoint[], maxPoints = 64) {
  if (points.length <= maxPoints) return points;
  const groups = new globalThis.Map<number, RoutePoint[]>();
  points.forEach((point) => groups.set(point.segmentIndex, [...(groups.get(point.segmentIndex) ?? []), point]));
  const segments = [...groups.values()];
  const result: RoutePoint[] = [];
  let remaining = maxPoints;
  segments.forEach((segment, segmentIndex) => {
    const remainingSegments = segments.length - segmentIndex;
    const allocation = Math.max(2, Math.min(segment.length, Math.floor(remaining / remainingSegments)));
    if (segment.length <= allocation) result.push(...segment);
    else {
      const step = (segment.length - 1) / (allocation - 1);
      result.push(...Array.from({ length: allocation }, (_, index) => segment[Math.min(segment.length - 1, Math.round(index * step))]));
    }
    remaining = Math.max(0, maxPoints - result.length);
  });
  return result.slice(0, maxPoints);
}
