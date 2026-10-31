# PDF Unlocker

**Live app: https://devmehta7.github.io/pdf-unlocker/**

Removes the password from a PDF entirely on your device. It runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly (`vendor/`, from `@neslinesli93/qpdf-wasm@0.3.0`) inside the browser. **The PDF and password are never sent anywhere.**

Works on iPhone, Android and desktop browsers.

## Add it to your Home Screen

**iPhone (Safari)**
1. Open the live link above in Safari.
2. Tap **Share** → **Add to Home Screen** → **Add**.

**Android (Chrome)**
1. Open the live link above in Chrome.
2. Tap the **⋮** menu → **Add to Home screen** (or **Install app**).

It then opens from its own icon like a normal app.

## Unlock a PDF

1. Pick a PDF and enter its password. Leave the password empty if the PDF opens without one and only blocks printing or copying.
2. Tap **Unlock**.
3. Save the unlocked copy:
   - **Share** opens your phone's share sheet. On iPhone choose **Save to Files**; on Android pick an app such as Drive.
   - **Download** saves straight to your Downloads folder (best on Android).

## Offline use

Open the app once while online. After that it works with no connection, even in airplane mode, because all its files are cached on your device. Updates show up from the second launch after a change.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Test files are in `test-fixtures/` (password: `secret`).

When you change any file, bump `CACHE` in `sw.js` so installed copies pick up the new version.
