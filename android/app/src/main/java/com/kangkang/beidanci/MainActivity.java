package com.kangkang.beidanci;

import android.os.Bundle;
import android.view.KeyEvent;

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
        super.onCreate(savedInstanceState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        int code = event.getKeyCode();
        boolean readerKey = code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
                || code == KeyEvent.KEYCODE_PAGE_UP || code == KeyEvent.KEYCODE_PAGE_DOWN
                || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT;
        if (plugin != null && event.getAction() == KeyEvent.ACTION_DOWN
                && (readerKey || (plugin.isDebugCapture() && !event.isPrintingKey()))) plugin.emitKeyCode(code);
        if (plugin != null && plugin.isReaderMode() && readerKey) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        KeyEventsPlugin plugin = KeyEventsPlugin.getInstance();
        if (plugin != null && plugin.isReaderMode()) {
            plugin.emitBackPressed();
            return;
        }
        super.onBackPressed();
    }
}
