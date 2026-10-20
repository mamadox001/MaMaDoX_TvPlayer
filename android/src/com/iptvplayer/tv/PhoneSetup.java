package com.iptvplayer.tv;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.Enumeration;

/** Tiny LAN web server: a phone on the same network fills a form and the playlist arrives on the TV. */
final class PhoneSetup implements Runnable {
    private final MainActivity act;
    private ServerSocket server;
    private volatile boolean running;
    private String address = "";

    PhoneSetup(MainActivity a) {
        act = a;
    }

    synchronized String start() throws IOException {
        if (running) return address;
        server = new ServerSocket();
        server.setReuseAddress(true);
        int[] ports = {8723, 8724, 8725, 0};
        IOException last = null;
        for (int p : ports) {
            try {
                server.bind(new InetSocketAddress(p));
                last = null;
                break;
            } catch (IOException e) {
                last = e;
                server.close();
                server = new ServerSocket();
                server.setReuseAddress(true);
            }
        }
        if (last != null) throw last;
        running = true;
        String ip = lanIp();
        address = ip == null ? "" : "http://" + ip + ":" + server.getLocalPort();
        Thread t = new Thread(this, "phone-setup");
        t.setDaemon(true);
        t.start();
        return address;
    }

    synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        server = null;
    }

    public void run() {
        ServerSocket ss = server;
        while (running && ss != null && !ss.isClosed()) {
            Socket s = null;
            try {
                s = ss.accept();
                s.setSoTimeout(10000);
                handle(s);
            } catch (Throwable t) {
                if (running) Log.w(MainActivity.TAG, "phone setup", t);
            } finally {
                try { if (s != null) s.close(); } catch (IOException ignored) { }
            }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.append((char) c);
            if (b.length() > 8192) throw new IOException("header too long");
        }
        return b.toString();
    }

    private void handle(Socket s) throws IOException {
        InputStream in = new BufferedInputStream(s.getInputStream());
        String request = readLine(in);
        int contentLength = 0;
        String line;
        while ((line = readLine(in)).length() > 0) {
            int c = line.indexOf(':');
            if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("content-length")) {
                try { contentLength = Integer.parseInt(line.substring(c + 1).trim()); } catch (Exception ignored) { }
            }
        }
        String[] parts = request.split(" ");
        if (parts.length < 2) return;
        String method = parts[0], path = parts[1];
        OutputStream out = s.getOutputStream();
        if ("POST".equals(method) && path.startsWith("/add")) {
            contentLength = Math.min(contentLength, 64 * 1024);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            while (bo.size() < contentLength) {
                int n = in.read(buf, 0, Math.min(buf.length, contentLength - bo.size()));
                if (n < 0) break;
                bo.write(buf, 0, n);
            }
            JSONObject data = new JSONObject();
            for (String kv : bo.toString("UTF-8").split("&")) {
                int eq = kv.indexOf('=');
                if (eq <= 0) continue;
                try {
                    data.put(URLDecoder.decode(kv.substring(0, eq), "UTF-8"), URLDecoder.decode(kv.substring(eq + 1), "UTF-8").trim());
                } catch (Exception ignored) { }
            }
            try {
                JSONObject ev = new JSONObject();
                ev.put("t", "phone");
                ev.put("data", data);
                act.emit(ev);
            } catch (Exception ignored) { }
            send(out, 200, page(true));
            return;
        }
        if ("GET".equals(method) && (path.equals("/") || path.startsWith("/?"))) {
            send(out, 200, page(false));
            return;
        }
        send(out, 404, "Not found");
    }

    private static void send(OutputStream out, int code, String body) throws IOException {
        byte[] b = body.getBytes("UTF-8");
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Not Found") + "\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "
                + b.length + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
        out.write(head.getBytes("UTF-8"));
        out.write(b);
        out.flush();
    }

    private static String page(boolean sent) {
        String css = "*{box-sizing:border-box}body{margin:0;background:#0E1B2C;color:#F4F0E6;font:17px/1.45 -apple-system,Roboto,Segoe UI,sans-serif;padding:24px 18px 40px}"
                + "h1{font-size:26px;margin:4px 0 6px}p{color:#97A6BF;margin:0 0 22px}label{display:block;font-size:14px;color:#97A6BF;margin:16px 0 6px}"
                + "input{width:100%;font-size:17px;padding:13px 14px;border-radius:12px;border:2px solid #2B466E;background:#142540;color:#F4F0E6;outline:none}"
                + "input:focus{border-color:#FFC83A}.seg{display:flex;background:#142540;border-radius:999px;padding:4px;margin-bottom:6px}"
                + ".seg label{flex:1;margin:0;text-align:center;padding:11px 0;border-radius:999px;color:#F4F0E6;font-size:16px;cursor:pointer}"
                + ".seg input{display:none}.seg input:checked+span{color:#0E1B2C}.seg label.on{background:#FFC83A;color:#0E1B2C}"
                + "button{margin-top:26px;width:100%;font-size:18px;font-weight:700;padding:15px;border:0;border-radius:999px;background:#FFC83A;color:#0E1B2C}"
                + ".bars{display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:18px;width:120px}.bars i{flex:1}"
                + ".ok{font-size:20px;margin-top:30px}";
        String bars = "<div class=bars><i style=background:#F4F0E6></i><i style=background:#FFC83A></i><i style=background:#48D6E0></i>"
                + "<i style=background:#5BD98C></i><i style=background:#D36BD9></i><i style=background:#FF5148></i><i style=background:#3B6FE0></i></div>";
        if (sent) {
            return "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>IPTV Player</title><style>" + css + "</style>"
                    + bars + "<h1>Sent to your TV</h1><p class=ok>Check the TV screen to confirm the playlist.</p>";
        }
        return "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>IPTV Player</title><style>" + css + "</style>"
                + bars + "<h1>Add a playlist to your TV</h1><p>Fill this in on your phone. The TV will ask you to confirm.</p>"
                + "<form method=post action=/add>"
                + "<div class=seg><label class=on id=lx><input type=radio name=type value=xtream checked onchange=sw()>Xtream Codes</label>"
                + "<label id=lm><input type=radio name=type value=m3u onchange=sw()>M3U link</label></div>"
                + "<label>Playlist name</label><input name=name placeholder='My IPTV' autocomplete=off>"
                + "<div id=x><label>Server address</label><input name=server inputmode=url placeholder='http://example.com:8080' autocapitalize=none autocorrect=off>"
                + "<label>Username</label><input name=user autocapitalize=none autocorrect=off autocomplete=off>"
                + "<label>Password</label><input name=pass autocapitalize=none autocorrect=off autocomplete=off></div>"
                + "<div id=m style=display:none><label>Playlist link (M3U)</label><input name=url inputmode=url placeholder='http://...' autocapitalize=none autocorrect=off>"
                + "<label>TV guide link (optional, XMLTV)</label><input name=epg inputmode=url placeholder='http://...xml' autocapitalize=none autocorrect=off></div>"
                + "<button type=submit>Send to TV</button></form>"
                + "<script>function sw(){var m=document.querySelector('input[value=m3u]').checked;document.getElementById('x').style.display=m?'none':'block';"
                + "document.getElementById('m').style.display=m?'block':'none';document.getElementById('lx').className=m?'':'on';document.getElementById('lm').className=m?'on':'';}</script>";
    }

    static String lanIp() {
        try {
            String fallback = null;
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs != null && ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    String n = ni.getName() == null ? "" : ni.getName();
                    if (a.isSiteLocalAddress() && (n.startsWith("eth") || n.startsWith("wlan"))) return a.getHostAddress();
                    if (a.isSiteLocalAddress() || fallback == null) fallback = a.getHostAddress();
                }
            }
            return fallback;
        } catch (Exception e) {
            return null;
        }
    }
}
