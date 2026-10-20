package com.iptvplayer.core;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Writer;

/**
 * Downloads Xtream Codes catalogues with a streaming parser and writes compact TSV:
 *  C  catId  name
 *  L  id  num  name  logo  catId  epgId  archiveDays  adult  url  extra      (live)
 *  M  id  name  icon  catId  rating  added  ext  year  adult  url  extra    (movies)
 *  S  id  name  cover  catId  rating  modified  year  genre                (series)
 */
public final class XtreamSync {
    private XtreamSync() { }

    public static String api(String base, String user, String pass, String action) {
        StringBuilder b = new StringBuilder(base.length() + 96);
        b.append(base).append("/player_api.php?username=").append(Http.enc(user)).append("&password=").append(Http.enc(pass));
        if (action != null) b.append("&action=").append(action);
        return b.toString();
    }

    /** Returns item count. section: live | vod | series */
    public static int syncSection(String base, String user, String pass, String ua, String section,
                                  File dir, Tsv.Progress p) throws IOException {
        String catAction, listAction;
        if ("live".equals(section)) { catAction = "get_live_categories"; listAction = "get_live_streams"; }
        else if ("vod".equals(section)) { catAction = "get_vod_categories"; listAction = "get_vod_streams"; }
        else if ("series".equals(section)) { catAction = "get_series_categories"; listAction = "get_series"; }
        else throw new IOException("Unknown section " + section);

        File out = new File(dir, section + ".tsv");
        File tmp = new File(dir, section + ".tsv.tmp");
        Writer w = Tsv.open(tmp);
        int count = 0;
        boolean ok = false;
        try {
            Tsv.row(w, "H", "2", "xtream", Long.toString(System.currentTimeMillis()));
            p.report(section + ":categories", 0);
            writeCategories(api(base, user, pass, catAction), ua, w);
            if (p.isCancelled()) throw new Tsv.Cancelled();
            p.report(section, 0);
            Http.Resp r = Http.get(api(base, user, pass, listAction), ua, 15000, 90000);
            try {
                if (r.code >= 400) throw new IOException("Server answered " + r.code + " for the " + section + " list");
                JsonPull j = new JsonPull(new BufferedReader(new InputStreamReader(r.body, "UTF-8"), 65536));
                int t = j.peek();
                if (t == JsonPull.BEGIN_ARRAY || t == JsonPull.BEGIN_OBJECT) {
                    boolean isObj = j.beginRecords();
                    while (j.hasNext()) {
                        if (isObj) j.nextName();
                        if (j.peek() != JsonPull.BEGIN_OBJECT) { j.skipValue(); continue; }
                        if ("live".equals(section)) writeLive(j, w);
                        else if ("vod".equals(section)) writeVod(j, w);
                        else writeSeries(j, w);
                        count++;
                        if ((count & 511) == 0) {
                            if (p.isCancelled()) throw new Tsv.Cancelled();
                            p.report(section, count);
                        }
                    }
                }
            } finally {
                r.close();
            }
            p.report(section, count);
            ok = true;
        } finally {
            w.close();
            if (!ok) tmp.delete();
        }
        Tsv.commit(tmp, out);
        return count;
    }

    private static void writeCategories(String url, String ua, Writer w) throws IOException {
        Http.Resp r = Http.get(url, ua, 15000, 45000);
        try {
            if (r.code >= 400) throw new IOException("Server answered " + r.code);
            JsonPull j = new JsonPull(new BufferedReader(new InputStreamReader(r.body, "UTF-8"), 16384));
            int t = j.peek();
            if (t != JsonPull.BEGIN_ARRAY && t != JsonPull.BEGIN_OBJECT) return;
            boolean isObj = j.beginRecords();
            while (j.hasNext()) {
                if (isObj) j.nextName();
                if (j.peek() != JsonPull.BEGIN_OBJECT) { j.skipValue(); continue; }
                String id = "", name = "";
                j.beginObject();
                while (j.hasNext()) {
                    String k = j.nextName();
                    if ("category_id".equals(k)) id = j.nextFlat();
                    else if ("category_name".equals(k)) name = j.nextFlat();
                    else j.skipValue();
                }
                j.endObject();
                if (id.length() > 0) Tsv.row(w, "C", Tsv.clean(id), Tsv.clean(name));
            }
        } finally {
            r.close();
        }
    }

    private static int toInt(String s) {
        if (s == null) return 0;
        try { return (int) Double.parseDouble(s.trim()); } catch (Exception e) { return 0; }
    }

    private static void writeLive(JsonPull j, Writer w) throws IOException {
        String id = "", num = "", name = "", icon = "", cat = "", epg = "", archive = "0", archiveDur = "0", adult = "0", direct = "";
        j.beginObject();
        while (j.hasNext()) {
            String k = j.nextName();
            switch (k) {
                case "stream_id": id = j.nextFlat(); break;
                case "num": num = j.nextFlat(); break;
                case "name": name = j.nextFlat(); break;
                case "stream_icon": icon = j.nextFlat(); break;
                case "category_id": cat = j.nextFlat(); break;
                case "epg_channel_id": epg = j.nextFlat(); break;
                case "tv_archive": archive = j.nextFlat(); break;
                case "tv_archive_duration": archiveDur = j.nextFlat(); break;
                case "is_adult": adult = j.nextFlat(); break;
                case "direct_source": direct = j.nextFlat(); break;
                default: j.skipValue();
            }
        }
        j.endObject();
        if (id.length() == 0) return;
        int days = toInt(archive) > 0 ? Math.max(1, toInt(archiveDur)) : 0;
        Tsv.row(w, "L", Tsv.clean(id), Tsv.clean(num), Tsv.clean(name), Tsv.clean(icon), Tsv.clean(cat), Tsv.clean(epg),
                Integer.toString(days), toInt(adult) > 0 ? "1" : "0", "", "");
    }

    private static void writeVod(JsonPull j, Writer w) throws IOException {
        String id = "", name = "", icon = "", cat = "", rating = "", rating5 = "", added = "", ext = "", year = "", adult = "0";
        j.beginObject();
        while (j.hasNext()) {
            String k = j.nextName();
            switch (k) {
                case "stream_id": id = j.nextFlat(); break;
                case "name": name = j.nextFlat(); break;
                case "stream_icon": icon = j.nextFlat(); break;
                case "category_id": cat = j.nextFlat(); break;
                case "rating": rating = j.nextFlat(); break;
                case "rating_5based": rating5 = j.nextFlat(); break;
                case "added": added = j.nextFlat(); break;
                case "container_extension": ext = j.nextFlat(); break;
                case "year": year = j.nextFlat(); break;
                case "is_adult": adult = j.nextFlat(); break;
                default: j.skipValue();
            }
        }
        j.endObject();
        if (id.length() == 0) return;
        Tsv.row(w, "M", Tsv.clean(id), Tsv.clean(name), Tsv.clean(icon), Tsv.clean(cat), rating(rating, rating5),
                Tsv.clean(added), Tsv.clean(ext), Tsv.clean(year), toInt(adult) > 0 ? "1" : "0", "", "");
    }

    private static void writeSeries(JsonPull j, Writer w) throws IOException {
        String id = "", name = "", cover = "", cat = "", rating = "", rating5 = "", mod = "", year = "", genre = "";
        j.beginObject();
        while (j.hasNext()) {
            String k = j.nextName();
            switch (k) {
                case "series_id": id = j.nextFlat(); break;
                case "name": name = j.nextFlat(); break;
                case "cover": cover = j.nextFlat(); break;
                case "category_id": cat = j.nextFlat(); break;
                case "rating": rating = j.nextFlat(); break;
                case "rating_5based": rating5 = j.nextFlat(); break;
                case "last_modified": mod = j.nextFlat(); break;
                case "releaseDate": case "release_date": {
                    String d = j.nextFlat();
                    if (year.length() == 0 && d.length() >= 4) year = d.substring(0, 4);
                    break;
                }
                case "year": { String y = j.nextFlat(); if (y.length() >= 4) year = y.substring(0, 4); break; }
                case "genre": genre = j.nextFlat(); break;
                default: j.skipValue();
            }
        }
        j.endObject();
        if (id.length() == 0) return;
        Tsv.row(w, "S", Tsv.clean(id), Tsv.clean(name), Tsv.clean(cover), Tsv.clean(cat), rating(rating, rating5),
                Tsv.clean(mod), Tsv.clean(year), Tsv.clip(genre, 60));
    }

    private static String rating(String r10, String r5) {
        double v = 0;
        try { if (r10 != null && r10.length() > 0) v = Double.parseDouble(r10.trim()); } catch (Exception ignored) { }
        if (v <= 0) {
            try { if (r5 != null && r5.length() > 0) v = Double.parseDouble(r5.trim()) * 2; } catch (Exception ignored) { }
        }
        if (v <= 0 || v > 10.01) return "";
        return String.valueOf(Math.round(v * 10) / 10.0);
    }
}
