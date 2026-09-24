package expo.modules.stridewidget

import android.content.Context
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

internal object StepCounterSnapshotSampler {
  private const val STEP_PREFS = "stride_route_step_counter_v13"
  private const val KEY_DATE = "date_key"
  private const val KEY_TOTAL = "daily_total"
  private const val KEY_LAST_RAW = "last_raw"
  private const val KEY_UPDATED_AT = "updated_at"
  private const val KEY_LAST_BACKGROUND_SAMPLE = "last_background_sample"
  private const val RAW_UNSET = -1L
  private const val MIN_SAMPLE_GAP_MS = 8_000L
  private const val SAMPLE_TIMEOUT_MS = 2_500L

  @Synchronized
  fun sample(context: Context, onComplete: (() -> Unit)? = null) {
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
        val latest = app.getSharedPreferences(STEP_PREFS, Context.MODE_PRIVATE)
        val storedDate = latest.getString(KEY_DATE, "") ?: ""
        val previousRaw = latest.getLong(KEY_LAST_RAW, RAW_UNSET)
        val rawDelta = if (storedDate == today && previousRaw != RAW_UNSET && raw >= previousRaw) (raw - previousRaw).coerceAtLeast(0L) else 0L
        val total = (if (storedDate == today) latest.getInt(KEY_TOTAL, 0) else 0) + rawDelta.toInt()
        latest.edit()
          .putString(KEY_DATE, today)
          .putInt(KEY_TOTAL, total.coerceAtLeast(0))
          .putLong(KEY_LAST_RAW, raw)
          .putLong(KEY_UPDATED_AT, timestamp)
          .apply()
        WidgetStateStore.writeSteps(app, total, timestamp, today)
        StrideWidgetRefresh.refresh(app)
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

  private fun localDateKey(timestamp: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timestamp))
}
