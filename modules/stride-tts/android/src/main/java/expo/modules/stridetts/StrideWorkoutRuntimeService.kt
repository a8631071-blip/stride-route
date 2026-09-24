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
        "maxSpeedMps" to p.getFloat("maxSpeedMps", 0f).toDouble(),
        "lastLocationAt" to p.getLong("lastLocationAt", 0L).toDouble(),
        "lastAccuracy" to if (p.contains("lastAccuracy")) p.getFloat("lastAccuracy", 0f).toDouble() else null,
        "acceptedPoints" to p.getInt("acceptedPoints", 0),
        "rejectedPoints" to p.getInt("rejectedPoints", 0),
        "maxGapMs" to p.getLong("maxGapMs", 0L).toDouble(),
        "sequence" to p.getLong("sequence", 0L).toDouble(),
        "nextTimeCueMs" to p.getLong("nextTimeCueMs", 0L).toDouble(),
        "nextDistanceCueMeters" to p.getFloat("nextDistanceCueMeters", 0f).toDouble(),
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
            "accuracy" to if (j.isNull("accuracy")) null else j.optDouble("accuracy"),
            "speed" to if (j.isNull("speed")) null else j.optDouble("speed"),
            "altitude" to if (j.isNull("altitude")) null else j.optDouble("altitude"),
            "segmentIndex" to j.optInt("segmentIndex", 0),
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
    val accuracy: Double?,
    val speed: Double?,
    val altitude: Double?,
  )

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
    val same = p.getString("workoutId", null) == id && p.getString("status", "stopped") != "stopped"
    if (!same) {
      val intervalMin = max(1, j.optInt("intervalMinutes", 5))
      val intervalMeters = max(1, j.optInt("intervalMeters", 1000))
      try { journalFile(this, id).delete() } catch (_: Throwable) { }
      p.edit()
        .clear()
        .putString("workoutId", id)
        .putString("workoutType", j.optString("workoutType", "walk"))
        .putString("status", "active")
        .putLong("startedAt", j.optLong("startedAt", System.currentTimeMillis()))
        .putLong("pausedMillis", 0L)
        .putInt("segmentIndex", j.optInt("segmentIndex", 0))
        .putFloat("distanceMeters", 0f)
        .putFloat("maxSpeedMps", 0f)
        .putInt("acceptedPoints", 0)
        .putInt("rejectedPoints", 0)
        .putLong("maxGapMs", 0L)
        .putLong("sequence", 0L)
        .putLong("nextTimeCueMs", intervalMin * 60_000L)
        .putFloat("nextDistanceCueMeters", intervalMeters.toFloat())
        .apply()
      previous = null
    } else {
      p.edit()
        .putString("status", "active")
        .putInt("segmentIndex", j.optInt("segmentIndex", p.getInt("segmentIndex", 0)))
        .apply()
      restorePrevious()
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
    p.edit().putString("status", "paused").putLong("pausedAt", now).apply()
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
      .remove("prevLat").remove("prevLon").remove("prevTime").remove("prevAcc")
      .apply()
    previous = null
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
    p.edit().putString("status", "stopped").apply()
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
      .setWaitForAccurateLocation(false)
      .build()
    callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.sortedBy { it.time }.forEach { processLocation(it) }
      }
    }
    try { fused.requestLocationUpdates(request, callback!!, Looper.getMainLooper()) } catch (_: Throwable) { }
  }

  private fun stopLocation() {
    callback?.let { try { fused.removeLocationUpdates(it) } catch (_: Throwable) { } }
    callback = null
  }

  private fun profile(type: String): DoubleArray = when (type) {
    // Existing walk/run/bike values are preserved. Shopping uses a stronger stationary-drift guard.
    "run" -> doubleArrayOf(35.0, 9.5, 3.0, 800.0, 8.0, 0.2)
    "shopping" -> doubleArrayOf(35.0, 4.5, 4.0, 1200.0, 10.0, 0.3)
    "bike" -> doubleArrayOf(50.0, 22.0, 4.0, 700.0, 10.0, 0.2)
    else -> doubleArrayOf(40.0, 4.5, 3.0, 1000.0, 8.0, 0.2)
  }

  private fun distance(a: Point, b: Point): Double {
    val radius = 6_371_000.0
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLon = Math.toRadians(b.lon - a.lon)
    val value = sin(dLat / 2).pow(2) +
      cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).pow(2)
    return radius * 2 * atan2(sqrt(value), sqrt(1 - value))
  }

  private data class Evaluation(val accepted: Boolean, val distance: Double = 0.0, val derivedSpeed: Double = 0.0)

  private fun evaluate(prev: Point?, point: Point, type: String): Evaluation {
    val profile = profile(type)
    if (!point.lat.isFinite() || !point.lon.isFinite() || abs(point.lat) > 90 || abs(point.lon) > 180) return Evaluation(false)
    if (point.accuracy != null && (!point.accuracy.isFinite() || point.accuracy < 0 || point.accuracy > profile[0])) return Evaluation(false)
    if (prev == null) return Evaluation(true)
    val delta = point.timestamp - prev.timestamp
    if (delta <= 0 || delta < profile[3]) return Evaluation(false)
    val meters = distance(prev, point)
    val uncertainty = max(prev.accuracy ?: 0.0, point.accuracy ?: 0.0)
    val drift = min(profile[4], max(profile[2], uncertainty * profile[5]))
    if (meters < drift) return Evaluation(false)
    val derived = meters / (delta / 1000.0)
    if (!derived.isFinite() || derived > profile[1]) return Evaluation(false)
    if (point.speed != null && point.speed.isFinite() && point.speed > profile[1] * 1.25) return Evaluation(false)
    return Evaluation(true, meters, derived)
  }

  private fun processLocation(location: Location) {
    val p = prefs()
    if (p.getString("status", "") != "active") return
    val point = Point(
      location.latitude,
      location.longitude,
      if (location.time > 0) location.time else System.currentTimeMillis(),
      if (location.hasAccuracy()) location.accuracy.toDouble() else null,
      if (location.hasSpeed()) location.speed.toDouble() else null,
      if (location.hasAltitude()) location.altitude else null,
    )
    val lastAt = p.getLong("lastLocationAt", 0L)
    val gap = if (lastAt > 0) max(0L, point.timestamp - lastAt) else 0L
    val evaluation = evaluate(previous, point, p.getString("workoutType", "walk") ?: "walk")
    var distanceMeters = p.getFloat("distanceMeters", 0f).toDouble()
    var maxSpeedMps = p.getFloat("maxSpeedMps", 0f).toDouble()
    var accepted = p.getInt("acceptedPoints", 0)
    var rejected = p.getInt("rejectedPoints", 0)

    if (evaluation.accepted) {
      if (previous != null) distanceMeters += evaluation.distance
      maxSpeedMps = max(maxSpeedMps, max(point.speed ?: 0.0, evaluation.derivedSpeed))
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
      .putLong("lastLocationAt", point.timestamp)
      .putInt("acceptedPoints", accepted)
      .putInt("rejectedPoints", rejected)
      .putLong("maxGapMs", max(p.getLong("maxGapMs", 0L), gap))
      .putLong("sequence", sequence)
    if (point.accuracy != null) editor.putFloat("lastAccuracy", point.accuracy.toFloat())
    editor.apply()

    appendJournal(sequence, point, p.getInt("segmentIndex", 0))
    checkCue()
  }

  private fun appendJournal(sequence: Long, point: Point, segment: Int) {
    val id = prefs().getString("workoutId", null) ?: return
    val value = JSONObject()
      .put("sequence", sequence)
      .put("latitude", point.lat)
      .put("longitude", point.lon)
      .put("timestamp", point.timestamp)
      .put("accuracy", point.accuracy ?: JSONObject.NULL)
      .put("speed", point.speed ?: JSONObject.NULL)
      .put("altitude", point.altitude ?: JSONObject.NULL)
      .put("segmentIndex", segment)
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
      if (p.contains("prevAcc")) p.getFloat("prevAcc", 0f).toDouble() else null,
      null,
      null,
    )
  }

  private fun persistPrevious() {
    val point = previous ?: return
    val editor = prefs().edit()
      .putFloat("prevLat", point.lat.toFloat())
      .putFloat("prevLon", point.lon.toFloat())
      .putLong("prevTime", point.timestamp)
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

    speakLocale(primary, primaryEngine, minutes, distanceMeters, compact) {
      if (secondary.isNotBlank() && secondary != primary) {
        speakLocale(secondary, secondaryEngine, minutes, distanceMeters, true) { speaking = false }
      } else {
        speaking = false
      }
    }
  }

  private val progressEncouragements = listOf(
    "enc_great","enc_amazing","enc_awesome","enc_good","enc_not_bad","enc_very_good",
    "enc_can","enc_you_can","enc_you_can_do_it","enc_go","enc_go_again","enc_keep_going",
    "enc_try_more","enc_try_little_more","enc_continue","enc_keep_it","enc_hold","enc_hold_little",
    "enc_slow","enc_steady","enc_little_more","enc_tiny_more","enc_almost","enc_nearly",
    "enc_small_gap","enc_very_possible","enc_progress","enc_today_good","enc_nice_work","enc_keep"
  )
  private var lastProgressEncouragement: String? = null

  private fun nextProgressEncouragement(): String {
    val choices = progressEncouragements.filter { it != lastProgressEncouragement }
    val selected = choices[Random.nextInt(choices.size)]
    lastProgressEncouragement = selected
    return selected
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

  private fun speakLocale(locale: String, engine: String, minutes: Int, distanceMeters: Double, compact: Boolean, done: () -> Unit) {
    if (locale == "nan-TW") {
      speakTaigi(taigiTokens(minutes, distanceMeters, compact), done)
    } else {
      speakText(locale, engine, cueText(locale, minutes, distanceMeters, compact), done)
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

  private fun taigiTokens(minutes: Int, distanceMeters: Double, compact: Boolean): List<String> {
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

    out.add("pause_medium")
    out.add(nextProgressEncouragement())
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
