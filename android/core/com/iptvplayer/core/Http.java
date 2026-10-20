package com.iptvplayer.core;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Minimal HTTP client on top of HttpURLConnection with manual redirects and gzip. */
public final class Http {
    public static volatile String defaultUa = "Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 (KHTML, like Gecko) IPTVPlayerTV/1.0";
    public static volatile boolean trustAll = false;
    private static SSLSocketFactory trustAllFactory;

    public static final class Resp {
        public int code;
        public String contentType;
        public long length = -1;
        public String finalUrl;
        public InputStream body;
        HttpURLConnection conn;

        public void close() {
            try { if (body != null) body.close(); } catch (Throwable ignored) { }
            try { if (conn != null) conn.disconnect(); } catch (Throwable ignored) { }
        }

        public String text(int maxBytes) throws IOException {
            return new String(bytes(maxBytes), "UTF-8");
        }

        public byte[] bytes(int maxBytes) throws IOException {
            ByteArrayOutputStream bo = new ByteArrayOutputStream(16384);
            byte[] b = new byte[16384];
            int n, total = 0;
            while ((n = body.read(b)) > 0) {
                total += n;
                if (total > maxBytes) throw new IOException("Response too large");
                bo.write(b, 0, n);
            }
            return bo.toByteArray();
        }
    }

    public static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            return s;
        }
    }

    private static synchronized SSLSocketFactory lenientFactory() throws IOException {
        if (trustAllFactory == null) {
            try {
                TrustManager[] tm = new TrustManager[]{new X509TrustManager() {
                    public void checkClientTrusted(X509Certificate[] c, String a) { }
                    public void checkServerTrusted(X509Certificate[] c, String a) { }
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }};
                SSLContext ctx = SSLContext.getInstance("TLS");
                ctx.init(null, tm, new SecureRandom());
                trustAllFactory = ctx.getSocketFactory();
            } catch (Exception e) {
                throw new IOException("TLS setup failed: " + e.getMessage());
            }
        }
        return trustAllFactory;
    }

    private static SSLSocketFactory platformFactory;
    private static HostnameVerifier platformVerifier;

    /**
     * Applies "allow all certificates" to every HTTPS connection in the app, including the
     * ones the system video player opens for streams (it uses HttpURLConnection in our process).
     */
    public static synchronized void setTrustAll(boolean on) {
        trustAll = on;
        try {
            if (platformFactory == null) {
                platformFactory = HttpsURLConnection.getDefaultSSLSocketFactory();
                platformVerifier = HttpsURLConnection.getDefaultHostnameVerifier();
            }
            if (on) {
                HttpsURLConnection.setDefaultSSLSocketFactory(lenientFactory());
                HttpsURLConnection.setDefaultHostnameVerifier(new HostnameVerifier() {
                    public boolean verify(String h, SSLSession s) { return true; }
                });
            } else {
                HttpsURLConnection.setDefaultSSLSocketFactory(platformFactory);
                HttpsURLConnection.setDefaultHostnameVerifier(platformVerifier);
            }
        } catch (Throwable ignored) { }
    }

    public static Resp get(String url, String ua, int connectMs, int readMs) throws IOException {
        return get(url, ua, connectMs, readMs, null);
    }

    public static Resp get(String url, String ua, int connectMs, int readMs, Map<String, String> headers) throws IOException {
        String cur = url;
        for (int hop = 0; hop < 8; hop++) {
            URL u = new URL(cur);
            String proto = u.getProtocol();
            if (!"http".equals(proto) && !"https".equals(proto)) throw new IOException("Unsupported link: " + proto);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            if (trustAll && c instanceof HttpsURLConnection) {
                HttpsURLConnection hc = (HttpsURLConnection) c;
                hc.setSSLSocketFactory(lenientFactory());
                hc.setHostnameVerifier(new HostnameVerifier() {
                    public boolean verify(String h, SSLSession s) { return true; }
                });
            }
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setUseCaches(false);
            c.setRequestProperty("User-Agent", ua == null || ua.length() == 0 ? defaultUa : ua);
            c.setRequestProperty("Accept", "*/*");
            c.setRequestProperty("Accept-Encoding", "gzip");
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getValue() != null && e.getValue().length() > 0) c.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            int code;
            try {
                code = c.getResponseCode();
            } catch (IOException e) {
                c.disconnect();
                throw e;
            }
            if (code >= 300 && code < 400 && code != 304) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null || loc.length() == 0) throw new IOException("Redirect without location");
                cur = new URL(u, loc).toString();
                continue;
            }
            Resp r = new Resp();
            r.code = code;
            r.conn = c;
            r.finalUrl = cur;
            r.contentType = c.getContentType();
            String cl = c.getHeaderField("Content-Length");
            boolean gz = "gzip".equalsIgnoreCase(c.getContentEncoding());
            if (cl != null && !gz) {
                try { r.length = Long.parseLong(cl.trim()); } catch (NumberFormatException ignored) { }
            }
            InputStream is;
            try {
                is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            } catch (IOException e) {
                is = null;
            }
            if (is == null) is = new ByteArrayInputStream(new byte[0]);
            if (gz) is = new GZIPInputStream(is, 16384);
            r.body = is;
            return r;
        }
        throw new IOException("Too many redirects");
    }

    /** Wraps a stream so that gzip content is transparently inflated (by magic bytes). */
    public static InputStream maybeGunzip(InputStream in) throws IOException {
        BufferedInputStream b = new BufferedInputStream(in, 65536);
        b.mark(4);
        int a = b.read(), c = b.read();
        b.reset();
        if (a == 0x1f && c == 0x8b) return new GZIPInputStream(b, 65536);
        return b;
    }

    /** Human readable message for network failures. */
    public static String describe(Throwable t) {
        String n = t.getClass().getSimpleName();
        String m = t.getMessage() == null ? "" : t.getMessage();
        if (n.contains("UnknownHost")) return "Server not found. Check the address.";
        if (n.contains("ConnectException")) return "The server refused the connection. Check the address and port.";
        if (n.contains("SocketTimeout")) return "The server took too long to respond.";
        if (n.contains("SSL") || m.contains("Certificate") || m.contains("certificate") || n.contains("Certificate"))
            return "Secure connection failed. Turn on 'Allow all certificates' in Settings if your provider uses HTTPS.";
        if (m.length() == 0) return n;
        return m;
    }
}
