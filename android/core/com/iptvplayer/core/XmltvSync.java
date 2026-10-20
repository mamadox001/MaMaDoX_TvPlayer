package com.iptvplayer.core;

import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Writer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * Streams XMLTV guides and keeps only programmes for channels in the playlist,
 * inside the useful time window. Programmes are bucketed on disk, then written
 * grouped by channel so the UI can load one channel at a time.
 *  epg.tsv:  P  epgKey  startSec  stopSec  title  description   (grouped by epgKey, sorted by start)
 *  epg.idx:  K  epgKey  byteOffset  byteLength  count
 *            X  channelId  epgKey        (name-based matches)
 *            I  epgKey  iconUrl          (logos advertised by the guide)
 */
public final class XmltvSync {
    private XmltvSync() { }

    public static final class Result {
        public int programmes, channels;
    }

    public static Result run(String[] urls, String ua, File liveTsv, File out, int futureHours, Tsv.Progress p) throws IOException {
        // 1. channels from the playlist
        HashMap<String, Integer> wantedIds = new HashMap<>();
        HashMap<String, List<String[]>> wantedNames = new HashMap<>(); // norm -> [channelId, archDays]
        BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(liveTsv), "UTF-8"), 65536);
        try {
            String line;
            while ((line = br.readLine()) != null) {
                if (!line.startsWith("L\t")) continue;
                String[] f = line.split("\t", -1);
                if (f.length < 8) continue;
                int arch = 0;
                try { arch = Integer.parseInt(f[7]); } catch (Exception ignored) { }
                String epg = f[6].trim().toLowerCase();
                if (epg.length() > 0) {
                    Integer old = wantedIds.get(epg);
                    wantedIds.put(epg, old == null ? arch : Math.max(old, arch));
                }
                String n = Tsv.normName(f[3]);
                if (n.length() > 0) {
                    List<String[]> l = wantedNames.get(n);
                    if (l == null) wantedNames.put(n, l = new ArrayList<>(2));
                    l.add(new String[]{f[1], Integer.toString(arch)});
                }
            }
        } finally {
            br.close();
        }

        long now = System.currentTimeMillis() / 1000L;
        long future = now + futureHours * 3600L;
        HashMap<String, Integer> kept = new HashMap<>(); // epgKey -> archive days
        Result res = new Result();
        File dir = out.getParentFile();
        File idxOut = new File(dir, "epg.idx");
        File idxTmp = new File(dir, "epg.idx.tmp");
        File tmp = new File(dir, "epg.tsv.tmp");
        Writer[] buckets = new Writer[BUCKETS];
        File[] bucketFiles = new File[BUCKETS];
        for (int i = 0; i < BUCKETS; i++) bucketFiles[i] = new File(dir, "epg.b" + i + ".tmp");
        Writer iw = Tsv.open(idxTmp);
        boolean ok = false;
        String lastError = null;
        int sourcesOk = 0;
        try {
            for (int i = 0; i < BUCKETS; i++) buckets[i] = Tsv.open(bucketFiles[i]);
            Tsv.row(iw, "H", "2", "xmltv", Long.toString(System.currentTimeMillis()));
            for (String url : urls) {
                url = url.trim();
                if (url.length() == 0) continue;
                try {
                    parseOne(url, ua, buckets, iw, wantedIds, wantedNames, kept, now, future, res, p);
                    sourcesOk++;
                } catch (Tsv.Cancelled c) {
                    throw c;
                } catch (Exception e) {
                    lastError = Http.describe(e);
                }
            }
            for (int i = 0; i < BUCKETS; i++) { buckets[i].close(); buckets[i] = null; }
            ok = sourcesOk > 0;
            if (ok) {
                p.report("epg:index", res.programmes);
                res.programmes = group(bucketFiles, tmp, iw);
            }
        } finally {
            for (int i = 0; i < BUCKETS; i++) {
                if (buckets[i] != null) try { buckets[i].close(); } catch (IOException ignored) { }
                bucketFiles[i].delete();
            }
            iw.close();
            if (!ok) { tmp.delete(); idxTmp.delete(); }
        }
        if (!ok) throw new IOException(lastError != null ? lastError : "No guide link to load");
        Tsv.commit(tmp, out);
        Tsv.commit(idxTmp, idxOut);
        res.channels = kept.size();
        return res;
    }

    private static final int BUCKETS = 48;

    private static int bucket(String key) { return (key.hashCode() & 0x7fffffff) % BUCKETS; }

    /** Reads every bucket, groups lines by channel, sorts by start, removes duplicates. */
    private static int group(File[] bucketFiles, File out, Writer idx) throws IOException {
        CountingStream cs = new CountingStream(new java.io.FileOutputStream(out));
        Writer w = new java.io.BufferedWriter(new java.io.OutputStreamWriter(cs, "UTF-8"), 65536);
        int total = 0;
        try {
            for (File bf : bucketFiles) {
                if (!bf.exists() || bf.length() == 0) continue;
                java.util.LinkedHashMap<String, ArrayList<String>> by = new java.util.LinkedHashMap<>();
                BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(bf), "UTF-8"), 65536);
                try {
                    String line;
                    while ((line = r.readLine()) != null) {
                        int a = line.indexOf('\t', 2);
                        if (a < 0) continue;
                        String key = line.substring(2, a);
                        ArrayList<String> l = by.get(key);
                        if (l == null) by.put(key, l = new ArrayList<>(64));
                        l.add(line);
                    }
                } finally {
                    r.close();
                }
                for (java.util.Map.Entry<String, ArrayList<String>> e : by.entrySet()) {
                    ArrayList<String> l = e.getValue();
                    java.util.Collections.sort(l, START_ORDER);
                    w.flush();
                    long off = cs.count;
                    long lastStart = Long.MIN_VALUE;
                    int n = 0;
                    for (String line : l) {
                        long st = startOf(line);
                        if (st == lastStart) continue;
                        lastStart = st;
                        w.write(line);
                        w.write('\n');
                        n++;
                    }
                    w.flush();
                    Tsv.row(idx, "K", e.getKey(), Long.toString(off), Long.toString(cs.count - off), Integer.toString(n));
                    total += n;
                }
            }
        } finally {
            w.close();
        }
        return total;
    }

    private static long startOf(String line) {
        int a = line.indexOf('\t', 2);
        int b = a < 0 ? -1 : line.indexOf('\t', a + 1);
        if (b < 0) return 0;
        try { return Long.parseLong(line.substring(a + 1, b)); } catch (Exception e) { return 0; }
    }

    private static final java.util.Comparator<String> START_ORDER = new java.util.Comparator<String>() {
        public int compare(String x, String y) {
            long a = startOf(x), b = startOf(y);
            return a < b ? -1 : (a == b ? 0 : 1);
        }
    };

    static final class CountingStream extends java.io.FilterOutputStream {
        long count;
        CountingStream(java.io.OutputStream o) { super(new java.io.BufferedOutputStream(o, 65536)); }
        @Override public void write(int b) throws IOException { out.write(b); count++; }
        @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); count += len; }
    }

    private static void parseOne(String url, String ua, Writer[] buckets, Writer w, HashMap<String, Integer> wantedIds,
                                 HashMap<String, List<String[]>> wantedNames, HashMap<String, Integer> kept,
                                 long now, long future, Result res, Tsv.Progress p) throws Exception {
        Http.Resp r = Http.get(url, ua, 20000, 120000);
        try {
            if (r.code >= 400) throw new IOException("Guide server answered " + r.code);
            XmlPullParserFactory f = XmlPullParserFactory.newInstance();
            f.setNamespaceAware(false);
            XmlPullParser x = f.newPullParser();
            try { x.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true); } catch (Exception ignored) { }
            try { x.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false); } catch (Exception ignored) { }
            x.setInput(new BufferedReader(new InputStreamReader(Http.maybeGunzip(r.body), "UTF-8"), 65536));
            int ev;
            int seen = 0;
            while ((ev = x.next()) != XmlPullParser.END_DOCUMENT) {
                if (ev != XmlPullParser.START_TAG) continue;
                String tag = x.getName();
                if ("programme".equals(tag)) {
                    seen++;
                    if ((seen & 4095) == 0) {
                        if (p.isCancelled()) throw new Tsv.Cancelled();
                        p.report("epg", res.programmes);
                    }
                    String ch = x.getAttributeValue(null, "channel");
                    if (ch == null) { skip(x); continue; }
                    String key = ch.trim().toLowerCase();
                    Integer arch = kept.get(key);
                    if (arch == null) {
                        arch = wantedIds.get(key);
                        if (arch == null) { skip(x); continue; }
                        kept.put(key, arch);
                    }
                    long start = parseTime(x.getAttributeValue(null, "start"));
                    long stop = parseTime(x.getAttributeValue(null, "stop"));
                    if (start < 0) { skip(x); continue; }
                    if (stop <= start) stop = start + 1800;
                    long pastLimit = now - Math.max(3 * 3600L, arch * 86400L);
                    if (stop < pastLimit || start > future) { skip(x); continue; }
                    String title = "", desc = "";
                    int depth = x.getDepth();
                    while (true) {
                        ev = x.next();
                        if (ev == XmlPullParser.END_DOCUMENT) break;
                        if (ev == XmlPullParser.END_TAG && x.getDepth() == depth) break;
                        if (ev == XmlPullParser.START_TAG) {
                            String t = x.getName();
                            if ("title".equals(t) && title.length() == 0) title = text(x);
                            else if ("desc".equals(t) && desc.length() == 0) desc = text(x);
                            else skip(x);
                        }
                    }
                    String k = Tsv.clean(key);
                    Tsv.row(buckets[bucket(k)], "P", k, Long.toString(start), Long.toString(stop), Tsv.clip(title, 120), Tsv.clip(desc, 220));
                    res.programmes++;
                } else if ("channel".equals(tag)) {
                    String id = x.getAttributeValue(null, "id");
                    if (id == null) { skip(x); continue; }
                    String key = id.trim().toLowerCase();
                    List<String> names = new ArrayList<>(3);
                    String icon = "";
                    int depth = x.getDepth();
                    while (true) {
                        ev = x.next();
                        if (ev == XmlPullParser.END_DOCUMENT) break;
                        if (ev == XmlPullParser.END_TAG && x.getDepth() == depth) break;
                        if (ev == XmlPullParser.START_TAG) {
                            String t = x.getName();
                            if ("display-name".equals(t)) names.add(text(x));
                            else if ("icon".equals(t)) {
                                String src = x.getAttributeValue(null, "src");
                                if (src != null && icon.length() == 0) icon = src;
                                skip(x);
                            } else skip(x);
                        }
                    }
                    Integer arch = wantedIds.get(key);
                    int best = arch == null ? -1 : arch;
                    // name based matching
                    String base = key;
                    int dot = base.indexOf('.');
                    if (dot > 0) base = base.substring(0, dot);
                    names.add(base);
                    for (String n : names) {
                        List<String[]> chans = wantedNames.get(Tsv.normName(n));
                        if (chans == null) continue;
                        for (String[] c : chans) {
                            Tsv.row(w, "X", c[0], Tsv.clean(key));
                            int a = 0;
                            try { a = Integer.parseInt(c[1]); } catch (Exception ignored) { }
                            best = Math.max(best, a);
                        }
                        wantedNames.remove(Tsv.normName(n));
                    }
                    if (best >= 0) {
                        Integer prev = kept.get(key);
                        kept.put(key, prev == null ? best : Math.max(prev, best));
                        if (icon.length() > 0) Tsv.row(w, "I", Tsv.clean(key), Tsv.clean(icon));
                    }
                }
            }
            p.report("epg", res.programmes);
        } finally {
            r.close();
        }
    }

    private static String text(XmlPullParser x) throws Exception {
        StringBuilder b = new StringBuilder();
        int depth = x.getDepth();
        while (true) {
            int ev = x.next();
            if (ev == XmlPullParser.TEXT || ev == XmlPullParser.CDSECT || ev == XmlPullParser.ENTITY_REF) {
                String t = x.getText();
                if (t != null && b.length() < 4000) b.append(t);
            } else if (ev == XmlPullParser.END_TAG && x.getDepth() == depth) {
                break;
            } else if (ev == XmlPullParser.END_DOCUMENT) {
                break;
            }
        }
        return b.toString().trim();
    }

    private static void skip(XmlPullParser x) throws Exception {
        if (x.getEventType() != XmlPullParser.START_TAG) return;
        int d = 1;
        while (d > 0) {
            int ev = x.next();
            if (ev == XmlPullParser.START_TAG) d++;
            else if (ev == XmlPullParser.END_TAG) d--;
            else if (ev == XmlPullParser.END_DOCUMENT) return;
        }
    }

    /** "20261020183000 +0100" -> epoch seconds. */
    public static long parseTime(String s) {
        if (s == null) return -1;
        s = s.trim();
        if (s.length() < 12) return -1;
        try {
            int Y = Integer.parseInt(s.substring(0, 4));
            int M = Integer.parseInt(s.substring(4, 6));
            int D = Integer.parseInt(s.substring(6, 8));
            int h = Integer.parseInt(s.substring(8, 10));
            int m = Integer.parseInt(s.substring(10, 12));
            int sec = 0;
            int i = 12;
            if (s.length() >= 14 && Character.isDigit(s.charAt(12)) && Character.isDigit(s.charAt(13))) {
                sec = Integer.parseInt(s.substring(12, 14));
                i = 14;
            }
            long t = daysFromCivil(Y, M, D) * 86400L + h * 3600L + m * 60L + sec;
            while (i < s.length() && s.charAt(i) == ' ') i++;
            if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-') && s.length() >= i + 5) {
                int sign = s.charAt(i) == '-' ? -1 : 1;
                int oh = Integer.parseInt(s.substring(i + 1, i + 3));
                int om = Integer.parseInt(s.substring(i + 3, i + 5));
                t -= sign * (oh * 3600L + om * 60L);
            }
            return t;
        } catch (Exception e) {
            return -1;
        }
    }

    static long daysFromCivil(int y, int m, int d) {
        y -= m <= 2 ? 1 : 0;
        long era = (y >= 0 ? y : y - 399) / 400;
        long yoe = y - era * 400;
        long doy = (153L * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

}
