package expo.modules.strideactivityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

class StrideActivityRecognitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityRecognitionResult.hasResult(intent)) return
    val result = ActivityRecognitionResult.extractResult(intent) ?: return
    val detected = result.mostProbableActivity ?: return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_TYPE, detected.type)
      .putInt(KEY_CONFIDENCE, detected.confidence)
      .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
      .apply()

    val pendingResult = goAsync()
    StrideBackgroundStepSampler.sample(context, detected.type, detected.confidence) {
      pendingResult.finish()
    }
  }

  companion object {
    const val PREFS = "stride_route_activity_recognition"
    const val KEY_TYPE = "type"
    const val KEY_CONFIDENCE = "confidence"
    const val KEY_UPDATED_AT = "updated_at"

    fun typeName(type: Int): String = when (type) {
      DetectedActivity.IN_VEHICLE -> "in_vehicle"
      DetectedActivity.ON_BICYCLE -> "on_bicycle"
      DetectedActivity.ON_FOOT -> "on_foot"
      DetectedActivity.RUNNING -> "running"
      DetectedActivity.STILL -> "still"
      DetectedActivity.TILTING -> "tilting"
      DetectedActivity.WALKING -> "walking"
      else -> "unknown"
    }
  }
}
