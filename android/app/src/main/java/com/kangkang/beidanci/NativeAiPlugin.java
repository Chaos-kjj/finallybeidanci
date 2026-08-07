package com.kangkang.beidanci;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeAi")
public class NativeAiPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        String baseUrl = call.getString("baseUrl", "");
        JSObject body = call.getObject("body");
        if (!baseUrl.startsWith("https://") || body == null) { call.reject("AI 网络桥只允许 HTTPS"); return; }
        Executors.newSingleThreadExecutor().execute(() -> {
            HttpURLConnection connection = null;
            try {
                String apiKey = KeystoreVault.get(getContext());
                if (apiKey.isEmpty()) { call.reject("请先在 Android Keystore 中配置 API Key"); return; }
                connection = (HttpURLConnection) new URL(baseUrl).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseText = readBody(stream);
                JSObject result = new JSObject();
                result.put("status", status);
                try { result.put("body", new JSObject(responseText)); }
                catch (Exception ignored) { result.put("body", responseText); }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("AI 网络请求失败");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
