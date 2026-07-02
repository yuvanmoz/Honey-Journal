package com.honeyjournal.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class SetupStatsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_TOGGLE_BULL = "com.honeyjournal.app.ACTION_TOGGLE_BULL"
        const val ACTION_TOGGLE_BEAR = "com.honeyjournal.app.ACTION_TOGGLE_BEAR"
        const val PREFS_NAME = "com.honeyjournal.app.WIDGET_PREFS"
        const val KEY_ACTIVE_TAB = "active_tab"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
        super.onUpdate(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action
        if (action == ACTION_TOGGLE_BULL || action == ACTION_TOGGLE_BEAR) {
            val isBull = action == ACTION_TOGGLE_BULL
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_ACTIVE_TAB, if (isBull) "bull" else "bear").apply()

            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, SetupStatsWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)

            // Notify ListView to reload data
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list)

            // Update button states on the widget UI
            for (appWidgetId in appWidgetIds) {
                updateWidget(context, appWidgetManager, appWidgetId)
            }
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_setup_stats)

        // Read toggled tab
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val activeTab = prefs.getString(KEY_ACTIVE_TAB, "bull") ?: "bull"
        val isBull = activeTab == "bull"

        // Set toggle button highlights
        if (isBull) {
            views.setInt(R.id.btn_bull, "setBackgroundResource", R.drawable.widget_toggle_active_left)
            views.setTextColor(R.id.btn_bull, android.graphics.Color.WHITE)
            views.setInt(R.id.btn_bear, "setBackgroundResource", R.drawable.widget_toggle_inactive_right)
            views.setTextColor(R.id.btn_bear, android.graphics.Color.parseColor("#8E8E93"))
        } else {
            views.setInt(R.id.btn_bull, "setBackgroundResource", R.drawable.widget_toggle_inactive_left)
            views.setTextColor(R.id.btn_bull, android.graphics.Color.parseColor("#8E8E93"))
            views.setInt(R.id.btn_bear, "setBackgroundResource", R.drawable.widget_toggle_active_right)
            views.setTextColor(R.id.btn_bear, android.graphics.Color.WHITE)
        }

        // Set up the toggle click intents
        val bullIntent = Intent(context, SetupStatsWidgetProvider::class.java).apply {
            action = ACTION_TOGGLE_BULL
        }
        val bullPending = PendingIntent.getBroadcast(
            context, 0, bullIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.btn_bull, bullPending)

        val bearIntent = Intent(context, SetupStatsWidgetProvider::class.java).apply {
            action = ACTION_TOGGLE_BEAR
        }
        val bearPending = PendingIntent.getBroadcast(
            context, 1, bearIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.btn_bear, bearPending)

        // Bind ListView service
        val serviceIntent = Intent(context, WidgetRemoteViewsService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        views.setRemoteAdapter(R.id.widget_list, serviceIntent)
        views.setEmptyView(R.id.widget_list, R.id.widget_empty)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}
