package com.iptvplayer.tv;

import android.content.Context;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaFormat;
import android.media.MediaPlayer;
import android.media.TimedText;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/**
 * Hardware video playback with Android MediaPlayer on a SurfaceView that sits under
 * the transparent UI. All methods run on the UI thread unless noted.
 */
final class PlayerHost implements SurfaceHolder.Callback, MediaPlayer.OnPreparedListener, MediaPlayer.OnErrorListener,
        MediaPlayer.OnInfoListener, MediaPlayer.OnCompletionListener, MediaPlayer.OnVideoSizeChangedListener,
        MediaPlayer.OnBufferingUpdateListener, MediaPlayer.OnSeekCompleteListener, MediaPlayer.OnTimedTextListener,
        AudioManager.OnAudioFocusChangeListener {

    private final MainActivity act;
    private final FrameLayout frame;
    private final SurfaceView surface;
    private final AudioManager audio;
    private MediaPlayer mp;
    private boolean surfaceReady;
    private int session;
    private String state = "idle";
    private String url;
    private final Map<String, String> headers = new HashMap<>();
    private boolean live;
    private long startMs;
    private int videoW, videoH;
    private String aspect = "fit";
    private int[] rect; // x, y, w, h in device pixels; null = full screen
    private int bufferPct;
    private boolean buffering;
    private boolean prepared;
    private boolean userPaused;
    private float volume = 1f;
    private int retries;
    private int maxRetries;
    private boolean positionAdvances;
    private long lastPos = -1, lastPosAt, bufferingSince, preparedAt;
    private volatile String snapshot = "{\"state\":\"idle\"}";
    private boolean focusHeld;
    private boolean pausedByFocus;
    private boolean everPlayed;      // this stream reached "prepared" at least once
    private int startGen;            // invalidates queued starts
    private boolean waitingSurface;

    /**
     * MediaPlayer.release() can block for a long time on some boxes (a stuck HLS download),
     * so old players are released here, in order, and a new one starts only after that.
     */
    private static final ExecutorService RELEASER = Executors.newSingleThreadExecutor(new ThreadFactory() {
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "player-release");
            t.setDaemon(true);
            return t;
        }
    });

    PlayerHost(MainActivity a, FrameLayout root) {
        act = a;
        audio = (AudioManager) a.getSystemService(Context.AUDIO_SERVICE);
        frame = new FrameLayout(a);
        surface = new SurfaceView(a);
        surface.setFocusable(false);
        surface.getHolder().addCallback(this);
        frame.addView(surface, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        // The surface punches a hole through everything under it, so it only exists while something plays.
        surface.setVisibility(View.GONE);
        frame.setFocusable(false);
        root.addView(frame, new FrameLayout.LayoutParams(-1, -1, Gravity.TOP | Gravity.LEFT));
        // phones rotate: size the picture again whenever the video area changes size
        frame.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                if (r - l != or - ol || b - t != ob - ot) {
                    act.ui.post(new Runnable() { public void run() { layoutVideo(); } });
                }
            }
        });
    }

    void setFrameBackground(boolean black) {
        frame.setBackgroundColor(black ? Color.BLACK : Color.TRANSPARENT);
    }

    // ------------------------------------------------------------ commands

    void command(JSONObject c) {
        String cmd = c.optString("cmd");
        try {
            switch (cmd) {
                case "open": open(c); break;
                case "stop": stop(); break;
                case "pause": pause(true); break;
                case "resume": resume(); break;
                case "toggle": if ("paused".equals(state)) resume(); else pause(true); break;
                case "seek": seek(c.optLong("ms")); break;
                case "rect": setRect(c.optJSONArray("rect")); break;
                case "aspect": aspect = c.optString("mode", "fit"); layoutVideo(); break;
                case "volume": setVolume((float) c.optDouble("v", 1)); break;
                case "track": selectTrack(c.optInt("index", -1), c.optBoolean("on", true)); break;
                default: Log.w(MainActivity.TAG, "unknown player cmd " + cmd);
            }
        } catch (Throwable t) {
            Log.e(MainActivity.TAG, "player " + cmd, t);
        }
    }

    private void open(JSONObject o) {
        releasePlayer();
        session = o.optInt("session", session + 1);
        url = o.optString("url");
        live = o.optBoolean("live", false);
        startMs = o.optLong("start", 0);
        volume = o.optBoolean("muted", false) ? 0f : 1f;
        headers.clear();
        JSONObject h = o.optJSONObject("headers");
        if (h != null) {
            Iterator<String> it = h.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = h.optString(k, "");
                if (v.length() > 0) headers.put(k, v);
            }
        }
        if (o.has("rect")) setRect(o.optJSONArray("rect"));
        if (o.has("aspect")) aspect = o.optString("aspect", "fit");
        retries = 0;
        everPlayed = false;
        videoW = videoH = 0;
        userPaused = false;
        layoutVideo();
        showSurface(true);
        setState("preparing");
        scheduleStart();
    }

    private void showSurface(boolean on) {
        int v = on ? View.VISIBLE : View.GONE;
        if (surface.getVisibility() != v) surface.setVisibility(v);
    }

    /** Starts a new player once every older one is released and the video surface exists. */
    private void scheduleStart() {
        final int gen = ++startGen;
        RELEASER.execute(new Runnable() {
            public void run() {
                act.ui.post(new Runnable() {
                    public void run() {
                        if (gen != startGen || mp != null || url == null) return;
                        if (surfaceReady || surface.getVisibility() != View.VISIBLE) {
                            startPlayer();
                            return;
                        }
                        waitingSurface = true;
                        act.ui.removeCallbacks(surfaceTimeout);
                        act.ui.postDelayed(surfaceTimeout, 800);
                    }
                });
            }
        });
    }

    private final Runnable surfaceTimeout = new Runnable() {
        public void run() {
            if (!waitingSurface) return;
            waitingSurface = false;
            if (mp == null && url != null) startPlayer(); // the surface is attached when it arrives
        }
    };

    private void startPlayer() {
        prepared = false;
        buffering = false;
        positionAdvances = false;
        lastPos = -1;
        bufferPct = 0;
        try {
            mp = new MediaPlayer();
            mp.setOnPreparedListener(this);
            mp.setOnErrorListener(this);
            mp.setOnInfoListener(this);
            mp.setOnCompletionListener(this);
            mp.setOnVideoSizeChangedListener(this);
            mp.setOnBufferingUpdateListener(this);
            mp.setOnSeekCompleteListener(this);
            mp.setOnTimedTextListener(this);
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build());
            mp.setDataSource(act, Uri.parse(url), headers);
            if (surfaceReady) mp.setDisplay(surface.getHolder());
            mp.setScreenOnWhilePlaying(true);
            mp.setVolume(volume, volume);
            mp.prepareAsync();
            setState(retries > 0 ? "reconnecting" : "preparing");
            act.ui.removeCallbacks(ticker);
            act.ui.postDelayed(ticker, 500);
            act.ui.removeCallbacks(prepareTimeout);
            act.ui.postDelayed(prepareTimeout, live ? 15000 : 30000);
        } catch (Throwable t) {
            failure(-1, -1004, t.getMessage());
        }
    }

    private final Runnable prepareTimeout = new Runnable() {
        public void run() {
            if (mp != null && !prepared) failure(-110, 0, "timeout");
        }
    };

    void stop() {
        releasePlayer();
        url = null;
        showSurface(false);
        setState("idle");
        abandonFocus();
    }

    /** Activity went to the background: free the decoder and the connection. */
    void stopForBackground() {
        boolean was = mp != null || waitingSurface;
        releasePlayer();
        showSurface(false);
        if (was) setState("idle");
        abandonFocus();
    }

    void release() {
        releasePlayer();
        url = null;
        abandonFocus();
    }

    private void releasePlayer() {
        startGen++;
        waitingSurface = false;
        act.ui.removeCallbacks(surfaceTimeout);
        act.ui.removeCallbacks(ticker);
        act.ui.removeCallbacks(retry);
        act.ui.removeCallbacks(prepareTimeout);
        if (mp != null) {
            final MediaPlayer old = mp;
            mp = null;
            try { old.setDisplay(null); } catch (Throwable ignored) { }
            RELEASER.execute(new Runnable() {
                public void run() {
                    try { old.reset(); } catch (Throwable ignored) { }
                    try { old.release(); } catch (Throwable ignored) { }
                }
            });
        }
        prepared = false;
        keepScreenOn(false);
    }

    private void pause(boolean byUser) {
        if (mp != null && prepared) {
            try {
                if (mp.isPlaying()) mp.pause();
            } catch (Throwable ignored) { }
            userPaused = byUser;
            setState("paused");
            keepScreenOn(false);
        }
    }

    private void resume() {
        if (mp != null && prepared) {
            requestFocus();
            try { mp.start(); } catch (Throwable ignored) { }
            userPaused = false;
            lastPosAt = SystemClock.elapsedRealtime();
            setState("playing");
            keepScreenOn(true);
        } else if (mp == null && url != null && !"idle".equals(state)) {
            retries = 0;
            showSurface(true);
            setState("preparing");
            scheduleStart();
        }
    }

    private void seek(long ms) {
        if (mp != null && prepared && !live) {
            try {
                long dur = mp.getDuration();
                if (dur > 0) ms = Math.max(0, Math.min(ms, dur - 1000));
                mp.seekTo((int) ms);
                buffering = true;
                setState(state);
            } catch (Throwable ignored) { }
        } else if (!prepared && !live) {
            startMs = ms;
        }
    }

    private void setVolume(float v) {
        volume = Math.max(0f, Math.min(1f, v));
        if (mp != null) try { mp.setVolume(volume, volume); } catch (Throwable ignored) { }
    }

    private void setRect(JSONArray r) {
        if (r == null || r.length() < 4) rect = null;
        else rect = new int[]{r.optInt(0), r.optInt(1), Math.max(2, r.optInt(2)), Math.max(2, r.optInt(3))};
        FrameLayout.LayoutParams lp;
        if (rect == null) {
            lp = new FrameLayout.LayoutParams(-1, -1, Gravity.TOP | Gravity.LEFT);
        } else {
            lp = new FrameLayout.LayoutParams(rect[2], rect[3], Gravity.TOP | Gravity.LEFT);
            lp.leftMargin = rect[0];
            lp.topMargin = rect[1];
        }
        frame.setLayoutParams(lp);
        layoutVideo();
    }

    private void layoutVideo() {
        int cw, ch;
        if (rect != null) { cw = rect[2]; ch = rect[3]; }
        else {
            View root = (View) frame.getParent();
            cw = root.getWidth();
            ch = root.getHeight();
        }
        if (cw <= 0 || ch <= 0 || videoW <= 0 || videoH <= 0) {
            surface.setLayoutParams(new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
            return;
        }
        double va = (double) videoW / videoH;
        String mode = rect != null ? "fit" : aspect;
        if ("16:9".equals(mode)) va = 16.0 / 9.0;
        else if ("4:3".equals(mode)) va = 4.0 / 3.0;
        else if ("21:9".equals(mode)) va = 21.0 / 9.0;
        double ca = (double) cw / ch;
        int w, h;
        if ("stretch".equals(mode)) {
            w = cw; h = ch;
        } else if ("fill".equals(mode) || "zoom".equals(mode)) {
            if (ca > va) { w = cw; h = (int) Math.round(cw / va); } else { h = ch; w = (int) Math.round(ch * va); }
            if ("zoom".equals(mode)) { w = (int) (w * 1.12); h = (int) (h * 1.12); }
        } else {
            if (ca > va) { h = ch; w = (int) Math.round(ch * va); } else { w = cw; h = (int) Math.round(cw / va); }
        }
        surface.setLayoutParams(new FrameLayout.LayoutParams(Math.max(2, w), Math.max(2, h), Gravity.CENTER));
    }

    private void selectTrack(int index, boolean on) {
        if (mp == null || !prepared) return;
        try {
            if (on) mp.selectTrack(index);
            else mp.deselectTrack(index);
            if (!on) emitText("");
        } catch (Throwable t) {
            Log.w(MainActivity.TAG, "track " + index, t);
        }
    }

    /** Called from the JS bridge thread. */
    String tracksJson() {
        final String[] out = {"[]"};
        final CountDownLatch done = new CountDownLatch(1);
        act.ui.post(new Runnable() {
            public void run() {
                try { out[0] = buildTracks(); } catch (Throwable ignored) { }
                done.countDown();
            }
        });
        try { done.await(800, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { }
        return out[0];
    }

    private String buildTracks() throws Exception {
        JSONArray a = new JSONArray();
        if (mp == null || !prepared) return a.toString();
        MediaPlayer.TrackInfo[] info = mp.getTrackInfo();
        int selAudio = -1, selText = -1;
        try {
            selAudio = mp.getSelectedTrack(MediaPlayer.TrackInfo.MEDIA_TRACK_TYPE_AUDIO);
            selText = mp.getSelectedTrack(MediaPlayer.TrackInfo.MEDIA_TRACK_TYPE_TIMEDTEXT);
        } catch (Throwable ignored) { }
        for (int i = 0; i < info.length; i++) {
            int type = info[i].getTrackType();
            String kind;
            if (type == MediaPlayer.TrackInfo.MEDIA_TRACK_TYPE_AUDIO) kind = "audio";
            else if (type == MediaPlayer.TrackInfo.MEDIA_TRACK_TYPE_TIMEDTEXT || type == 4) kind = "text";
            else continue;
            JSONObject t = new JSONObject();
            t.put("index", i);
            t.put("kind", kind);
            t.put("lang", info[i].getLanguage() == null ? "" : info[i].getLanguage());
            t.put("selected", i == selAudio || i == selText);
            t.put("renderable", type != 4);
            try {
                MediaFormat f = info[i].getFormat();
                if (f != null) {
                    if (f.containsKey(MediaFormat.KEY_MIME)) t.put("mime", f.getString(MediaFormat.KEY_MIME));
                    if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) t.put("channels", f.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                }
            } catch (Throwable ignored) { }
            a.put(t);
        }
        return a.toString();
    }

    String status() { return snapshot; }

    // ------------------------------------------------------------ state + ticker

    private void setState(String s) {
        state = s;
        updateSnapshot();
        try {
            JSONObject o = new JSONObject();
            o.put("t", "player");
            o.put("ev", "state");
            o.put("session", session);
            o.put("state", s);
            o.put("buffering", buffering);
            act.emit(o);
        } catch (Exception ignored) { }
    }

    private void emit(String ev, JSONObject extra) {
        try {
            JSONObject o = extra == null ? new JSONObject() : extra;
            o.put("t", "player");
            o.put("ev", ev);
            o.put("session", session);
            act.emit(o);
        } catch (Exception ignored) { }
    }

    private void updateSnapshot() {
        try {
            JSONObject o = new JSONObject();
            o.put("session", session);
            o.put("state", state);
            o.put("buffering", buffering);
            o.put("live", live);
            o.put("w", videoW);
            o.put("h", videoH);
            o.put("buf", bufferPct);
            if (mp != null && prepared) {
                try {
                    o.put("pos", mp.getCurrentPosition());
                    o.put("dur", live ? 0 : Math.max(0, mp.getDuration()));
                } catch (Throwable ignored) { }
            } else {
                o.put("pos", startMs);
                o.put("dur", 0);
            }
            snapshot = o.toString();
        } catch (Exception ignored) { }
    }

    private final Runnable ticker = new Runnable() {
        public void run() {
            if (mp == null) return;
            updateSnapshot();
            long now = SystemClock.elapsedRealtime();
            if (prepared && "playing".equals(state)) {
                long pos = -1;
                try { pos = mp.getCurrentPosition(); } catch (Throwable ignored) { }
                if (pos >= 0) {
                    if (lastPos >= 0 && pos != lastPos) {
                        positionAdvances = true;
                        lastPosAt = now;
                    } else if (lastPos < 0) {
                        lastPosAt = now;
                    }
                    lastPos = pos;
                }
                // a stream that has played well for a while earns its retries back
                if (retries > 0 && positionAdvances && now - preparedAt > 30000) retries = 0;
                // watchdog: only trust it when we have seen the clock move on this stream
                if (positionAdvances && !userPaused && now - lastPosAt > (live ? 15000 : 30000)) {
                    Log.w(MainActivity.TAG, "playback stalled, reconnecting");
                    if (!live) startMs = Math.max(0, lastPos);
                    failure(-2, 0, "stalled");
                    return;
                }
                if (buffering && live && bufferingSince > 0 && now - bufferingSince > 25000) {
                    failure(-3, 0, "buffering too long");
                    return;
                }
            }
            act.ui.postDelayed(this, 500);
        }
    };

    private final Runnable retry = new Runnable() {
        public void run() {
            if (url != null) scheduleStart();
        }
    };

    private void failure(int what, int extra, String msg) {
        Log.w(MainActivity.TAG, "playback failure " + what + "/" + extra + " " + msg + " retries=" + retries);
        long resumeAt = 0;
        if (!live && mp != null && prepared) {
            try { resumeAt = mp.getCurrentPosition(); } catch (Throwable ignored) { }
        }
        releasePlayer();
        if (resumeAt > 0) startMs = resumeAt;
        // A stream that played and then dropped is worth several reconnects. One that never
        // started gets a short second chance (servers often still count the previous
        // connection right after zapping), then the page can try the other format quickly.
        if (everPlayed) maxRetries = live ? 5 : 3;
        else if (what == -110 || extra == MediaPlayer.MEDIA_ERROR_UNSUPPORTED || extra == MediaPlayer.MEDIA_ERROR_MALFORMED) maxRetries = 0;
        else maxRetries = live ? 2 : 1;
        if (retries < maxRetries) {
            retries++;
            setState("reconnecting");
            act.ui.postDelayed(retry, Math.min(8000, 1000L << (retries - 1)));
            return;
        }
        try {
            JSONObject o = new JSONObject();
            o.put("what", what);
            o.put("extra", extra);
            o.put("message", msg == null ? "" : msg);
            emit("error", o);
        } catch (Exception ignored) { }
        showSurface(false);
        setState("error");
        abandonFocus();
    }

    private void keepScreenOn(boolean on) {
        if (on) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (focusHeld) return;
        try {
            focusHeld = audio.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Throwable ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (!focusHeld) return;
        try { audio.abandonAudioFocus(this); } catch (Throwable ignored) { }
        focusHeld = false;
    }

    @Override
    public void onAudioFocusChange(int change) {
        if (mp == null || !prepared) return;
        try {
            if (change == AudioManager.AUDIOFOCUS_LOSS) {
                focusHeld = false;
                if (!live) { pause(false); pausedByFocus = true; } else mp.setVolume(0.15f, 0.15f);
            } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                if (!live && mp.isPlaying()) { pause(false); pausedByFocus = true; } else mp.setVolume(0.15f, 0.15f);
            } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                mp.setVolume(0.2f * volume, 0.2f * volume);
            } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                mp.setVolume(volume, volume);
                if (pausedByFocus) { pausedByFocus = false; resume(); }
            }
        } catch (Throwable ignored) { }
    }

    // ------------------------------------------------------------ MediaPlayer callbacks

    @Override
    public void onPrepared(MediaPlayer p) {
        if (p != mp) return;
        act.ui.removeCallbacks(prepareTimeout);
        prepared = true;
        everPlayed = true;
        try {
            if (!live && startMs > 1000) p.seekTo((int) startMs);
            requestFocus();
            p.setVolume(volume, volume);
            p.start();
            preparedAt = SystemClock.elapsedRealtime();
            lastPosAt = preparedAt;
            keepScreenOn(true);
            setState("playing");
            try {
                JSONObject o = new JSONObject();
                o.put("tracks", new JSONArray(buildTracks()));
                o.put("dur", live ? 0 : p.getDuration());
                emit("prepared", o);
            } catch (Throwable ignored) { }
        } catch (Throwable t) {
            failure(-1, -1007, t.getMessage());
        }
    }

    @Override
    public boolean onError(MediaPlayer p, int what, int extra) {
        if (p != mp) return true;
        failure(what, extra, "media error");
        return true;
    }

    @Override
    public boolean onInfo(MediaPlayer p, int what, int extra) {
        if (p != mp) return false;
        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
            buffering = true;
            bufferingSince = SystemClock.elapsedRealtime();
            setState(state);
        } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
            buffering = false;
            bufferingSince = 0;
            lastPosAt = SystemClock.elapsedRealtime();
            setState(state);
        } else if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
            buffering = false;
            emit("firstframe", null);
            setState(state);
        }
        return false;
    }

    @Override
    public void onCompletion(MediaPlayer p) {
        if (p != mp) return;
        if (live) {
            failure(-4, 0, "stream ended");
            return;
        }
        keepScreenOn(false);
        setState("ended");
    }

    @Override
    public void onVideoSizeChanged(MediaPlayer p, int w, int h) {
        if (p != mp || w <= 0 || h <= 0) return;
        videoW = w;
        videoH = h;
        layoutVideo();
        try {
            JSONObject o = new JSONObject();
            o.put("w", w);
            o.put("h", h);
            emit("size", o);
        } catch (Exception ignored) { }
    }

    @Override
    public void onBufferingUpdate(MediaPlayer p, int percent) {
        if (p == mp) bufferPct = percent;
    }

    @Override
    public void onSeekComplete(MediaPlayer p) {
        if (p != mp) return;
        buffering = false;
        lastPosAt = SystemClock.elapsedRealtime();
        emit("seeked", null);
        setState(state);
    }

    @Override
    public void onTimedText(MediaPlayer p, TimedText text) {
        if (p != mp) return;
        emitText(text == null || text.getText() == null ? "" : text.getText());
    }

    private void emitText(String s) {
        try {
            JSONObject o = new JSONObject();
            o.put("text", s);
            emit("text", o);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------ surface

    @Override
    public void surfaceCreated(SurfaceHolder h) {
        surfaceReady = true;
        if (mp != null) try { mp.setDisplay(h); } catch (Throwable ignored) { }
        if (waitingSurface) {
            waitingSurface = false;
            act.ui.removeCallbacks(surfaceTimeout);
            if (mp == null && url != null) startPlayer();
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder h, int format, int w, int hh) { }

    @Override
    public void surfaceDestroyed(SurfaceHolder h) {
        surfaceReady = false;
        if (mp != null) try { mp.setDisplay(null); } catch (Throwable ignored) { }
    }
}
