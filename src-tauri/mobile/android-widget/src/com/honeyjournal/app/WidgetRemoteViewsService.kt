package com.honeyjournal.app

import android.content.Intent
import android.widget.RemoteViewsService

class WidgetRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return WidgetListFactory(this.applicationContext)
    }
}
