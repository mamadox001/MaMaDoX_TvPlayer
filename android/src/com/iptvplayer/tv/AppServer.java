package com.iptvplayer.tv;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import com.iptvplayer.core.Http;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;

/** Serves the UI, local data files, the API proxy and the image cache to the WebView. */
final class AppServer {
    private final Context ctx;
    private final File filesDir;
    final ImageCache images;

    AppServer(Context c) {
        ctx = c.getApplicationContext();
        filesDir = ctx.getFilesDir();
        images = new ImageCache(ctx);
    }

    WebResourceResponse handle(Uri u) {
        if (u == null || !MainActivity.HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.length() == 0 || path.equals("/")) path = "/index.html";
        try {
            if (path.equals("/net")) return net(u);
            if (path.equals("/img")) return images.handle(u);
            if (path.startsWith("/files/")) return file(path.substring(7), u);
            return asset(path);
        } catch (Throwable t) {
            Log.w(MainActivity.TAG, "serve " + path, t);
            return text(500, "{\"error\":\"internal\"}");
        }
    }

    static Map<String, String> baseHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        return h;
    }

    static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Error";
            case 502: return "Bad Gateway";
            case 504: return "Gateway Timeout";
            default: return "Status " + code;
        }
    }

    static WebResourceResponse text(int code, String body) {
        try {
            return new WebResourceResponse("application/json", "utf-8", code, reason(code), baseHeaders(),
                    new ByteArrayInputStream(body.getBytes("UTF-8")));
        } catch (Exception e) {
            return null;
        }
    }

    private static String mime(String path) {
        int q = path.lastIndexOf('.');
        String ext = q >= 0 ? path.substring(q + 1).toLowerCase() : "";
        switch (ext) {
            case "html": return "text/html";
            case "js": return "application/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "svg": return "image/svg+xml";
            case "webp": return "image/webp";
            case "tsv": case "txt": case "idx": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private WebResourceResponse asset(String path) throws IOException {
        if (path.contains("..")) return text(404, "{}");
        InputStream in;
        try {
            in = ctx.getAssets().open("www" + path);
        } catch (IOException e) {
            return text(404, "{\"error\":\"not found\"}");
        }
        String m = mime(path);
        boolean textual = m.startsWith("text/") || m.endsWith("javascript") || m.endsWith("json") || m.endsWith("svg+xml");
        return new WebResourceResponse(m, textual ? "utf-8" : null, 200, "OK", baseHeaders(), in);
    }

    /** /files/<relative path>[?o=offset&n=length] */
    private WebResourceResponse file(String rel, Uri u) throws IOException {
        File f = new File(filesDir, Uri.decode(rel));
        String canon = f.getCanonicalPath();
        if (!canon.startsWith(filesDir.getCanonicalPath() + File.separator) || !f.isFile()) {
            return text(404, "{\"error\":\"not found\"}");
        }
        String o = u.getQueryParameter("o"), n = u.getQueryParameter("n");
        if (o != null && n != null) {
            long off = Long.parseLong(o);
            int len = (int) Math.min(Long.parseLong(n), 4L << 20);
            byte[] buf = new byte[Math.max(0, len)];
            RandomAccessFile raf = new RandomAccessFile(f, "r");
            try {
                raf.seek(off);
                raf.readFully(buf);
            } finally {
                raf.close();
            }
            return new WebResourceResponse("text/plain", "utf-8", 200, "OK", baseHeaders(), new ByteArrayInputStream(buf));
        }
        return new WebResourceResponse(mime(f.getName()), "utf-8", 200, "OK", baseHeaders(), new FileInputStream(f));
    }

    /** /net?u=<url>&ua=<user agent>&t=<read timeout ms>&ref=<referer> */
    private WebResourceResponse net(Uri u) {
        String target = u.getQueryParameter("u");
        if (target == null || target.length() == 0) return text(400, "{\"error\":\"missing url\"}");
        String ua = u.getQueryParameter("ua");
        String ref = u.getQueryParameter("ref");
        int timeout = 20000;
        try { timeout = Integer.parseInt(u.getQueryParameter("t")); } catch (Exception ignored) { }
        Map<String, String> extra = null;
        if (ref != null && ref.length() > 0) {
            extra = new HashMap<>();
            extra.put("Referer", ref);
        }
        final Http.Resp r;
        try {
            r = Http.get(target, ua, Math.min(timeout, 12000), timeout, extra);
        } catch (Throwable e) {
            Map<String, String> h = baseHeaders();
            h.put("X-Net-Error", Http.describe(e));
            try {
                return new WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", h,
                        new ByteArrayInputStream(("{\"__netError\":" + org.json.JSONObject.quote(Http.describe(e)) + "}").getBytes("UTF-8")));
            } catch (Exception x) {
                return null;
            }
        }
        String ct = r.contentType == null ? "application/octet-stream" : r.contentType;
        String mime = ct, charset = "utf-8";
        int semi = ct.indexOf(';');
        if (semi >= 0) {
            mime = ct.substring(0, semi).trim();
            int cs = ct.toLowerCase().indexOf("charset=");
            if (cs >= 0) charset = ct.substring(cs + 8).trim().replace("\"", "");
        }
        int code = r.code;
        if (code < 100 || code > 599 || (code >= 300 && code < 400)) code = 502;
        Map<String, String> h = baseHeaders();
        h.put("X-Final-Url", r.finalUrl);
        h.put("X-Status", Integer.toString(r.code));
        InputStream body = new FilterInputStream(r.body) {
            @Override
            public void close() throws IOException {
                r.close();
            }
        };
        return new WebResourceResponse(mime, charset, code, reason(code), h, body);
    }
}
