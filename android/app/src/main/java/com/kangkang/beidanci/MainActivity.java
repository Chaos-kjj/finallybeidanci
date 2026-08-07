package com.kangkang.beidanci;

import android.os.Bundle;
import android.os.Build;
import android.view.KeyEvent;
import android.window.OnBackInvokedDispatcher;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(NativeAiPlugin.class);
        registerPlugin(NativeTtsPlugin.class);
        registerPlugin(KeyEventsPlugin.class);
        registerPlugin(ReaderWindowPlugin.class);
        registerPlugin(DocumentExportPlugin.class);
        registerPlugin(NativeClipboardPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_OVERLAY,
                    this::handleBackPressed);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        int code = event.getKeyCode();
        if (plugin != null && code == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
            handleBackPressed();
            return true;
        }
        boolean readerKey = code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
                || code == KeyEvent.KEYCODE_PAGE_UP || code == KeyEvent.KEYCODE_PAGE_DOWN
                || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT
                || code == KeyEvent.KEYCODE_MENU;
        if (plugin != null && event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0
                && (readerKey || (plugin.isDebugCapture() && !event.isPrintingKey()))) plugin.emitKeyCode(code);
        if (plugin != null && plugin.isReaderMode() && readerKey) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    private void handleBackPressed() {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        if (plugin != null && plugin.isReaderMode()) {
            plugin.emitBackPressed();
            return;
        }
        MainActivity.super.onBackPressed();
    }
}
