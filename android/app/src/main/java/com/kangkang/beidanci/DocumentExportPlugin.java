package com.kangkang.beidanci;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private static final String PENDING_FILE = "pending-export-file";

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "kangkang-backup.zip");
        String mime = call.getString("mime", "application/zip");
        String encoded = call.getString("dataBase64", "");
        if (encoded.isEmpty()) {
            call.reject("没有可导出的备份数据");
            return;
        }
        File tempFile = null;
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            tempFile = File.createTempFile("kangkang-export-", ".bin", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(tempFile)) {
                output.write(bytes);
                output.flush();
            }
            getContext().getSharedPreferences("document-export", 0)
                .edit().putString(PENDING_FILE, tempFile.getAbsolutePath()).apply();
            // Capacitor persists pending plugin-call options when the SAF activity opens.
            // Remove the large payload before launching the activity to avoid a Binder
            // TransactionTooLargeException for complete backups containing book files.
            call.getData().remove("dataBase64");
        } catch (Exception error) {
            if (tempFile != null) tempFile.delete();
            call.reject("准备备份失败：" + error.getMessage());
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "handleCreateDocument");
    }

    @ActivityCallback
    private void handleCreateDocument(PluginCall call, ActivityResult result) {
        if (result == null || result.getData() == null || result.getData().getData() == null) {
            clearPendingFile();
            call.reject("用户取消了文件导出");
            return;
        }
        Uri uri = result.getData().getData();
        File tempFile = getPendingFile();
        if (tempFile == null || !tempFile.isFile()) {
            call.reject("导出缓存不存在，请重试");
            return;
        }
        int bytes = 0;
        try (InputStream input = new FileInputStream(tempFile);
             OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (output == null) throw new IllegalStateException("无法打开导出目标");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                bytes += read;
            }
            output.flush();
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("bytes", bytes);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("写入备份失败：" + error.getMessage());
        } finally {
            clearPendingFile();
        }
    }

    private File getPendingFile() {
        String path = getContext().getSharedPreferences("document-export", 0).getString(PENDING_FILE, "");
        return path.isEmpty() ? null : new File(path);
    }

    private void clearPendingFile() {
        File file = getPendingFile();
        if (file != null) file.delete();
        getContext().getSharedPreferences("document-export", 0).edit().remove(PENDING_FILE).apply();
    }
}
