package com.kangkang.beidanci;

import android.view.Window;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReaderWindow")
public class ReaderWindowPlugin extends Plugin {
    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.setDecorFitsSystemWindows(window, !enabled);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (enabled) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSelectionGuard(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (enabled) {
                // Consume WebView's native long-click before it starts the
                // Android text-selection ActionMode and cancels JS pointers.
                // The reader implements selection entirely through Pointer
                // Events and logical document offsets while this guard is on.
                webView.setLongClickable(true);
                webView.setHapticFeedbackEnabled(false);
                webView.setOnLongClickListener(view -> true);
            } else {
                webView.setOnLongClickListener(null);
                webView.setLongClickable(true);
                webView.setHapticFeedbackEnabled(true);
            }
            call.resolve();
        });
    }
}
