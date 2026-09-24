package expo.modules.stridewidget

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToLong

class StrideWidgetBridgeModule : Module(), SensorEventListener {
  companion object {
    private const val STEP_PREFS = "stride_route_step_counter_v13"
    private const val KEY_DATE = "date_key"
    private const val KEY_TOTAL = "daily_total"
    private const val KEY_LAST_RAW = "last_raw"
    private const val KEY_UPDATED_AT = "updated_at"
    private const val KEY_WORKOUT_ID = "workout_id"
    private const val KEY_WORKOUT_ACTIVE = "workout_active"
    private const val KEY_WORKOUT_STEPS = "workout_steps"
    private const val KEY_WORKOUT_LAST_RAW = "workout_last_raw"
    private const val RAW_UNSET = -1L
    private const val WIDGET_REFRESH_MS = 10_000L
    private const val ACTIVITY_PREFS = "stride_route_activity_recognition"
    private const val ACTIVITY_TYPE = "type"
    private const val ACTIVITY_CONFIDENCE = "confidence"
    private const val ACTIVITY_UPDATED_AT = "updated_at"
  }

  private var sensorManager: SensorManager? = null
  private var stepCounter: Sensor? = null
  private var registered = false
  private var lastRawInMemory: Long = RAW_UNSET
  private var lastWidgetRefreshAt = 0L
  private var widgetRefreshPending = false
  private val handler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("StrideWidgetBridge")
    Events("onDailyStepsChanged")

    AsyncFunction("updateWidget") { steps: Double, goal: Double, updatedAt: Double, dateKey: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        false
      } else {
        WidgetStateStore.write(context, steps.toInt(), goal.toInt(), updatedAt.toLong(), dateKey)
        refreshWidget(context)
        true
      }
    }

    AsyncFunction("startStepCounter") { dateKey: String, seedSteps: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null || !hasActivityRecognitionPermission(context)) {
        false
      } else {
        seedDaily(context, dateKey, seedSteps.toInt())
        ensureSensor(context)
      }
    }

    AsyncFunction("seedDailySteps") { dateKey: String, steps: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        false
      } else {
        seedDaily(context, dateKey, steps.toInt())
        true
      }
    }

    Function("getStepSnapshot") {
      val context = appContext.reactContext?.applicationContext
      if (context == null) emptySnapshot() else readSnapshot(context)
    }

    AsyncFunction("refreshWidget") {
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        StepCounterSnapshotSampler.sample(context)
        refreshWidget(context)
        true
      }
    }

    AsyncFunction("setLocale") { locale: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        WidgetStateStore.setLocale(context, locale)
        refreshWidget(context)
        true
      }
    }

    AsyncFunction("startWorkoutStepSession") { workoutId: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        prefs.edit()
          .putString(KEY_WORKOUT_ID, workoutId)
          .putBoolean(KEY_WORKOUT_ACTIVE, true)
          .putInt(KEY_WORKOUT_STEPS, 0)
          .putLong(KEY_WORKOUT_LAST_RAW, currentRaw(prefs))
          .apply()
        true
      }
    }

    AsyncFunction("restoreWorkoutStepSession") { workoutId: String, active: Boolean, persistedSteps: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        val sameWorkout = prefs.getString(KEY_WORKOUT_ID, null) == workoutId
        val storedActive = prefs.getBoolean(KEY_WORKOUT_ACTIVE, false)
        val nextSteps = if (sameWorkout) max(prefs.getInt(KEY_WORKOUT_STEPS, 0), persistedSteps.toInt()) else persistedSteps.toInt().coerceAtLeast(0)
        val editor = prefs.edit()
          .putString(KEY_WORKOUT_ID, workoutId)
          .putBoolean(KEY_WORKOUT_ACTIVE, active)
          .putInt(KEY_WORKOUT_STEPS, nextSteps)
        if (!sameWorkout || (!storedActive && active)) editor.putLong(KEY_WORKOUT_LAST_RAW, currentRaw(prefs))
        editor.apply()
        true
      }
    }

    AsyncFunction("seedWorkoutSteps") { workoutId: String, steps: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_WORKOUT_ID, null) != workoutId) false else {
          val current = prefs.getInt(KEY_WORKOUT_STEPS, 0)
          val incoming = steps.toInt().coerceAtLeast(0)
          if (incoming > current) {
            prefs.edit()
              .putInt(KEY_WORKOUT_STEPS, incoming)
              .putLong(KEY_WORKOUT_LAST_RAW, RAW_UNSET)
              .apply()
          }
          true
        }
      }
    }

    AsyncFunction("pauseWorkoutStepSession") { workoutId: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_WORKOUT_ID, null) != workoutId) false else {
          prefs.edit()
            .putBoolean(KEY_WORKOUT_ACTIVE, false)
            .putLong(KEY_WORKOUT_LAST_RAW, currentRaw(prefs))
            .apply()
          true
        }
      }
    }

    AsyncFunction("resumeWorkoutStepSession") { workoutId: String, persistedSteps: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        val sameWorkout = prefs.getString(KEY_WORKOUT_ID, null) == workoutId
        val steps = if (sameWorkout) max(prefs.getInt(KEY_WORKOUT_STEPS, 0), persistedSteps.toInt()) else persistedSteps.toInt().coerceAtLeast(0)
        prefs.edit()
          .putString(KEY_WORKOUT_ID, workoutId)
          .putInt(KEY_WORKOUT_STEPS, steps)
          .putBoolean(KEY_WORKOUT_ACTIVE, true)
          .putLong(KEY_WORKOUT_LAST_RAW, currentRaw(prefs))
          .apply()
        true
      }
    }

    AsyncFunction("stopWorkoutStepSession") { workoutId: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) false else {
        val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_WORKOUT_ID, null) != workoutId) false else {
          prefs.edit()
            .remove(KEY_WORKOUT_ID)
            .remove(KEY_WORKOUT_ACTIVE)
            .remove(KEY_WORKOUT_STEPS)
            .remove(KEY_WORKOUT_LAST_RAW)
            .apply()
          true
        }
      }
    }

    OnDestroy {
      sensorManager?.unregisterListener(this@StrideWidgetBridgeModule)
      registered = false
      handler.removeCallbacksAndMessages(null)
    }
  }

  private fun hasActivityRecognitionPermission(context: Context): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
  }

  private fun ensureSensor(context: Context): Boolean {
    if (registered) return true
    val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
    val sensor = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return false
    sensorManager = manager
    stepCounter = sensor
    registered = manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL)
    return registered
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    if (event?.sensor?.type != Sensor.TYPE_STEP_COUNTER || event.values.isEmpty()) return
    val context = appContext.reactContext?.applicationContext ?: return
    val raw = event.values[0].roundToLong().coerceAtLeast(0L)
    val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val today = localDateKey(now)
    val storedDate = prefs.getString(KEY_DATE, "") ?: ""
    val persistedRaw = prefs.getLong(KEY_LAST_RAW, RAW_UNSET)
    val previousRaw = when {
      lastRawInMemory == RAW_UNSET -> persistedRaw
      persistedRaw == RAW_UNSET -> lastRawInMemory
      else -> max(lastRawInMemory, persistedRaw)
    }
    val rawDelta = if (previousRaw == RAW_UNSET || raw < previousRaw) 0L else (raw - previousRaw).coerceAtLeast(0L)
    lastRawInMemory = raw

    val activityBlocked = isRecentVehicleOrBike(context, now)
    var dailyTotal = if (storedDate == today) prefs.getInt(KEY_TOTAL, 0) else 0
    if (storedDate == today && !activityBlocked && rawDelta > 0) {
      dailyTotal += rawDelta.toInt()
    }

    var workoutSteps = prefs.getInt(KEY_WORKOUT_STEPS, 0)
    val workoutId = prefs.getString(KEY_WORKOUT_ID, null)
    val workoutActive = prefs.getBoolean(KEY_WORKOUT_ACTIVE, false)
    val workoutLastRaw = prefs.getLong(KEY_WORKOUT_LAST_RAW, RAW_UNSET)
    if (workoutId != null && workoutActive) {
      val workoutDelta = if (workoutLastRaw == RAW_UNSET || raw < workoutLastRaw) 0L else (raw - workoutLastRaw).coerceAtLeast(0L)
      if (!activityBlocked && workoutDelta > 0) workoutSteps += workoutDelta.toInt()
    }

    prefs.edit()
      .putString(KEY_DATE, today)
      .putInt(KEY_TOTAL, dailyTotal.coerceAtLeast(0))
      .putLong(KEY_LAST_RAW, raw)
      .putLong(KEY_UPDATED_AT, now)
      .apply {
        if (workoutId != null) {
          putInt(KEY_WORKOUT_STEPS, workoutSteps.coerceAtLeast(0))
          putLong(KEY_WORKOUT_LAST_RAW, raw)
        }
      }
      .apply()

    WidgetStateStore.writeSteps(context, dailyTotal, now, today)
    scheduleWidgetRefresh(context, now)

    val payload = Bundle().apply {
      putString("dateKey", today)
      putInt("steps", dailyTotal)
      putDouble("updatedAt", now.toDouble())
      putDouble("rawCounter", raw.toDouble())
      putBoolean("available", true)
      putString("workoutId", workoutId)
      putInt("workoutSteps", workoutSteps)
    }
    this@StrideWidgetBridgeModule.sendEvent("onDailyStepsChanged", payload)
  }

  private fun seedDaily(context: Context, dateKey: String, steps: Int) {
    val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
    val storedDate = prefs.getString(KEY_DATE, "") ?: ""
    val currentTotal = if (storedDate == dateKey) prefs.getInt(KEY_TOTAL, 0) else 0
    val incoming = steps.coerceAtLeast(0)
    val nextTotal = max(currentTotal, incoming)
    val raisedByExternalSource = storedDate == dateKey && incoming > currentTotal
    val editor = prefs.edit()
      .putString(KEY_DATE, dateKey)
      .putInt(KEY_TOTAL, nextTotal)
      .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
    if (storedDate != dateKey || raisedByExternalSource) {
      editor.putLong(KEY_LAST_RAW, RAW_UNSET)
      lastRawInMemory = RAW_UNSET
    }
    editor.apply()
    WidgetStateStore.writeSteps(context, nextTotal, System.currentTimeMillis(), dateKey)
    refreshWidget(context)
  }

  private fun currentRaw(prefs: android.content.SharedPreferences): Long {
    return if (lastRawInMemory != RAW_UNSET) lastRawInMemory else prefs.getLong(KEY_LAST_RAW, RAW_UNSET)
  }

  private fun readSnapshot(context: Context): Map<String, Any?> {
    val prefs = context.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
    return mapOf(
      "dateKey" to (prefs.getString(KEY_DATE, "") ?: ""),
      "steps" to prefs.getInt(KEY_TOTAL, 0),
      "updatedAt" to prefs.getLong(KEY_UPDATED_AT, 0L).toDouble(),
      "rawCounter" to prefs.getLong(KEY_LAST_RAW, RAW_UNSET).let { if (it == RAW_UNSET) null else it.toDouble() },
      "available" to (stepCounter != null || sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null),
      "workoutId" to prefs.getString(KEY_WORKOUT_ID, null),
      "workoutSteps" to prefs.getInt(KEY_WORKOUT_STEPS, 0),
    )
  }

  private fun emptySnapshot() = mapOf(
    "dateKey" to "",
    "steps" to 0,
    "updatedAt" to 0.0,
    "rawCounter" to null,
    "available" to false,
    "workoutId" to null,
    "workoutSteps" to 0,
  )

  private fun isRecentVehicleOrBike(context: Context, now: Long): Boolean {
    val prefs = context.getSharedPreferences(ACTIVITY_PREFS, Context.MODE_PRIVATE)
    val updatedAt = prefs.getLong(ACTIVITY_UPDATED_AT, 0L)
    val confidence = prefs.getInt(ACTIVITY_CONFIDENCE, 0)
    val type = prefs.getInt(ACTIVITY_TYPE, -1)
    if (now - updatedAt > 12_000L || confidence < 70) return false
    return type == 0 || type == 1
  }

  private fun localDateKey(timestamp: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timestamp))

  private fun scheduleWidgetRefresh(context: Context, now: Long) {
    val elapsed = now - lastWidgetRefreshAt
    if (elapsed >= WIDGET_REFRESH_MS) {
      lastWidgetRefreshAt = now
      refreshWidget(context)
      return
    }
    if (widgetRefreshPending) return
    widgetRefreshPending = true
    handler.postDelayed({
      widgetRefreshPending = false
      lastWidgetRefreshAt = System.currentTimeMillis()
      refreshWidget(context)
    }, (WIDGET_REFRESH_MS - elapsed).coerceAtLeast(250L))
  }

  private fun refreshWidget(context: Context) {
    StrideWidgetRefresh.refresh(context)
  }
}
