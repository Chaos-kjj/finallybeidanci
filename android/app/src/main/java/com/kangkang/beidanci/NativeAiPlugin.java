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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

@CapacitorPlugin(name = "NativeAi")
public class NativeAiPlugin extends Plugin {
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
    private static final Map<String, PendingRequest> PENDING = new ConcurrentHashMap<>();

    private static final class PendingRequest {
        final PluginCall call;
        volatile Future<?> future;
        volatile boolean cancelled;

        PendingRequest(PluginCall call) { this.call = call; }
    }

    @PluginMethod
    public void request(PluginCall call) {
        String baseUrl = call.getString("baseUrl", "");
        JSObject body = call.getObject("body");
        String requestId = call.getString("requestId", String.valueOf(System.nanoTime()));
        int timeoutMs = Math.max(5000, Math.min(120000, call.getInt("timeoutMs", 30000)));
        if (!baseUrl.startsWith("https://") || body == null) { call.reject("AI 网络桥只允许 HTTPS"); return; }
        PendingRequest pending = new PendingRequest(call);
        PENDING.put(requestId, pending);
        Future<?> future = EXECUTOR.submit(() -> {
            HttpURLConnection connection = null;
            try {
                String apiKey = KeystoreVault.get(getContext());
                if (apiKey.isEmpty()) { call.reject("请先在 Android Keystore 中配置 API Key"); return; }
                connection = (HttpURLConnection) new URL(baseUrl).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
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
                if (!Thread.currentThread().isInterrupted() && !pending.cancelled) call.resolve(result);
            } catch (Exception error) {
                if (!Thread.currentThread().isInterrupted() && !pending.cancelled) call.reject(error.getMessage() == null ? "AI 网络请求失败" : "AI 网络请求失败");
            } finally {
                if (connection != null) connection.disconnect();
                PENDING.remove(requestId, pending);
            }
        });
        pending.future = future;
        if (pending.cancelled) future.cancel(true);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId", "");
        PendingRequest pending = PENDING.remove(requestId);
        if (pending != null) {
            pending.cancelled = true;
            pending.call.reject("AI 请求已取消");
            if (pending.future != null) pending.future.cancel(true);
        }
        call.resolve();
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
