package com.iptvplayer.core;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.text.Normalizer;
import java.util.regex.Pattern;

/** Shared helpers for the compact tab separated files the UI loads. */
public final class Tsv {
    private Tsv() { }

    public interface Progress {
        /** stage: short machine name, count: items processed so far. */
        void report(String stage, int count);

        boolean isCancelled();
    }

    public static final class Cancelled extends java.io.IOException {
        public Cancelled() { super("cancelled"); }
    }

    public static Writer open(File f) throws IOException {
        File dir = f.getParentFile();
        if (dir != null && !dir.isDirectory()) dir.mkdirs();
        return new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f), "UTF-8"), 65536);
    }

    /** Atomically replaces target with tmp. */
    public static void commit(File tmp, File target) throws IOException {
        if (target.exists() && !target.delete()) {
            // fall through, rename may still work on some file systems
        }
        if (!tmp.renameTo(target)) throw new IOException("Could not save " + target.getName());
    }

    /** Removes tabs and line breaks, trims. */
    public static String clean(String s) {
        if (s == null) return "";
        int n = s.length();
        boolean dirty = false;
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            if (c == '\t' || c == '\n' || c == '\r') { dirty = true; break; }
        }
        if (dirty) {
            StringBuilder b = new StringBuilder(n);
            for (int i = 0; i < n; i++) {
                char c = s.charAt(i);
                b.append(c == '\t' || c == '\n' || c == '\r' ? ' ' : c);
            }
            s = b.toString();
        }
        return s.trim();
    }

    public static String clip(String s, int max) {
        s = clean(s);
        if (s.length() <= max) return s;
        int cut = s.lastIndexOf(' ', max);
        if (cut < max * 2 / 3) cut = max;
        return s.substring(0, cut).trim() + "…";
    }

    public static void row(Writer w, String... f) throws IOException {
        for (int i = 0; i < f.length; i++) {
            if (i > 0) w.write('\t');
            String v = f[i];
            if (v != null) w.write(v);
        }
        w.write('\n');
    }

    private static final Pattern MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern PREFIX = Pattern.compile("^(?:\\|[^|]{1,8}\\|\\s*|[a-z]{2,4}\\s*[:|]\\s*|[a-z]{2,3}\\s+-\\s+)");
    private static final Pattern QUALITY = Pattern.compile("\\b(?:uhd|fhd|hd|sd|4k|8k|hevc|h\\.?26[45]|1080[pi]?|720p|2160p|50fps|60fps|backup|vip|raw|hdr)\\b");
    private static final Pattern NON_ALNUM = Pattern.compile("[^\\p{L}\\p{N}+]+");

    /** Normalized channel name used to match playlist channels with EPG channels. */
    public static String normName(String s) {
        if (s == null) return "";
        String t = s.toLowerCase().trim();
        t = Normalizer.normalize(t, Normalizer.Form.NFD);
        t = MARKS.matcher(t).replaceAll("");
        t = t.replace('ʜ', 'h').replace('ᴅ', 'd'); // small caps "ʜᴅ" used by some providers
        t = PREFIX.matcher(t).replaceFirst("");
        t = QUALITY.matcher(t).replaceAll(" ");
        t = NON_ALNUM.matcher(t).replaceAll("");
        return t;
    }
}
