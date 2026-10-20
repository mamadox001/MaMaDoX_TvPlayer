package com.iptvplayer.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import com.iptvplayer.core.Http;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Downloads artwork once, downsizes it to the size the UI draws it at and keeps it on disk.
 * Requests are answered immediately with a stream that is filled when the work completes,
 * so slow image servers never block the WebView. Newest requests are served first.
 */
final class ImageCache {
    private static final long MAX_BYTES = 160L << 20;
    private final File dir;
    private final ThreadPoolExecutor pool;
    private final ConcurrentHashMap<String, Task> inflight = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> failed = new ConcurrentHashMap<>();
    volatile String userAgent = null;

    @SuppressWarnings("serial")
    private static final class LifoQueue extends LinkedBlockingDeque<Runnable> {
        @Override public boolean offer(Runnable r) { return super.offerFirst(r); }
        @Override public boolean add(Runnable r) { return super.offerFirst(r); }
    }

    ImageCache(Context c) {
        dir = new File(c.getCacheDir(), "img");
        dir.mkdirs();
        pool = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, new LifoQueue());
        pool.allowCoreThreadTimeOut(true);
        new Thread(new Runnable() { public void run() { trim(); } }, "img-trim").start();
    }

    /** Stream whose content arrives later. */
    static final class LateStream extends InputStream {
        private byte[] data;
        private boolean done;
        private int pos;
        volatile boolean closed;

        synchronized void complete(byte[] d) {
            data = d;
            done = true;
            notifyAll();
        }

        private void await() throws IOException {
            long end = System.currentTimeMillis() + 45000;
            while (!done) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) { done = true; break; }
                try { wait(left); } catch (InterruptedException e) { throw new IOException("interrupted"); }
            }
        }

        @Override public synchronized int read() throws IOException {
            await();
            if (data == null || pos >= data.length) return -1;
            return data[pos++] & 0xff;
        }

        @Override public synchronized int read(byte[] b, int off, int len) throws IOException {
            await();
            if (data == null || pos >= data.length) return -1;
            int n = Math.min(len, data.length - pos);
            System.arraycopy(data, pos, b, off, n);
            pos += n;
            return n;
        }

        @Override public int available() { return 0; }

        @Override public void close() {
            closed = true;
        }
    }

    final class Task implements Runnable {
        final String key, src;
        final int width;
        final List<LateStream> waiters = new ArrayList<>(2);

        Task(String key, String src, int width) {
            this.key = key;
            this.src = src;
            this.width = width;
        }

        public void run() {
            boolean anyone;
            synchronized (this) {
                anyone = false;
                for (LateStream s : waiters) if (!s.closed) anyone = true;
            }
            byte[] out = null;
            if (anyone) {
                try {
                    out = fetch(src, width, key);
                } catch (Throwable t) {
                    failed.put(key, System.currentTimeMillis());
                }
            }
            synchronized (this) {
                inflight.remove(key);
                for (LateStream s : waiters) s.complete(out);
            }
        }
    }

    WebResourceResponse handle(Uri u) {
        String src = u.getQueryParameter("u");
        if (src == null || src.length() == 0 || !(src.startsWith("http://") || src.startsWith("https://"))) {
            return AppServer.text(404, "{}");
        }
        int w = 0;
        try { w = Integer.parseInt(u.getQueryParameter("w")); } catch (Exception ignored) { }
        String key = md5(src + "|" + w);
        File f = new File(dir, key);
        if (f.length() > 0) {
            try {
                return new WebResourceResponse(sniff(f), null, 200, "OK", AppServer.baseHeaders(), new FileInputStream(f));
            } catch (IOException ignored) { }
        }
        Long fail = failed.get(key);
        if (fail != null && System.currentTimeMillis() - fail < 10 * 60 * 1000L) return AppServer.text(404, "{}");
        LateStream ls = new LateStream();
        Task t;
        synchronized (inflight) {
            t = inflight.get(key);
            if (t == null) {
                t = new Task(key, src, w);
                inflight.put(key, t);
                synchronized (t) { t.waiters.add(ls); }
                pool.execute(t);
            } else {
                synchronized (t) { t.waiters.add(ls); }
            }
        }
        String mime = src.toLowerCase().contains(".svg") ? "image/svg+xml" : "image/jpeg";
        return new WebResourceResponse(mime, null, 200, "OK", AppServer.baseHeaders(), ls);
    }

    private byte[] fetch(String src, int width, String key) throws IOException {
        Http.Resp r = Http.get(src, userAgent, 8000, 15000);
        byte[] raw;
        try {
            if (r.code >= 400) throw new IOException("http " + r.code);
            raw = r.bytes(12 << 20);
        } finally {
            r.close();
        }
        if (raw.length == 0) throw new IOException("empty");
        byte[] out = raw;
        boolean svg = raw.length > 4 && (raw[0] == '<' || (raw[0] == (byte) 0xEF && raw[3] == '<'));
        if (!svg && width > 0) {
            try {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
                if (o.outWidth <= 0) throw new IOException("not an image");
                if (o.outWidth > width * 1.25f) {
                    int sample = 1;
                    while (o.outWidth / (sample * 2) >= width) sample *= 2;
                    BitmapFactory.Options d = new BitmapFactory.Options();
                    d.inSampleSize = sample;
                    Bitmap b = BitmapFactory.decodeByteArray(raw, 0, raw.length, d);
                    if (b != null) {
                        if (b.getWidth() > width * 1.25f) {
                            int h = Math.max(1, Math.round(b.getHeight() * (width / (float) b.getWidth())));
                            Bitmap s = Bitmap.createScaledBitmap(b, width, h, true);
                            if (s != b) b.recycle();
                            b = s;
                        }
                        ByteArrayOutputStream bo = new ByteArrayOutputStream(64 * 1024);
                        boolean alpha = b.hasAlpha();
                        b.compress(alpha ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 86, bo);
                        b.recycle();
                        if (bo.size() > 0 && bo.size() < raw.length) out = bo.toByteArray();
                    }
                }
            } catch (OutOfMemoryError oom) {
                Log.w(MainActivity.TAG, "image too large " + src);
                throw new IOException("oom");
            }
        }
        File tmp = new File(dir, key + ".tmp");
        try {
            FileOutputStream fo = new FileOutputStream(tmp);
            try { fo.write(out); } finally { fo.close(); }
            File target = new File(dir, key);
            if (!tmp.renameTo(target)) tmp.delete();
        } catch (IOException e) {
            tmp.delete();
        }
        return out;
    }

    private static String sniff(File f) {
        byte[] b = new byte[12];
        try {
            InputStream in = new FileInputStream(f);
            try { in.read(b); } finally { in.close(); }
        } catch (IOException e) {
            return "image/jpeg";
        }
        if ((b[0] & 0xff) == 0x89 && b[1] == 'P') return "image/png";
        if ((b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xD8) return "image/jpeg";
        if (b[0] == 'G' && b[1] == 'I') return "image/gif";
        if (b[0] == 'R' && b[1] == 'I' && b[8] == 'W') return "image/webp";
        if (b[0] == '<' || ((b[0] & 0xff) == 0xEF && b[3] == '<')) return "image/svg+xml";
        if (b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') return "image/avif";
        return "image/jpeg";
    }

    static String md5(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder(32);
            for (byte x : d) b.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    long size() {
        long t = 0;
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) t += f.length();
        return t;
    }

    void clear() {
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) f.delete();
        failed.clear();
    }

    /** Keeps the cache under MAX_BYTES, removing the least recently written files. */
    void trim() {
        try {
            File[] fs = dir.listFiles();
            if (fs == null) return;
            long total = 0;
            for (File f : fs) total += f.length();
            if (total <= MAX_BYTES) return;
            final HashMap<File, Long> mod = new HashMap<>();
            for (File f : fs) mod.put(f, f.lastModified());
            Arrays.sort(fs, new Comparator<File>() {
                public int compare(File a, File b) {
                    long x = mod.get(a), y = mod.get(b);
                    return x < y ? -1 : (x == y ? 0 : 1);
                }
            });
            for (File f : fs) {
                if (total <= MAX_BYTES * 3 / 4) break;
                total -= f.length();
                f.delete();
            }
        } catch (Throwable t) {
            Log.w(MainActivity.TAG, "trim", t);
        }
    }
}
