package com.iptvplayer.core;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Writer;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Streaming M3U / M3U8 playlist parser. Splits entries into live channels, movies
 * and series episodes (grouped into shows) and writes the same TSV files as XtreamSync.
 *  E  seriesId  season  episode  title  url  icon  extra   (episodes, series.tsv)
 */
public final class M3uSync {
    private M3uSync() { }

    public static final class Result {
        public int live, movies, series, episodes;
        public String epgUrl = "";
    }

    private static final Pattern SXE = Pattern.compile(
            "^(.*?)[\\s._\\-:|(\\[]*\\b[Ss](\\d{1,3})[\\s._\\-]*[EeXx](\\d{1,4})(?!\\d)(.*)$");
    private static final Pattern SEASON_WORDS = Pattern.compile(
            "(?i)^(.*?)[\\s._\\-:|]*(?:season|saison|temporada|staffel|stagione)\\s*(\\d{1,3})[\\s._\\-:|,]*(?:episode|[eé]pisode|episodio|folge|ep\\.?|e)\\s*(\\d{1,4})(.*)$");
    private static final Pattern YEAR = Pattern.compile("[(\\[]((?:19|20)\\d\\d)[)\\]]");

    private static final String[] VIDEO_EXT = {"mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "divx", "3gp", "ogv", "vob"};

    static final class Entry {
        String name = "", logo = "", group = "", tvgId = "", tvgName = "", chno = "", catchup = "", catchupSource = "",
                catchupDays = "", ua = "", ref = "", url = "";
    }

    static final class Show {
        String id, name, cover, catId;
        int episodes;
    }

    public static Result parse(InputStream raw, File dir, Tsv.Progress p) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(Http.maybeGunzip(raw), "UTF-8"), 65536);
        Result res = new Result();
        File liveTmp = new File(dir, "live.tsv.tmp"), vodTmp = new File(dir, "vod.tsv.tmp"), serTmp = new File(dir, "series.tsv.tmp");
        Writer lw = Tsv.open(liveTmp), vw = Tsv.open(vodTmp), sw = Tsv.open(serTmp);
        boolean ok = false;
        LinkedHashMap<String, String> liveCats = new LinkedHashMap<>(), vodCats = new LinkedHashMap<>(), serCats = new LinkedHashMap<>();
        LinkedHashMap<String, Show> shows = new LinkedHashMap<>();
        HashSet<String> usedIds = new HashSet<>();
        HashMap<String, Integer> epCounter = new HashMap<>();
        try {
            String now = Long.toString(System.currentTimeMillis());
            Tsv.row(lw, "H", "2", "m3u", now);
            Tsv.row(vw, "H", "2", "m3u", now);
            Tsv.row(sw, "H", "2", "m3u", now);
            Entry e = null;
            String pendingGroup = "", pendingUa = "", pendingRef = "";
            String line;
            int lineNo = 0, total = 0;
            boolean sawHeader = false;
            while ((line = in.readLine()) != null) {
                lineNo++;
                line = line.trim();
                if (line.length() == 0) continue;
                if (lineNo < 3 && line.startsWith("﻿")) line = line.substring(1);
                if (line.charAt(0) == '#') {
                    String up = line.length() > 12 ? line.substring(0, 12).toUpperCase() : line.toUpperCase();
                    if (up.startsWith("#EXTM3U")) {
                        sawHeader = true;
                        Map<String, String> a = new HashMap<>();
                        parseAttrs(line, 7, a, null);
                        String epg = first(a.get("url-tvg"), a.get("x-tvg-url"), a.get("tvg-url"));
                        if (epg.length() > 0 && res.epgUrl.length() == 0) res.epgUrl = epg;
                    } else if (up.startsWith("#EXTINF")) {
                        e = new Entry();
                        int colon = line.indexOf(':');
                        Map<String, String> a = new HashMap<>();
                        String[] title = new String[1];
                        parseAttrs(line, colon < 0 ? 7 : colon + 1, a, title);
                        e.name = title[0] == null ? "" : title[0].trim();
                        e.tvgId = s(a.get("tvg-id"));
                        e.tvgName = s(a.get("tvg-name"));
                        e.logo = first(a.get("tvg-logo"), a.get("logo"), a.get("tvg-logo-small"));
                        e.group = s(a.get("group-title"));
                        e.chno = first(a.get("tvg-chno"), a.get("channel-number"), a.get("tvg-num"));
                        e.catchup = first(a.get("catchup"), a.get("catchup-type"));
                        e.catchupSource = s(a.get("catchup-source"));
                        e.catchupDays = first(a.get("catchup-days"), a.get("timeshift"), a.get("tvg-rec"));
                        e.ua = first(a.get("user-agent"), a.get("http-user-agent"));
                        e.ref = first(a.get("referrer"), a.get("http-referrer"), a.get("referer"));
                        if (pendingGroup.length() > 0 && e.group.length() == 0) e.group = pendingGroup;
                    } else if (up.startsWith("#EXTGRP")) {
                        int c = line.indexOf(':');
                        String g = c >= 0 ? line.substring(c + 1).trim() : "";
                        if (e != null && e.group.length() == 0) e.group = g;
                        else if (e == null) pendingGroup = g;
                    } else if (up.startsWith("#EXTVLCOPT")) {
                        int c = line.indexOf(':');
                        String opt = c >= 0 ? line.substring(c + 1).trim() : "";
                        int eq = opt.indexOf('=');
                        if (eq > 0) {
                            String k = opt.substring(0, eq).trim().toLowerCase(), v = opt.substring(eq + 1).trim();
                            if (k.equals("http-user-agent")) { if (e != null) e.ua = v; else pendingUa = v; }
                            else if (k.equals("http-referrer") || k.equals("http-referer")) { if (e != null) e.ref = v; else pendingRef = v; }
                        }
                    }
                    continue;
                }
                // URL line
                if (e == null) {
                    e = new Entry();
                    if (!sawHeader && lineNo == 1 && !looksLikeUrl(line)) continue;
                }
                if (e.ua.length() == 0) e.ua = pendingUa;
                if (e.ref.length() == 0) e.ref = pendingRef;
                String url = line;
                int pipe = url.indexOf('|');
                if (pipe > 0) {
                    String hdr = url.substring(pipe + 1);
                    url = url.substring(0, pipe).trim();
                    for (String kv : hdr.split("&")) {
                        int eq = kv.indexOf('=');
                        if (eq <= 0) continue;
                        String k = kv.substring(0, eq).trim().toLowerCase(), v = urlDecode(kv.substring(eq + 1).trim());
                        if (k.equals("user-agent")) e.ua = v;
                        else if (k.equals("referer") || k.equals("referrer")) e.ref = v;
                    }
                }
                e.url = url;
                if (e.name.length() == 0) e.name = e.tvgName.length() > 0 ? e.tvgName : baseName(url);
                emit(e, lw, vw, sw, liveCats, vodCats, serCats, shows, usedIds, epCounter, res);
                e = null;
                pendingGroup = "";
                pendingUa = "";
                pendingRef = "";
                total++;
                if ((total & 1023) == 0) {
                    if (p.isCancelled()) throw new Tsv.Cancelled();
                    p.report("m3u", total);
                }
            }
            for (Show sh : shows.values()) {
                Tsv.row(sw, "S", sh.id, Tsv.clean(sh.name), Tsv.clean(sh.cover), sh.catId, "", "", year(sh.name), "");
            }
            writeCats(lw, liveCats);
            writeCats(vw, vodCats);
            writeCats(sw, serCats);
            res.series = shows.size();
            p.report("m3u", total);
            ok = true;
        } finally {
            lw.close();
            vw.close();
            sw.close();
            if (!ok) {
                liveTmp.delete();
                vodTmp.delete();
                serTmp.delete();
            }
        }
        if (res.live + res.movies + res.episodes == 0) {
            liveTmp.delete();
            vodTmp.delete();
            serTmp.delete();
            throw new IOException("This link did not return a playlist with any channels.");
        }
        Tsv.commit(liveTmp, new File(dir, "live.tsv"));
        Tsv.commit(vodTmp, new File(dir, "vod.tsv"));
        Tsv.commit(serTmp, new File(dir, "series.tsv"));
        return res;
    }

    private static void writeCats(Writer w, LinkedHashMap<String, String> cats) throws IOException {
        for (Map.Entry<String, String> c : cats.entrySet()) Tsv.row(w, "C", c.getValue(), Tsv.clean(c.getKey()));
    }

    private static String catId(LinkedHashMap<String, String> cats, String group, String prefix) {
        String g = group.length() == 0 ? "Uncategorized" : group;
        String id = cats.get(g);
        if (id == null) {
            id = prefix + (cats.size() + 1);
            cats.put(g, id);
        }
        return id;
    }

    private static void emit(Entry e, Writer lw, Writer vw, Writer sw,
                             LinkedHashMap<String, String> liveCats, LinkedHashMap<String, String> vodCats,
                             LinkedHashMap<String, String> serCats, LinkedHashMap<String, Show> shows,
                             HashSet<String> usedIds, HashMap<String, Integer> epCounter, Result res) throws IOException {
        String lowerUrl = e.url.toLowerCase();
        String ext = extension(lowerUrl);
        boolean isSeriesPath = lowerUrl.contains("/series/");
        boolean isMoviePath = lowerUrl.contains("/movie/") || lowerUrl.contains("/movies/") || lowerUrl.contains("/vod/");
        boolean isVideoFile = false;
        for (String v : VIDEO_EXT) if (v.equals(ext)) { isVideoFile = true; break; }
        String extra = extra(e);

        Matcher m = null;
        if (isSeriesPath || (isVideoFile && !isMoviePath)) {
            m = SXE.matcher(e.name);
            if (!m.matches()) {
                m = SEASON_WORDS.matcher(e.name);
                if (!m.matches()) m = null;
            }
        }
        if (isSeriesPath || m != null) {
            String showName, title;
            int season, episode;
            if (m != null) {
                showName = trimSep(m.group(1));
                season = parseInt(m.group(2), 1);
                episode = parseInt(m.group(3), 1);
                title = trimSep(m.group(4));
            } else {
                showName = e.name;
                season = 1;
                Integer n = epCounter.get(e.group + "|" + showName);
                episode = n == null ? 1 : n + 1;
                title = "";
            }
            if (showName.length() == 0) showName = e.group.length() > 0 ? e.group : "Series";
            String cat = catId(serCats, e.group, "s");
            String key = cat + "|" + Tsv.normName(showName);
            Show sh = shows.get(key);
            if (sh == null) {
                sh = new Show();
                sh.id = uniqueId("s" + hash(key), usedIds);
                sh.name = showName;
                sh.cover = e.logo;
                sh.catId = cat;
                shows.put(key, sh);
            }
            if (sh.cover.length() == 0) sh.cover = e.logo;
            sh.episodes++;
            epCounter.put(e.group + "|" + showName, episode);
            Tsv.row(sw, "E", sh.id, Integer.toString(season), Integer.toString(episode), Tsv.clean(title),
                    Tsv.clean(e.url), Tsv.clean(e.logo), extra);
            res.episodes++;
            return;
        }
        if (isMoviePath || isVideoFile) {
            String cat = catId(vodCats, e.group, "v");
            String id = uniqueId("m" + hash(e.name + "|" + e.group), usedIds);
            Tsv.row(vw, "M", id, Tsv.clean(e.name), Tsv.clean(e.logo), cat, "", "", ext.length() > 5 ? "" : ext,
                    year(e.name), "0", Tsv.clean(e.url), extra);
            res.movies++;
            return;
        }
        String cat = catId(liveCats, e.group, "g");
        String id = uniqueId("c" + hash(e.tvgId + "|" + e.name + "|" + e.group), usedIds);
        res.live++;
        String num = e.chno.length() > 0 ? e.chno : Integer.toString(res.live);
        Tsv.row(lw, "L", id, Tsv.clean(num), Tsv.clean(e.name), Tsv.clean(e.logo), cat, Tsv.clean(e.tvgId),
                Integer.toString(catchupDays(e)), "0", Tsv.clean(e.url), extra);
    }

    private static int catchupDays(Entry e) {
        if (e.catchup.length() == 0 && e.catchupDays.length() == 0) return 0;
        int d = parseInt(e.catchupDays, 0);
        if (d <= 0 && e.catchup.length() > 0) d = 1;
        return Math.min(d, 30);
    }

    private static String extra(Entry e) {
        StringBuilder b = new StringBuilder();
        if (e.ua.length() > 0) b.append("ua=").append(Http.enc(e.ua));
        if (e.ref.length() > 0) { if (b.length() > 0) b.append('&'); b.append("ref=").append(Http.enc(e.ref)); }
        if (e.catchup.length() > 0) { if (b.length() > 0) b.append('&'); b.append("cu=").append(Http.enc(e.catchup)); }
        if (e.catchupSource.length() > 0) { if (b.length() > 0) b.append('&'); b.append("cus=").append(Http.enc(e.catchupSource)); }
        return b.toString();
    }

    private static String uniqueId(String base, HashSet<String> used) {
        String id = base;
        int n = 2;
        while (!used.add(id)) id = base + "~" + (n++);
        return id;
    }

    /** 64-bit FNV-1a hash, base36. Stable across refreshes so favourites keep working. */
    static String hash(String s) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x100000001b3L;
        }
        return Long.toString(h & Long.MAX_VALUE, 36);
    }

    private static String year(String name) {
        Matcher m = YEAR.matcher(name);
        String y = "";
        while (m.find()) y = m.group(1);
        return y;
    }

    private static String trimSep(String s) {
        if (s == null) return "";
        int a = 0, b = s.length();
        while (a < b && " ._-:|([".indexOf(s.charAt(a)) >= 0) a++;
        while (b > a && " ._-:|)]".indexOf(s.charAt(b - 1)) >= 0) b--;
        return s.substring(a, b).replace('.', ' ').replace('_', ' ').trim();
    }

    private static int parseInt(String s, int def) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return def; }
    }

    private static String extension(String lowerUrl) {
        int q = lowerUrl.indexOf('?');
        String path = q >= 0 ? lowerUrl.substring(0, q) : lowerUrl;
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        if (dot > slash && dot < path.length() - 1) return path.substring(dot + 1);
        return "";
    }

    private static String baseName(String url) {
        int q = url.indexOf('?');
        String p = q >= 0 ? url.substring(0, q) : url;
        int s = p.lastIndexOf('/');
        return s >= 0 && s < p.length() - 1 ? p.substring(s + 1) : url;
    }

    private static boolean looksLikeUrl(String s) {
        return s.contains("://");
    }

    private static String s(String v) { return v == null ? "" : v.trim(); }

    private static String first(String... v) {
        for (String x : v) if (x != null && x.trim().length() > 0) return x.trim();
        return "";
    }

    private static String urlDecode(String s) {
        try { return java.net.URLDecoder.decode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    /**
     * Parses key="value" attributes starting at index; stores lower-cased keys.
     * If title != null, the text after the first comma outside quotes is returned in title[0].
     */
    static void parseAttrs(String line, int start, Map<String, String> out, String[] title) {
        int i = start, n = line.length();
        // skip duration
        while (i < n && (line.charAt(i) == '-' || line.charAt(i) == '.' || Character.isDigit(line.charAt(i)) || line.charAt(i) == ' ')) {
            if (line.charAt(i) == ' ' && i > start) break;
            i++;
        }
        while (i < n) {
            char c = line.charAt(i);
            if (c == ' ' || c == '\t') { i++; continue; }
            if (c == ',') {
                if (title != null) title[0] = line.substring(i + 1);
                return;
            }
            int ks = i;
            while (i < n && line.charAt(i) != '=' && line.charAt(i) != ' ' && line.charAt(i) != ',') i++;
            String key = line.substring(ks, i).toLowerCase();
            if (i < n && line.charAt(i) == '=') {
                i++;
                String val;
                if (i < n && (line.charAt(i) == '"' || line.charAt(i) == '\'')) {
                    char q = line.charAt(i++);
                    int vs = i;
                    int end = line.indexOf(q, i);
                    if (end < 0) end = n;
                    val = line.substring(vs, end);
                    i = Math.min(n, end + 1);
                } else {
                    int vs = i;
                    while (i < n && line.charAt(i) != ' ' && line.charAt(i) != ',') i++;
                    val = line.substring(vs, i);
                }
                if (key.length() > 0 && !out.containsKey(key)) out.put(key, val);
            } else if (key.length() == 0) {
                i++;
            }
        }
        if (title != null && title[0] == null) title[0] = "";
    }
}
