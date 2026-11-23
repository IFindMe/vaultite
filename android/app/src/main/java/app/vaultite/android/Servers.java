package app.vaultite.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The servers the first screen lists (web/src/phone.tsx), and the one opened last. */
final class Servers {

    static final class Server {

        final String url;
        final String name;

        Server(String url, String name) {
            this.url = url;
            this.name = name;
        }
    }

    private final SharedPreferences prefs;

    Servers(Context context) {
        prefs = context.getSharedPreferences("servers", Context.MODE_PRIVATE);
    }

    List<Server> list() {
        List<Server> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs.getString("servers", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject s = a.getJSONObject(i);
                out.add(new Server(s.getString("url"), s.getString("name")));
            }
        } catch (JSONException ignored) {}
        return out;
    }

    void setList(List<Server> list) {
        JSONArray a = new JSONArray();
        for (Server s : list) {
            try {
                a.put(new JSONObject().put("url", s.url).put("name", s.name));
            } catch (JSONException ignored) {}
        }
        prefs.edit().putString("servers", a.toString()).apply();
    }

    String last() {
        return prefs.getString("last", null);
    }

    void setLast(String url) {
        prefs.edit().putString("last", url).apply();
    }

    /** Whether an address is one of the servers' (the same scheme, host and port). */
    boolean knows(Uri url) {
        String o = origin(url);
        if (o == null) return false;
        for (Server s : list()) if (o.equals(origin(Uri.parse(s.url)))) return true;
        return false;
    }

    /** The servers' origins as WebView's origin rules take them: the port only when it isn't the scheme's own. */
    List<String> originRules() {
        List<String> out = new ArrayList<>();
        for (Server s : list()) {
            String o = origin(Uri.parse(s.url));
            if (o != null && !out.contains(o)) out.add(o);
        }
        return out;
    }

    static String origin(Uri url) {
        String scheme = url.getScheme(), host = url.getHost();
        if (scheme == null || host == null) return null;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) return null;
        int port = url.getPort(), own = scheme.equals("https") ? 443 : 80;
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (port == -1 || port == own ? "" : ":" + port);
    }
}
