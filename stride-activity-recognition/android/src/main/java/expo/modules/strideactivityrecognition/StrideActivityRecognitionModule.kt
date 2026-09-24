package expo.modules.strideactivityrecognition

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.tasks.Tasks
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StrideActivityRecognitionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StrideActivityRecognition")

    AsyncFunction("startTracking") {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          Tasks.await(ActivityRecognition.getClient(context).requestActivityUpdates(3_000L, pendingIntent(context)))
          true
        } catch (_: Throwable) {
          false
        }
      }
    }

    AsyncFunction("stopTracking") {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          Tasks.await(ActivityRecognition.getClient(context).removeActivityUpdates(pendingIntent(context)))
          true
        } catch (_: Throwable) {
          false
        }
      }
    }

    Function("getCurrentActivity") {
      val context = appContext.reactContext
      if (context == null) {
        mapOf("type" to "unknown", "confidence" to 0, "updatedAt" to 0L)
      } else {
        val prefs = context.getSharedPreferences(StrideActivityRecognitionReceiver.PREFS, Context.MODE_PRIVATE)
        val type = prefs.getInt(StrideActivityRecognitionReceiver.KEY_TYPE, -1)
        mapOf(
          "type" to StrideActivityRecognitionReceiver.typeName(type),
          "confidence" to prefs.getInt(StrideActivityRecognitionReceiver.KEY_CONFIDENCE, 0),
          "updatedAt" to prefs.getLong(StrideActivityRecognitionReceiver.KEY_UPDATED_AT, 0L),
        )
      }
    }
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, StrideActivityRecognitionReceiver::class.java)
    return PendingIntent.getBroadcast(
      context,
      7407,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
