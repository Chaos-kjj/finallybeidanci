package com.kangkang.beidanci;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "NativeTts")
public class NativeTtsPlugin extends Plugin {
    private TextToSpeech engine;
    private volatile boolean ready;

    @Override
    public void load() {
        super.load();
        engine = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) engine.setLanguage(Locale.US);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("没有可朗读的内容");
            return;
        }
        if (!ready || engine == null) {
            call.reject("系统语音引擎尚未就绪");
            return;
        }
        Double requestedRate = call.getDouble("rate", 0.85);
        float rate = (float) Math.max(0.5, Math.min(2.0, requestedRate == null ? 0.85 : requestedRate));
        getActivity().runOnUiThread(() -> {
            engine.setLanguage(Locale.US);
            engine.setSpeechRate(rate);
            int result;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), "kangkang-vocab");
            } else {
                result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null);
            }
            if (result == TextToSpeech.ERROR) call.reject("系统语音引擎无法朗读");
            else call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (engine != null) engine.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) {
            engine.stop();
            engine.shutdown();
            engine = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
