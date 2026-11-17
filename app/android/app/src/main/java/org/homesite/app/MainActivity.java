package org.homesite.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

/*
 * The app: Capacitor's WebView with the bundled site (scripts/app-build.mjs).
 * Edge to edge (Capacitor's SystemBars keeps the page out of the bars, the
 * page colours them through HomeSitePlugin) and passkeys for the site's own
 * origin (the app is linked to it by /.well-known/assetlinks.json).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HomeSitePlugin.class);
        super.onCreate(savedInstanceState);
        // After super: BridgeActivity sets the theme first (earlier, the window would keep the launch theme's title bar).
        EdgeToEdge.enable(this);

        WebView webView = getBridge().getWebView();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(webView.getSettings(), WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        }
    }
}
