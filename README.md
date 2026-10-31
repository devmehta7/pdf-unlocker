# PDF Unlocker

Removes the password from a PDF entirely on your device. It runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly (`vendor/`, from `@neslinesli93/qpdf-wasm@0.3.0`) inside the browser. The PDF and password are never sent anywhere.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Test files are in `test-fixtures/` (password: `secret`).

## Use on iPhone

1. Host the folder on any static HTTPS host (e.g. GitHub Pages).
2. Open the URL in Safari → Share → **Add to Home Screen**.
3. Open it, pick a PDF, enter the password, tap **Unlock**, then **Save unlocked PDF** → Save to Files.

After the first load it works offline. When you change any file, bump `CACHE` in `sw.js`.
