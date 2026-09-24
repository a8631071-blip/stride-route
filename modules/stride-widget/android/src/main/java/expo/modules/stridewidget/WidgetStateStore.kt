package expo.modules.stridewidget

import android.content.Context

internal object WidgetStateStore {
  // Keep the V13 preference namespace so upgrades preserve the same-day total/goal.
  private const val PREFS = "stride_route_widget_v13"
  private const val STEPS = "steps"
  private const val GOAL = "goal"
  private const val UPDATED_AT = "updatedAt"
  private const val DATE_KEY = "dateKey"
  private const val LOCALE = "locale"

  fun write(context: Context, steps: Int, goal: Int, updatedAt: Long, dateKey: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val storedDate = prefs.getString(DATE_KEY, "") ?: ""
    val safeSteps = if (storedDate == dateKey) maxOf(prefs.getInt(STEPS, 0), steps.coerceAtLeast(0)) else steps.coerceAtLeast(0)
    prefs.edit()
      .putInt(STEPS, safeSteps)
      .putInt(GOAL, goal.coerceAtLeast(1))
      .putLong(UPDATED_AT, updatedAt)
      .putString(DATE_KEY, dateKey)
      .apply()
  }

  fun writeSteps(context: Context, steps: Int, updatedAt: Long, dateKey: String) {
    val current = read(context)
    write(context, steps, current.goal, updatedAt, dateKey)
  }

  fun setLocale(context: Context, locale: String) {
    val safe = when {
      locale.startsWith("zh", true) -> "zh-TW"
      locale.startsWith("ja", true) -> "ja"
      locale.startsWith("th", true) -> "th"
      locale.startsWith("ko", true) -> "ko"
      else -> "en"
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LOCALE, safe).apply()
  }

  fun read(context: Context): State {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return State(
      steps = prefs.getInt(STEPS, 0),
      goal = prefs.getInt(GOAL, 10_000),
      updatedAt = prefs.getLong(UPDATED_AT, 0L),
      dateKey = prefs.getString(DATE_KEY, "") ?: "",
      locale = prefs.getString(LOCALE, "zh-TW") ?: "zh-TW",
    )
  }

  data class State(val steps: Int, val goal: Int, val updatedAt: Long, val dateKey: String, val locale: String)
}
