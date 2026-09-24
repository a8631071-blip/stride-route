import * as SQLite from "expo-sqlite";

const DB_NAME = "stride-route-v3.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getFitnessDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workouts (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('walk','run','shopping','bike')),
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          paused_at INTEGER,
          paused_seconds INTEGER NOT NULL DEFAULT 0,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          distance_meters REAL NOT NULL DEFAULT 0,
          steps INTEGER NOT NULL DEFAULT 0,
          max_speed_mps REAL NOT NULL DEFAULT 0,
          current_segment_index INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
          preview_route_json TEXT NOT NULL DEFAULT '[]',
          weight_kg REAL,
          estimated_calories_kcal REAL
        );

        CREATE INDEX IF NOT EXISTS idx_workouts_started_at ON workouts(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_workouts_status ON workouts(status);

        CREATE TABLE IF NOT EXISTS workout_segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workout_id TEXT NOT NULL,
          segment_index INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          UNIQUE(workout_id, segment_index),
          FOREIGN KEY(workout_id) REFERENCES workouts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS track_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workout_id TEXT NOT NULL,
          segment_index INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          accuracy REAL,
          speed REAL,
          altitude REAL,
          source TEXT NOT NULL,
          accepted INTEGER NOT NULL DEFAULT 1,
          reject_reason TEXT,
          UNIQUE(workout_id, timestamp, latitude, longitude),
          FOREIGN KEY(workout_id) REFERENCES workouts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_track_points_workout_time ON track_points(workout_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_track_points_accepted ON track_points(workout_id, accepted, timestamp);

        CREATE TABLE IF NOT EXISTS daily_steps (
          date_key TEXT PRIMARY KEY NOT NULL,
          steps INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'sensor',
          updated_at INTEGER NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS prevent_daily_steps_decrease
        BEFORE INSERT ON daily_steps
        WHEN EXISTS (
          SELECT 1 FROM daily_steps
          WHERE date_key = NEW.date_key AND steps > NEW.steps
        )
        BEGIN
          SELECT RAISE(IGNORE);
        END;

        CREATE TABLE IF NOT EXISTS diagnostic_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          scope TEXT NOT NULL,
          message TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_diagnostic_events_created_at ON diagnostic_events(created_at DESC);
      `);
      const workoutColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(workouts)");
      const workoutColumnNames = new Set(workoutColumns.map((column) => column.name));
      if (!workoutColumnNames.has("weight_kg")) await db.execAsync("ALTER TABLE workouts ADD COLUMN weight_kg REAL;");
      if (!workoutColumnNames.has("estimated_calories_kcal")) await db.execAsync("ALTER TABLE workouts ADD COLUMN estimated_calories_kcal REAL;");

      // V22 adds the independent `shopping` workout type. Existing installs still have
      // the old SQLite CHECK(type IN ('walk','run','bike')), which ALTER TABLE cannot edit.
      // Rebuild only the parent table, preserving every row and the child-table FK target name.
      const workoutSchema = await db.getFirstAsync<{ sql: string | null }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='workouts'");
      if (workoutSchema?.sql && !workoutSchema.sql.includes("'shopping'")) {
        await db.execAsync("PRAGMA foreign_keys = OFF;");
        try {
          await db.execAsync(`
            BEGIN IMMEDIATE;
            CREATE TABLE workouts_v22 (
              id TEXT PRIMARY KEY NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('walk','run','shopping','bike')),
              started_at INTEGER NOT NULL,
              ended_at INTEGER,
              paused_at INTEGER,
              paused_seconds INTEGER NOT NULL DEFAULT 0,
              duration_seconds INTEGER NOT NULL DEFAULT 0,
              distance_meters REAL NOT NULL DEFAULT 0,
              steps INTEGER NOT NULL DEFAULT 0,
              max_speed_mps REAL NOT NULL DEFAULT 0,
              current_segment_index INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
              preview_route_json TEXT NOT NULL DEFAULT '[]',
              weight_kg REAL,
              estimated_calories_kcal REAL
            );
            INSERT INTO workouts_v22 (
              id, type, started_at, ended_at, paused_at, paused_seconds, duration_seconds,
              distance_meters, steps, max_speed_mps, current_segment_index, status,
              preview_route_json, weight_kg, estimated_calories_kcal
            )
            SELECT
              id, type, started_at, ended_at, paused_at, paused_seconds, duration_seconds,
              distance_meters, steps, max_speed_mps, current_segment_index, status,
              preview_route_json, weight_kg, estimated_calories_kcal
            FROM workouts;
            DROP TABLE workouts;
            ALTER TABLE workouts_v22 RENAME TO workouts;
            CREATE INDEX IF NOT EXISTS idx_workouts_started_at ON workouts(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_workouts_status ON workouts(status);
            COMMIT;
          `);
        } catch (error) {
          await db.execAsync("ROLLBACK;").catch(() => undefined);
          throw error;
        } finally {
          await db.execAsync("PRAGMA foreign_keys = ON;");
        }
        const fkIssues = await db.getAllAsync("PRAGMA foreign_key_check;");
        if (fkIssues.length > 0) throw new Error("V22 workout schema migration failed foreign-key validation.");
      }
      return db;
    });
  }
  return databasePromise;
}

export async function initFitnessDatabase() {
  return getFitnessDatabase();
}
