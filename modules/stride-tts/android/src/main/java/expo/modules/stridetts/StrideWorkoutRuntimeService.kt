package expo.modules.stridetts

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

class StrideWorkoutRuntimeService : Service() {
  companion object {
    private const val PREFS = "stride_workout_runtime_v19"
    private const val ACTION_START = "stride.runtime.START"
    private const val ACTION_PAUSE = "stride.runtime.PAUSE"
    private const val ACTION_RESUME = "stride.runtime.RESUME"
    private const val ACTION_STOP = "stride.runtime.STOP"
    private const val ACTION_VOICE = "stride.runtime.VOICE"
    private const val EXTRA_CONFIG = "config"
    private const val EXTRA_SEGMENT = "segment"
    private const val CHANNEL_ID = "stride_workout_runtime"
    private const val NOTIFICATION_ID = 31919
    private const val SAMPLE_RATE = 22050
    // V30 shadow-only GPS experiments. These never change the official distance.
    private const val SHADOW_WEIGHTED_WINDOW = 5
    @Volatile private var activeInstance: StrideWorkoutRuntimeService? = null

    fun start(context: Context, configJson: String): Boolean {
      val intent = Intent(context, StrideWorkoutRuntimeService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_CONFIG, configJson)
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (_: Throwable) { false }
    }

    fun pause(context: Context): Boolean {
      activeInstance?.let { it.pauseRuntime(); return true }
      return try {
        context.startService(Intent(context, StrideWorkoutRuntimeService::class.java).setAction(ACTION_PAUSE))
        true
      } catch (_: Throwable) { false }
    }

    fun resume(context: Context, segmentIndex: Int, configJson: String): Boolean {
      activeInstance?.let {
        it.updateVoiceConfig(configJson)
        it.resumeRuntime(segmentIndex)
        return true
      }
      val intent = Intent(context, StrideWorkoutRuntimeService::class.java)
        .setAction(ACTION_RESUME)
        .putExtra(EXTRA_SEGMENT, segmentIndex)
        .putExtra(EXTRA_CONFIG, configJson)
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (_: Throwable) { false }
    }

    fun updateVoice(context: Context, configJson: String): Boolean {
      activeInstance?.let { it.updateVoiceConfig(configJson); return true }
      return try {
        context.startService(Intent(context, StrideWorkoutRuntimeService::class.java).setAction(ACTION_VOICE).putExtra(EXTRA_CONFIG, configJson))
        true
      } catch (_: Throwable) { false }
    }

    fun stopNow(context: Context): Map<String, Any?> {
      activeInstance?.stopRuntime()
      if (activeInstance == null) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("status", "stopped").apply()
        try { context.stopService(Intent(context, StrideWorkoutRuntimeService::class.java)) } catch (_: Throwable) { }
      }
      return snapshot(context)
    }

    fun snapshot(context: Context): Map<String, Any?> {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return mapOf(
        "workoutId" to p.getString("workoutId", null),
        "workoutType" to (p.getString("workoutType", "walk") ?: "walk"),
        "status" to (p.getString("status", "stopped") ?: "stopped"),
        "startedAt" to p.getLong("startedAt", 0L).toDouble(),
        "pausedAt" to p.getLong("pausedAt", 0L).toDouble(),
        "pausedMillis" to p.getLong("pausedMillis", 0L).toDouble(),
        "segmentIndex" to p.getInt("segmentIndex", 0),
        "distanceMeters" to p.getFloat("distanceMeters", 0f).toDouble(),
        "shadowWeightedDistanceMeters" to p.getFloat("shadowWeightedDistanceMeters", 0f).toDouble(),
        "shadowKalmanDistanceMeters" to p.getFloat("shadowKalmanDistanceMeters", 0f).toDouble(),
        "shadowFilterResets" to p.getInt("shadowFilterResets", 0),
        "maxSpeedMps" to p.getFloat("maxSpeedMps", 0f).toDouble(),
        "currentSpeedMps" to p.getFloat("currentSpeedMps", 0f).toDouble(),
        "lastLocationAt" to p.getLong("lastLocationAt", 0L).toDouble(),
        "lastAcceptedAt" to p.getLong("lastAcceptedAt", 0L).toDouble(),
        "lastAccuracy" to if (p.contains("lastAccuracy")) p.getFloat("lastAccuracy", 0f).toDouble() else null,
        "acceptedPoints" to p.getInt("acceptedPoints", 0),
        "rejectedPoints" to p.getInt("rejectedPoints", 0),
        "rejectedInvalid" to p.getInt("rejectedInvalid", 0),
        "rejectedAccuracy" to p.getInt("rejectedAccuracy", 0),
        "rejectedTooClose" to p.getInt("rejectedTooClose", 0),
        "rejectedSpeed" to p.getInt("rejectedSpeed", 0),
        "rejectedTime" to p.getInt("rejectedTime", 0),
        "maxGapMs" to p.getLong("maxGapMs", 0L).toDouble(),
        "sequence" to p.getLong("sequence", 0L).toDouble(),
        "nextTimeCueMs" to p.getLong("nextTimeCueMs", 0L).toDouble(),
        "nextDistanceCueMeters" to p.getFloat("nextDistanceCueMeters", 0f).toDouble(),
        "encCueCount" to p.getInt("encCueCount", 0),
        "encLastTrend" to (p.getString("encLastTrend", "general") ?: "general"),
        "encLastSelectedKey" to (p.getString("encLastSelectedKey", "") ?: ""),
        "wakeLockHeld" to (activeInstance?.wakeLock?.isHeld == true),
      )
    }

    fun readPointsSince(context: Context, since: Long): List<Map<String, Any?>> {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val workoutId = p.getString("workoutId", null) ?: return emptyList()
      val file = journalFile(context, workoutId)
      if (!file.exists()) return emptyList()
      val out = ArrayList<Map<String, Any?>>()
      try {
        file.forEachLine(Charsets.UTF_8) { line ->
          val j = try { JSONObject(line) } catch (_: Throwable) { null } ?: return@forEachLine
          val seq = j.optLong("sequence", 0L)
          if (seq <= since) return@forEachLine
          out.add(mapOf(
            "sequence" to seq.toDouble(),
            "latitude" to j.optDouble("latitude"),
            "longitude" to j.optDouble("longitude"),
            "timestamp" to j.optLong("timestamp").toDouble(),
            "elapsedRealtimeNanos" to j.optLong("elapsedRealtimeNanos", 0L).toDouble(),
            "accuracy" to if (j.isNull("accuracy")) null else j.optDouble("accuracy"),
            "speed" to if (j.isNull("speed")) null else j.optDouble("speed"),
            "altitude" to if (j.isNull("altitude")) null else j.optDouble("altitude"),
            "segmentIndex" to j.optInt("segmentIndex", 0),
            "accepted" to j.optBoolean("accepted", false),
            "rejectReason" to if (j.isNull("rejectReason")) null else j.optString("rejectReason"),
            "distanceDeltaMeters" to j.optDouble("distanceDeltaMeters", 0.0),
            "cumulativeDistanceMeters" to j.optDouble("cumulativeDistanceMeters", 0.0),
            "derivedSpeedMps" to j.optDouble("derivedSpeedMps", 0.0),
            "shadowWeightedLatitude" to if (j.isNull("shadowWeightedLatitude")) null else j.optDouble("shadowWeightedLatitude"),
            "shadowWeightedLongitude" to if (j.isNull("shadowWeightedLongitude")) null else j.optDouble("shadowWeightedLongitude"),
            "shadowWeightedDeltaMeters" to j.optDouble("shadowWeightedDeltaMeters", 0.0),
            "shadowWeightedCumulativeMeters" to j.optDouble("shadowWeightedCumulativeMeters", 0.0),
            "shadowKalmanLatitude" to if (j.isNull("shadowKalmanLatitude")) null else j.optDouble("shadowKalmanLatitude"),
            "shadowKalmanLongitude" to if (j.isNull("shadowKalmanLongitude")) null else j.optDouble("shadowKalmanLongitude"),
            "shadowKalmanDeltaMeters" to j.optDouble("shadowKalmanDeltaMeters", 0.0),
            "shadowKalmanCumulativeMeters" to j.optDouble("shadowKalmanCumulativeMeters", 0.0),
            "shadowFilterReset" to j.optBoolean("shadowFilterReset", false),
            "source" to "native",
          ))
        }
      } catch (_: Throwable) { }
      return out
    }

    private fun journalFile(context: Context, workoutId: String): File {
      val safe = workoutId.replace(Regex("[^A-Za-z0-9_-]"), "_")
      return File(context.filesDir, "stride_runtime_" + safe + ".jsonl")
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private lateinit var fused: FusedLocationProviderClient
  private var callback: LocationCallback? = null
  internal var wakeLock: PowerManager.WakeLock? = null
  private var previous: Point? = null
  private val shadowWeightedWindow = ArrayDeque<Point>()
  private var shadowWeightedPrevious: Point? = null
  private var shadowKalman: ShadowKalman2D? = null
  private var shadowKalmanPrevious: Point? = null
  private var speaking = false
  private var activePlayer: MediaPlayer? = null
  private var activeTts: TextToSpeech? = null
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var playerTimeout: Runnable? = null
  private var ttsTimeout: Runnable? = null

  data class Point(
    val lat: Double,
    val lon: Double,
    val timestamp: Long,
    val elapsedRealtimeNanos: Long,
    val accuracy: Double?,
    val speed: Double?,
    val altitude: Double?,
  )

  private data class ShadowMetrics(
    val weightedPoint: Point? = null,
    val weightedDeltaMeters: Double = 0.0,
    val weightedCumulativeMeters: Double = 0.0,
    val kalmanPoint: Point? = null,
    val kalmanDeltaMeters: Double = 0.0,
    val kalmanCumulativeMeters: Double = 0.0,
    val filterReset: Boolean = false,
  )

  private class AxisKalman(initialPosition: Double, initialVariance: Double) {
    var position = initialPosition
    var velocity = 0.0
    private var p00 = initialVariance
    private var p01 = 0.0
    private var p10 = 0.0
    private var p11 = 25.0

    fun step(measurement: Double, dt: Double, measurementVariance: Double, accelerationSigma: Double) {
      val boundedDt = dt.coerceIn(0.05, 30.0)
      val dt2 = boundedDt * boundedDt
      val dt3 = dt2 * boundedDt
      val dt4 = dt2 * dt2
      val q = accelerationSigma * accelerationSigma

      position += velocity * boundedDt
      val pred00 = p00 + boundedDt * (p01 + p10) + dt2 * p11 + 0.25 * dt4 * q
      val pred01 = p01 + boundedDt * p11 + 0.5 * dt3 * q
      val pred10 = p10 + boundedDt * p11 + 0.5 * dt3 * q
      val pred11 = p11 + dt2 * q

      val innovationVariance = pred00 + measurementVariance
      if (!innovationVariance.isFinite() || innovationVariance <= 0.0) return
      val k0 = pred00 / innovationVariance
      val k1 = pred10 / innovationVariance
      val innovation = measurement - position
      position += k0 * innovation
      velocity += k1 * innovation

      p00 = (1.0 - k0) * pred00
      p01 = (1.0 - k0) * pred01
      p10 = pred10 - k1 * pred00
      p11 = pred11 - k1 * pred01
    }
  }

  private class ShadowKalman2D(private val originLat: Double, private val originLon: Double, first: Point) {
    private val earthRadius = 6_371_000.0
    private val cosOrigin = cos(Math.toRadians(originLat))
    private val x = AxisKalman(0.0, initialVariance(first))
    private val y = AxisKalman(0.0, initialVariance(first))
    private var lastElapsedRealtimeNanos = first.elapsedRealtimeNanos

    private fun toMeters(point: Point): Pair<Double, Double> {
      val east = Math.toRadians(point.lon - originLon) * earthRadius * cosOrigin
      val north = Math.toRadians(point.lat - originLat) * earthRadius
      return east to north
    }

    fun update(point: Point, accelerationSigma: Double): Point {
      val (mx, my) = toMeters(point)
      val dt = if (lastElapsedRealtimeNanos > 0L && point.elapsedRealtimeNanos > lastElapsedRealtimeNanos)
        (point.elapsedRealtimeNanos - lastElapsedRealtimeNanos) / 1_000_000_000.0 else 0.05
      val sigma = max(1.0, point.accuracy ?: 1.0)
      val variance = sigma * sigma
      x.step(mx, dt, variance, accelerationSigma)
      y.step(my, dt, variance, accelerationSigma)
      lastElapsedRealtimeNanos = point.elapsedRealtimeNanos
      val lat = originLat + Math.toDegrees(y.position / earthRadius)
      val lon = originLon + Math.toDegrees(x.position / (earthRadius * cosOrigin))
      return point.copy(lat = lat, lon = lon)
    }

    companion object {
      private fun initialVariance(point: Point): Double {
        val sigma = max(1.0, point.accuracy ?: 1.0)
        return sigma * sigma
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    activeInstance = this
    fused = LocationServices.getFusedLocationProviderClient(this)
    createChannel()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> startRuntime(intent.getStringExtra(EXTRA_CONFIG) ?: "{}")
      ACTION_PAUSE -> pauseRuntime()
      ACTION_RESUME -> {
        updateVoiceConfig(intent.getStringExtra(EXTRA_CONFIG) ?: "{}")
        resumeRuntime(intent.getIntExtra(EXTRA_SEGMENT, prefs().getInt("segmentIndex", 0) + 1))
      }
      ACTION_STOP -> stopRuntime()
      ACTION_VOICE -> updateVoiceConfig(intent.getStringExtra(EXTRA_CONFIG) ?: "{}")
      else -> restoreRuntime()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    stopLocation()
    releaseWake()
    stopAudio()
    handler.removeCallbacksAndMessages(null)
    activeInstance = null
    super.onDestroy()
  }

  private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "步跡運動記錄", NotificationManager.IMPORTANCE_LOW).apply {
            description = "運動期間持續記錄 GPS 與語音播報"
            setShowBadge(false)
          }
        )
      }
    }
  }

  private fun notification(): Notification {
    val p = prefs()
    val title = p.getString("notificationTitle", "步跡 · 運動記錄中") ?: "步跡 · 運動記錄中"
    val status = p.getString("status", "active") ?: "active"
    val body = if (status == "paused") "運動已暫停" else (p.getString("notificationBody", "GPS 與語音播報持續運作") ?: "GPS 與語音播報持續運作")
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle(title)
        .setContentText(body)
        .setOngoing(true)
        .setCategory(Notification.CATEGORY_SERVICE)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle(title)
        .setContentText(body)
        .setOngoing(true)
        .build()
    }
  }

  private fun startForegroundNow() {
    try { startForeground(NOTIFICATION_ID, notification()) } catch (_: Throwable) { }
  }

  private fun startRuntime(configJson: String) {
    val j = try { JSONObject(configJson) } catch (_: Throwable) { JSONObject() }
    val id = j.optString("workoutId", "")
    if (id.isBlank()) { stopSelf(); return }

    val p = prefs()
    val sameWorkout = p.getString("workoutId", null) == id
    val same = sameWorkout && p.getString("status", "stopped") != "stopped"
    if (!same) {
      val intervalMin = max(1, j.optInt("intervalMinutes", 5))
      val intervalMeters = max(1, j.optInt("intervalMeters", 1000))
      val seedDistance = max(j.optDouble("distanceSeedMeters", 0.0), if (sameWorkout) p.getFloat("distanceMeters", 0f).toDouble() else 0.0)
      val seedShadowWeighted = max(j.optDouble("shadowWeightedSeedMeters", 0.0), if (sameWorkout) p.getFloat("shadowWeightedDistanceMeters", 0f).toDouble() else 0.0)
      val seedShadowKalman = max(j.optDouble("shadowKalmanSeedMeters", 0.0), if (sameWorkout) p.getFloat("shadowKalmanDistanceMeters", 0f).toDouble() else 0.0)
      val seedMaxSpeed = max(j.optDouble("maxSpeedSeedMps", 0.0), if (sameWorkout) p.getFloat("maxSpeedMps", 0f).toDouble() else 0.0)
      val seedSequence = max(j.optLong("sequenceSeed", 0L), if (sameWorkout) p.getLong("sequence", 0L) else 0L)
      if (!sameWorkout && seedSequence <= 0L) {
        try { journalFile(this, id).delete() } catch (_: Throwable) { }
      }
      p.edit()
        .clear()
        .putString("workoutId", id)
        .putString("workoutType", j.optString("workoutType", "walk"))
        .putString("status", "active")
        .putLong("startedAt", j.optLong("startedAt", System.currentTimeMillis()))
        .putLong("pausedMillis", 0L)
        .putInt("segmentIndex", j.optInt("segmentIndex", 0))
        .putFloat("distanceMeters", seedDistance.toFloat())
        .putFloat("shadowWeightedDistanceMeters", seedShadowWeighted.toFloat())
        .putFloat("shadowKalmanDistanceMeters", seedShadowKalman.toFloat())
        .putInt("shadowFilterResets", if (seedSequence > 0L) 1 else 0)
        .putFloat("maxSpeedMps", seedMaxSpeed.toFloat())
        .putFloat("currentSpeedMps", 0f)
        .putInt("acceptedPoints", 0)
        .putInt("rejectedPoints", 0)
        .putInt("rejectedInvalid", 0)
        .putInt("rejectedAccuracy", 0)
        .putInt("rejectedTooClose", 0)
        .putInt("rejectedSpeed", 0)
        .putInt("rejectedTime", 0)
        .putLong("maxGapMs", 0L)
        .putLong("sequence", seedSequence)
        .putLong("nextTimeCueMs", intervalMin * 60_000L)
        .putFloat("nextDistanceCueMeters", intervalMeters.toFloat())
        .putInt("encCueCount", 0)
        .putString("encUsedCanonical", "")
        .putString("encSpeedHistory", "")
        .putString("encLastTrend", "general")
        .putString("encLastSelectedKey", "")
        .putLong("encLastCueElapsedMs", 0L)
        .putFloat("encLastCueDistanceMeters", seedDistance.toFloat())
        .apply()
      previous = null
      resetShadowSegment(false)
    } else {
      p.edit()
        .putString("status", "active")
        .putInt("segmentIndex", j.optInt("segmentIndex", p.getInt("segmentIndex", 0)))
        .apply()
      restorePrevious()
      if (shadowWeightedPrevious == null && p.getLong("sequence", 0L) > 0L) resetShadowSegment(true)
    }
    updateVoiceConfig(configJson)
    startForegroundNow()
    acquireWake()
    startLocation()
    scheduleTicker()
  }

  private fun restoreRuntime() {
    val p = prefs()
    val id = p.getString("workoutId", null)
    if (id.isNullOrBlank() || p.getString("status", "stopped") == "stopped") {
      stopSelf()
      return
    }
    startForegroundNow()
    restorePrevious()
    resetShadowSegment(p.getLong("sequence", 0L) > 0L)
    if (p.getString("status", "active") == "active") {
      acquireWake()
      startLocation()
      scheduleTicker()
    }
  }

  internal fun updateVoiceConfig(configJson: String) {
    val j = try { JSONObject(configJson) } catch (_: Throwable) { JSONObject() }
    val editor = prefs().edit()
    val stringFields = listOf(
      "voiceMode", "primaryLocale", "primaryEngine", "secondaryLocale", "secondaryEngine",
      "cueBasis", "notificationTitle", "notificationBody"
    )
    for (key in stringFields) if (j.has(key)) editor.putString(key, j.optString(key, ""))
    if (j.has("voiceEnabled")) editor.putBoolean("voiceEnabled", j.optBoolean("voiceEnabled", true))
    if (j.has("intervalMinutes")) {
      val value = max(1, j.optInt("intervalMinutes", 5))
      editor.putInt("intervalMinutes", value)
      if (prefs().getLong("nextTimeCueMs", 0L) <= 0L) editor.putLong("nextTimeCueMs", value * 60_000L)
    }
    if (j.has("intervalMeters")) {
      val value = max(1, j.optInt("intervalMeters", 1000))
      editor.putInt("intervalMeters", value)
      if (prefs().getFloat("nextDistanceCueMeters", 0f) <= 0f) editor.putFloat("nextDistanceCueMeters", value.toFloat())
    }
    editor.apply()
    startForegroundNow()
  }

  internal fun pauseRuntime() {
    val p = prefs()
    if (p.getString("status", "") != "active") return
    val now = System.currentTimeMillis()
    p.edit().putString("status", "paused").putLong("pausedAt", now).putFloat("currentSpeedMps", 0f).apply()
    stopLocation()
    releaseWake()
    handler.removeCallbacks(ticker)
    startForegroundNow()
  }

  internal fun resumeRuntime(segmentIndex: Int) {
    val p = prefs()
    val now = System.currentTimeMillis()
    val pausedAt = p.getLong("pausedAt", 0L)
    val totalPaused = p.getLong("pausedMillis", 0L) + if (pausedAt > 0L) max(0L, now - pausedAt) else 0L
    p.edit()
      .putString("status", "active")
      .putLong("pausedAt", 0L)
      .putLong("pausedMillis", totalPaused)
      .putInt("segmentIndex", segmentIndex)
      .remove("prevLat").remove("prevLon").remove("prevTime").remove("prevElapsedRealtimeNanos").remove("prevAcc")
      .apply()
    previous = null
    resetShadowSegment(true)
    startForegroundNow()
    acquireWake()
    startLocation()
    scheduleTicker()
  }

  internal fun stopRuntime() {
    val p = prefs()
    if (p.getString("status", "stopped") == "paused") {
      val now = System.currentTimeMillis()
      val pausedAt = p.getLong("pausedAt", 0L)
      if (pausedAt > 0L) {
        p.edit()
          .putLong("pausedMillis", p.getLong("pausedMillis", 0L) + max(0L, now - pausedAt))
          .putLong("pausedAt", 0L)
          .apply()
      }
    }
    p.edit().putString("status", "stopped").putFloat("currentSpeedMps", 0f).apply()
    stopLocation()
    releaseWake()
    stopAudio()
    handler.removeCallbacksAndMessages(null)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun acquireWake() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "StrideRoute:WorkoutRuntime").apply {
      setReferenceCounted(false)
      try { acquire(12L * 60L * 60L * 1000L) } catch (_: Throwable) { }
    }
  }

  private fun releaseWake() {
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Throwable) { }
    wakeLock = null
  }

  private fun startLocation() {
    val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return
    stopLocation()
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
      .setMinUpdateIntervalMillis(3_000L)
      .setMinUpdateDistanceMeters(3f)
      .setWaitForAccurateLocation(true)
      .build()
    callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.sortedBy { it.elapsedRealtimeNanos }.forEach { processLocation(it) }
      }
    }
    try { fused.requestLocationUpdates(request, callback!!, Looper.getMainLooper()) } catch (_: Throwable) { }
  }

  private fun stopLocation() {
    callback?.let { try { fused.removeLocationUpdates(it) } catch (_: Throwable) { } }
    callback = null
  }

  private data class GpsProfile(
    val maxAccuracyMeters: Double,
    val maxSpeedMps: Double,
    val recordingDistanceMeters: Double,
  )

  private fun profile(type: String): GpsProfile = when (type) {
    "run" -> GpsProfile(35.0, 9.5, 3.0)
    "shopping" -> GpsProfile(35.0, 4.5, 4.0)
    "bike" -> GpsProfile(50.0, 22.0, 4.0)
    else -> GpsProfile(40.0, 4.5, 3.0)
  }

  private fun distance(a: Point, b: Point): Double {
    val radius = 6_371_000.0
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLon = Math.toRadians(b.lon - a.lon)
    val value = sin(dLat / 2).pow(2) +
      cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).pow(2)
    return radius * 2 * atan2(sqrt(value), sqrt(1 - value))
  }

  private data class Evaluation(
    val accepted: Boolean,
    val reason: String? = null,
    val distance: Double = 0.0,
    val derivedSpeed: Double = 0.0,
  )

  private fun evaluate(prev: Point?, point: Point, type: String): Evaluation {
    val profile = profile(type)
    if (!point.lat.isFinite() || !point.lon.isFinite() || abs(point.lat) > 90 || abs(point.lon) > 180) {
      return Evaluation(false, "invalid")
    }
    if (point.accuracy != null && (!point.accuracy.isFinite() || point.accuracy < 0 || point.accuracy > profile.maxAccuracyMeters)) {
      return Evaluation(false, "poor_accuracy")
    }
    if (prev == null) return Evaluation(true)

    val deltaNanos = point.elapsedRealtimeNanos - prev.elapsedRealtimeNanos
    if (deltaNanos <= 0L) return Evaluation(false, "out_of_order")

    val meters = distance(prev, point)
    if (!meters.isFinite()) return Evaluation(false, "invalid")
    if (meters < profile.recordingDistanceMeters) return Evaluation(false, "too_close")

    val deltaSeconds = deltaNanos / 1_000_000_000.0
    val derived = meters / deltaSeconds
    if (!derived.isFinite() || derived > profile.maxSpeedMps) return Evaluation(false, "impossible_jump")
    if (point.speed != null && point.speed.isFinite() && point.speed > profile.maxSpeedMps) {
      return Evaluation(false, "device_speed_outlier")
    }
    return Evaluation(true, null, meters, derived)
  }

  private fun shadowAccelerationSigma(type: String): Double = when (type) {
    "run" -> 3.0
    "bike" -> 4.0
    else -> 1.5
  }

  private fun resetShadowSegment(countReset: Boolean) {
    shadowWeightedWindow.clear()
    shadowWeightedPrevious = null
    shadowKalman = null
    shadowKalmanPrevious = null
    if (countReset) {
      val p = prefs()
      p.edit().putInt("shadowFilterResets", p.getInt("shadowFilterResets", 0) + 1).apply()
    }
  }

  private fun weightedShadowPoint(point: Point): Point {
    shadowWeightedWindow.addLast(point)
    while (shadowWeightedWindow.size > SHADOW_WEIGHTED_WINDOW) shadowWeightedWindow.removeFirst()
    var sumWeight = 0.0
    var sumLat = 0.0
    var sumLon = 0.0
    for (sample in shadowWeightedWindow) {
      val sigma = max(1.0, sample.accuracy ?: 1.0)
      val weight = 1.0 / (sigma * sigma)
      sumWeight += weight
      sumLat += sample.lat * weight
      sumLon += sample.lon * weight
    }
    if (!sumWeight.isFinite() || sumWeight <= 0.0) return point
    return point.copy(lat = sumLat / sumWeight, lon = sumLon / sumWeight)
  }

  private fun updateShadow(point: Point, type: String): ShadowMetrics {
    val p = prefs()
    var weightedCumulative = p.getFloat("shadowWeightedDistanceMeters", 0f).toDouble()
    var kalmanCumulative = p.getFloat("shadowKalmanDistanceMeters", 0f).toDouble()
    val firstAfterReset = shadowWeightedPrevious == null || shadowKalmanPrevious == null

    val weighted = weightedShadowPoint(point)
    val weightedDelta = shadowWeightedPrevious?.let { distance(it, weighted) } ?: 0.0
    if (weightedDelta.isFinite() && weightedDelta >= 0.0) weightedCumulative += weightedDelta
    shadowWeightedPrevious = weighted

    if (shadowKalman == null) shadowKalman = ShadowKalman2D(point.lat, point.lon, point)
    val kalman = shadowKalman!!.update(point, shadowAccelerationSigma(type))
    val kalmanDelta = shadowKalmanPrevious?.let { distance(it, kalman) } ?: 0.0
    if (kalmanDelta.isFinite() && kalmanDelta >= 0.0) kalmanCumulative += kalmanDelta
    shadowKalmanPrevious = kalman

    p.edit()
      .putFloat("shadowWeightedDistanceMeters", weightedCumulative.toFloat())
      .putFloat("shadowKalmanDistanceMeters", kalmanCumulative.toFloat())
      .apply()

    return ShadowMetrics(
      weightedPoint = weighted,
      weightedDeltaMeters = if (weightedDelta.isFinite()) max(0.0, weightedDelta) else 0.0,
      weightedCumulativeMeters = weightedCumulative,
      kalmanPoint = kalman,
      kalmanDeltaMeters = if (kalmanDelta.isFinite()) max(0.0, kalmanDelta) else 0.0,
      kalmanCumulativeMeters = kalmanCumulative,
      filterReset = firstAfterReset,
    )
  }

  private fun currentShadowMetrics(): ShadowMetrics {
    val p = prefs()
    return ShadowMetrics(
      weightedCumulativeMeters = p.getFloat("shadowWeightedDistanceMeters", 0f).toDouble(),
      kalmanCumulativeMeters = p.getFloat("shadowKalmanDistanceMeters", 0f).toDouble(),
    )
  }

  private fun incrementRejectCounter(editor: android.content.SharedPreferences.Editor, p: android.content.SharedPreferences, reason: String?) {
    when (reason) {
      "poor_accuracy" -> editor.putInt("rejectedAccuracy", p.getInt("rejectedAccuracy", 0) + 1)
      "too_close" -> editor.putInt("rejectedTooClose", p.getInt("rejectedTooClose", 0) + 1)
      "impossible_jump", "device_speed_outlier" -> editor.putInt("rejectedSpeed", p.getInt("rejectedSpeed", 0) + 1)
      "out_of_order" -> editor.putInt("rejectedTime", p.getInt("rejectedTime", 0) + 1)
      else -> editor.putInt("rejectedInvalid", p.getInt("rejectedInvalid", 0) + 1)
    }
  }

  private fun processLocation(location: Location) {
    val p = prefs()
    if (p.getString("status", "") != "active") return
    val point = Point(
      location.latitude,
      location.longitude,
      if (location.time > 0) location.time else System.currentTimeMillis(),
      location.elapsedRealtimeNanos,
      if (location.hasAccuracy()) location.accuracy.toDouble() else null,
      if (location.hasSpeed()) location.speed.toDouble() else null,
      if (location.hasAltitude()) location.altitude else null,
    )
    val lastElapsed = p.getLong("lastElapsedRealtimeNanos", 0L)
    val gap = if (lastElapsed > 0L && point.elapsedRealtimeNanos > lastElapsed) (point.elapsedRealtimeNanos - lastElapsed) / 1_000_000L else 0L
    val evaluation = evaluate(previous, point, p.getString("workoutType", "walk") ?: "walk")
    var distanceMeters = p.getFloat("distanceMeters", 0f).toDouble()
    var maxSpeedMps = p.getFloat("maxSpeedMps", 0f).toDouble()
    var accepted = p.getInt("acceptedPoints", 0)
    var rejected = p.getInt("rejectedPoints", 0)
    var currentSpeedMps = 0.0
    var shadow = currentShadowMetrics()

    if (evaluation.accepted) {
      shadow = updateShadow(point, p.getString("workoutType", "walk") ?: "walk")
      if (previous != null) distanceMeters += evaluation.distance
      currentSpeedMps = max(point.speed ?: 0.0, evaluation.derivedSpeed)
      maxSpeedMps = max(maxSpeedMps, currentSpeedMps)
      previous = point
      accepted += 1
      persistPrevious()
    } else {
      rejected += 1
    }

    val sequence = p.getLong("sequence", 0L) + 1L
    val editor = p.edit()
      .putFloat("distanceMeters", distanceMeters.toFloat())
      .putFloat("maxSpeedMps", maxSpeedMps.toFloat())
      .putFloat("currentSpeedMps", currentSpeedMps.toFloat())
      .putLong("lastLocationAt", point.timestamp)
      .putLong("lastElapsedRealtimeNanos", point.elapsedRealtimeNanos)
      .putInt("acceptedPoints", accepted)
      .putInt("rejectedPoints", rejected)
      .putLong("maxGapMs", max(p.getLong("maxGapMs", 0L), gap))
      .putLong("sequence", sequence)
    if (evaluation.accepted) editor.putLong("lastAcceptedAt", point.timestamp)
    if (point.accuracy != null) editor.putFloat("lastAccuracy", point.accuracy.toFloat())
    if (!evaluation.accepted) incrementRejectCounter(editor, p, evaluation.reason)
    editor.apply()

    appendJournal(sequence, point, p.getInt("segmentIndex", 0), evaluation, distanceMeters, shadow)
    checkCue()
  }

  private fun appendJournal(sequence: Long, point: Point, segment: Int, evaluation: Evaluation, cumulativeDistanceMeters: Double, shadow: ShadowMetrics) {
    val id = prefs().getString("workoutId", null) ?: return
    val value = JSONObject()
      .put("sequence", sequence)
      .put("latitude", point.lat)
      .put("longitude", point.lon)
      .put("timestamp", point.timestamp)
      .put("elapsedRealtimeNanos", point.elapsedRealtimeNanos)
      .put("accuracy", point.accuracy ?: JSONObject.NULL)
      .put("speed", point.speed ?: JSONObject.NULL)
      .put("altitude", point.altitude ?: JSONObject.NULL)
      .put("segmentIndex", segment)
      .put("accepted", evaluation.accepted)
      .put("rejectReason", evaluation.reason ?: JSONObject.NULL)
      .put("distanceDeltaMeters", if (evaluation.accepted) evaluation.distance else 0.0)
      .put("cumulativeDistanceMeters", cumulativeDistanceMeters)
      .put("derivedSpeedMps", if (evaluation.accepted) evaluation.derivedSpeed else 0.0)
      .put("shadowWeightedLatitude", shadow.weightedPoint?.lat ?: JSONObject.NULL)
      .put("shadowWeightedLongitude", shadow.weightedPoint?.lon ?: JSONObject.NULL)
      .put("shadowWeightedDeltaMeters", shadow.weightedDeltaMeters)
      .put("shadowWeightedCumulativeMeters", shadow.weightedCumulativeMeters)
      .put("shadowKalmanLatitude", shadow.kalmanPoint?.lat ?: JSONObject.NULL)
      .put("shadowKalmanLongitude", shadow.kalmanPoint?.lon ?: JSONObject.NULL)
      .put("shadowKalmanDeltaMeters", shadow.kalmanDeltaMeters)
      .put("shadowKalmanCumulativeMeters", shadow.kalmanCumulativeMeters)
      .put("shadowFilterReset", shadow.filterReset)
      .put("source", "native")
    try { journalFile(this, id).appendText(value.toString() + "\n", Charsets.UTF_8) } catch (_: Throwable) { }
  }

  private fun restorePrevious() {
    val p = prefs()
    if (!p.contains("prevLat")) { previous = null; return }
    previous = Point(
      p.getFloat("prevLat", 0f).toDouble(),
      p.getFloat("prevLon", 0f).toDouble(),
      p.getLong("prevTime", 0L),
      p.getLong("prevElapsedRealtimeNanos", 0L),
      if (p.contains("prevAcc")) p.getFloat("prevAcc", 0f).toDouble() else null,
      null,
      null,
    )
    if ((previous?.elapsedRealtimeNanos ?: 0L) <= 0L) previous = null
  }

  private fun persistPrevious() {
    val point = previous ?: return
    val editor = prefs().edit()
      .putFloat("prevLat", point.lat.toFloat())
      .putFloat("prevLon", point.lon.toFloat())
      .putLong("prevTime", point.timestamp)
      .putLong("prevElapsedRealtimeNanos", point.elapsedRealtimeNanos)
    if (point.accuracy != null) editor.putFloat("prevAcc", point.accuracy.toFloat())
    editor.apply()
  }

  private val ticker = object : Runnable {
    override fun run() {
      checkCue()
      if (prefs().getString("status", "") == "active") handler.postDelayed(this, 1000L)
    }
  }

  private fun scheduleTicker() {
    handler.removeCallbacks(ticker)
    handler.post(ticker)
  }

  private fun elapsedMs(now: Long = System.currentTimeMillis()): Long {
    val p = prefs()
    val started = p.getLong("startedAt", now)
    var paused = p.getLong("pausedMillis", 0L)
    if (p.getString("status", "") == "paused") {
      val pausedAt = p.getLong("pausedAt", 0L)
      if (pausedAt > 0) paused += max(0L, now - pausedAt)
    }
    return max(0L, now - started - paused)
  }

  private fun checkCue() {
    if (speaking) return
    val p = prefs()
    if (p.getString("status", "") != "active" || !p.getBoolean("voiceEnabled", true)) return

    if ((p.getString("cueBasis", "time") ?: "time") == "distance") {
      val interval = max(1, p.getInt("intervalMeters", 1000)).toFloat()
      var next = p.getFloat("nextDistanceCueMeters", interval)
      if (next <= 0f) next = interval
      val current = p.getFloat("distanceMeters", 0f)
      if (current + 0.01f >= next) {
        p.edit().putFloat("nextDistanceCueMeters", next + interval).apply()
        announceCue(max(1, (elapsedMs() / 60_000L).toInt()), next.toDouble())
      }
    } else {
      val interval = max(1, p.getInt("intervalMinutes", 5))
      var next = p.getLong("nextTimeCueMs", interval * 60_000L)
      if (next <= 0L) next = interval * 60_000L
      if (elapsedMs() >= next) {
        p.edit().putLong("nextTimeCueMs", next + interval * 60_000L).apply()
        announceCue((next / 60_000L).toInt(), p.getFloat("distanceMeters", 0f).toDouble())
      }
    }
  }

  private fun announceCue(minutes: Int, distanceMeters: Double) {
    val p = prefs()
    speaking = true
    val primary = p.getString("primaryLocale", "zh-TW") ?: "zh-TW"
    val primaryEngine = p.getString("primaryEngine", "") ?: ""
    val secondary = p.getString("secondaryLocale", "") ?: ""
    val secondaryEngine = p.getString("secondaryEngine", "") ?: ""
    val compact = (p.getString("voiceMode", "single") ?: "single") == "bilingual"

    val wantsEncouragement = primary == "zh-TW" || primary == "nan-TW" || secondary == "zh-TW" || secondary == "nan-TW"
    val encouragementKey = if (wantsEncouragement) nextProgressEncouragement(distanceMeters) else null

    speakLocale(primary, primaryEngine, minutes, distanceMeters, compact, encouragementKey) {
      if (secondary.isNotBlank() && secondary != primary) {
        speakLocale(secondary, secondaryEngine, minutes, distanceMeters, true, encouragementKey) { speaking = false }
      } else {
        speaking = false
      }
    }
  }

  // V27 encouragement policy:
  // - first three cues use broad, general encouragement only;
  // - cue 4+ uses recent interval-speed trend (faster / steady / slower / recovery);
  // - sampling is without replacement inside a workout and also avoids the last
  //   few spoken phrases from the previous workout;
  // - near-goal phrases are reserved until StrideRoute has a real time/distance target.
  private val encouragementGeneral = listOf(
    "enc_great","enc_amazing","enc_awesome","enc_good","enc_not_bad","enc_very_good",
    "enc_can","enc_you_can","enc_you_can_do_it","enc_go","enc_keep_going","enc_continue",
    "enc_keep_it","enc_slow","enc_steady","enc_very_possible","enc_nice_work","enc_keep"
  )
  private val encouragementFaster = listOf(
    "enc_great","enc_amazing","enc_awesome","enc_good","enc_not_bad","enc_very_good",
    "enc_can","enc_you_can_do_it","enc_keep_it","enc_progress","enc_today_good","enc_nice_work","enc_keep"
  )
  private val encouragementSteady = listOf(
    "enc_great","enc_good","enc_not_bad","enc_very_good","enc_continue","enc_keep_it",
    "enc_hold","enc_slow","enc_steady","enc_very_possible","enc_nice_work","enc_keep"
  )
  private val encouragementSlower = listOf(
    "enc_can","enc_you_can","enc_you_can_do_it","enc_go","enc_go_again","enc_keep_going",
    "enc_try_more","enc_try_little_more","enc_continue","enc_hold","enc_hold_little",
    "enc_slow","enc_steady","enc_little_more","enc_tiny_more","enc_very_possible"
  )
  private val encouragementRecovery = listOf(
    "enc_great","enc_amazing","enc_awesome","enc_very_good","enc_can","enc_you_can",
    "enc_you_can_do_it","enc_keep_going","enc_continue","enc_keep_it","enc_progress",
    "enc_today_good","enc_nice_work","enc_keep"
  )
  private val encouragementNearGoal = listOf("enc_almost","enc_nearly","enc_small_gap")
  private val allProgressEncouragements = (
    encouragementGeneral + encouragementFaster + encouragementSteady + encouragementSlower + encouragementRecovery
  ).distinct()

  private fun encouragementHistoryPrefs() =
    getSharedPreferences("stride_voice_encouragement_v27", Context.MODE_PRIVATE)

  private fun canonicalEncouragement(key: String): String = when (key) {
    // These are separate recordings of the same spoken sentence. Treat them as
    // one phrase for anti-repeat logic so the listener does not hear the same wording twice.
    "enc_good" -> "enc_great"
    "enc_little_more" -> "enc_hold_little"
    else -> key
  }

  private fun parseCsv(value: String?): MutableList<String> =
    value.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()

  private fun recentEncouragementCanonicals(): List<String> =
    parseCsv(encouragementHistoryPrefs().getString("recentCanonical", ""))

  private fun recordRecentEncouragement(key: String) {
    val canonical = canonicalEncouragement(key)
    val recent = parseCsv(encouragementHistoryPrefs().getString("recentCanonical", ""))
    recent.removeAll { it == canonical }
    recent.add(canonical)
    val trimmed = recent.takeLast(6)
    encouragementHistoryPrefs().edit().putString("recentCanonical", trimmed.joinToString(",")).apply()
  }

  private fun parseSpeedHistory(value: String?): MutableList<Double> =
    value.orEmpty().split(',').mapNotNull { it.toDoubleOrNull() }.filter { it >= 0.0 }.toMutableList()

  private fun classifyEncouragementTrend(speeds: List<Double>, previousTrend: String): String {
    if (speeds.size < 3) return "steady"
    val a = speeds[speeds.size - 3]
    val b = speeds[speeds.size - 2]
    val c = speeds[speeds.size - 1]
    if (a < 0.15 && b < 0.15 && c < 0.15) return "steady"

    if (previousTrend == "slower" && b > 0.10 && c >= b * 1.06) return "recovery"

    val base = max(0.10, a)
    val overall = (c - a) / base
    val rising = b >= a * 1.02 && c >= b * 1.02 && overall >= 0.05
    val falling = b <= a * 0.98 && c <= b * 0.98 && overall <= -0.05
    if (rising) return "faster"
    if (falling) return "slower"

    val recentAverage = max(0.10, (a + b) / 2.0)
    if (c >= recentAverage * 1.08) return "faster"
    if (c <= recentAverage * 0.92) return "slower"
    return "steady"
  }

  private fun encouragementPool(trend: String): List<String> = when (trend) {
    "faster" -> encouragementFaster
    "slower" -> encouragementSlower
    "recovery" -> encouragementRecovery
    "steady" -> encouragementSteady
    else -> encouragementGeneral
  }

  private fun nextProgressEncouragement(distanceMeters: Double): String {
    val p = prefs()
    val cueCount = p.getInt("encCueCount", 0) + 1
    val nowElapsedMs = elapsedMs()
    val lastDistance = p.getFloat("encLastCueDistanceMeters", 0f).toDouble()
    val lastElapsedMs = p.getLong("encLastCueElapsedMs", 0L)
    val speedHistory = parseSpeedHistory(p.getString("encSpeedHistory", ""))

    val segmentSpeed = when {
      lastElapsedMs > 0L && nowElapsedMs > lastElapsedMs + 30_000L && distanceMeters >= lastDistance ->
        (distanceMeters - lastDistance) / ((nowElapsedMs - lastElapsedMs) / 1000.0)
      lastElapsedMs == 0L && nowElapsedMs >= 30_000L -> distanceMeters / (nowElapsedMs / 1000.0)
      else -> null
    }
    if (segmentSpeed != null && segmentSpeed.isFinite() && segmentSpeed >= 0.0) {
      speedHistory.add(segmentSpeed)
      while (speedHistory.size > 4) speedHistory.removeAt(0)
    }

    val previousTrend = p.getString("encLastTrend", "general") ?: "general"
    val trend = if (cueCount <= 3) "general" else classifyEncouragementTrend(speedHistory, previousTrend)
    val used = parseCsv(p.getString("encUsedCanonical", "")).toMutableSet()
    val recent = recentEncouragementCanonicals().toSet()

    fun candidates(pool: List<String>, avoidRecent: Boolean): List<String> = pool.filter { key ->
      val canonical = canonicalEncouragement(key)
      canonical !in used && (!avoidRecent || canonical !in recent)
    }

    var choices = candidates(encouragementPool(trend), true)
    if (choices.isEmpty()) choices = candidates(encouragementPool(trend), false)
    if (choices.isEmpty()) choices = candidates(encouragementGeneral, true)
    if (choices.isEmpty()) choices = candidates(encouragementGeneral, false)
    if (choices.isEmpty()) choices = candidates(allProgressEncouragements, true)
    if (choices.isEmpty()) choices = candidates(allProgressEncouragements, false)
    if (choices.isEmpty()) {
      // A very long workout may eventually exhaust every eligible phrase. Only then
      // allow a new bag; normal 45-minute / 5-minute sessions never reach this path.
      used.clear()
      choices = encouragementPool(trend)
    }

    val selected = choices[Random.nextInt(choices.size)]
    used.add(canonicalEncouragement(selected))
    p.edit()
      .putInt("encCueCount", cueCount)
      .putString("encUsedCanonical", used.joinToString(","))
      .putString("encSpeedHistory", speedHistory.joinToString(",") { String.format(Locale.US, "%.4f", it) })
      .putString("encLastTrend", trend)
      .putString("encLastSelectedKey", selected)
      .putLong("encLastCueElapsedMs", nowElapsedMs)
      .putFloat("encLastCueDistanceMeters", distanceMeters.toFloat())
      .apply()
    recordRecentEncouragement(selected)
    return selected
  }

  private fun chineseEncouragement(key: String): String? = when (key) {
    "enc_great" -> "真棒"
    "enc_amazing" -> "很厲害"
    "enc_awesome" -> "太棒了"
    "enc_good" -> "表現很好"
    "enc_not_bad" -> "不錯喔"
    "enc_very_good" -> "很不錯"
    "enc_can" -> "可以的"
    "enc_you_can" -> "你可以的"
    "enc_you_can_do_it" -> "你做得到"
    "enc_go" -> "加油"
    "enc_go_again" -> "再加油"
    "enc_keep_going" -> "繼續加油"
    "enc_try_more" -> "再努力一下"
    "enc_try_little_more" -> "再加把勁"
    "enc_continue" -> "繼續喔"
    "enc_keep_it" -> "繼續保持"
    "enc_hold" -> "穩住"
    "enc_hold_little" -> "再一下"
    "enc_slow" -> "慢慢來"
    "enc_steady" -> "穩穩來"
    "enc_little_more" -> "再一下"
    "enc_tiny_more" -> "再一點點"
    "enc_almost" -> "快到了"
    "enc_nearly" -> "就快到了"
    "enc_small_gap" -> "差一點點"
    "enc_very_possible" -> "沒問題的"
    "enc_progress" -> "有進步喔"
    "enc_today_good" -> "今天狀況不錯"
    "enc_nice_work" -> "做得很好"
    "enc_keep" -> "保持住"
    else -> null
  }

  private fun workoutSteps(): Int =
    getSharedPreferences("stride_route_step_counter_v13", Context.MODE_PRIVATE).getInt("workout_steps", 0)

  private fun distanceText(locale: String, meters: Double): String {
    if (meters < 1000 && locale != "nan-TW") {
      val value = round(max(0.0, meters)).toInt().toString()
      return when (locale) {
        "ja" -> value + "メートル"
        "th" -> value + " เมตร"
        "ko" -> value + "미터"
        "en" -> value + " meters"
        else -> value + " 公尺"
      }
    }
    val km = max(0.0, meters) / 1000.0
    val value = if (abs(km - round(km)) < 0.0005) {
      round(km).toInt().toString()
    } else {
      String.format(Locale.US, "%.2f", km).trimEnd('0').trimEnd('.')
    }
    return when (locale) {
      "ja" -> value + "キロメートル"
      "th" -> value + " กิโลเมตร"
      "ko" -> value + "킬로미터"
      "en" -> value + " kilometers"
      else -> value + " 公里"
    }
  }

  private fun paceText(locale: String, meters: Double, seconds: Double): String {
    if (meters < 30 || seconds < 1) return "—"
    val perKm = round(seconds / meters * 1000).toInt()
    val minutes = perKm / 60
    val secs = perKm % 60
    return when (locale) {
      "ja" -> "1キロ " + minutes + "分" + secs + "秒"
      "th" -> minutes.toString() + " นาที " + secs + " วินาทีต่อกิโลเมตร"
      "ko" -> "킬로미터당 " + minutes + "분 " + secs + "초"
      "en" -> minutes.toString() + " minutes " + secs + " seconds per kilometer"
      else -> "每公里 " + minutes + " 分 " + secs + " 秒"
    }
  }

  private fun cueText(locale: String, minutes: Int, distanceMeters: Double, compact: Boolean): String {
    val d = distanceText(locale, distanceMeters)
    if (compact) {
      return when (locale) {
        "ja" -> "運動時間 " + minutes + " 分、距離 " + d
        "th" -> "เวลาออกกำลังกาย " + minutes + " นาที ระยะทาง " + d
        "ko" -> "운동 시간 " + minutes + "분, 거리 " + d
        "en" -> "Workout time " + minutes + " minutes, distance " + d
        else -> "運動時間 " + minutes + " 分鐘，距離 " + d
      }
    }

    val type = prefs().getString("workoutType", "walk") ?: "walk"
    val elapsed = max(1.0, elapsedMs() / 1000.0)
    if (type == "bike") {
      val speed = if (distanceMeters < 10) 0.0 else distanceMeters / elapsed * 3.6
      val value = String.format(Locale.US, "%.1f", speed)
      return when (locale) {
        "ja" -> "運動時間 " + minutes + " 分、距離 " + d + "、平均速度 時速 " + value + " キロメートル"
        "th" -> "เวลาออกกำลังกาย " + minutes + " นาที ระยะทาง " + d + " ความเร็วเฉลี่ย " + value + " กิโลเมตรต่อชั่วโมง"
        "ko" -> "운동 시간 " + minutes + "분, 거리 " + d + ", 평균 속도 시속 " + value + "킬로미터"
        "en" -> "Workout time " + minutes + " minutes, distance " + d + ", average speed " + value + " kilometers per hour"
        else -> "運動時間 " + minutes + " 分鐘，距離 " + d + "，平均速度每小時 " + value + " 公里"
      }
    }

    if (type == "shopping") {
      return when (locale) {
        "ja" -> "買い物時間 " + minutes + " 分、移動距離 " + d
        "th" -> "เวลาเดินเลือกซื้อ " + minutes + " นาที ระยะทางที่เดิน " + d
        "ko" -> "쇼핑 시간 " + minutes + "분, 이동 거리 " + d
        "en" -> "Shopping time " + minutes + " minutes, moving distance " + d
        else -> "逛街時間 " + minutes + " 分鐘，移動距離 " + d
      }
    }
    val pace = paceText(locale, distanceMeters, elapsed)
    return when (locale) {
      "ja" -> "運動時間 " + minutes + " 分、距離 " + d + "、平均ペース " + pace
      "th" -> "เวลาออกกำลังกาย " + minutes + " นาที ระยะทาง " + d + " เพซเฉลี่ย " + pace
      "ko" -> "운동 시간 " + minutes + "분, 거리 " + d + ", 평균 페이스 " + pace
      "en" -> "Workout time " + minutes + " minutes, distance " + d + ", average pace " + pace
      else -> "運動時間 " + minutes + " 分鐘，距離 " + d + "，平均配速 " + pace
    }
  }

  private fun speakLocale(locale: String, engine: String, minutes: Int, distanceMeters: Double, compact: Boolean, encouragementKey: String?, done: () -> Unit) {
    if (locale == "nan-TW") {
      speakTaigi(taigiTokens(minutes, distanceMeters, compact, encouragementKey), done)
    } else {
      val base = cueText(locale, minutes, distanceMeters, compact)
      val encouragement = if (locale == "zh-TW" && encouragementKey != null) chineseEncouragement(encouragementKey) else null
      val text = if (encouragement.isNullOrBlank()) base else base + "，" + encouragement
      speakText(locale, engine, text, done)
    }
  }

  private fun languageTag(locale: String): String = when (locale) {
    "ja" -> "ja-JP"
    "th" -> "th-TH"
    "ko" -> "ko-KR"
    "en" -> "en-US"
    else -> "zh-TW"
  }

  private fun requestFocus() {
    val manager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager = manager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .build()
        manager.requestAudioFocus(request)
        focusRequest = request
      } else {
        @Suppress("DEPRECATION")
        manager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      }
    } catch (_: Throwable) { }
  }

  private fun releaseFocus() {
    val manager = audioManager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) focusRequest?.let { manager?.abandonAudioFocusRequest(it) }
      else {
        @Suppress("DEPRECATION")
        manager?.abandonAudioFocus(null)
      }
    } catch (_: Throwable) { }
    focusRequest = null
    audioManager = null
  }

  private fun speakText(locale: String, engine: String, text: String, done: () -> Unit) {
    stopAudio()
    val holder = arrayOfNulls<TextToSpeech>(1)
    var settled = false

    fun finish() {
      if (settled) return
      settled = true
      ttsTimeout?.let { handler.removeCallbacks(it) }
      ttsTimeout = null
      val tts = holder[0]
      try { tts?.stop() } catch (_: Throwable) { }
      try { tts?.shutdown() } catch (_: Throwable) { }
      if (activeTts === tts) activeTts = null
      releaseFocus()
      done()
    }

    val listener = TextToSpeech.OnInitListener { status ->
      handler.post {
        val tts = holder[0]
        if (status != TextToSpeech.SUCCESS || tts == null) { finish(); return@post }
        val language = try { tts.setLanguage(Locale.forLanguageTag(languageTag(locale))) } catch (_: Throwable) { TextToSpeech.LANG_NOT_SUPPORTED }
        if (language < TextToSpeech.LANG_AVAILABLE) { finish(); return@post }
        tts.setSpeechRate(0.98f)
        tts.setPitch(1f)
        tts.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        requestFocus()
        activeTts = tts
        val utteranceId = "stride-runtime-" + UUID.randomUUID().toString()
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) = Unit
          override fun onDone(utteranceId: String?) = finish()
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) = finish()
          override fun onError(utteranceId: String?, errorCode: Int) = finish()
          override fun onStop(utteranceId: String?, interrupted: Boolean) = finish()
        })
        val result = try { tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId) } catch (_: Throwable) { TextToSpeech.ERROR }
        if (result == TextToSpeech.ERROR) finish()
        else {
          val timeout = Runnable { finish() }
          ttsTimeout = timeout
          handler.postDelayed(timeout, 30_000L)
        }
      }
    }

    holder[0] = try {
      if (engine.isBlank()) TextToSpeech(this, listener) else TextToSpeech(this, listener, engine)
    } catch (_: Throwable) { null }
    if (holder[0] == null) finish()
  }

  private fun compound(value: Int): String = when (value) {
    0 -> "num_zero"
    1 -> "num_one_compound"
    2 -> "num_two_compound"
    3 -> "num_three"
    4 -> "num_four"
    5 -> "num_five"
    6 -> "num_six"
    7 -> "num_seven"
    8 -> "num_eight"
    else -> "num_nine"
  }

  private fun measure(value: Int): String = when (value) {
    0 -> "num_zero"
    1 -> "num_one_measure"
    2 -> "num_two_measure"
    3 -> "num_three"
    4 -> "num_four"
    5 -> "num_five"
    6 -> "num_six"
    7 -> "num_seven"
    8 -> "num_eight"
    else -> "num_nine"
  }

  private fun under10000(value: Int, standalone: Boolean): MutableList<String> {
    var n = max(0, value)
    if (n == 0) return mutableListOf("num_zero")
    if (n < 10) return mutableListOf(if (standalone) measure(n) else compound(n))
    val out = mutableListOf<String>()
    var remainder = n
    val thousands = remainder / 1000
    if (thousands > 0) {
      out.add(measure(thousands)); out.add("num_thousand"); remainder %= 1000
      if (remainder in 1..99) out.add("num_zero")
    }
    val hundreds = remainder / 100
    if (hundreds > 0) {
      out.add(measure(hundreds)); out.add("num_hundred"); remainder %= 100
      if (remainder in 1..9) out.add("num_zero")
    }
    val tens = remainder / 10
    if (tens > 0) {
      if (tens > 1) out.add(compound(tens))
      out.add("num_ten")
      remainder %= 10
      if (remainder > 0) out.add(compound(remainder))
    } else if (remainder > 0) out.add(compound(remainder))
    return out
  }

  private fun fullIntegerToken(value: Int): String? =
    if (value in 1..100) "integer_full_" + value.toString().padStart(3, '0') else null

  private fun integerTokens(value: Int, standalone: Boolean = true): MutableList<String> {
    var n = max(0, value)
    if (n == 0) return mutableListOf("num_zero")
    fullIntegerToken(n)?.let { return mutableListOf(it) }
    if (n < 10000) return under10000(n, standalone)
    val out = mutableListOf<String>()
    val hundredMillion = n / 100000000
    if (hundredMillion > 0) {
      out.addAll(under10000(hundredMillion, true)); out.add("num_hundred_million")
      n %= 100000000
      if (n in 1..9999999) out.add("num_zero")
    }
    val tenThousand = n / 10000
    if (tenThousand > 0) {
      out.addAll(under10000(tenThousand, true)); out.add("num_ten_thousand")
      n %= 10000
      if (n in 1..999) out.add("num_zero")
    }
    if (n > 0) out.addAll(under10000(n, false))
    return out
  }

  private fun distanceTokens(meters: Double): MutableList<String> {
    // V24 speaks the same maximum two decimal places shown by the UI. RAW199 V4
    // decimal_full_01..99 include the decimal point and preserve trailing-zero collapse.
    val hundredths = max(0.0, meters) / 1000.0 * 100.0
    val roundedHundredths = round(hundredths).toInt()
    val whole = roundedHundredths / 100
    val fraction = roundedHundredths % 100
    val result = mutableListOf<String>()
    if (whole > 0) result.addAll(integerTokens(whole, true))
    else if (fraction == 0) result.add("num_zero")
    else result.add("num_zero_decimal_prefix")
    if (fraction > 0) result.add("decimal_full_" + fraction.toString().padStart(2, '0'))
    result.add("unit_kilometer")
    return result
  }

  private fun movement(type: String): String = when (type) {
    "run" -> "word_run"
    "bike" -> "word_ride"
    // Shopping is stop-and-go walking; use the walking verb for numeric progress composition.
    else -> "word_walk"
  }

  // V23 context-first layer. These complete-context WAVs are packaged offline.
  // If no exact approved context exists, the complete V22 token composer remains the fallback.
  private fun precomposedTimeToken(minutes: Int): String? = when (minutes) {
    5 -> "time_ctx_05m"
    10 -> "time_ctx_10m"
    15 -> "time_ctx_15m"
    20 -> "time_ctx_20m"
    22 -> "ai_v6_time_22m"
    30 -> "time_ctx_30m"
    45 -> "time_ctx_45m"
    46 -> "time_ctx_46m"
    60 -> "time_ctx_60m"
    65 -> "time_ctx_1h05m"
    90 -> "time_ctx_1h30m"
    else -> null
  }

  private fun distanceContextKey(meters: Double): String =
    String.format(Locale.US, "%.3f", max(0.0, meters) / 1000.0).trimEnd('0').trimEnd('.')

  private fun precomposedDistanceToken(type: String, meters: Double): String? {
    // Complete distance contexts say "已經走 … 公里" and therefore only replace
    // walking/shopping progress, never the distinct run/bike movement verb.
    if (type != "walk" && type != "shopping") return null
    return when (distanceContextKey(meters)) {
      "0.01" -> "distance_ctx_01"
      "0.05" -> "distance_ctx_02"
      "0.09" -> "distance_ctx_03"
      "1.01" -> "ai_v6_distance_1_01"
      "1.02" -> "distance_ctx_05"
      "1.03" -> "distance_ctx_06"
      "1.04" -> "distance_ctx_07"
      "1.05" -> "distance_ctx_08"
      "1.06" -> "distance_ctx_09"
      "1.07" -> "distance_ctx_10"
      "1.08" -> "distance_ctx_11"
      "1.09" -> "distance_ctx_12"
      "1.1" -> "distance_ctx_13"
      "1.11" -> "distance_ctx_14"
      "1.23" -> "distance_ctx_15"
      "1.5" -> "distance_ctx_16"
      "1.78" -> "distance_ctx_17"
      "1.99" -> "distance_ctx_18"
      "2" -> "ai_v6_distance_2_00"
      "2.01" -> "ai_v6_distance_2_01"
      "2.22" -> "ai_v6_distance_2_22"
      "3.45" -> "ai_v6_distance_3_45"
      "3.78" -> "distance_ctx_19"
      "10.5" -> "distance_ctx_20"
      else -> null
    }
  }

  private fun precomposedSpeedToken(speedKmh: Double): String? = when (String.format(Locale.US, "%.1f", max(0.0, speedKmh))) {
    "3.5" -> "speed_ctx_3_5"
    "4.0" -> "speed_ctx_4_0"
    "4.8" -> "speed_ctx_4_8"
    "5.2" -> "speed_ctx_5_2"
    else -> null
  }

  private fun taigiTokens(minutes: Int, distanceMeters: Double, compact: Boolean, encouragementKey: String?): List<String> {
    val type = prefs().getString("workoutType", "walk") ?: "walk"
    val out = mutableListOf<String>()

    val fullTime = precomposedTimeToken(minutes)
    if (fullTime != null) out.add(fullTime)
    else {
      out.add("word_already")
      out.add("word_workout")
      out.addAll(integerTokens(minutes, true))
      out.add("unit_minutes")
    }

    out.add("pause_medium")
    val fullDistance = precomposedDistanceToken(type, distanceMeters)
    if (fullDistance != null) out.add(fullDistance)
    else {
      out.add("word_already")
      out.add(movement(type))
      out.addAll(distanceTokens(distanceMeters))
    }

    if (!compact) {
      val elapsed = max(1.0, elapsedMs() / 1000.0)
      if (type == "bike") {
        val speed = if (distanceMeters < 10) 0.0 else distanceMeters / elapsed * 3.6
        out.add("pause_medium")
        val fullSpeed = precomposedSpeedToken(speed)
        if (fullSpeed != null) out.add(fullSpeed)
        else {
          out.add("phrase_average_speed")
          out.add("phrase_per_hour")
          out.addAll(distanceTokens(speed * 1000))
        }
      } else if (type != "shopping" && distanceMeters >= 30) {
        val perKm = round(elapsed / distanceMeters * 1000).toInt()
        out.add("pause_medium")
        out.add("phrase_average_pace")
        out.addAll(integerTokens(perKm / 60, true))
        out.add("unit_minute")
        out.addAll(integerTokens(perKm % 60, true))
        out.add("unit_second")
      }
    }

    if (encouragementKey != null) {
      out.add("pause_medium")
      out.add(encouragementKey)
    }
    return out
  }

  private fun rawId(token: String): Int =
    if (token.matches(Regex("^[a-z0-9_]+$"))) resources.getIdentifier(token, "raw", packageName) else 0

  private fun leInt(bytes: ByteArray, offset: Int): Int =
    ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.LITTLE_ENDIAN).int

  private fun leShort(bytes: ByteArray, offset: Int): Int =
    ByteBuffer.wrap(bytes, offset, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff

  private fun wavPcm(resId: Int, token: String): ByteArray? {
    return try {
      val bytes = resources.openRawResource(resId).use { it.readBytes() }
      if (bytes.size < 44 || String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF" || String(bytes, 8, 4, Charsets.US_ASCII) != "WAVE") return null
      var offset = 12
      var formatOk = false
      var pcm: ByteArray? = null
      while (offset + 8 <= bytes.size) {
        val id = String(bytes, offset, 4, Charsets.US_ASCII)
        val size = leInt(bytes, offset + 4)
        val dataStart = offset + 8
        if (size < 0 || dataStart + size > bytes.size) return null
        if (id == "fmt " && size >= 16) {
          formatOk = leShort(bytes, dataStart) == 1 &&
            leShort(bytes, dataStart + 2) == 1 &&
            leInt(bytes, dataStart + 4) == SAMPLE_RATE &&
            leShort(bytes, dataStart + 14) == 16
        } else if (id == "data") {
          pcm = bytes.copyOfRange(dataStart, dataStart + size)
        }
        offset = dataStart + size + (size and 1)
      }
      if (formatOk && pcm != null) pcm else null
    } catch (_: Throwable) { null }
  }

  private fun combinedWav(tokens: List<String>): File? {
    var merged = ByteArray(0)
    for (token in tokens) {
      val id = rawId(token)
      if (id == 0) return null
      val pcm = wavPcm(id, token) ?: return null
      // V24: no blanket token crossfade. RAW199 complete numbers reduce seams; V23/V22 fallbacks remain unchanged.
      merged = if (merged.isEmpty()) pcm else merged + pcm
    }
    val total = merged.size
    return try {
      val file = File.createTempFile("stride_runtime_taigi_", ".wav", cacheDir)
      FileOutputStream(file).use { out ->
        fun intLE(value: Int) {
          out.write(byteArrayOf(
            (value and 255).toByte(),
            ((value ushr 8) and 255).toByte(),
            ((value ushr 16) and 255).toByte(),
            ((value ushr 24) and 255).toByte()
          ))
        }
        fun shortLE(value: Int) {
          out.write(byteArrayOf((value and 255).toByte(), ((value ushr 8) and 255).toByte()))
        }
        out.write("RIFF".toByteArray(Charsets.US_ASCII))
        intLE(36 + total)
        out.write("WAVEfmt ".toByteArray(Charsets.US_ASCII))
        intLE(16)
        shortLE(1)
        shortLE(1)
        intLE(SAMPLE_RATE)
        intLE(SAMPLE_RATE * 2)
        shortLE(2)
        shortLE(16)
        out.write("data".toByteArray(Charsets.US_ASCII))
        intLE(total)
        out.write(merged)
      }
      file
    } catch (_: Throwable) { null }
  }

  private fun speakTaigi(tokens: List<String>, done: () -> Unit) {
    stopAudio()
    Thread {
      val file = combinedWav(tokens)
      handler.post {
        if (file == null) { done(); return@post }
        val player = MediaPlayer()
        activePlayer = player

        fun finish() {
          playerTimeout?.let { handler.removeCallbacks(it) }
          playerTimeout = null
          try { player.release() } catch (_: Throwable) { }
          if (activePlayer === player) activePlayer = null
          try { file.delete() } catch (_: Throwable) { }
          releaseFocus()
          done()
        }

        try {
          player.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          FileInputStream(file).use { player.setDataSource(it.fd) }
          player.setOnPreparedListener {
            requestFocus()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
              try { player.playbackParams = PlaybackParams().setSpeed(1.0f).setPitch(1.0f) } catch (_: Throwable) { }
            }
            try { player.start() } catch (_: Throwable) { finish() }
          }
          player.setOnCompletionListener { finish() }
          player.setOnErrorListener { _, _, _ -> finish(); true }
          player.prepareAsync()
          val timeout = Runnable { if (activePlayer === player) finish() }
          playerTimeout = timeout
          handler.postDelayed(timeout, 45_000L)
        } catch (_: Throwable) {
          finish()
        }
      }
    }.start()
  }

  private fun stopAudio() {
    playerTimeout?.let { handler.removeCallbacks(it) }
    playerTimeout = null
    ttsTimeout?.let { handler.removeCallbacks(it) }
    ttsTimeout = null
    try { activePlayer?.stop() } catch (_: Throwable) { }
    try { activePlayer?.release() } catch (_: Throwable) { }
    activePlayer = null
    try { activeTts?.stop() } catch (_: Throwable) { }
    try { activeTts?.shutdown() } catch (_: Throwable) { }
    activeTts = null
    releaseFocus()
  }
}
