package com.kangkang.beidanci;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KeyEvents")
public class KeyEventsPlugin extends Plugin {
    private static KeyEventsPlugin instance;
    private volatile boolean readerMode;
    private volatile boolean debugCapture;

    public KeyEventsPlugin() { instance = this; }
    public static KeyEventsPlugin getInstance() { return instance; }

    @PluginMethod
    public void setReaderMode(PluginCall call) {
        readerMode = call.getBoolean("enabled", false);
        call.resolve();
    }

    public boolean isReaderMode() { return readerMode; }
    public boolean isDebugCapture() { return debugCapture; }

    @PluginMethod
    public void setDebugCapture(PluginCall call) {
        debugCapture = call.getBoolean("enabled", false);
        call.resolve();
    }

    public void emitKeyCode(int keyCode) {
        JSObject data = new JSObject();
        data.put("keyCode", keyCode);
        notifyListeners("androidKey", data);
    }

    public void emitBackPressed() { notifyListeners("backPressed", new JSObject()); }
}
