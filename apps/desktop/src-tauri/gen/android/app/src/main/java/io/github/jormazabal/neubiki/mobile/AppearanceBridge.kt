package io.github.jormazabal.neubiki.mobile

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.WindowInsetsControllerCompat

/** UI-only bridge: no file, network, recording or persistence authority. */
class NeubikiAppearance(private val activity: Activity, private val webView: WebView) {
    @JavascriptInterface fun setTheme(dark: Boolean) {
        applyFrame(if (dark) Color.rgb(12, 13, 15) else Color.WHITE, dark)
    }

    @JavascriptInterface fun setWorkspaceFrame(color: String, dark: Boolean) {
        if (color.length != 7 || !color.startsWith('#')) return
        val background = runCatching { Color.parseColor(color) }.getOrNull() ?: return
        applyFrame(background, dark)
    }

    @Suppress("DEPRECATION") // Explicit bar colors apply on Android 14 and earlier.
    private fun applyFrame(background: Int, dark: Boolean) {
        webView.post {
            if (activity.isFinishing || activity.isDestroyed) return@post
            val window = activity.window
            // Edge-to-edge bars show the frame drawn behind their insets.
            window.decorView.setBackgroundColor(background)
            (webView.parent as? View)?.setBackgroundColor(background)
            webView.setBackgroundColor(background)
            if (Build.VERSION.SDK_INT < 35) {
                window.statusBarColor = background
                window.navigationBarColor = background
            }
            window.isNavigationBarContrastEnforced = false
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }
    }
}
