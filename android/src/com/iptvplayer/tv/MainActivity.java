package com.iptvplayer.tv;

import android.app.Activity;
import android.content.ComponentCallbacks2;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;

public class MainActivity extends Activity {
    static final String TAG = "IPTVPlayer";
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final int REQ_VOICE = 41;

    FrameLayout root;
    WebView web;
    PlayerHost player;
    Bridge bridge;
    AppServer server;
    final Handler ui = new Handler(Looper.getMainLooper());
    volatile boolean keyPassthrough = false;
    volatile boolean pageReady = false;
    private boolean started = false;
    private final ArrayList<String> pendingEvents = new ArrayList<>();
    private TextView notice;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        root = new FrameLayout(this);
        root.setBackgroundResource(R.drawable.launch);
        server = new AppServer(this);
        player = new PlayerHost(this, root);
        bridge = new Bridge(this);
        setContentView(root);
        immersive();
        if (!createWebView()) return;
    }

    private boolean createWebView() {
        pageReady = false;
        try {
            web = new WebView(this);
        } catch (Throwable t) {
            Log.e(TAG, "WebView unavailable", t);
            showNotice("Android System WebView is missing or being updated.\n\nUpdate \"Android System WebView\" from the Play Store, then open IPTV Player again.");
            return false;
        }
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setMinimumFontSize(1);
        s.setMinimumLogicalFontSize(1);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " IPTVPlayerTV/" + BuildInfo.VERSION);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.addJavascriptInterface(bridge, "AndroidNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "js: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl(ORIGIN + "/index.html");
        web.requestFocus();
        ui.removeCallbacks(readyWatchdog);
        ui.postDelayed(readyWatchdog, 30000);
        return true;
    }

    /** The page never said it was ready: say so instead of showing the launch screen forever. */
    private final Runnable readyWatchdog = new Runnable() {
        public void run() {
            if (!pageReady && web != null) {
                showNotice("IPTV Player could not start its interface.\n\nUpdate \"Android System WebView\" from the Play Store, then open IPTV Player again.\n\nPress Back to close.");
            }
        }
    };

    private void showNotice(String text) {
        if (notice == null) {
            notice = new TextView(this);
            notice.setTextColor(Color.WHITE);
            notice.setBackgroundColor(0xFF0E1B2C);
            notice.setTextSize(22);
            notice.setGravity(Gravity.CENTER);
            notice.setPadding(120, 80, 120, 80);
            root.addView(notice, new FrameLayout.LayoutParams(-1, -1));
        }
        notice.setText(text);
    }

    /** Called by the page once its first screen is drawn. */
    void onPageReady() {
        ui.post(new Runnable() {
            public void run() {
                pageReady = true;
                ui.removeCallbacks(readyWatchdog);
                if (notice != null) {
                    root.removeView(notice);
                    notice = null;
                }
                root.setBackgroundColor(Color.BLACK);
                player.setFrameBackground(true);
                synchronized (pendingEvents) {
                    for (String e : pendingEvents) evalEvent(e);
                    pendingEvents.clear();
                }
            }
        });
    }

    final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            return server.handle(r.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            return url == null || !url.startsWith(ORIGIN);
        }

        /** API 26+: the renderer died (usually memory pressure). Rebuild instead of crashing. */
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
            Log.w(TAG, "WebView renderer gone, recreating");
            if (v == web) {
                try { root.removeView(web); } catch (Throwable ignored) { }
                try { web.destroy(); } catch (Throwable ignored) { }
                web = null;
                player.stop();
                ui.postDelayed(new Runnable() { public void run() { createWebView(); } }, 300);
            }
            return true;
        }
    }

    // ---------------------------------------------------------------- events to JS

    void emit(final JSONObject o) {
        final String json = o.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        ui.post(new Runnable() {
            public void run() {
                if (!pageReady) {
                    synchronized (pendingEvents) {
                        if (pendingEvents.size() < 50) pendingEvents.add(json);
                    }
                    return;
                }
                evalEvent(json);
            }
        });
    }

    private void evalEvent(String json) {
        if (web == null) return;
        try {
            web.evaluateJavascript("window.__native&&window.__native(" + json + ")", null);
        } catch (Throwable t) {
            Log.w(TAG, "eval failed", t);
        }
    }

    // ---------------------------------------------------------------- keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (isSystemKey(code)) return super.dispatchKeyEvent(e);
        if (web == null || !pageReady) {
            if (code == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) {
                finish();
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
        if (keyPassthrough && code != KeyEvent.KEYCODE_BACK && code != KeyEvent.KEYCODE_ESCAPE) {
            return super.dispatchKeyEvent(e);
        }
        String name = keyName(code, e);
        if (name == null) return super.dispatchKeyEvent(e);
        int action = e.getAction();
        if (action == KeyEvent.ACTION_DOWN) sendKey(name, "down", e.getRepeatCount());
        else if (action == KeyEvent.ACTION_UP) sendKey(name, "up", 0);
        else if (action == KeyEvent.ACTION_MULTIPLE) {
            String chars = e.getCharacters();
            if (chars != null) for (int i = 0; i < chars.length(); i++) sendKey("char:" + chars.charAt(i), "down", 0);
        }
        return true;
    }

    private void sendKey(String name, String type, int repeat) {
        if (web == null) return;
        web.evaluateJavascript("window.__key&&window.__key(" + JSONObject.quote(name) + ",'" + type + "'," + repeat + ")", null);
    }

    private static boolean isSystemKey(int c) {
        switch (c) {
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_VOLUME_MUTE:
            case KeyEvent.KEYCODE_MUTE:
            case KeyEvent.KEYCODE_POWER:
            case KeyEvent.KEYCODE_HOME:
            case KeyEvent.KEYCODE_SETTINGS:
            case KeyEvent.KEYCODE_TV_INPUT:
            case KeyEvent.KEYCODE_TV_POWER:
            case KeyEvent.KEYCODE_APP_SWITCH:
            case KeyEvent.KEYCODE_SLEEP:
            case KeyEvent.KEYCODE_WAKEUP:
            case KeyEvent.KEYCODE_ASSIST:
            case KeyEvent.KEYCODE_VOICE_ASSIST:
            case 284: // KEYCODE_ALL_APPS
            case 283: // KEYCODE_NOTIFICATION
                return true;
            default:
                return false;
        }
    }

    private static String keyName(int c, KeyEvent e) {
        switch (c) {
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_BUTTON_SELECT:
                return "ok";
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_BUTTON_B:
                return "back";
            case KeyEvent.KEYCODE_DEL: return "del";
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_BUTTON_START:
            case KeyEvent.KEYCODE_BUTTON_Y:
                return "menu";
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_BUTTON_X:
                return "info";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "stop";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case 272: // MEDIA_SKIP_FORWARD
            case 274: // MEDIA_STEP_FORWARD
            case KeyEvent.KEYCODE_BUTTON_R1:
                return "ff";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case 273: // MEDIA_SKIP_BACKWARD
            case 275: // MEDIA_STEP_BACKWARD
            case KeyEvent.KEYCODE_BUTTON_L1:
                return "rew";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "next";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "prev";
            case KeyEvent.KEYCODE_CHANNEL_UP: return "chup";
            case KeyEvent.KEYCODE_CHANNEL_DOWN: return "chdown";
            case KeyEvent.KEYCODE_PAGE_UP: return "pgup";
            case KeyEvent.KEYCODE_PAGE_DOWN: return "pgdown";
            case KeyEvent.KEYCODE_PROG_RED: return "red";
            case KeyEvent.KEYCODE_PROG_GREEN: return "green";
            case KeyEvent.KEYCODE_PROG_YELLOW: return "yellow";
            case KeyEvent.KEYCODE_PROG_BLUE: return "blue";
            case KeyEvent.KEYCODE_GUIDE: return "guide";
            case KeyEvent.KEYCODE_LAST_CHANNEL: return "last";
            case KeyEvent.KEYCODE_CAPTIONS: return "subs";
            case KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK: return "audio";
            case KeyEvent.KEYCODE_SEARCH: return "search";
            case KeyEvent.KEYCODE_BOOKMARK: return "fav";
            case 255: return "zoom"; // TV_ZOOM_MODE
            case KeyEvent.KEYCODE_TAB: return "tab";
            case KeyEvent.KEYCODE_FORWARD_DEL: return "del";
            case KeyEvent.KEYCODE_MOVE_HOME: return "home";
            case KeyEvent.KEYCODE_MOVE_END: return "end";
            default:
                break;
        }
        if (c >= KeyEvent.KEYCODE_0 && c <= KeyEvent.KEYCODE_9) return "digit:" + (c - KeyEvent.KEYCODE_0);
        if (c >= KeyEvent.KEYCODE_NUMPAD_0 && c <= KeyEvent.KEYCODE_NUMPAD_9) return "digit:" + (c - KeyEvent.KEYCODE_NUMPAD_0);
        int uc = e.getUnicodeChar();
        if (uc > 31 && uc != 127) return "char:" + (char) uc;
        return null;
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onStart() {
        super.onStart();
        if (started) emitLifecycle("resume");
        started = true;
    }

    @Override
    protected void onStop() {
        emitLifecycle("background");
        player.stopForBackground();
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        if (web != null) {
            web.onResume();
            web.requestFocus();
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(readyWatchdog);
        player.release();
        bridge.shutdown();
        if (web != null) {
            try {
                root.removeView(web);
                web.destroy();
            } catch (Throwable ignored) { }
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            try {
                JSONObject o = new JSONObject();
                o.put("t", "memory");
                o.put("level", level);
                emit(o);
            } catch (Exception ignored) { }
        }
    }

    private void emitLifecycle(String what) {
        try {
            JSONObject o = new JSONObject();
            o.put("t", "lifecycle");
            o.put("state", what);
            emit(o);
        } catch (Exception ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    void showSystemKeyboard(boolean show) {
        if (web == null) return;
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm == null) return;
            if (show) {
                web.requestFocus();
                imm.showSoftInput(web, 0);
            } else {
                imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
            }
        } catch (Throwable t) {
            Log.w(TAG, "keyboard", t);
        }
    }

    // ---------------------------------------------------------------- voice search

    boolean startVoiceSearch() {
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say a channel, movie or series");
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            startActivityForResult(i, REQ_VOICE);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_VOICE) return;
        String text = "";
        if (result == RESULT_OK && data != null) {
            ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (r != null && !r.isEmpty()) text = r.get(0);
        }
        try {
            JSONObject o = new JSONObject();
            o.put("t", "voice");
            o.put("text", text);
            emit(o);
        } catch (Exception ignored) { }
    }
}
