package app.vaultite.android;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSExport;
import com.getcapacitor.Logger;
import com.getcapacitor.PluginHandle;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The bridge on a server's pages. Capacitor's Android bridge answers only its own origin (the first screen) and the
 * origins its config allows when the bridge is made, and injects its JS only into its own; iOS gives both to every page.
 * So the config is the bundled one plus the servers' origins (MainActivity makes the activity again when a new one is
 * opened), and Capacitor's JS goes into the servers' pages too.
 */
final class ServerPages {

    private ServerPages() {}

    /** The bundled capacitor.config.json, its navigation allowed to the servers, as Capacitor reads a config from disk. */
    static CapConfig config(Context context, List<String> origins) {
        try (InputStream in = context.getAssets().open("capacitor.config.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) bytes.write(buf, 0, n);
            JSONObject json = new JSONObject(bytes.toString("UTF-8"));
            JSONObject server = json.optJSONObject("server");
            if (server == null) server = new JSONObject();
            server.put("allowNavigation", new JSONArray(origins));
            json.put("server", server);
            File dir = new File(context.getNoBackupFilesDir(), "capacitor");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("no folder for the config");
            try (FileOutputStream out = new FileOutputStream(new File(dir, "capacitor.config.json"))) {
                out.write(json.toString().getBytes(StandardCharsets.UTF_8));
            }
            return CapConfig.loadFromFile(context, dir.getPath());
        } catch (Exception e) {
            Logger.error("Vaultite: the servers' config couldn't be written; servers' pages get no bridge", e);
            return CapConfig.loadDefault(context);
        }
    }

    /** Capacitor's JS (with the Shell plugin's methods) at the start of every page of the servers'. */
    static void inject(Bridge bridge, List<String> origins) {
        if (origins.isEmpty() || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        Context context = bridge.getContext();
        boolean debug = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        PluginHandle shell = bridge.getPlugin("Shell");
        try {
            // (Capacitor's JSInjector, which is package-private, puts the same parts together in this order)
            String js = String.join(
                "\n\n",
                JSExport.getGlobalJS(context, bridge.getConfig().isLoggingEnabled(), debug),
                "window.WEBVIEW_SERVER_URL = '" + bridge.getLocalUrl() + "';",
                JSExport.getBridgeJS(context),
                JSExport.getPluginJS(shell == null ? Collections.emptyList() : Collections.singletonList(shell)),
                JSExport.getCordovaJS(context),
                JSExport.getCordovaPluginsFileJS(context),
                JSExport.getCordovaPluginJS(context)
            );
            WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), js, new HashSet<>(origins));
        } catch (Exception e) {
            Logger.error("Vaultite: servers' pages get no bridge", e);
        }
    }
}
