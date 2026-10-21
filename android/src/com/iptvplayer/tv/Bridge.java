package com.iptvplayer.tv;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.util.DisplayMetrics;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.iptvplayer.core.Http;
import com.iptvplayer.core.M3uSync;
import com.iptvplayer.core.Tsv;
import com.iptvplayer.core.XmltvSync;
import com.iptvplayer.core.XtreamSync;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Methods callable from the page as window.AndroidNative.* (run on the JavaBridge thread). */
final class Bridge {
    private final MainActivity act;
    private final File files;
    private final ExecutorService jobs = Executors.newFixedThreadPool(2);
    private final ConcurrentHashMap<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();
    private PhoneSetup phone;

    Bridge(MainActivity a) {
        act = a;
        files = a.getFilesDir();
    }

    void shutdown() {
        for (AtomicBoolean c : cancels.values()) c.set(true);
        jobs.shutdownNow();
        if (phone != null) phone.stop();
    }

    private File resolve(String name) throws IOException {
        File f = new File(files, name);
        String c = f.getCanonicalPath();
        if (!c.startsWith(files.getCanonicalPath() + File.separator)) throw new IOException("bad path");
        return f;
    }

    // ------------------------------------------------------------ app

    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("version", BuildInfo.VERSION);
            o.put("build", BuildInfo.BUILD);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            o.put("model", Build.MODEL);
            o.put("maker", Build.MANUFACTURER);
            DisplayMetrics dm = act.getResources().getDisplayMetrics();
            o.put("width", dm.widthPixels);
            o.put("height", dm.heightPixels);
            o.put("density", dm.density);
            ActivityManager am = (ActivityManager) act.getSystemService(Context.ACTIVITY_SERVICE);
            o.put("lowRam", am.isLowRamDevice());
            o.put("memoryClass", am.getMemoryClass());
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            o.put("totalMem", mi.totalMem);
            o.put("cores", Runtime.getRuntime().availableProcessors());
            String wv = "";
            try {
                PackageInfo pi = (PackageInfo) Class.forName("android.webkit.WebView").getMethod("getCurrentWebViewPackage").invoke(null);
                if (pi != null) wv = pi.packageName + " " + pi.versionName;
            } catch (Throwable ignored) { }
            o.put("webview", wv);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void ready() {
        act.onPageReady();
    }

    @JavascriptInterface
    public void exitApp() {
        act.ui.post(new Runnable() {
            public void run() {
                act.player.stop();
                act.finish();
            }
        });
    }

    /** Phones: 'portrait', 'landscape' (full-screen player) or 'auto'. */
    @JavascriptInterface
    public void setOrientation(final String mode) {
        act.ui.post(new Runnable() {
            public void run() {
                act.setPhoneMode(mode);
            }
        });
    }

    @JavascriptInterface
    public void log(String s) {
        Log.d(MainActivity.TAG, "page: " + s);
    }

    /** On: keys go to the focused text field and the system keyboard opens; off: it closes. */
    @JavascriptInterface
    public void setKeyPassthrough(final boolean on) {
        act.keyPassthrough = on;
        act.ui.postDelayed(new Runnable() {
            public void run() {
                act.showSystemKeyboard(on && act.keyPassthrough);
            }
        }, on ? 150 : 0);
    }

    @JavascriptInterface
    public void setOption(String key, String value) {
        if ("trustAll".equals(key)) Http.setTrustAll("true".equals(value));
        else if ("userAgent".equals(key)) {
            if (value != null && value.length() > 0) Http.defaultUa = value;
            act.server.images.userAgent = value;
        }
    }

    // ------------------------------------------------------------ storage

    @JavascriptInterface
    public String readText(String name) {
        try {
            File f = resolve(name);
            if (!f.isFile()) return null;
            InputStream in = new FileInputStream(f);
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.min(f.length(), 1 << 20));
                byte[] b = new byte[16384];
                int n;
                while ((n = in.read(b)) > 0) bo.write(b, 0, n);
                return bo.toString("UTF-8");
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean writeText(String name, String text) {
        try {
            File f = resolve(name);
            File d = f.getParentFile();
            if (d != null && !d.isDirectory()) d.mkdirs();
            File tmp = new File(f.getPath() + ".w");
            FileOutputStream fo = new FileOutputStream(tmp);
            try {
                fo.write(text.getBytes("UTF-8"));
                fo.getFD().sync();
            } finally {
                fo.close();
            }
            // rename() replaces the old file atomically, so a crash never leaves a half-written file
            if (tmp.renameTo(f)) return true;
            f.delete();
            return tmp.renameTo(f);
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "write " + name, e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean remove(String name) {
        try {
            return deleteTree(resolve(name));
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean deleteTree(File f) {
        if (f.isDirectory()) {
            File[] c = f.listFiles();
            if (c != null) for (File x : c) deleteTree(x);
        }
        return f.delete() || !f.exists();
    }

    @JavascriptInterface
    public String fileInfo(String name) {
        try {
            File f = resolve(name);
            JSONObject o = new JSONObject();
            o.put("exists", f.isFile());
            o.put("size", f.length());
            o.put("modified", f.lastModified());
            return o.toString();
        } catch (Exception e) {
            return "{\"exists\":false}";
        }
    }

    @JavascriptInterface
    public String cacheInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("images", act.server.images.size());
            o.put("data", dirSize(new File(files, "pl")));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private static long dirSize(File f) {
        if (f.isFile()) return f.length();
        long t = 0;
        File[] c = f.listFiles();
        if (c != null) for (File x : c) t += dirSize(x);
        return t;
    }

    @JavascriptInterface
    public void clearImageCache() {
        jobs.execute(new Runnable() { public void run() { act.server.images.clear(); } });
    }

    // ------------------------------------------------------------ background jobs

    @JavascriptInterface
    public void startJob(final String id, final String json) {
        final AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(id, cancel);
        jobs.execute(new Runnable() {
            public void run() {
                runJob(id, json, cancel);
                cancels.remove(id);
            }
        });
    }

    @JavascriptInterface
    public void cancelJob(String id) {
        AtomicBoolean c = cancels.get(id);
        if (c != null) c.set(true);
    }

    private void jobEvent(String id, String state, JSONObject data) {
        try {
            JSONObject o = data == null ? new JSONObject() : data;
            o.put("t", "job");
            o.put("id", id);
            o.put("state", state);
            act.emit(o);
        } catch (Exception ignored) { }
    }

    private void runJob(final String id, String json, final AtomicBoolean cancel) {
        try {
            JSONObject j = new JSONObject(json);
            String type = j.getString("type");
            String pid = j.getString("pid").replaceAll("[^A-Za-z0-9_-]", "");
            File dir = new File(new File(files, "pl"), pid);
            dir.mkdirs();
            String ua = j.optString("ua", "");
            Tsv.Progress p = new Tsv.Progress() {
                long last;
                public void report(String stage, int count) {
                    long now = System.currentTimeMillis();
                    if (now - last < 250) return;
                    last = now;
                    try {
                        JSONObject o = new JSONObject();
                        o.put("stage", stage);
                        o.put("count", count);
                        jobEvent(id, "progress", o);
                    } catch (Exception ignored) { }
                }
                public boolean isCancelled() { return cancel.get(); }
            };
            JSONObject result = new JSONObject();
            if ("xtream".equals(type)) {
                JSONArray secs = j.getJSONArray("sections");
                for (int i = 0; i < secs.length(); i++) {
                    String s = secs.getString(i);
                    int n = XtreamSync.syncSection(j.getString("base"), j.getString("user"), j.getString("pass"), ua, s, dir, p);
                    result.put(s, n);
                }
            } else if ("m3u".equals(type)) {
                Http.Resp r = Http.get(j.getString("url"), ua, 15000, 120000);
                try {
                    if (r.code == 401 || r.code == 403) throw new IOException("The server refused the playlist link (" + r.code + "). Check the link or your subscription.");
                    if (r.code >= 400) throw new IOException("The server answered " + r.code + " for the playlist link.");
                    M3uSync.Result res = M3uSync.parse(r.body, dir, p);
                    result.put("live", res.live);
                    result.put("vod", res.movies);
                    result.put("series", res.series);
                    result.put("episodes", res.episodes);
                    result.put("epg", res.epgUrl);
                } finally {
                    r.close();
                }
            } else if ("xmltv".equals(type)) {
                JSONArray urls = j.getJSONArray("urls");
                String[] u = new String[urls.length()];
                for (int i = 0; i < u.length; i++) u[i] = urls.getString(i);
                File live = new File(dir, "live.tsv");
                if (!live.isFile()) throw new IOException("Load the channel list first.");
                XmltvSync.Result res = XmltvSync.run(u, ua, live, new File(dir, "epg.tsv"), j.optInt("hours", 30), p);
                result.put("programmes", res.programmes);
                result.put("channels", res.channels);
            } else {
                throw new IOException("Unknown job " + type);
            }
            jobEvent(id, "done", new JSONObject().put("result", result));
        } catch (Tsv.Cancelled c) {
            jobEvent(id, "cancelled", null);
        } catch (Throwable t) {
            Log.w(MainActivity.TAG, "job " + id, t);
            try {
                jobEvent(id, "error", new JSONObject().put("message", t instanceof OutOfMemoryError ? "Not enough memory to load this playlist." : Http.describe(t)));
            } catch (Exception ignored) { }
        }
    }

    // ------------------------------------------------------------ player

    @JavascriptInterface
    public void player(final String json) {
        act.ui.post(new Runnable() {
            public void run() {
                try {
                    act.player.command(new JSONObject(json));
                } catch (Exception e) {
                    Log.w(MainActivity.TAG, "player json", e);
                }
            }
        });
    }

    @JavascriptInterface
    public String playerStatus() {
        return act.player.status();
    }

    @JavascriptInterface
    public String playerTracks() {
        return act.player.tracksJson();
    }

    @JavascriptInterface
    public boolean openExternal(String json) {
        try {
            JSONObject o = new JSONObject(json);
            final Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(o.getString("url")), o.optString("mime", "video/*"));
            i.putExtra("title", o.optString("title"));
            i.putExtra("forcename", o.optString("title"));
            i.putExtra("android.intent.extra.TITLE", o.optString("title"));
            if (o.has("position")) i.putExtra("position", (int) o.optLong("position"));
            String ua = o.optString("ua", "");
            if (ua.length() > 0) i.putExtra("headers", new String[]{"User-Agent", ua});
            String pkg = o.optString("package", "");
            if (pkg.length() > 0) i.setPackage(pkg);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return startOnUi(i, true);
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean openUrl(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return startOnUi(i, false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Starts another app and reports whether one accepted the intent. startActivity() is not
     * limited by Android 11 package visibility the way resolveActivity() is.
     */
    private boolean startOnUi(final Intent i, final boolean stopPlayer) {
        final boolean[] ok = {false};
        final java.util.concurrent.CountDownLatch l = new java.util.concurrent.CountDownLatch(1);
        act.ui.post(new Runnable() {
            public void run() {
                try {
                    act.startActivity(i);
                    ok[0] = true;
                    if (stopPlayer) act.player.stop();
                } catch (Throwable t) {
                    Log.w(MainActivity.TAG, "no app for " + i, t);
                }
                l.countDown();
            }
        });
        try { l.await(2000, java.util.concurrent.TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        return ok[0];
    }

    @JavascriptInterface
    public boolean voiceSearch() {
        final boolean[] ok = {false};
        final java.util.concurrent.CountDownLatch l = new java.util.concurrent.CountDownLatch(1);
        act.ui.post(new Runnable() {
            public void run() {
                ok[0] = act.startVoiceSearch();
                l.countDown();
            }
        });
        try { l.await(1500, java.util.concurrent.TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        return ok[0];
    }

    // ------------------------------------------------------------ add from phone

    @JavascriptInterface
    public synchronized String phoneSetup(boolean start) {
        if (!start) {
            if (phone != null) phone.stop();
            phone = null;
            return "";
        }
        if (phone == null) phone = new PhoneSetup(act);
        try {
            return phone.start();
        } catch (IOException e) {
            phone = null;
            return "";
        }
    }
}
