import AsyncStorage from "@react-native-async-storage/async-storage";
import { translate } from "@/lib/i18n-core";

import { getFitnessDatabase, initFitnessDatabase } from "./database";
import { calculateDistanceBetweenPoints, dateKey, estimateWorkoutCalories, evaluateRoutePoint, simplifyRoute } from "./math";
import type { AppSettings, DailyStepHistory, DailyStepSnapshot, DailyStepSource, RoutePoint, WorkoutSession, WorkoutType } from "./types";

const SETTINGS_KEY = "stride-route.settings.v10";
const LEGACY_SETTINGS_KEYS = ["stride-route.settings.v3", "stride-route.settings.v2"];
const LEGACY_SESSIONS_KEYS = ["stride-route.sessions.v2", "stride-route.sessions.v1"];
const LEGACY_DAILY_STEPS_KEY = "stride-route.daily-steps.v2";
const LEGACY_STEP_HISTORY_KEY = "stride-route.step-history.v2";
const MIGRATION_META_KEY = "legacy-v2-migrated";

export const DEFAULT_SETTINGS: AppSettings = { dailyStepGoal: 10_000, backgroundTrackingEnabled: false, gpsRecommendationShown: false, heightCm: null, weightKg: null };

let routeMutationQueue: Promise<unknown> = Promise.resolve();

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function normalizeLegacyRoutePoint(point: Partial<RoutePoint>, segmentIndex = 0): RoutePoint {
  return {
    latitude: Number(point.latitude ?? 0),
    longitude: Number(point.longitude ?? 0),
    timestamp: Number(point.timestamp ?? Date.now()),
    accuracy: point.accuracy == null ? null : Number(point.accuracy),
    speed: point.speed == null ? null : Number(point.speed),
    altitude: point.altitude == null ? null : Number(point.altitude),
    segmentIndex,
    source: point.source ?? "initial",
  };
}

function normalizeLegacySession(raw: Partial<WorkoutSession> & Pick<WorkoutSession, "id" | "startedAt">): WorkoutSession {
  const route = (raw.route ?? []).map((point) => normalizeLegacyRoutePoint(point));
  return {
    id: raw.id,
    type: raw.type ?? "walk",
    startedAt: raw.startedAt,
    endedAt: raw.endedAt ?? null,
    pausedAt: raw.pausedAt ?? null,
    pausedSeconds: raw.pausedSeconds ?? 0,
    durationSeconds: raw.durationSeconds ?? 0,
    distanceMeters: raw.distanceMeters ?? 0,
    steps: raw.steps ?? 0,
    maxSpeedMps: raw.maxSpeedMps ?? 0,
    currentSegmentIndex: raw.currentSegmentIndex ?? 0,
    route,
    previewRoute: raw.previewRoute ?? simplifyRoute(route),
    status: raw.status ?? "completed",
    weightKgAtCompletion: raw.weightKgAtCompletion ?? null,
    estimatedCaloriesKcal: raw.estimatedCaloriesKcal ?? null,
  };
}

export async function initFitnessStorage() {
  const db = await initFitnessDatabase();
  const migrated = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", MIGRATION_META_KEY);
  if (migrated?.value === "1") return;

  await db.withTransactionAsync(async () => {
    let legacySessions: WorkoutSession[] = [];
    for (const key of LEGACY_SESSIONS_KEYS) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        legacySessions = safeJsonParse<WorkoutSession[]>(raw, []).map((session) => normalizeLegacySession(session));
        if (legacySessions.length) break;
      }
    }

    for (const session of legacySessions) {
      await db.runAsync(
        `INSERT OR IGNORE INTO workouts
          (id,type,started_at,ended_at,paused_at,paused_seconds,duration_seconds,distance_meters,steps,max_speed_mps,current_segment_index,status,preview_route_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        session.id, session.type, session.startedAt, session.endedAt, session.pausedAt, session.pausedSeconds,
        session.durationSeconds, session.distanceMeters, session.steps, session.maxSpeedMps, session.currentSegmentIndex,
        session.status, JSON.stringify(session.previewRoute),
      );
      await db.runAsync(
        "INSERT OR IGNORE INTO workout_segments (workout_id,segment_index,started_at,ended_at) VALUES (?,?,?,?)",
        session.id, 0, session.startedAt, session.endedAt,
      );
      for (const point of session.route) {
        await db.runAsync(
          `INSERT OR IGNORE INTO track_points
            (workout_id,segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source,accepted,reject_reason)
           VALUES (?,?,?,?,?,?,?,?,?,1,NULL)`,
          session.id, point.segmentIndex, point.latitude, point.longitude, point.timestamp, point.accuracy, point.speed, point.altitude, point.source,
        );
      }
    }

    const legacySnapshot = safeJsonParse<{ dateKey?: string; steps?: number }>(await AsyncStorage.getItem(LEGACY_DAILY_STEPS_KEY), {});
    if (legacySnapshot.dateKey && Number.isFinite(legacySnapshot.steps)) {
      await db.runAsync(
        "INSERT OR REPLACE INTO daily_steps (date_key,steps,source,updated_at) VALUES (?,?,?,?)",
        legacySnapshot.dateKey, Math.max(0, Math.round(legacySnapshot.steps ?? 0)), "legacy", Date.now(),
      );
    }
    const legacyHistory = safeJsonParse<Record<string, number>>(await AsyncStorage.getItem(LEGACY_STEP_HISTORY_KEY), {});
    for (const [key, value] of Object.entries(legacyHistory)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(value)) continue;
      await db.runAsync(
        "INSERT OR IGNORE INTO daily_steps (date_key,steps,source,updated_at) VALUES (?,?,?,?)",
        key, Math.max(0, Math.round(value)), "legacy", Date.now(),
      );
    }
    await db.runAsync("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)", MIGRATION_META_KEY, "1");
  });
}

export async function readSettings(): Promise<AppSettings> {
  const current = await AsyncStorage.getItem(SETTINGS_KEY);
  if (current) return { ...DEFAULT_SETTINGS, ...safeJsonParse<Partial<AppSettings>>(current, {}) };

  let legacy: string | null = null;
  for (const key of LEGACY_SETTINGS_KEYS) {
    legacy = await AsyncStorage.getItem(key);
    if (legacy) break;
  }

  const settings = legacy
    ? { ...DEFAULT_SETTINGS, ...safeJsonParse<Partial<AppSettings>>(legacy, {}), backgroundTrackingEnabled: true }
    : DEFAULT_SETTINGS;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function writeSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function rowToWorkout(row: any, route: RoutePoint[] = []): WorkoutSession {
  return {
    id: String(row.id),
    type: row.type as WorkoutType,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    pausedAt: row.paused_at == null ? null : Number(row.paused_at),
    pausedSeconds: Number(row.paused_seconds ?? 0),
    durationSeconds: Number(row.duration_seconds ?? 0),
    distanceMeters: Number(row.distance_meters ?? 0),
    steps: Number(row.steps ?? 0),
    maxSpeedMps: Number(row.max_speed_mps ?? 0),
    currentSegmentIndex: Number(row.current_segment_index ?? 0),
    route,
    previewRoute: safeJsonParse<RoutePoint[]>(row.preview_route_json ?? "[]", []).map((point) => normalizeLegacyRoutePoint(point, point.segmentIndex ?? 0)),
    status: row.status,
    weightKgAtCompletion: row.weight_kg == null ? null : Number(row.weight_kg),
    estimatedCaloriesKcal: row.estimated_calories_kcal == null ? null : Number(row.estimated_calories_kcal),
  };
}

function rowToPoint(row: any): RoutePoint {
  return {
    latitude: Number(row.latitude), longitude: Number(row.longitude), timestamp: Number(row.timestamp),
    accuracy: row.accuracy == null ? null : Number(row.accuracy), speed: row.speed == null ? null : Number(row.speed),
    altitude: row.altitude == null ? null : Number(row.altitude), segmentIndex: Number(row.segment_index ?? 0), source: row.source ?? "foreground",
  };
}

async function readAcceptedRoute(workoutId: string) {
  const db = await getFitnessDatabase();
  const rows = await db.getAllAsync<any>(
    "SELECT segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source FROM track_points WHERE workout_id = ? AND accepted = 1 ORDER BY timestamp ASC",
    workoutId,
  );
  return rows.map(rowToPoint);
}

export async function readWorkoutSessions(): Promise<WorkoutSession[]> {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const rows = await db.getAllAsync<any>("SELECT * FROM workouts ORDER BY started_at DESC");
  return rows.map((row) => rowToWorkout(row));
}

export async function readWorkoutSession(id: string): Promise<WorkoutSession | null> {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const row = await db.getFirstAsync<any>("SELECT * FROM workouts WHERE id = ?", id);
  if (!row) return null;
  return rowToWorkout(row, await readAcceptedRoute(id));
}

export async function readActiveWorkout(): Promise<WorkoutSession | null> {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const row = await db.getFirstAsync<any>("SELECT * FROM workouts WHERE status IN ('active','paused') ORDER BY started_at DESC LIMIT 1");
  if (!row) return null;
  return rowToWorkout(row, await readAcceptedRoute(String(row.id)));
}

export function createWorkout(type: WorkoutType, initialPoint: RoutePoint | null): WorkoutSession {
  const startedAt = Date.now();
  const candidate = initialPoint ? { ...initialPoint, segmentIndex: 0, source: "initial" as const } : null;
  const route = candidate && evaluateRoutePoint(undefined, candidate, type).accepted ? [candidate] : [];
  return {
    id: `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type, startedAt, endedAt: null, pausedAt: null, pausedSeconds: 0, durationSeconds: 0,
    distanceMeters: 0, steps: 0, maxSpeedMps: 0, currentSegmentIndex: 0,
    route, previewRoute: route, status: "active", weightKgAtCompletion: null, estimatedCaloriesKcal: null,
  };
}

export async function insertWorkout(session: WorkoutSession) {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  await db.withTransactionAsync(async () => {
    const active = await db.getFirstAsync<any>("SELECT id FROM workouts WHERE status IN ('active','paused') LIMIT 1");
    if (active) throw new Error(translate("provider.activeExists"));
    await db.runAsync(
      `INSERT INTO workouts
        (id,type,started_at,ended_at,paused_at,paused_seconds,duration_seconds,distance_meters,steps,max_speed_mps,current_segment_index,status,preview_route_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      session.id, session.type, session.startedAt, null, null, 0, 0, 0, 0, 0, 0, "active", JSON.stringify(session.previewRoute),
    );
    await db.runAsync("INSERT INTO workout_segments (workout_id,segment_index,started_at,ended_at) VALUES (?,?,?,NULL)", session.id, 0, session.startedAt);
    if (session.route[0]) {
      const point = session.route[0];
      await db.runAsync(
        `INSERT OR IGNORE INTO track_points
          (workout_id,segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source,accepted,reject_reason)
         VALUES (?,?,?,?,?,?,?,?,?,1,NULL)`,
        session.id, 0, point.latitude, point.longitude, point.timestamp, point.accuracy, point.speed, point.altitude, point.source,
      );
    }
  });
}


export async function readWorkoutActiveIntervals(workoutId: string, openEndedAt = Date.now()) {
  const db = await getFitnessDatabase();
  const rows = await db.getAllAsync<{ started_at: number; ended_at: number | null }>(
    "SELECT started_at,ended_at FROM workout_segments WHERE workout_id=? ORDER BY segment_index ASC",
    workoutId,
  );
  return rows
    .map((row) => ({ startedAt: Number(row.started_at), endedAt: row.ended_at == null ? openEndedAt : Number(row.ended_at) }))
    .filter((interval) => interval.endedAt > interval.startedAt);
}

export async function updateWorkoutSteps(id: string, steps: number) {
  const db = await getFitnessDatabase();
  await db.runAsync("UPDATE workouts SET steps = ? WHERE id = ? AND status IN ('active','paused')", Math.max(0, Math.round(steps)), id);
}

export async function pauseWorkoutRecord(id: string, steps: number, pausedAt = Date.now()) {
  const db = await getFitnessDatabase();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>("SELECT current_segment_index FROM workouts WHERE id = ? AND status = 'active'", id);
    if (!row) return;
    await db.runAsync("UPDATE workouts SET status='paused', paused_at=?, steps=? WHERE id=?", pausedAt, Math.max(0, Math.round(steps)), id);
    await db.runAsync("UPDATE workout_segments SET ended_at=? WHERE workout_id=? AND segment_index=? AND ended_at IS NULL", pausedAt, id, Number(row.current_segment_index));
  });
}

export async function resumeWorkoutRecord(id: string, resumedAt = Date.now()) {
  const db = await getFitnessDatabase();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>("SELECT paused_at,paused_seconds,current_segment_index FROM workouts WHERE id=? AND status='paused'", id);
    if (!row) return;
    const pausedSeconds = Number(row.paused_seconds ?? 0) + (row.paused_at ? Math.max(0, Math.round((resumedAt - Number(row.paused_at)) / 1000)) : 0);
    const nextSegment = Number(row.current_segment_index ?? 0) + 1;
    await db.runAsync("UPDATE workouts SET status='active',paused_at=NULL,paused_seconds=?,current_segment_index=? WHERE id=?", pausedSeconds, nextSegment, id);
    await db.runAsync("INSERT OR IGNORE INTO workout_segments (workout_id,segment_index,started_at,ended_at) VALUES (?,?,?,NULL)", id, nextSegment, resumedAt);
  });
}

export async function completeWorkoutRecord(id: string, steps: number, endedAt = Date.now(), weightKg?: number | null) {
  const db = await getFitnessDatabase();
  let completed: WorkoutSession | null = null;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>("SELECT * FROM workouts WHERE id=? AND status IN ('active','paused')", id);
    if (!row) return;
    const extraPaused = row.status === "paused" && row.paused_at ? Math.max(0, Math.round((endedAt - Number(row.paused_at)) / 1000)) : 0;
    const totalPaused = Number(row.paused_seconds ?? 0) + extraPaused;
    const durationSeconds = Math.max(0, Math.round((endedAt - Number(row.started_at)) / 1000) - totalPaused);
    await db.runAsync("UPDATE workout_segments SET ended_at=? WHERE workout_id=? AND ended_at IS NULL", endedAt, id);
    const routeRows = await db.getAllAsync<any>(
      "SELECT segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source FROM track_points WHERE workout_id=? AND accepted=1 ORDER BY timestamp ASC",
      id,
    );
    const route = routeRows.map(rowToPoint);
    const preview = simplifyRoute(route);
    const weightSnapshot = weightKg == null ? null : (Number.isFinite(Number(weightKg)) ? Number(weightKg) : null);
    const estimatedCalories = estimateWorkoutCalories(row.type as WorkoutType, Number(row.distance_meters ?? 0), durationSeconds, weightSnapshot);
    await db.runAsync(
      "UPDATE workouts SET status='completed',ended_at=?,paused_at=NULL,paused_seconds=?,duration_seconds=?,steps=?,preview_route_json=?,weight_kg=?,estimated_calories_kcal=? WHERE id=?",
      endedAt, totalPaused, durationSeconds, Math.max(0, Math.round(steps)), JSON.stringify(preview), weightSnapshot, estimatedCalories, id,
    );
    const updated = { ...row, status: "completed", ended_at: endedAt, paused_at: null, paused_seconds: totalPaused, duration_seconds: durationSeconds, steps: Math.max(0, Math.round(steps)), preview_route_json: JSON.stringify(preview), weight_kg: weightSnapshot, estimated_calories_kcal: estimatedCalories };
    completed = rowToWorkout(updated, route);
  });
  return completed;
}

export async function deleteWorkoutRecord(id: string) {
  const db = await getFitnessDatabase();
  await db.runAsync("DELETE FROM workouts WHERE id=?", id);
}

export async function flushRouteMutations() {
  await routeMutationQueue.catch(() => undefined);
}

export function appendPointsToActiveWorkout(points: RoutePoint[]) {
  const operation = routeMutationQueue.then(async () => {
    if (!points.length) return null;
    const db = await getFitnessDatabase();
    const workoutRow = await db.getFirstAsync<any>("SELECT * FROM workouts WHERE status='active' ORDER BY started_at DESC LIMIT 1");
    if (!workoutRow) return null;
    const workoutId = String(workoutRow.id);
    const type = workoutRow.type as WorkoutType;
    const segmentIndex = Number(workoutRow.current_segment_index ?? 0);
    const previousRow = await db.getFirstAsync<any>(
      "SELECT segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source FROM track_points WHERE workout_id=? AND segment_index=? AND accepted=1 ORDER BY timestamp DESC LIMIT 1",
      workoutId, segmentIndex,
    );
    let previous = previousRow ? rowToPoint(previousRow) : undefined;
    let distanceMeters = Number(workoutRow.distance_meters ?? 0);
    let maxSpeedMps = Number(workoutRow.max_speed_mps ?? 0);

    await db.withTransactionAsync(async () => {
      for (const incoming of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
        const point: RoutePoint = { ...incoming, segmentIndex };
        const evaluation = evaluateRoutePoint(previous, point, type);
        const insert = await db.runAsync(
          `INSERT OR IGNORE INTO track_points
            (workout_id,segment_index,latitude,longitude,timestamp,accuracy,speed,altitude,source,accepted,reject_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          workoutId, segmentIndex, point.latitude, point.longitude, point.timestamp, point.accuracy, point.speed, point.altitude, point.source,
          evaluation.accepted ? 1 : 0, evaluation.reason,
        );
        if (!evaluation.accepted || insert.changes === 0) continue;
        if (previous) {
          distanceMeters += evaluation.distanceMeters;
          maxSpeedMps = Math.max(maxSpeedMps, point.speed ?? 0, evaluation.derivedSpeedMps);
        }
        previous = point;
      }
      await db.runAsync("UPDATE workouts SET distance_meters=?,max_speed_mps=? WHERE id=?", distanceMeters, maxSpeedMps, workoutId);
    });
    return readWorkoutSession(workoutId);
  });
  routeMutationQueue = operation.catch(() => undefined);
  return operation;
}

export async function readDailySteps(targetDateKey = dateKey()): Promise<DailyStepSnapshot> {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const row = await db.getFirstAsync<any>("SELECT date_key,steps,source,updated_at FROM daily_steps WHERE date_key=?", targetDateKey);
  return row ? { dateKey: String(row.date_key), steps: Number(row.steps), source: row.source, updatedAt: Number(row.updated_at) } : { dateKey: targetDateKey, steps: 0, source: "sensor", updatedAt: 0 };
}

export async function readStepHistory(): Promise<DailyStepHistory> {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const rows = await db.getAllAsync<any>("SELECT date_key,steps FROM daily_steps ORDER BY date_key ASC");
  return Object.fromEntries(rows.map((row) => [String(row.date_key), Number(row.steps)]));
}

export async function writeDailySteps(snapshot: Omit<DailyStepSnapshot, "updatedAt"> & { updatedAt?: number }) {
  const db = await getFitnessDatabase();
  await db.runAsync(
    `INSERT INTO daily_steps (date_key,steps,source,updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(date_key) DO UPDATE SET
       steps=excluded.steps,
       source=excluded.source,
       updated_at=excluded.updated_at
     WHERE excluded.steps >= daily_steps.steps`,
    snapshot.dateKey, Math.max(0, Math.round(snapshot.steps)), snapshot.source, snapshot.updatedAt ?? Date.now(),
  );
}

export async function writeStepHistory(entries: Array<{ dateKey: string; steps: number; source: DailyStepSource }>) {
  if (!entries.length) return;
  const db = await getFitnessDatabase();
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      await db.runAsync(
        `INSERT INTO daily_steps (date_key,steps,source,updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(date_key) DO UPDATE SET
           steps=excluded.steps,
           source=excluded.source,
           updated_at=excluded.updated_at
         WHERE excluded.steps >= daily_steps.steps`,
        entry.dateKey, Math.max(0, Math.round(entry.steps)), entry.source, Date.now(),
      );
    }
  });
}

export async function readRejectedPointCount(workoutId: string) {
  const db = await getFitnessDatabase();
  const row = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM track_points WHERE workout_id=? AND accepted=0", workoutId);
  return Number(row?.count ?? 0);
}

export async function getWorkoutRouteDistance(workoutId: string) {
  const route = await readAcceptedRoute(workoutId);
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    if (route[index].segmentIndex !== route[index - 1].segmentIndex) continue;
    distance += calculateDistanceBetweenPoints(route[index - 1], route[index]);
  }
  return distance;
}



export type WorkoutVoiceMilestoneKind = "time" | "distance";

export async function claimWorkoutVoiceMilestone(workoutId: string, kind: WorkoutVoiceMilestoneKind, milestoneValue: number) {
  await initFitnessStorage();
  const db = await getFitnessDatabase();
  const key = `voice-milestone:${kind}:${workoutId}`;
  const milestone = Math.max(0, Math.floor(milestoneValue));
  const result = await db.runAsync(
    `INSERT INTO app_meta (key,value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value
     WHERE CAST(app_meta.value AS INTEGER) < CAST(excluded.value AS INTEGER)`,
    key,
    String(milestone),
  );
  return result.changes > 0;
}

export async function releaseWorkoutVoiceMilestone(workoutId: string, kind: WorkoutVoiceMilestoneKind, milestoneValue: number) {
  const db = await getFitnessDatabase();
  const key = `voice-milestone:${kind}:${workoutId}`;
  const milestone = String(Math.max(0, Math.floor(milestoneValue)));
  await db.runAsync("DELETE FROM app_meta WHERE key = ? AND value = ?", key, milestone);
}

export async function clearWorkoutVoiceMilestone(workoutId: string) {
  const db = await getFitnessDatabase();
  await db.runAsync("DELETE FROM app_meta WHERE key IN (?,?,?)",
    `voice-milestone:${workoutId}`,
    `voice-milestone:time:${workoutId}`,
    `voice-milestone:distance:${workoutId}`,
  );
}

export async function logDiagnosticEvent(scope: string, message: string) {
  try {
    const db = await getFitnessDatabase();
    await db.runAsync(
      "INSERT INTO diagnostic_events (created_at,scope,message) VALUES (?,?,?)",
      Date.now(), scope.slice(0, 80), message.slice(0, 500),
    );
    await db.runAsync(
      "DELETE FROM diagnostic_events WHERE id NOT IN (SELECT id FROM diagnostic_events ORDER BY created_at DESC LIMIT 200)",
    );
  } catch {
    // 診斷紀錄本身不得影響運動記錄。
  }
}
