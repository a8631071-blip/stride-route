import { getFitnessDatabase } from "./database";

export async function prepareV7StepPolicy() {
  const db = await getFitnessDatabase();
  await db.execAsync(`
    DROP TRIGGER IF EXISTS prevent_daily_steps_decrease;
    DROP TRIGGER IF EXISTS prevent_daily_steps_decrease_update;
    DROP TRIGGER IF EXISTS prevent_sensor_overwrite_health_connect;

    CREATE TRIGGER IF NOT EXISTS prevent_daily_steps_decrease
    BEFORE INSERT ON daily_steps
    WHEN EXISTS (
      SELECT 1 FROM daily_steps
      WHERE date_key = NEW.date_key AND steps > NEW.steps
    )
    BEGIN
      SELECT RAISE(IGNORE);
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_daily_steps_decrease_update
    BEFORE UPDATE OF steps ON daily_steps
    WHEN NEW.steps < OLD.steps
    BEGIN
      SELECT RAISE(IGNORE);
    END;
  `);
}

export async function writeAuthoritativeHealthSteps(entries: Array<{ dateKey: string; steps: number }>) {
  if (!entries.length) return;
  const db = await getFitnessDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      const steps = Math.max(0, Math.round(entry.steps));
      await db.runAsync(
        `INSERT INTO daily_steps (date_key,steps,source,updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(date_key) DO UPDATE SET
           steps=excluded.steps,
           source='health_connect',
           updated_at=excluded.updated_at
         WHERE excluded.steps >= daily_steps.steps`,
        entry.dateKey,
        steps,
        "health_connect",
        now,
      );
    }
  });
}
