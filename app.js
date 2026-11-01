const $ = (id) => document.getElementById(id);

const PDF = ".pdf,application/pdf";
const MIME = {
  pdf: "application/pdf",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const TOOLS = {
  unlock: { title: "Unlock", accept: ".pdf,.docx,.xlsx,.pptx,.zip,application/pdf,application/zip", pick: "Choose a file", types: "PDF, Word, Excel, PowerPoint or ZIP", action: "Unlock", busy: "Unlocking…", done: "Unlocked", focus: "password", run: runUnlock },
  lock: { title: "Lock PDF", accept: PDF, pick: "Choose a PDF", action: "Lock", busy: "Locking…", done: "Locked", focus: "lock-password", openPdf: true, run: runLock },
  merge: { title: "Merge PDFs", accept: PDF, multiple: true, pick: "Choose PDFs", types: "Pick 2 or more", action: "Merge", busy: "Merging…", done: "Merged", openPdf: true, run: runMerge },
  pages: { title: "Pages", accept: PDF, pick: "Choose a PDF", action: "Save PDF", busy: "Saving…", done: "Pages saved", focus: "range", openPdf: true, run: runPages },
  rotate: { title: "Rotate", accept: PDF, pick: "Choose a PDF", action: "Rotate", busy: "Rotating…", done: "Rotated", openPdf: true, run: runRotate },
  photos: { title: "Photos → PDF", accept: "image/*", multiple: true, pick: "Choose photos", types: "Receipts, documents, IDs", action: "Create PDF", busy: "Creating…", done: "PDF created", run: runPhotos },
};

// Errors meant for the user; `field` is the input to mark as invalid.
class UserError extends Error {
  constructor(message, field) { super(message); this.field = field; }
}

let tool = null;
let files = []; // [{ file, pages?, url? }]
let result = null;

// ---------- engines ----------

// A fresh qpdf instance per run, so nothing from a previous file stays in memory.
// qpdf binds console.log/error when an instance is created, so swapping them here captures only this run's output.
async function runQpdf(inputs, args) {
  const out = [], err = [];
  const { log, error } = console;
  console.log = (s) => out.push(s);
  console.error = (s) => err.push(s);
  let qpdf;
  try { qpdf = await Module({ locateFile: () => "vendor/qpdf.wasm", noInitialRun: true }); }
  finally { console.log = log; console.error = error; }
  for (const [name, bytes] of Object.entries(inputs)) qpdf.FS.writeFile("/" + name, bytes);
  let code;
  try { code = qpdf.callMain(args); } catch (e) { code = e.status ?? 2; }
  // qpdf exit codes: 0 ok, 3 ok with warnings, 2 error
  const ok = code === 0 || code === 3;
  let bytes = null;
  if (ok) try { bytes = qpdf.FS.readFile("/out.pdf"); } catch {}
  return { ok, out: out.join("\n"), err: err.join("\n"), bytes };
}

function pdfError(r, field, pages) {
  if (/invalid password/.test(r.err)) return new UserError("Wrong password.", "password");
  const n = r.err.match(/number (\d+) out of range/);
  if (n) return new UserError(`Page ${n[1]} doesn't exist. This PDF has ${pages} page${pages === 1 ? "" : "s"}.`, field);
  if (field && /range|page/i.test(r.err)) return new UserError("Use page numbers like 1-3, 5.", field);
  return new UserError("This file isn't a valid PDF.");
}

async function pdfInfo(file) {
  const r = await runQpdf({ "in.pdf": await bytesOf(file) }, ["--show-npages", "/in.pdf"]);
  if (r.ok) return { pages: parseInt(r.out, 10) };
  return { locked: /invalid password/.test(r.err) };
}

const scripts = {};
function loadScript(src) {
  return (scripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  }));
}

async function unlockOffice(file, password) {
  const { decrypt, isEncrypted } = await import("./vendor/officecrypto.js");
  const bytes = await bytesOf(file);
  if (!isEncrypted(bytes)) throw new UserError("This file isn't password-protected.");
  try { return await decrypt(bytes, password); }
  catch (e) { if (/password/i.test(e.message)) throw new UserError("Wrong password.", "password"); throw e; }
}

async function unlockZip(file, password) {
  await loadScript("vendor/zip-native.min.js");
  const { ZipReader, ZipWriter, BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, configure } = window.zip;
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file), { password });
  const writer = new ZipWriter(new BlobWriter(MIME.zip));
  try {
    const entries = await reader.getEntries();
    if (!entries.some((e) => e.encrypted)) throw new UserError("This ZIP isn't password-protected.");
    for (const e of entries) {
      if (e.directory) await writer.add(e.filename, undefined, { directory: true, lastModDate: e.lastModDate });
      else await writer.add(e.filename, new Uint8ArrayReader(await e.getData(new Uint8ArrayWriter())), { lastModDate: e.lastModDate });
    }
  } catch (e) {
    if (!(e instanceof UserError) && /password/i.test(e.message)) throw new UserError("Wrong password.", "password");
    throw e;
  } finally {
    await reader.close();
  }
  return writer.close();
}

// Phone photos are large; 2000px on the long side is plenty for a readable A4 page.
const MAX_SIDE = 2000;
async function toJpeg(url, name) {
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { throw new UserError(`Couldn't read "${name}". Try a JPG or PNG.`); }
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- tools ----------

async function runUnlock() {
  const { file } = files[0];
  const password = $("password").value;
  const ext = extOf(file.name);
  if (ext === "pdf") {
    const args = ["--decrypt", "/in.pdf", "/out.pdf"];
    if (password) args.unshift("--password=" + password);
    const r = await runQpdf({ "in.pdf": await bytesOf(file) }, args);
    if (!r.ok) throw pdfError(r);
    return output(r.bytes, file, "-unlocked");
  }
  if (!password) throw new UserError("Enter the file's password.", "password");
  const data = ext === "zip" ? await unlockZip(file, password) : await unlockOffice(file, password);
  return output(data, file, "-unlocked");
}

async function runLock() {
  const password = $("lock-password").value;
  if (!password) throw new UserError("Enter a password.", "lock-password");
  if (password !== $("lock-confirm").value) throw new UserError("The passwords don't match.", "lock-confirm");
  const { file } = files[0];
  const r = await runQpdf({ "in.pdf": await bytesOf(file) }, ["/in.pdf", "--encrypt", password, password, "256", "--", "/out.pdf"]);
  if (!r.ok) throw pdfError(r);
  return output(r.bytes, file, "-locked");
}

async function runMerge() {
  if (files.length < 2) throw new UserError("Add at least 2 PDFs to merge.");
  const inputs = {}, pages = [];
  for (const [i, { file }] of files.entries()) {
    inputs[`in${i}.pdf`] = await bytesOf(file);
    pages.push(`/in${i}.pdf`, "1-z");
  }
  const r = await runQpdf(inputs, ["--empty", "--pages", ...pages, "--", "/out.pdf"]);
  if (!r.ok) throw pdfError(r);
  return new File([r.bytes], "merged.pdf", { type: MIME.pdf });
}

async function runPages() {
  const range = cleanRange($("range").value);
  if (!range) throw new UserError("Enter the pages, like 1-3, 5.", "range");
  const keep = document.querySelector("input[name=pages-mode]:checked").value === "keep";
  // qpdf excludes pages with an "x" prefix: "1-z,x2-3" is every page except 2-3.
  const selection = keep ? range : "1-z," + range.split(",").map((p) => "x" + p).join(",");
  const { file, pages } = files[0];
  const r = await runQpdf({ "in.pdf": await bytesOf(file) }, ["--decrypt", "/in.pdf", "--pages", ".", selection, "--", "/out.pdf"]);
  if (!r.ok) throw pdfError(r, "range", pages);
  const left = await runQpdf({ "in.pdf": r.bytes }, ["--show-npages", "/in.pdf"]);
  if (left.out.trim() === "0") throw new UserError("That would remove every page.", "range");
  return output(r.bytes, file, keep ? "-pages" : "-trimmed");
}

async function runRotate() {
  const range = cleanRange($("rotate-range").value);
  const angle = document.querySelector("input[name=angle]:checked").value;
  const { file, pages } = files[0];
  const r = await runQpdf({ "in.pdf": await bytesOf(file) }, ["--decrypt", "/in.pdf", `--rotate=${angle}${range ? ":" + range : ""}`, "/out.pdf"]);
  if (!r.ok) throw pdfError(r, "rotate-range", pages);
  return output(r.bytes, file, "-rotated");
}

async function runPhotos() {
  const { PDFDocument } = await import("./vendor/pdf-lib.esm.min.js");
  const doc = await PDFDocument.create();
  const margin = 18;
  for (const { file, url } of files) {
    const img = await doc.embedJpg(await toJpeg(url, file.name));
    // A4 in points, turned to match the photo
    const [w, h] = img.width > img.height ? [842, 595] : [595, 842];
    const scale = Math.min((w - 2 * margin) / img.width, (h - 2 * margin) / img.height);
    const [iw, ih] = [img.width * scale, img.height * scale];
    doc.addPage([w, h]).drawImage(img, { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih });
  }
  const date = new Date().toISOString().slice(0, 10);
  return new File([await doc.save()], `photos-${date}.pdf`, { type: MIME.pdf });
}

// ---------- helpers ----------

const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());
const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
const cleanRange = (s) => s.replace(/\s+/g, "").replace(/^,+|,+$/g, "");

function output(data, source, suffix) {
  const ext = extOf(source.name);
  const base = source.name.slice(0, source.name.length - ext.length - 1);
  return new File([data], `${base}${suffix}.${ext}`, { type: MIME[ext] });
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function accepts(file) {
  if (tool.id === "photos") return file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
  if (tool.id === "unlock") return ["pdf", "docx", "xlsx", "pptx", "zip"].includes(extOf(file.name));
  return file.type === "application/pdf" || extOf(file.name) === "pdf";
}

function setError(id, text, unlockLink = false) {
  const p = $(id);
  p.textContent = text;
  p.hidden = !text;
  if (unlockLink) {
    const a = document.createElement("a");
    a.href = "#unlock";
    a.textContent = "Unlock it first";
    p.append(" ", a, ".");
  }
}

function clearInvalid() {
  for (const el of document.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
  setError("opt-error", "");
}

function show(step) {
  for (const id of ["step-pick", "step-options", "step-done"]) $(id).hidden = id !== step;
}

function busy(on) {
  $("run").disabled = on;
  $("run-spinner").hidden = !on;
  $("run-label").textContent = on ? tool.busy : tool.action;
}

// ---------- screens ----------

function route() {
  const id = location.hash.slice(1);
  tool = TOOLS[id] ? { id, ...TOOLS[id] } : null;
  $("home").hidden = !!tool;
  $("tool").hidden = !tool;
  $("back").hidden = !tool;
  $("brand-icon").toggleAttribute("hidden", !!tool); // SVG elements have no .hidden property
  $("title").textContent = tool ? tool.title : "Private Doc Tools";
  document.title = tool ? `${tool.title} · Private Doc Tools` : "Private Doc Tools";
  if (tool) startTool();
}

function startTool() {
  for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
  files = [];
  result = null;
  const input = $("file");
  input.value = "";
  input.accept = tool.accept;
  input.multiple = !!tool.multiple;
  $("pick-title").textContent = tool.pick;
  $("pick-types").textContent = tool.types ?? "";
  for (const el of document.querySelectorAll("[data-tools]")) el.hidden = !el.dataset.tools.split(" ").includes(tool.id);
  for (const el of $("step-options").querySelectorAll(".input")) el.value = "";
  for (const el of document.querySelectorAll(".pw input")) el.type = "password";
  for (const el of document.querySelectorAll(".pw button")) {
    el.setAttribute("aria-pressed", "false");
    el.setAttribute("aria-label", "Show password");
  }
  clearInvalid();
  setError("pick-error", "");
  setError("done-error", "");
  busy(false);
  show("step-pick");
}

async function choose(list) {
  const picked = [...list];
  $("file").value = "";
  if (!picked.length) return;
  const errorId = $("step-pick").hidden ? "opt-error" : "pick-error";
  setError(errorId, "");
  const entries = [];
  for (const file of picked) {
    if (!accepts(file)) return setError(errorId, `"${file.name}" isn't a supported file.`);
    const entry = { file };
    if (tool.openPdf) {
      const info = await pdfInfo(file);
      if (info.locked) return setError(errorId, `"${file.name}" is locked.`, true);
      if (!info.pages) return setError(errorId, `"${file.name}" isn't a valid PDF.`);
      entry.pages = info.pages;
    }
    if (tool.id === "photos") entry.url = URL.createObjectURL(file);
    entries.push(entry);
  }
  files = tool.multiple ? files.concat(entries) : entries;
  renderFiles();
  show("step-options");
  if (tool.focus) $(tool.focus).focus();
}

function describe({ file, pages }) {
  return formatSize(file.size) + (pages ? ` · ${pages} page${pages === 1 ? "" : "s"}` : "");
}

function renderFiles() {
  if (!tool.multiple) {
    $("file-name").textContent = files[0].file.name;
    $("file-size").textContent = describe(files[0]);
    $("pw-hint").hidden = extOf(files[0].file.name) !== "pdf";
    return;
  }
  const items = files.map((f, i) => {
    const li = $("item-tpl").content.firstElementChild.cloneNode(true);
    li.dataset.index = i;
    const thumb = li.querySelector(".thumb");
    if (f.url) thumb.src = f.url; else thumb.remove();
    li.querySelector("strong").textContent = f.file.name;
    li.querySelector("span").textContent = describe(f);
    const [up, down, remove] = li.querySelectorAll("button");
    up.disabled = i === 0;
    down.disabled = i === files.length - 1;
    up.setAttribute("aria-label", `Move ${f.file.name} up`);
    down.setAttribute("aria-label", `Move ${f.file.name} down`);
    remove.setAttribute("aria-label", `Remove ${f.file.name}`);
    return li;
  });
  $("file-list").replaceChildren(...items);
}

// ---------- events ----------

$("file").addEventListener("change", () => choose($("file").files));

$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", (e) => {
  e.preventDefault();
  $("drop").classList.remove("over");
  choose(e.dataTransfer.files);
});

$("file-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const i = Number(btn.closest("li").dataset.index);
  if (btn.hasAttribute("data-remove")) {
    const [gone] = files.splice(i, 1);
    if (gone.url) URL.revokeObjectURL(gone.url);
    if (!files.length) return startTool();
  } else {
    const j = i + Number(btn.dataset.move);
    [files[i], files[j]] = [files[j], files[i]];
  }
  renderFiles();
});

$("add").addEventListener("click", () => $("file").click());
$("change").addEventListener("click", startTool);
$("again").addEventListener("click", startTool);

let fromHome = false;
addEventListener("hashchange", (e) => {
  fromHome = !new URL(e.oldURL).hash.slice(1);
  route();
});
// Go back through history when we came from Home, so the phone's Back button stays in step.
$("back").addEventListener("click", () => (fromHome ? history.back() : (location.hash = "")));

for (const btn of document.querySelectorAll(".pw button")) {
  btn.addEventListener("click", () => {
    const input = btn.previousElementSibling;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.setAttribute("aria-pressed", String(!showing));
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
}

$("step-options").addEventListener("input", clearInvalid);

$("step-options").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearInvalid();
  busy(true);
  try {
    result = await tool.run();
    $("lock-password").value = $("lock-confirm").value = $("password").value = "";
    $("done-title").textContent = tool.done;
    $("done-name").textContent = result.name;
    $("done-note").hidden = tool.id !== "lock";
    show("step-done");
    $("done-title").focus();
  } catch (err) {
    if (!(err instanceof UserError)) console.error(err);
    setError("opt-error", err instanceof UserError ? err.message : "Something went wrong. The file may be damaged.");
    if (err.field) {
      $(err.field).setAttribute("aria-invalid", "true");
      $(err.field).focus();
    }
  } finally {
    busy(false);
  }
});

function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(result);
  a.download = result.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$("share").addEventListener("click", async () => {
  if (navigator.canShare?.({ files: [result] })) {
    try { await navigator.share({ files: [result] }); } catch (e) { if (e.name !== "AbortError") setError("done-error", e.message); }
    return;
  }
  download();
});

$("download").addEventListener("click", download);

route();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
