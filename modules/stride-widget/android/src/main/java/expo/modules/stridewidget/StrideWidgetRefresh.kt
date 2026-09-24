package expo.modules.stridewidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

internal object StrideWidgetRefresh {
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val component = ComponentName(context, StrideWidgetProvider::class.java)
    val ids = manager.getAppWidgetIds(component)
    if (ids.isEmpty()) return
    context.sendBroadcast(
      Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .setComponent(component)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
    )
  }
}
