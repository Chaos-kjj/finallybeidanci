package com.kangkang.beidanci;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.os.Build;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(NativeAiPlugin.class);
        registerPlugin(NativeTtsPlugin.class);
        registerPlugin(KeyEventsPlugin.class);
        super.onCreate(savedInstanceState);
        configureEinkWindow();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        int code = event.getKeyCode();
        if (plugin != null && plugin.isCaptureMode()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) plugin.emitKeyCode(code);
            // Capture mode is a diagnostic mode: never let a captured volume
            // or navigation key also change the system/app state.
            return true;
        }
        boolean shouldEmit = plugin != null && (plugin.isCaptureMode() || (plugin.isReaderMode() && plugin.shouldEmit(code)));
        if (shouldEmit && event.getAction() == KeyEvent.ACTION_DOWN) plugin.emitKeyCode(code);
        // Unknown keys are left to Android. This keeps volume/system navigation
        // intact outside reader mode and makes custom Bigme mappings safe.
        if (plugin != null && plugin.isReaderMode() && plugin.shouldEmit(code)) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        if (plugin != null && plugin.isCaptureMode()) {
            plugin.emitKeyCode(KeyEvent.KEYCODE_BACK);
            return;
        }
        if (plugin != null && (plugin.isReaderMode() || plugin.isBackHandlingEnabled())) {
            plugin.emitKeyCode(KeyEvent.KEYCODE_BACK);
            return;
        }
        super.onBackPressed();
    }

    private void configureEinkWindow() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.setStatusBarColor(android.graphics.Color.WHITE);
        window.setNavigationBarColor(android.graphics.Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                            | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
}
