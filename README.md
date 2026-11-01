# Private Doc Tools

**Live app: https://devmehta7.github.io/pdf-unlocker/**

Everyday document tools that run entirely on your device. **Your files and passwords are never sent anywhere.**

| Tool | What it does |
|---|---|
| **Unlock** | Removes a known password from a PDF, Word, Excel or PowerPoint file (`.docx/.xlsx/.pptx`) or a ZIP |
| **Lock PDF** | Adds a password (AES-256) |
| **Merge PDFs** | Combines PDFs into one, in the order you choose |
| **Pages** | Keeps or removes pages, e.g. `1-3, 5` |
| **Rotate** | Turns all pages or some of them left, right or 180° |
| **Photos → PDF** | Turns photos of receipts, documents or IDs into one PDF |

Works on iPhone, Android and desktop browsers.

## Add it to your Home Screen

**iPhone (Safari)**
1. Open the live link above in Safari.
2. Tap **Share** → **Add to Home Screen** → **Add**.

**Android (Chrome)**
1. Open the live link above in Chrome.
2. Tap the **⋮** menu → **Add to Home screen** (or **Install app**).

It then opens from its own icon like a normal app.

## Using a tool

1. Pick a tool, then choose your file(s).
2. Fill in the options (password, pages, …) and tap the button.
3. Save the result:
   - **Share** opens your phone's share sheet. On iPhone choose **Save to Files**; on Android pick an app such as Drive.
   - **Download** saves straight to your Downloads folder (best on Android, and for Word, Excel and ZIP files).

For PDFs that open fine but block printing or copying, use **Unlock** with the password left empty.

## Offline use

Open the app once while online. After that it works with no connection, even in airplane mode, because all its files are cached on your device. Updates show up from the second launch after a change.

## How it works

Plain HTML and JavaScript (`index.html`, `app.js`), no framework and no build step. The libraries are pinned copies in `vendor/`:

| File | Library | Licence | Used for |
|---|---|---|---|
| `qpdf.js`, `qpdf.wasm` | [qpdf](https://github.com/qpdf/qpdf) via `@neslinesli93/qpdf-wasm@0.3.0` | Apache-2.0 / ISC | All PDF tools |
| `pdf-lib.esm.min.js` | `pdf-lib@1.17.1` | MIT | Photos → PDF |
| `zip-native.min.js` | `@zip.js/zip.js@2.24.0` | BSD-3-Clause | Unlock ZIP |
| `officecrypto.js` | `officecrypto-tool@0.0.19`, bundled for the browser | MIT | Unlock Word/Excel/PowerPoint |

The extra libraries load only when their tool is used.

`officecrypto.js` was bundled once, from a scratch folder, with this entry file (`entry.js`):

```js
import { Buffer } from "buffer";
import officeCrypto from "officecrypto-tool";
export async function decrypt(bytes, password) {
  return new Uint8Array(await officeCrypto.decrypt(Buffer.from(bytes), { password }));
}
export function isEncrypted(bytes) {
  return officeCrypto.isEncrypted(Buffer.from(bytes));
}
```

and a `shim.js` that exports `Buffer` (from `buffer`) and `process` (from `process`):

    npm i officecrypto-tool@0.0.19 esbuild@0.24.2 buffer@6.0.3 process@0.11.10 \
      crypto-browserify@3.12.1 stream-browserify@3.0.0 timers-browserify@2.0.12 events@3.3.0 util@0.12.5 string_decoder@1.3.0
    npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 \
      --alias:crypto=crypto-browserify --alias:stream=stream-browserify --alias:timers=timers-browserify \
      --inject:shim.js --define:global=globalThis --outfile=officecrypto.js

Old pre-2007 Office files (`.doc/.xls/.ppt`) aren't supported, because their cipher isn't available in the browser bundle.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000. Test files are in `test-fixtures/` (password: `secret`; all synthetic).

When you change any file, bump `CACHE` in `sw.js` so installed copies pick up the new version.
