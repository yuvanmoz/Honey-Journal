package com.honeyjournal.app

import android.content.Context
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

class WidgetListFactory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {

    private var items: List<SetupItem> = ArrayList()

    data class SetupItem(val name: String, val passed: Int, val missed: Int, val failed: Int, val total: Int)

    override fun onCreate() {}

    override fun onDataSetChanged() {
        // Read active tab
        val prefs = context.getSharedPreferences(SetupStatsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        val activeTab = prefs.getString(SetupStatsWidgetProvider.KEY_ACTIVE_TAB, "bull") ?: "bull"
        val isBull = activeTab == "bull"

        // Load data from external storage
        val baseFolder = File("/storage/emulated/0/HoneyJournal")
        if (!baseFolder.exists()) {
            items = emptyList()
            return
        }

        // 1. Read tags.json to check tag biases (Bullish, Bearish, Both)
        val tagsFile = File(baseFolder, "tags.json")
        val tagBiases = HashMap<String, String>() // name -> type
        if (tagsFile.exists()) {
            try {
                val tagsJson = tagsFile.readText()
                val tagsArr = JSONArray(tagsJson)
                for (i in 0 until tagsArr.length()) {
                    val obj = tagsArr.getJSONObject(i)
                    val name = obj.optString("name")
                    val type = obj.optString("type", "Both")
                    tagBiases[name] = type
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        // 2. Read entries from entries/ folder
        val entriesFolder = File(baseFolder, "entries")
        val bullishCounts = HashMap<String, SetupCounts>()
        val bearishCounts = HashMap<String, SetupCounts>()

        val incrementCount = { counts: HashMap<String, SetupCounts>, pat: String, status: String ->
            val c = counts.getOrPut(pat) { SetupCounts() }
            c.total += 1
            when (status) {
                "PASSED" -> c.passed += 1
                "FAILED" -> c.failed += 1
                else -> c.missed += 1
            }
        }

        val entriesFiles = entriesFolder.listFiles()
        if (entriesFiles != null) {
            for (file in entriesFiles) {
                if (file.isFile && file.name.endsWith(".json")) {
                    try {
                        val entryJson = file.readText()
                        val obj = JSONObject(entryJson)
                        val status = obj.optString("status", "MISSED")
                        val bias = obj.optString("bias", "")
                        val patternsArr = obj.optJSONArray("patterns")
                        if (patternsArr != null) {
                            for (i in 0 until patternsArr.length()) {
                                val pat = patternsArr.getString(i)
                                val tagType = tagBiases[pat] ?: "Both"
                                if (tagType == "Bullish") {
                                    incrementCount(bullishCounts, pat, status)
                                } else if (tagType == "Bearish") {
                                    incrementCount(bearishCounts, pat, status)
                                } else {
                                    if (bias == "Bullish") {
                                        incrementCount(bullishCounts, pat, status)
                                    } else if (bias == "Bearish") {
                                        incrementCount(bearishCounts, pat, status)
                                    } else {
                                        incrementCount(bullishCounts, pat, status)
                                        incrementCount(bearishCounts, pat, status)
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
        }

        val activeCounts = if (isBull) bullishCounts else bearishCounts
        items = activeCounts.map { (name, c) ->
            SetupItem(name, c.passed, c.missed, c.failed, c.total)
        }.sortedByDescending { it.total }
    }

    class SetupCounts {
        var passed = 0
        var missed = 0
        var failed = 0
        var total = 0
    }

    override fun onDestroy() {}

    override fun getCount(): Int {
        return items.size
    }

    override fun getViewAt(position: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_list_item)
        if (position >= items.size) return rv

        val item = items[position]
        rv.setTextViewText(R.id.item_rank, "${position + 1}.")
        rv.setTextViewText(R.id.item_name, item.name)
        
        // Setup stats badges
        rv.setTextViewText(R.id.badge_passed, "${item.passed}P")
        rv.setTextViewText(R.id.badge_missed, "${item.missed}M")
        rv.setTextViewText(R.id.badge_failed, "${item.failed}F")

        return rv
    }

    override fun getLoadingView(): RemoteViews? {
        return null
    }

    override fun getViewTypeCount(): Int {
        return 1
    }

    override fun getItemId(position: Int): Long {
        return position.toLong()
    }

    override fun hasStableIds(): Boolean {
        return true
    }
}
