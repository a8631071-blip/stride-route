package expo.modules.strideactivityrecognition

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToLong

internal object StrideBackgroundStepSampler {
  private const val STEP_PREFS = "stride_route_step_counter_v13"
  private const val WIDGET_PREFS = "stride_route_widget_v13"
  private const val KEY_DATE = "date_key"
  private const val KEY_TOTAL = "daily_total"
  private const val KEY_LAST_RAW = "last_raw"
  private const val KEY_UPDATED_AT = "updated_at"
  private const val KEY_WORKOUT_ID = "workout_id"
  private const val KEY_WORKOUT_ACTIVE = "workout_active"
  private const val KEY_WORKOUT_STEPS = "workout_steps"
  private const val KEY_WORKOUT_LAST_RAW = "workout_last_raw"
  private const val KEY_LAST_BACKGROUND_SAMPLE = "last_background_sample"
  private const val RAW_UNSET = -1L
  private const val MIN_SAMPLE_GAP_MS = 8_000L
  private const val SAMPLE_TIMEOUT_MS = 2_500L

  @Synchronized
  fun sample(context: Context, activityType: Int, confidence: Int, onComplete: (() -> Unit)? = null) {
    val app = context.applicationContext
    val now = System.currentTimeMillis()
    val prefs = app.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
    if (now - prefs.getLong(KEY_LAST_BACKGROUND_SAMPLE, 0L) < MIN_SAMPLE_GAP_MS) {
      onComplete?.invoke()
      return
    }
    prefs.edit().putLong(KEY_LAST_BACKGROUND_SAMPLE, now).apply()

    val manager = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    val sensor = manager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (manager == null || sensor == null) {
      prefs.edit().putLong(KEY_LAST_BACKGROUND_SAMPLE, 0L).apply()
      onComplete?.invoke()
      return
    }

    val blocked = confidence >= 70 && (activityType == 0 || activityType == 1)
    val handler = Handler(Looper.getMainLooper())
    var completed = false
    var listener: SensorEventListener? = null
    lateinit var timeout: Runnable
    fun finish() {
      if (completed) return
      completed = true
      handler.removeCallbacks(timeout)
      listener?.let { manager.unregisterListener(it) }
      onComplete?.invoke()
    }

    timeout = Runnable {
      prefs.edit().putLong(KEY_LAST_BACKGROUND_SAMPLE, 0L).apply()
      finish()
    }

    listener = object : SensorEventListener {
      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
      override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_STEP_COUNTER || event.values.isEmpty()) return
        val raw = event.values[0].roundToLong().coerceAtLeast(0L)
        val timestamp = System.currentTimeMillis()
        val today = localDateKey(timestamp)
        val live = app.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        val storedDate = live.getString(KEY_DATE, "") ?: ""
        val previousRaw = live.getLong(KEY_LAST_RAW, RAW_UNSET)
        val rawDelta = if (storedDate == today && previousRaw != RAW_UNSET && raw >= previousRaw) (raw - previousRaw).coerceAtLeast(0L) else 0L
        var dailyTotal = if (storedDate == today) live.getInt(KEY_TOTAL, 0) else 0
        if (!blocked && rawDelta > 0) dailyTotal += rawDelta.toInt()

        val workoutId = live.getString(KEY_WORKOUT_ID, null)
        val workoutActive = live.getBoolean(KEY_WORKOUT_ACTIVE, false)
        val workoutLastRaw = live.getLong(KEY_WORKOUT_LAST_RAW, RAW_UNSET)
        var workoutSteps = live.getInt(KEY_WORKOUT_STEPS, 0)
        if (workoutId != null && workoutActive) {
          val workoutDelta = if (workoutLastRaw != RAW_UNSET && raw >= workoutLastRaw) (raw - workoutLastRaw).coerceAtLeast(0L) else 0L
          if (!blocked && workoutDelta > 0) workoutSteps += workoutDelta.toInt()
        }

        val editor = live.edit()
          .putString(KEY_DATE, today)
          .putInt(KEY_TOTAL, dailyTotal.coerceAtLeast(0))
          .putLong(KEY_LAST_RAW, raw)
          .putLong(KEY_UPDATED_AT, timestamp)
        if (workoutId != null) {
          editor.putInt(KEY_WORKOUT_STEPS, workoutSteps.coerceAtLeast(0))
          editor.putLong(KEY_WORKOUT_LAST_RAW, raw)
        }
        editor.apply()
        writeWidget(app, today, dailyTotal, timestamp)
        refreshWidget(app)
        finish()
      }
    }

    if (!manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)) {
      prefs.edit().putLong(KEY_LAST_BACKGROUND_SAMPLE, 0L).apply()
      finish()
      return
    }
    handler.postDelayed(timeout, SAMPLE_TIMEOUT_MS)
  }

  private fun writeWidget(context: Context, dateKey: String, steps: Int, updatedAt: Long) {
    val prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
    val storedDate = prefs.getString("dateKey", "") ?: ""
    val safeSteps = if (storedDate == dateKey) maxOf(prefs.getInt("steps", 0), steps.coerceAtLeast(0)) else steps.coerceAtLeast(0)
    prefs.edit()
      .putInt("steps", safeSteps)
      .putLong("updatedAt", updatedAt)
      .putString("dateKey", dateKey)
      .apply()
  }

  private fun refreshWidget(context: Context) {
    val component = ComponentName(context.packageName, "expo.modules.stridewidget.StrideWidgetProvider")
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(component)
    if (ids.isEmpty()) return
    context.sendBroadcast(
      Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .setComponent(component)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
    )
  }

  private fun localDateKey(timestamp: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timestamp))
}
