package com.kangkang.beidanci;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "KeyEvents")
public class KeyEventsPlugin extends Plugin {
    private static KeyEventsPlugin instance;
    private volatile boolean readerMode;
    private volatile boolean captureMode;
    private volatile boolean backHandlingEnabled;
    private final Set<Integer> mappedCodes = new HashSet<>();

    public KeyEventsPlugin() { instance = this; }
    public static KeyEventsPlugin getInstance() { return instance; }

    @PluginMethod
    public void setReaderMode(PluginCall call) {
        readerMode = call.getBoolean("enabled", false);
        call.resolve();
    }

    @PluginMethod
    public void setCaptureMode(PluginCall call) {
        captureMode = call.getBoolean("enabled", false);
        call.resolve();
    }

    @PluginMethod
    public void setBackHandling(PluginCall call) {
        backHandlingEnabled = call.getBoolean("enabled", false);
        call.resolve();
    }

    @PluginMethod
    public void finishApp(PluginCall call) {
        if (getActivity() != null) getActivity().finish();
        call.resolve();
    }

    @PluginMethod
    public void setMapping(PluginCall call) {
        Set<Integer> next = new HashSet<>();
        com.getcapacitor.JSObject mapping = call.getObject("mapping");
        if (mapping != null) {
            for (String action : Arrays.asList("next", "previous", "back", "menu")) {
                JSONArray values = mapping.optJSONArray(action);
                if (values == null) continue;
                for (int index = 0; index < values.length(); index += 1) {
                    int code = values.optInt(index, -1);
                    if (code >= 0 && code <= 1000) next.add(code);
                }
            }
        }
        synchronized (mappedCodes) {
            mappedCodes.clear();
            mappedCodes.addAll(next);
        }
        call.resolve();
    }

    public boolean isReaderMode() { return readerMode; }
    public boolean isCaptureMode() { return captureMode; }
    public boolean isBackHandlingEnabled() { return backHandlingEnabled; }
    public boolean shouldEmit(int keyCode) {
        synchronized (mappedCodes) { return mappedCodes.contains(keyCode); }
    }

    public void emitKeyCode(int keyCode) {
        JSObject data = new JSObject();
        data.put("keyCode", keyCode);
        notifyListeners("androidKey", data);
    }
}
