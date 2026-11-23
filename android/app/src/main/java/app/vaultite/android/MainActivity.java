package app.vaultite.android;

import android.app.DownloadManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.PluginHandle;
import java.util.Collections;
import java.util.List;

/**
 * The app's one screen: Capacitor's web view (the first screen, web/phone.html, then a server's app) with the Shell
 * plugin. The iPhone's counterpart is ios/App/App/AppViewController.swift.
 */
public class MainActivity extends BridgeActivity {

    /** The servers' origins this activity's bridge was made for (ServerPages). */
    private List<String> bridged = Collections.emptyList();
    /** A page shown in place of another (show), whose history starts once it's in. */
    private String fresh;
    private boolean keyboard;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(ShellPlugin.class);
        bridged = new Servers(this).originRules();
        config = ServerPages.config(this, bridged);
        super.onCreate(savedInstanceState);
        ServerPages.inject(bridge, bridged);
        WebView web = bridge.getWebView();
        bridge.setWebViewClient(new Fallback());
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url, agent, disposition, mime));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back(web);
            }
        });
        // The window shrinks for the keyboard (SystemBars pads it), so the page's viewport never shows it's up, as it
        // does on iOS and in Chrome (web/src/core/keyboard.ts): told instead.
        ViewCompat.setOnApplyWindowInsetsListener(web, (view, insets) -> {
            boolean up = insets.isVisible(WindowInsetsCompat.Type.ime());
            if (up != keyboard) {
                keyboard = up;
                web.evaluateJavascript("dispatchEvent(new CustomEvent('vaultite:keyboard', { detail: { up: " + up + " } }))", null);
            }
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
        take(getIntent());
    }

    /**
     * Back: what's open over the page first (a menu, the palette, a dialog: the page says, web/src/core/phoneapp.ts),
     * closed by the Escape key, as a real key, which the page's dialogs take as a close request and a script's can't
     * be; then the page's history; then out of the app.
     */
    private void back(WebView web) {
        web.evaluateJavascript("dispatchEvent(new Event('vaultite:system-back', { cancelable: true }))", (notTaken) -> {
            if ("false".equals(notTaken)) {
                long t = SystemClock.uptimeMillis();
                web.dispatchKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE, 0));
                web.dispatchKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE, 0));
            } else if (web.canGoBack()) {
                web.goBack();
            } else {
                moveTaskToBack(true);
            }
        });
    }

    /** A server's app in place of the page: in this bridge if it was made for the server, else in a new one. */
    void openServer(String url) {
        if (bridged.contains(Servers.origin(Uri.parse(url)))) {
            show(url);
            return;
        }
        // (the first screen opens the last server by itself, now with its bridge)
        recreate();
    }

    /**
     * A page in place of the one shown (a server's app, the first screen) where back doesn't go to the other: the
     * first screen, gone back to, would open the last server again.
     */
    void show(String url) {
        fresh = Servers.origin(Uri.parse(url));
        bridge.getWebView().loadUrl(url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        take(intent);
    }

    /** A vaultite:// link (a shortcut, another app): a command for the page to run, a file to open, a bundle to try. */
    private void take(Intent intent) {
        Uri url = intent == null ? null : intent.getData();
        if (url == null || !"vaultite".equals(url.getScheme()) || url.getHost() == null) return;
        String host = url.getHost(), arg = url.getPath() == null ? "" : url.getPath().replaceFirst("^/", "");
        if (arg.isEmpty() || !(host.equals("command") || host.equals("open") || host.equals("bundle"))) return;
        PluginHandle shell = bridge.getPlugin("Shell");
        if (shell == null) return;
        ((ShellPlugin) shell.getInstance()).setWaiting(Collections.singletonMap(host, arg));
        tell("vaultite:link");
    }

    // The app switcher, a call or the shade: the page isn't told it's inactive, so a finger's drag there would never
    // end (web/src/core/away.ts); and back, a video the player turned to sound while away shows again.
    @Override
    public void onPause() {
        super.onPause();
        tell("vaultite:away");
    }

    @Override
    public void onResume() {
        super.onResume();
        tell("vaultite:back");
    }

    // Capacitor's SystemBars keeps the bars' style as it resolved it at start, so turning dark mode on or off while the
    // app is open would leave the bars' icons in the old theme's color (on the new theme's bars, unreadable).
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        boolean dark = (config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
    }

    private void tell(String event) {
        if (bridge != null) bridge.getWebView().evaluateJavascript("dispatchEvent(new Event('" + event + "'))", null);
    }

    /** A file the page saves (web/src/core/savefile.ts), into Downloads with the page's cookies. */
    private void download(String url, String agent, String disposition, String mime) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
            Toast.makeText(this, "This file can't be saved from here", Toast.LENGTH_SHORT).show();
            return;
        }
        String name = URLUtil.guessFileName(url, disposition, mime);
        DownloadManager.Request request = new DownloadManager.Request(uri)
            .setMimeType(mime)
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
            .addRequestHeader("User-Agent", agent)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
        Toast.makeText(this, "Saving " + name + " to Downloads", Toast.LENGTH_SHORT).show();
    }

    /**
     * Capacitor's client with one thing more: a server's page that doesn't load goes back to the first screen, saying
     * why (web/src/phone.tsx), instead of Chrome's error page.
     */
    private class Fallback extends BridgeWebViewClient {

        Fallback() {
            super(bridge);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            if (fresh == null || !fresh.equals(Servers.origin(Uri.parse(url)))) return;
            fresh = null;
            view.clearHistory();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (error.getErrorCode() == ERROR_UNKNOWN && String.valueOf(error.getDescription()).contains("ERR_ABORTED")) return;
            fail(request, plain(error.getErrorCode(), String.valueOf(error.getDescription()).replaceFirst("^net::", "")));
        }

        // Tailscale Serve, its server stopped, answers 502 with nothing to show: Chrome's error page.
        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            super.onReceivedHttpError(view, request, response);
            if (response.getStatusCode() >= 500) fail(request, "it answered " + response.getStatusCode());
        }

        private void fail(WebResourceRequest request, String why) {
            String origin = Servers.origin(request.getUrl());
            if (!request.isForMainFrame() || origin == null || origin.equals(Servers.origin(Uri.parse(bridge.getLocalUrl())))) return;
            show(
                Uri.parse(bridge.getLocalUrl() + "/phone.html")
                    .buildUpon()
                    .appendQueryParameter("failed", origin)
                    .appendQueryParameter("why", why)
                    .build()
                    .toString()
            );
        }
    }

    private static String plain(int code, String chrome) {
        switch (code) {
            case WebViewClient.ERROR_HOST_LOOKUP:
                return "no server has that name";
            case WebViewClient.ERROR_TIMEOUT:
                return "it didn't answer";
            case WebViewClient.ERROR_CONNECT:
                return "it refused the connection";
            case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE:
                return "its certificate isn't valid";
            default:
                return chrome;
        }
    }
}
