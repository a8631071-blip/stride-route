package expo.modules.stridetts

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import java.util.UUID
import java.io.File
import java.io.FileOutputStream
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

class StrideTtsModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var activeTts: TextToSpeech? = null
  private var activeAudioManager: AudioManager? = null
  private var activeFocusRequest: AudioFocusRequest? = null
  private var activePlayer: MediaPlayer? = null
  private var activePackFile: File? = null
  private var activePackPromise: Promise? = null
  private var activePackGeneration: Long = 0

  override fun definition() = ModuleDefinition {
    Name("StrideTts")

    AsyncFunction("findEngineForLanguage") { languageTag: String, promise: Promise ->
      mainHandler.post { findEngineForLanguage(languageTag, promise) }
    }

    AsyncFunction("speak") { text: String, languageTag: String, enginePackage: String, promise: Promise ->
      mainHandler.post { speak(text, languageTag, enginePackage.ifBlank { null }, promise) }
    }

    AsyncFunction("hasPackagedTaigiVoice") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      rawResourceId(context, "state_walk_start") != 0 &&
        rawResourceId(context, "state_shopping_start") != 0 &&
        rawResourceId(context, "decimal_0") != 0 &&
        rawResourceId(context, "decimal_9") != 0 &&
        rawResourceId(context, "unit_kilometer") != 0 &&
        rawResourceId(context, "time_ctx_05m") != 0 &&
        rawResourceId(context, "ai_v6_distance_1_01") != 0 &&
        rawResourceId(context, "ai_v6_distance_2_01") != 0
    }

    AsyncFunction("playTaigiTokens") { tokens: List<String>, promise: Promise ->
      mainHandler.post { playTaigiTokens(tokens, promise) }
    }

    AsyncFunction("startWorkoutRuntime") { configJson: String ->
      val context = appContext.reactContext?.applicationContext
      context != null && StrideWorkoutRuntimeService.start(context, configJson)
    }

    AsyncFunction("pauseWorkoutRuntime") {
      val context = appContext.reactContext?.applicationContext
      context != null && StrideWorkoutRuntimeService.pause(context)
    }

    AsyncFunction("resumeWorkoutRuntime") { segmentIndex: Int, configJson: String ->
      val context = appContext.reactContext?.applicationContext
      context != null && StrideWorkoutRuntimeService.resume(context, segmentIndex, configJson)
    }

    AsyncFunction("updateWorkoutRuntimeVoice") { configJson: String ->
      val context = appContext.reactContext?.applicationContext
      context != null && StrideWorkoutRuntimeService.updateVoice(context, configJson)
    }

    AsyncFunction("stopWorkoutRuntime") {
      val context = appContext.reactContext?.applicationContext
      if (context == null) emptyMap<String, Any?>() else StrideWorkoutRuntimeService.stopNow(context)
    }

    Function("getWorkoutRuntimeSnapshot") {
      val context = appContext.reactContext?.applicationContext
      if (context == null) emptyMap<String, Any?>() else StrideWorkoutRuntimeService.snapshot(context)
    }

    Function("readWorkoutRuntimePoints") { sinceSequence: Double ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) emptyList<Map<String, Any?>>() else StrideWorkoutRuntimeService.readPointsSince(context, sinceSequence.toLong())
    }

    AsyncFunction("stop") {
      mainHandler.post { releaseActiveSpeech() }
      true
    }

    AsyncFunction("openTtsSettings") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      openIntent(context, Intent("com.android.settings.TTS_SETTINGS")) || openIntent(context, Intent(Settings.ACTION_SETTINGS))
    }

    AsyncFunction("installTtsData") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      openIntent(context, Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)) || openIntent(context, Intent("com.android.settings.TTS_SETTINGS"))
    }

    AsyncFunction("openPlayStore") { packageName: String ->
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
      if (openIntent(context, market)) true else openIntent(context, Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
    }

    OnDestroy { releaseActiveSpeech() }
  }

  private fun openIntent(context: Context, intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    } catch (_: Throwable) { false }
  }

  private fun ttsPackages(context: Context): List<Pair<String, String>> {
    val intent = Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE)
    @Suppress("DEPRECATION")
    val services = context.packageManager.queryIntentServices(intent, 0)
    val result = mutableListOf<Pair<String, String>>()
    val seen = mutableSetOf<String>()
    val defaultPackage = Settings.Secure.getString(context.contentResolver, "tts_default_synth")
    if (!defaultPackage.isNullOrBlank()) {
      val label = try { context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(defaultPackage, 0)).toString() } catch (_: Throwable) { defaultPackage }
      result.add(defaultPackage to label)
      seen.add(defaultPackage)
    }
    for (service in services) {
      val packageName = service.serviceInfo?.packageName ?: continue
      if (!seen.add(packageName)) continue
      val label = try { service.loadLabel(context.packageManager)?.toString() ?: packageName } catch (_: Throwable) { packageName }
      result.add(packageName to label)
    }
    return result
  }

  private fun resolveSupportedLocale(tts: TextToSpeech, languageTag: String): Pair<Locale, Int>? {
    val requested = Locale.forLanguageTag(languageTag)
    val requestedStatus = try { tts.isLanguageAvailable(requested) } catch (_: Throwable) { TextToSpeech.LANG_NOT_SUPPORTED }
    if (requestedStatus >= TextToSpeech.LANG_AVAILABLE) return requested to requestedStatus

    // 台語引擎未必宣告 nan-TW，而可能只宣告通用 nan 或某個 nan-* voice。
    // 只允許在同一個 nan 語言族內降級，絕不退回 zh-TW / 國語。
    if (languageTag.startsWith("nan", ignoreCase = true)) {
      val voiceLocale = try {
        tts.voices?.firstOrNull { voice -> voice.locale?.language?.equals("nan", ignoreCase = true) == true }?.locale
      } catch (_: Throwable) { null }
      if (voiceLocale != null) {
        val voiceStatus = try { tts.isLanguageAvailable(voiceLocale) } catch (_: Throwable) { TextToSpeech.LANG_NOT_SUPPORTED }
        if (voiceStatus >= TextToSpeech.LANG_AVAILABLE) return voiceLocale to voiceStatus
      }
      val genericNan = Locale.forLanguageTag("nan")
      val genericStatus = try { tts.isLanguageAvailable(genericNan) } catch (_: Throwable) { TextToSpeech.LANG_NOT_SUPPORTED }
      if (genericStatus >= TextToSpeech.LANG_AVAILABLE) return genericNan to genericStatus
    }
    return null
  }

  private fun findEngineForLanguage(languageTag: String, promise: Promise) {
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      promise.resolve(mapOf("available" to false, "enginePackage" to null, "engineLabel" to null, "status" to -98))
      return
    }
    val candidates = ttsPackages(context)
    if (candidates.isEmpty()) {
      promise.resolve(mapOf("available" to false, "enginePackage" to null, "engineLabel" to null, "status" to TextToSpeech.ERROR))
      return
    }
    var lastStatus = TextToSpeech.LANG_NOT_SUPPORTED

    fun tryAt(index: Int) {
      if (index >= candidates.size) {
        promise.resolve(mapOf("available" to false, "enginePackage" to null, "engineLabel" to null, "status" to lastStatus))
        return
      }
      val (packageName, label) = candidates[index]
      val holder = arrayOfNulls<TextToSpeech>(1)
      var candidateSettled = false
      lateinit var initTimeout: Runnable

      fun finishCandidate(available: Boolean, status: Int) {
        if (candidateSettled) return
        candidateSettled = true
        mainHandler.removeCallbacks(initTimeout)
        val tts = holder[0]
        try { tts?.shutdown() } catch (_: Throwable) { }
        lastStatus = status
        if (available) {
          promise.resolve(mapOf("available" to true, "enginePackage" to packageName, "engineLabel" to label, "status" to status))
        } else {
          tryAt(index + 1)
        }
      }

      initTimeout = Runnable { finishCandidate(false, TextToSpeech.ERROR) }
      val listener = TextToSpeech.OnInitListener { initStatus ->
        mainHandler.post {
          if (candidateSettled) return@post
          val tts = holder[0]
          if (tts == null || initStatus != TextToSpeech.SUCCESS) {
            finishCandidate(false, TextToSpeech.ERROR)
            return@post
          }
          val supported = resolveSupportedLocale(tts, languageTag)
          val status = supported?.second ?: TextToSpeech.LANG_NOT_SUPPORTED
          finishCandidate(supported != null, status)
        }
      }
      holder[0] = try { TextToSpeech(context, listener, packageName) } catch (_: Throwable) { null }
      if (holder[0] == null) {
        finishCandidate(false, TextToSpeech.ERROR)
      } else {
        // Broken third-party engines must not block the settings screen forever.
        mainHandler.postDelayed(initTimeout, 4_000)
      }
    }

    tryAt(0)
  }

  private fun requestAudioFocus(context: Context): Pair<AudioManager?, AudioFocusRequest?> {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return null to null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attributes)
        .setAcceptsDelayedFocusGain(false)
        .setOnAudioFocusChangeListener { }
        .build()
      manager.requestAudioFocus(request)
      manager to request
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      manager to null
    }
  }

  private fun releaseAudioFocus() {
    val manager = activeAudioManager
    val request = activeFocusRequest
    if (manager != null) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && request != null) {
        manager.abandonAudioFocusRequest(request)
      } else {
        @Suppress("DEPRECATION")
        manager.abandonAudioFocus(null)
      }
    }
    activeAudioManager = null
    activeFocusRequest = null
  }

  private fun releaseActiveSpeech() {
    val pp = activePackPromise
    activePackGeneration += 1
    activePackPromise = null
    try { activePlayer?.stop() } catch (_: Throwable) { }
    try { activePlayer?.release() } catch (_: Throwable) { }
    activePlayer = null
    try { activePackFile?.delete() } catch (_: Throwable) { }
    activePackFile = null
    if (pp != null) { try { pp.resolve(false) } catch (_: Throwable) { } }
    try { activeTts?.stop() } catch (_: Throwable) { }
    try { activeTts?.shutdown() } catch (_: Throwable) { }
    activeTts = null
    releaseAudioFocus()
  }

  private fun rawResourceId(context: Context, token: String): Int {
    if (!token.matches(Regex("^[a-z0-9_]+$"))) return 0
    return context.resources.getIdentifier(token, "raw", context.packageName)
  }

  private fun leInt(b: ByteArray, o: Int): Int =
    ByteBuffer.wrap(b, o, 4).order(ByteOrder.LITTLE_ENDIAN).int

  private fun leShort(b: ByteArray, o: Int): Int =
    ByteBuffer.wrap(b, o, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff

  private fun wavPcm(context: Context, resId: Int, token: String): ByteArray? {
    return try {
      val b = context.resources.openRawResource(resId).use { it.readBytes() }
      if (b.size < 44 || String(b,0,4,Charsets.US_ASCII)!="RIFF" || String(b,8,4,Charsets.US_ASCII)!="WAVE") return null
      var off=12
      var fmt=false
      var pcm: ByteArray?=null
      while (off+8<=b.size) {
        val id=String(b,off,4,Charsets.US_ASCII)
        val size=leInt(b,off+4)
        val start=off+8
        if (size<0 || start+size>b.size) return null
        if (id=="fmt " && size>=16) {
          fmt=leShort(b,start)==1 && leShort(b,start+2)==1 && leInt(b,start+4)==22050 && leShort(b,start+14)==16
        } else if (id=="data") {
          pcm=b.copyOfRange(start,start+size)
        }
        off=start+size+(size and 1)
      }
      if (fmt && pcm != null) pcm else null
    } catch (_: Throwable) { null }
  }

  private fun intLE(out: FileOutputStream,v:Int) {
    out.write(byteArrayOf((v and 255).toByte(),((v ushr 8) and 255).toByte(),((v ushr 16) and 255).toByte(),((v ushr 24) and 255).toByte()))
  }

  private fun shortLE(out: FileOutputStream,v:Int) {
    out.write(byteArrayOf((v and 255).toByte(),((v ushr 8) and 255).toByte()))
  }

  private fun combinedWav(context: Context,tokens: List<String>): File? {
    var merged = ByteArray(0)
    for (token in tokens) {
      val id=rawResourceId(context,token)
      if (id==0) return null
      val pcm=wavPcm(context,id,token) ?: return null
      // V22: do not overlap adjacent speech tokens; keep the offline-approved boundaries intact.
      merged = if (merged.isEmpty()) pcm else merged + pcm
    }
    val size = merged.size
    return try {
      val f=File.createTempFile("stride_taigi_",".wav",context.cacheDir)
      FileOutputStream(f).use { out ->
        out.write("RIFF".toByteArray(Charsets.US_ASCII)); intLE(out,36+size)
        out.write("WAVEfmt ".toByteArray(Charsets.US_ASCII)); intLE(out,16)
        shortLE(out,1); shortLE(out,1); intLE(out,22050); intLE(out,44100); shortLE(out,2); shortLE(out,16)
        out.write("data".toByteArray(Charsets.US_ASCII)); intLE(out,size)
        out.write(merged)
      }
      f
    } catch (_: Throwable) { null }
  }

  private fun playTaigiTokens(tokens: List<String>, promise: Promise) {
    val context=appContext.reactContext?.applicationContext
    if (context==null || tokens.isEmpty()) { promise.resolve(false); return }

    releaseActiveSpeech()
    val generation=activePackGeneration+1
    activePackGeneration=generation
    activePackPromise=promise

    Thread {
      val file=combinedWav(context,tokens)
      mainHandler.post {
        if (generation!=activePackGeneration || activePackPromise !== promise) {
          try { file?.delete() } catch (_: Throwable) { }
          return@post
        }
        if (file==null) {
          activePackPromise=null
          promise.resolve(false)
          return@post
        }

        val attrs=AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val player=MediaPlayer()
        activePlayer=player
        activePackFile=file
        var packTimeout: Runnable?=null

        fun finish(ok:Boolean) {
          if (activePackPromise !== promise || generation!=activePackGeneration) return
          packTimeout?.let { mainHandler.removeCallbacks(it) }
          packTimeout=null
          activePackPromise=null
          try { player.setOnPreparedListener(null) } catch (_: Throwable) { }
          try { player.setOnCompletionListener(null) } catch (_: Throwable) { }
          try { player.setOnErrorListener(null) } catch (_: Throwable) { }
          try { player.release() } catch (_: Throwable) { }
          if (activePlayer === player) activePlayer=null
          try { file.delete() } catch (_: Throwable) { }
          if (activePackFile === file) activePackFile=null
          releaseAudioFocus()
          promise.resolve(ok)
        }

        try {
          player.setAudioAttributes(attrs)
          FileInputStream(file).use { input -> player.setDataSource(input.fd) }
          player.setOnPreparedListener {
            if (activePackPromise !== promise || generation!=activePackGeneration) return@setOnPreparedListener
            val focus=requestAudioFocus(context)
            activeAudioManager=focus.first
            activeFocusRequest=focus.second
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
              try { player.playbackParams = android.media.PlaybackParams().setSpeed(1.0f).setPitch(1.0f) } catch (_: Throwable) { }
            }
            try { player.start() } catch (_: Throwable) { finish(false) }
          }
          player.setOnCompletionListener { finish(true) }
          player.setOnErrorListener { _,_,_ -> finish(false); true }
          val timeout=Runnable { finish(false) }
          packTimeout=timeout
          mainHandler.postDelayed(timeout,60_000)
          player.prepareAsync()
        } catch (_: Throwable) {
          finish(false)
        }
      }
    }.start()
  }

  private fun speak(text: String, languageTag: String, enginePackage: String?, promise: Promise) {
    val context = appContext.reactContext?.applicationContext
    if (context == null || text.isBlank()) { promise.resolve(false); return }
    releaseActiveSpeech()
    val holder = arrayOfNulls<TextToSpeech>(1)
    var settled = false
    lateinit var initTimeout: Runnable
    lateinit var utteranceTimeout: Runnable

    fun finish(ok: Boolean) {
      mainHandler.post {
        if (settled) return@post
        settled = true
        mainHandler.removeCallbacks(initTimeout)
        mainHandler.removeCallbacks(utteranceTimeout)
        val tts = holder[0]
        if (activeTts === tts) {
          try { tts?.stop() } catch (_: Throwable) { }
          try { tts?.shutdown() } catch (_: Throwable) { }
          activeTts = null
          releaseAudioFocus()
        } else {
          try { tts?.shutdown() } catch (_: Throwable) { }
        }
        promise.resolve(ok)
      }
    }

    initTimeout = Runnable { finish(false) }
    utteranceTimeout = Runnable { finish(false) }

    val listener = TextToSpeech.OnInitListener { initStatus ->
      mainHandler.post {
        if (settled) return@post
        mainHandler.removeCallbacks(initTimeout)
        val tts = holder[0]
        if (tts == null || initStatus != TextToSpeech.SUCCESS) {
          finish(false)
          return@post
        }
        val supported = resolveSupportedLocale(tts, languageTag)
        if (supported == null) {
          finish(false)
          return@post
        }
        val languageStatus = try { tts.setLanguage(supported.first) } catch (_: Throwable) { TextToSpeech.LANG_NOT_SUPPORTED }
        if (languageStatus < TextToSpeech.LANG_AVAILABLE) {
          finish(false)
          return@post
        }
        tts.setSpeechRate(0.95f)
        tts.setPitch(1.0f)
        tts.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        val focus = requestAudioFocus(context)
        activeAudioManager = focus.first
        activeFocusRequest = focus.second
        activeTts = tts
        val utteranceId = "stride-${UUID.randomUUID()}"
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) = Unit
          override fun onDone(utteranceId: String?) = finish(true)
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) = finish(false)
          override fun onError(utteranceId: String?, errorCode: Int) = finish(false)
          override fun onStop(utteranceId: String?, interrupted: Boolean) = finish(false)
        })
        val result = try {
          tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId)
        } catch (_: Throwable) { TextToSpeech.ERROR }
        if (result == TextToSpeech.ERROR) {
          finish(false)
        } else {
          // A buggy engine that never calls onDone/onError must not permanently block the queue.
          mainHandler.postDelayed(utteranceTimeout, 30_000)
        }
      }
    }
    holder[0] = try {
      if (enginePackage.isNullOrBlank()) TextToSpeech(context, listener) else TextToSpeech(context, listener, enginePackage)
    } catch (_: Throwable) { null }
    if (holder[0] == null) finish(false) else mainHandler.postDelayed(initTimeout, 4_000)
  }

}
