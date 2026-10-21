# MaMaDoX TvPlayer for Android TV and phones

A lightweight IPTV player for Android TV and Android TV boxes (Android 5.0 and newer).
It plays your own IPTV subscription from an **Xtream Codes** login or an **M3U link**,
with an XMLTV TV guide. The app does not include any channels.

There are two apps built from the same code: **MaMaDoX TvPlayer** for Android TV boxes
(remote control, landscape) and **MaMaDoX TvPlayer Phone** for Android phones (touch, portrait
lists with a full-screen landscape player). They install side by side. Each APK is about 200 KB.

There is also **MaMaDoX TvPlayer for Windows** (`desktop/`): the phone interface laid out for a
wide window, mouse and keyboard, packaged with Electron. It plays HLS and MPEG-TS live streams
(hls.js, mpegts.js). Unzip `MaMaDoX-TvPlayer-Windows.zip` and run `MaMaDoX TvPlayer.exe`.
In the player: Space pauses, Left/Right seek or change channel, Esc goes back, F11 toggles full screen.
Build it with `desktop/build-windows.sh`. Video plays in the TV's hardware decoder (Android MediaPlayer);
the interface is a web page inside the app, drawn by the TV's GPU.

## Features

- **Playlists**: Xtream Codes (server, username, password) and M3U/M3U8 links, several
  playlists side by side, automatic background updates, account expiry and connections.
- **Add from your phone**: the setup screen shows a QR code; scan it, fill in the form on the
  phone, confirm on the TV. No typing with the remote.
- **Live TV**: categories, favorites, recently watched, channel numbers, what is on now with
  progress, live preview window, programme list with catch-up (replay) where the server allows it.
- **Full-screen player**: zapping with Up/Down or CH+/CH−, channel list overlay, info banner,
  number entry, previous channel, audio and subtitle tracks, picture format (fit, fill, zoom,
  stretch, 16:9, 4:3), sleep timer. Live streams switch between HLS and MPEG-TS automatically
  when a channel does not start.
- **TV guide**: grid guide by category with a now line, catch-up marks and a live preview.
- **Movies and series**: poster grids with sorting, details, resume where you stopped,
  seasons and episodes, next episode autoplay, trailers (YouTube).
- **Search** across channels, movies and series, with voice search where the TV supports it.
- **Parental control**: adult categories locked with a PIN.
- **External player** option (VLC, MX Player…) for formats the TV cannot play.
- Settings for stream format, network identity (user agent), guide time shift, 12/24-hour
  clock, highlight color, reduced animations for slow boxes, cache size.

## Install on the TV

1. On the TV: **Settings → Device Preferences → Security & restrictions → Unknown sources**,
   and allow the app you will install with (a file manager, or *Downloader*).
2. Copy `MaMaDoX-TvPlayer-1.0.0.apk` to a USB stick, plug it into the TV and open it with a file
   manager — or send it with an app such as *Send Files to TV*.
3. Open **MaMaDoX TvPlayer** from the apps row, then add your playlist.

To update later, install a newer APK over the old one: your playlists and settings stay.

## Remote control

| Where | Key | Does |
| --- | --- | --- |
| Everywhere | Back | Go back (twice on Home to close the app) |
| Lists | Hold OK, or Menu | Options: favorites, guide, external player, sort |
| Live, full screen | Up / Down, CH+ / CH− | Previous / next channel |
| Live, full screen | OK or Left | Channel list |
| Live, full screen | Right or Info | What is on now and next |
| Live, full screen | 0–9 | Go to a channel number |
| Live, full screen | Hold OK, or Menu | Catch-up, audio, subtitles, picture, sleep timer, stream info |
| Live, full screen | Blue | Previous channel |
| Live | Yellow | Add or remove a favorite |
| Live | Guide | TV guide |
| Movies and series | Left / Right | Seek (hold to go faster) |

## Build from source

Requirements: Node.js 18+, a JDK (8 or newer) and the Android build tools `aapt`, `dx`
(`dalvik-exchange`), `zipalign`, `apksigner`, plus the Android API 23 `android.jar`.
On Debian/Ubuntu:

```sh
sudo apt install nodejs npm default-jdk-headless aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
npm install
./build.sh            # writes build/MaMaDoX-TvPlayer-<version>.apk and build/MaMaDoX-TvPlayer-Phone-<version>.apk
```

Raise `android:versionCode` and `android:versionName` in `android/AndroidManifest.xml`
before building an update.

**Signing key**: the APK is signed with `android/keys/release.p12` (password in
`android/keys/signing.txt`). The key is deliberately not in this repository; keep your own
copy and put both files in `android/keys/` before building. Android only installs an update
over the existing app when it is signed with the same key. Without them, `build.sh` creates a
new key, and that APK needs the old app uninstalled first.

## Project layout

```
android/
  AndroidManifest.xml, res/        app manifest, icons, TV banner, launch screen
  src/com/iptvplayer/tv/           Activity, WebView host, video player, local server, bridge
  core/com/iptvplayer/core/        streaming parsers: Xtream API, M3U, XMLTV, JSON, HTTP
  stubs/                           compile-only stubs for newer Android classes
  mobile/                          phone app manifest and theme (same Java code, MOBILE flag)
web/
  src/                             TV interface: screens, lists, player UI, data layer, styles
  mobile/                          phone interface (reuses the data layer and player from src/)
  build.mjs                        bundles the interface into android/assets/www
tools/
  mock/                            fake IPTV provider (Xtream API, M3U, XMLTV, test streams)
  dev/                             runs the interface in a desktop browser with the Java parsers
  test/                            remote-control UI tests and performance checks (Puppeteer)
build.sh                           builds and signs the APK
```

## Try it on a computer

```sh
# once: compile the parsers the dev host runs (needs kxml2: sudo apt install libkxml2-java)
cd android && javac -source 8 -target 8 -cp /usr/share/java/kxml2.jar -d ../tools/dev/cls $(find core devtools -name '*.java') && cd ..

PORT=8091 SCALE=large node tools/mock/server.mjs          # fake provider, login demo / demo123
PORT=8090 DATA=/tmp/iptv-data node tools/dev/server.mjs   # the app's native side, emulated
```

Open `http://127.0.0.1:8090` and use the arrow keys, Enter and Escape as the remote. Add a
playlist with server `http://127.0.0.1:8091`, username `demo`, password `demo123`.

The UI tests drive the same page with a simulated remote and save screenshots to `shots/`.
Start with an empty data folder and run `s1-setup` first, since it adds the test playlist:

```sh
node tools/test/s1-setup.mjs && node tools/test/s2-live.mjs && node tools/test/s3-vod.mjs \
  && node tools/test/s4-more.mjs && node tools/test/s5-m3u.mjs
node tools/test/perf.mjs     # key response times with the CPU slowed 6x
```
