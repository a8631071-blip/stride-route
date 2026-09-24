package expo.modules.stridewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

class StrideWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { manager.updateAppWidget(it, views(context)) }
  }

  override fun onReceive(context: Context, intent: Intent) {
    val shouldSample = intent.action == Intent.ACTION_USER_PRESENT ||
      intent.action == Intent.ACTION_BOOT_COMPLETED ||
      intent.action == AppWidgetManager.ACTION_APPWIDGET_ENABLED ||
      intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE

    if (shouldSample) {
      val pendingResult = goAsync()
      StepCounterSnapshotSampler.sample(context) {
        pendingResult.finish()
      }
    }
    super.onReceive(context, intent)
  }

  private fun views(context: Context): RemoteViews {
    val state = WidgetStateStore.read(context)
    val locale = localeFor(state.locale)
    val percent = (state.steps.toDouble() * 100.0 / state.goal).roundToInt().coerceIn(0, 100)
    val time = if (state.updatedAt <= 0L) "" else SimpleDateFormat("HH:mm", locale).format(Date(state.updatedAt))
    return RemoteViews(context.packageName, R.layout.stride_widget).apply {
      setTextViewText(R.id.stride_widget_title, text(state.locale, "title"))
      setTextViewText(R.id.stride_widget_steps, text(state.locale, "steps", number(state.steps, locale)))
      setTextViewText(R.id.stride_widget_meta, text(state.locale, "goal", number(state.goal, locale), percent.toString()))
      setTextViewText(R.id.stride_widget_updated, if (state.updatedAt <= 0L) text(state.locale, "not_synced") else text(state.locale, "updated", time))
      setOnClickPendingIntent(R.id.stride_widget_root, launchPendingIntent(context))
    }
  }

  private fun text(code: String, key: String, vararg args: String): String {
    val template = when (code) {
      "en" -> when (key) { "title" -> "StrideRoute · Today"; "steps" -> "{0} steps"; "goal" -> "Goal {0} · {1}%"; "updated" -> "Updated {0}"; else -> "Not synced" }
      "ja" -> when (key) { "title" -> "歩跡 · 今日"; "steps" -> "{0}歩"; "goal" -> "目標 {0} · {1}%"; "updated" -> "{0} 更新"; else -> "未同期" }
      "th" -> when (key) { "title" -> "StrideRoute · วันนี้"; "steps" -> "{0} ก้าว"; "goal" -> "เป้าหมาย {0} · {1}%"; "updated" -> "อัปเดต {0}"; else -> "ยังไม่ซิงก์" }
      "ko" -> when (key) { "title" -> "StrideRoute · 오늘"; "steps" -> "{0}걸음"; "goal" -> "목표 {0} · {1}%"; "updated" -> "{0} 업데이트"; else -> "동기화 안 됨" }
      else -> when (key) { "title" -> "步跡 · 今天"; "steps" -> "{0} 步"; "goal" -> "目標 {0} · {1}%"; "updated" -> "{0} 更新"; else -> "尚未同步" }
    }
    return args.foldIndexed(template) { index, value, item -> value.replace("{$index}", item) }
  }

  private fun localeFor(code: String): Locale = when (code) {
    "en" -> Locale.US
    "ja" -> Locale.JAPAN
    "th" -> Locale("th", "TH")
    "ko" -> Locale.KOREA
    else -> Locale.TAIWAN
  }

  private fun launchPendingIntent(context: Context): PendingIntent {
    val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse("strideroute:///"))
      .setPackage(context.packageName)
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, 9001, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun number(value: Int, locale: Locale) = NumberFormat.getIntegerInstance(locale).format(value)
}
