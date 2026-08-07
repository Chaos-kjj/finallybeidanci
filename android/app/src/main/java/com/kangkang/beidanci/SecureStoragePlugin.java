package com.kangkang.beidanci;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("value", KeystoreVault.get(getContext()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android Keystore 读取失败");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value", "");
        if (value.isEmpty()) { call.reject("安全值不能为空"); return; }
        try {
            KeystoreVault.put(getContext(), value);
            call.resolve();
        } catch (Exception error) {
            call.reject("Android Keystore 写入失败");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        KeystoreVault.remove(getContext());
        call.resolve();
    }
}
