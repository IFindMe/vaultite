package app.vaultite.android;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.PixelCopy;
import android.webkit.WebView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLException;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The shell's side of the bridge (the page's: web/src/core/phoneapp.ts), on the first screen and every server's page.
 * It has the iPhone's methods that need nothing more than Android itself; the page asks which it has (shellHas).
 */
@CapacitorPlugin(name = "Shell")
public class ShellPlugin extends Plugin {

    private final ExecutorService io = Executors.newCachedThreadPool();
    private Servers servers;
    /** What a link asked for (MainActivity.take): `command`, `open` or `bundle`, until the page takes it. */
    private Map<String, String> waiting;

    @Override
    public void load() {
        servers = new Servers(getContext());
    }

    void setWaiting(Map<String, String> what) {
        waiting = what;
    }

    @PluginMethod
    public void servers(PluginCall call) {
        JSArray list = new JSArray();
        for (Servers.Server s : servers.list()) {
            JSObject o = new JSObject();
            o.put("url", s.url);
            o.put("name", s.name);
            list.put(o);
        }
        JSObject answer = new JSObject();
        answer.put("servers", list);
        if (servers.last() != null) answer.put("last", servers.last());
        call.resolve(answer);
    }

    @PluginMethod
    public void setServers(PluginCall call) {
        List<Servers.Server> list = new ArrayList<>();
        JSArray given = call.getArray("servers", new JSArray());
        for (int i = 0; i < given.length(); i++) {
            JSONObject s = given.optJSONObject(i);
            if (s == null) continue;
            String url = s.optString("url", ""), name = s.optString("name", "");
            if (!url.isEmpty() && !name.isEmpty()) list.add(new Servers.Server(url, name));
        }
        servers.setList(list);
        call.resolve();
    }

    /** Whether a Vaultite server answers at `url`: its web app's manifest names it. */
    @PluginMethod
    public void probe(PluginCall call) {
        String base = call.getString("url");
        if (base == null || Servers.origin(Uri.parse(base)) == null) {
            call.reject("not a web address");
            return;
        }
        io.execute(() -> {
            JSObject answer = new JSObject();
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + "/manifest.webmanifest").openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setUseCaches(false);
                int status = c.getResponseCode();
                boolean named = status == 200 && read(c.getInputStream()).contains("Vaultite");
                answer.put("ok", named);
                if (!named) answer.put("error", status == 200 ? "That isn't a Vaultite server" : "It answered " + status);
            } catch (IOException e) {
                answer.put("ok", false);
                answer.put("error", say(e));
            } finally {
                if (c != null) c.disconnect();
            }
            call.resolve(answer);
        });
    }

    /** Load a server's app in place of the page asking (one of the list's), remembered as the last one. */
    @PluginMethod
    public void open(PluginCall call) {
        String address = call.getString("url");
        if (address == null || !servers.knows(Uri.parse(address))) {
            call.reject("not a server in the list");
            return;
        }
        servers.setLast(address);
        MainActivity activity = (MainActivity) getActivity();
        call.resolve();
        activity.runOnUiThread(() -> activity.openServer(address));
    }

    /** Back to the first screen, which this time doesn't open the last server by itself. */
    @PluginMethod
    public void launcher(PluginCall call) {
        call.resolve();
        MainActivity activity = (MainActivity) getActivity();
        activity.runOnUiThread(() -> activity.show(getBridge().getLocalUrl() + "/phone.html?pick"));
    }

    /**
     * A picture of what the page shows now, as the screen looks (tabShots.ts keeps one per tab for the tab list).
     * `x`, `y`, `width`, `height`: the part, in CSS pixels; `scaled`: its width in CSS pixels. A JPEG data URL.
     */
    @PluginMethod
    public void snapshot(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WebView view = getBridge().getWebView();
            float density = getContext().getResources().getDisplayMetrics().density;
            int[] at = new int[2];
            view.getLocationInWindow(at);
            double w = call.getDouble("width", (double) view.getWidth() / density);
            double h = call.getDouble("height", (double) view.getHeight() / density);
            Rect part = new Rect(
                at[0] + (int) (call.getDouble("x", 0.0) * density),
                at[1] + (int) (call.getDouble("y", 0.0) * density),
                0,
                0
            );
            part.right = Math.min(at[0] + view.getWidth(), part.left + (int) (w * density));
            part.bottom = Math.min(at[1] + view.getHeight(), part.top + (int) (h * density));
            if (part.width() <= 0 || part.height() <= 0) {
                call.reject("nothing to picture");
                return;
            }
            Bitmap shot = Bitmap.createBitmap(part.width(), part.height(), Bitmap.Config.ARGB_8888);
            PixelCopy.request(
                getActivity().getWindow(),
                part,
                shot,
                (result) -> {
                    if (result != PixelCopy.SUCCESS) {
                        call.reject("no picture");
                        return;
                    }
                    io.execute(() -> call.resolve(jpeg(shot, call.getDouble("scaled", w) * density, call.getDouble("quality", 0.7))));
                },
                new Handler(Looper.getMainLooper())
            );
        });
    }

    private static JSObject jpeg(Bitmap shot, double width, double quality) {
        Bitmap out = shot;
        if (width > 0 && width < shot.getWidth()) {
            out = Bitmap.createScaledBitmap(shot, (int) width, (int) Math.max(1, shot.getHeight() * width / shot.getWidth()), true);
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        out.compress(Bitmap.CompressFormat.JPEG, (int) Math.round(Math.max(0, Math.min(1, quality)) * 100), bytes);
        JSObject answer = new JSObject();
        answer.put("url", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
        return answer;
    }

    /** A tap from the vibrator (web/src/core/haptics.ts), iOS's kinds as Android's nearest constants. */
    @PluginMethod
    public void haptic(PluginCall call) {
        String weight = call.getString("weight", "light");
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().performHapticFeedback(feedback(weight));
            call.resolve();
        });
    }

    private static int feedback(String weight) {
        boolean r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        switch (weight) {
            case "selection":
                return HapticFeedbackConstants.CLOCK_TICK;
            case "success":
                return r ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
            case "warning":
            case "error":
                return r ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            case "medium":
            case "rigid":
                return HapticFeedbackConstants.CONTEXT_CLICK;
            case "heavy":
                return HapticFeedbackConstants.LONG_PRESS;
            default:
                return HapticFeedbackConstants.KEYBOARD_TAP;
        }
    }

    /** What's waiting (phoneapp.ts takeLinks), taken once. */
    @PluginMethod
    public void pending(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject answer = new JSObject();
            if (waiting != null) for (Map.Entry<String, String> e : waiting.entrySet()) answer.put(e.getKey(), e.getValue());
            waiting = null;
            call.resolve(answer);
        });
    }

    /** The servers' pages stay here, as the first screen does; any other address goes to the browser (Capacitor's). */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (servers.knows(url)) return false;
        return null;
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) bytes.write(buf, 0, n);
        return bytes.toString(StandardCharsets.UTF_8.name());
    }

    /** Why a request failed, as the first screen says it ("... Is Tailscale on and the server awake?" follows). */
    static String say(IOException e) {
        if (e instanceof UnknownHostException) return "No server has that name";
        if (e instanceof SocketTimeoutException) return "It didn't answer";
        if (e instanceof ConnectException) return "It refused the connection";
        if (e instanceof SSLException) return "Its certificate isn't valid";
        String m = e.getMessage();
        return m == null || m.isEmpty() ? "It didn't answer" : m.replaceAll("[. ]+$", "");
    }
}
