package com.kangkang.beidanci;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "NativeAi")
public class NativeAiPlugin extends Plugin {
    private static final ExecutorService NETWORK_EXECUTOR = Executors.newFixedThreadPool(2);
    private static final int MAX_REQUEST_BYTES = 2 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private final Map<String, RequestHandle> activeRequests = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(PluginCall call) {
        String baseUrl = call.getString("baseUrl", "");
        JSObject body = call.getObject("body");
        String requestId = call.getString("requestId", "");
        int requestedTimeout = call.getInt("timeoutMs", 30000);
        int timeoutMs = Math.max(5000, Math.min(120000, requestedTimeout));
        try {
            URL parsed = new URL(baseUrl);
            if (!"https".equalsIgnoreCase(parsed.getProtocol()) || parsed.getHost().isEmpty() || parsed.getUserInfo() != null) throw new IllegalArgumentException();
        } catch (Exception ignored) {
            call.reject("AI 网络桥只允许有效的 HTTPS 地址");
            return;
        }
        if (body == null) { call.reject("AI 请求内容不能为空"); return; }
        if (requestId.isEmpty()) requestId = UUID.randomUUID().toString();
        final String activeRequestId = requestId;
        final RequestHandle handle = new RequestHandle(call);
        activeRequests.put(activeRequestId, handle);
        handle.future = NETWORK_EXECUTOR.submit(() -> {
            HttpURLConnection connection = null;
            try {
                if (handle.cancelled.get()) return;
                String apiKey = KeystoreVault.get(getContext());
                if (apiKey.isEmpty()) { handle.reject("请先在 Android Keystore 中配置 API Key"); return; }
                connection = (HttpURLConnection) new URL(baseUrl).openConnection();
                handle.connection = connection;
                if (handle.cancelled.get()) return;
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
                connection.setDoOutput(true);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                if (payload.length > MAX_REQUEST_BYTES) { handle.reject("AI 请求内容过大"); return; }
                try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { handle.reject("AI 网络桥拒绝重定向"); return; }
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String responseText = readBody(stream, MAX_RESPONSE_BYTES);
                if (handle.cancelled.get()) return;
                JSObject result = new JSObject();
                result.put("status", status);
                try { result.put("body", new JSObject(responseText)); }
                catch (Exception ignored) { result.put("body", responseText); }
                handle.resolve(result);
            } catch (Exception error) {
                if (!handle.cancelled.get()) handle.reject("AI 网络请求失败");
            } finally {
                if (connection != null) connection.disconnect();
                activeRequests.remove(activeRequestId, handle);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId", "");
        RequestHandle handle = activeRequests.remove(requestId);
        if (handle != null) handle.cancel();
        call.resolve();
    }

    private static final class RequestHandle {
        private final AtomicBoolean cancelled = new AtomicBoolean(false);
        private final AtomicBoolean settled = new AtomicBoolean(false);
        private final PluginCall requestCall;
        private volatile HttpURLConnection connection;
        private volatile Future<?> future;

        private RequestHandle(PluginCall requestCall) { this.requestCall = requestCall; }

        private void resolve(JSObject result) {
            if (settled.compareAndSet(false, true)) requestCall.resolve(result);
        }

        private void reject(String message) {
            if (settled.compareAndSet(false, true)) requestCall.reject(message);
        }

        private void cancel() {
            cancelled.set(true);
            HttpURLConnection current = connection;
            if (current != null) current.disconnect();
            Future<?> currentFuture = future;
            if (currentFuture != null) currentFuture.cancel(true);
            reject("AI 请求已取消");
        }
    }

    private String readBody(InputStream stream, int maxBytes) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream result = new ByteArrayOutputStream(Math.min(maxBytes, 64 * 1024));
        try (InputStream input = stream) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (result.size() > maxBytes - read) throw new IllegalStateException("AI 响应内容过大");
                result.write(buffer, 0, read);
            }
        }
        return result.toString(StandardCharsets.UTF_8.name());
    }
}
