package org.homesite.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import java.io.OutputStream;
import android.graphics.drawable.GradientDrawable;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/*
 * The site's own bridge (src/lib/native.js, registerPlugin("HomeSite")).
 *   info()                       { push, version, build, host, app } (app: home | cult)
 *   openUrl({ url })             hands an https link to Android: the other app
 *                                (HomeSite / Cult) if it is installed and owns
 *                                that page, otherwise the browser
 *   saveFile({ name, type, data }) a download: Android's "save as" (pick a
 *                                folder, e.g. Downloads); data is base64.
 *                                Resolves { saved: false } when cancelled
 *   setBars({ top, bottom, dark }) paints the area behind the status bar (top
 *                                colour) and the navigation bar (bottom colour)
 *                                like the page; dark = the page is dark, so the
 *                                bar icons turn light.
 */
@CapacitorPlugin(name = "HomeSite")
public class HomeSitePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("push", BuildConfig.HAS_PUSH);
        result.put("version", BuildConfig.VERSION_NAME);
        result.put("build", BuildConfig.VERSION_CODE);
        result.put("host", BuildConfig.APP_HOST);
        result.put("app", BuildConfig.FLAVOR_NAME);
        call.resolve(result);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Only https links.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Nothing can open this link.");
        }
    }

    @PluginMethod
    public void setBars(PluginCall call) {
        final int top = parse(call.getString("top"), Color.parseColor("#150A24"));
        final int bottom = parse(call.getString("bottom"), top);
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { top, bottom }));
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    private byte[] pendingFile;

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "download");
        String type = call.getString("type", "application/octet-stream");
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data.");
            return;
        }
        try {
            pendingFile = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("Invalid data.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(type == null || type.isEmpty() ? "application/octet-stream" : type);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "fileSaved");
    }

    @ActivityCallback
    private void fileSaved(PluginCall call, ActivityResult result) {
        byte[] bytes = pendingFile;
        pendingFile = null;
        if (call == null) return;
        JSObject answer = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null || bytes == null) {
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if (out == null) throw new java.io.IOException("No output.");
            out.write(bytes);
            answer.put("saved", true);
            call.resolve(answer);
        } catch (Exception error) {
            call.reject("Could not save the file.");
        }
    }

    private static int parse(String value, int fallback) {
        if (value == null || !value.matches("#[0-9a-fA-F]{6}")) return fallback;
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException error) {
            return fallback;
        }
    }
}
