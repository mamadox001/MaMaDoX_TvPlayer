package com.iptvplayer.dev;

import com.iptvplayer.core.*;
import java.io.File;

/** Desktop runner for the sync jobs (used by tests and the browser dev server). */
public final class DevMain {
    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : (s == null ? "" : s).toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 32) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static String field(String json, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        return m.find() ? m.group(1).replace("\\/", "/").replace("\\\"", "\"").replace("\\\\", "\\") : "";
    }

    static String[] array(String json, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"" + key + "\"\\s*:\\s*\\[([^\\]]*)\\]").matcher(json);
        if (!m.find()) return new String[0];
        java.util.List<String> out = new java.util.ArrayList<>();
        java.util.regex.Matcher s = java.util.regex.Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(m.group(1));
        while (s.find()) out.add(s.group(1).replace("\\/", "/"));
        return out.toArray(new String[0]);
    }

    static void emit(String state, String body) {
        System.out.println("EVENT {\"state\":\"" + state + "\"" + (body.length() > 0 ? "," + body : "") + "}");
        System.out.flush();
    }

    static void runJob(File files, String json) {
        try {
            String type = field(json, "type");
            String pid = field(json, "pid").replaceAll("[^A-Za-z0-9_-]", "");
            File dir = new File(new File(files, "pl"), pid);
            dir.mkdirs();
            String ua = field(json, "ua");
            Tsv.Progress p = new Tsv.Progress() {
                long last;
                public void report(String stage, int count) {
                    long now = System.currentTimeMillis();
                    if (now - last < 250) return;
                    last = now;
                    emit("progress", "\"stage\":" + q(stage) + ",\"count\":" + count);
                }
                public boolean isCancelled() { return false; }
            };
            StringBuilder r = new StringBuilder();
            if ("xtream".equals(type)) {
                for (String s : array(json, "sections")) {
                    int n = XtreamSync.syncSection(field(json, "base"), field(json, "user"), field(json, "pass"), ua, s, dir, p);
                    if (r.length() > 0) r.append(',');
                    r.append(q(s)).append(':').append(n);
                }
            } else if ("m3u".equals(type)) {
                Http.Resp resp = Http.get(field(json, "url"), ua, 15000, 120000);
                try {
                    if (resp.code >= 400) throw new java.io.IOException("The server answered " + resp.code + " for the playlist link.");
                    M3uSync.Result res = M3uSync.parse(resp.body, dir, p);
                    r.append("\"live\":").append(res.live).append(",\"vod\":").append(res.movies).append(",\"series\":").append(res.series).append(",\"episodes\":").append(res.episodes).append(",\"epg\":").append(q(res.epgUrl));
                } finally { resp.close(); }
            } else if ("xmltv".equals(type)) {
                XmltvSync.Result res = XmltvSync.run(array(json, "urls"), ua, new File(dir, "live.tsv"), new File(dir, "epg.tsv"), 36, p);
                r.append("\"programmes\":").append(res.programmes).append(",\"channels\":").append(res.channels);
            } else throw new java.io.IOException("Unknown job " + type);
            emit("done", "\"result\":{" + r + "}");
        } catch (Throwable t) {
            emit("error", "\"message\":" + q(Http.describe(t)));
        }
    }

    public static void main(String[] a) throws Exception {
        Tsv.Progress p = new Tsv.Progress() {
            long last = 0;
            public void report(String stage, int count) {
                long t = System.currentTimeMillis();
                if (t - last > 300) { System.out.println("PROGRESS " + stage + " " + count); System.out.flush(); last = t; }
            }
            public boolean isCancelled() { return false; }
        };
        long t0 = System.currentTimeMillis();
        try {
            switch (a[0]) {
                case "xtream": {
                    File dir = new File(a[4]); dir.mkdirs();
                    String[] sections = a.length > 5 ? a[5].split(",") : new String[]{"live", "vod", "series"};
                    for (String s : sections) {
                        int n = XtreamSync.syncSection(a[1], a[2], a[3], null, s, dir, p);
                        System.out.println("DONE " + s + " " + n);
                    }
                    break;
                }
                case "m3u": {
                    File dir = new File(a[2]); dir.mkdirs();
                    Http.Resp r = Http.get(a[1], null, 15000, 120000);
                    try {
                        if (r.code >= 400) throw new java.io.IOException("Server answered " + r.code);
                        M3uSync.Result res = M3uSync.parse(r.body, dir, p);
                        System.out.println("DONE m3u live=" + res.live + " movies=" + res.movies + " series=" + res.series + " episodes=" + res.episodes + " epg=" + res.epgUrl);
                    } finally { r.close(); }
                    break;
                }
                case "xmltv": {
                    File dir = new File(a[1]);
                    XmltvSync.Result res = XmltvSync.run(a[2].split(","), null, new File(dir, "live.tsv"), new File(dir, "epg.tsv"), 30, p);
                    System.out.println("DONE epg programmes=" + res.programmes + " channels=" + res.channels);
                    break;
                }
                case "json": { // parser self-test on a local file
                    JsonPull j = new JsonPull(new java.io.InputStreamReader(new java.io.FileInputStream(a[1]), "UTF-8"));
                    int depth = 0, tokens = 0, t;
                    while ((t = j.peek()) != JsonPull.END) {
                        tokens++;
                        if (t == JsonPull.BEGIN_ARRAY) { j.beginArray(); depth++; }
                        else if (t == JsonPull.BEGIN_OBJECT) { j.beginObject(); depth++; }
                        else if (t == JsonPull.END_ARRAY) { j.endArray(); depth--; }
                        else if (t == JsonPull.END_OBJECT) { j.endObject(); depth--; }
                        else if (t == JsonPull.NAME) j.nextName();
                        else j.nextString();
                    }
                    System.out.println("DONE json tokens=" + tokens);
                    break;
                }
                case "job": { // same contract as Bridge.runJob, events printed as JSON lines
                    runJob(new File(a[1]), a[2]);
                    return;
                }
                default: throw new IllegalArgumentException(a[0]);
            }
        } catch (Exception e) {
            System.out.println("ERROR " + Http.describe(e));
            e.printStackTrace();
            System.exit(2);
        }
        System.out.println("TIME " + (System.currentTimeMillis() - t0) + "ms");
    }
}
