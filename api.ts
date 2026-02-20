import { convertBytes, convertHtmlToMarkdown, isImageMime } from "./convert";
import { getTokenStats, checkLLMFit, formatLLMFit } from "./tokens";

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  ppt: "application/vnd.ms-powerpoint",
  xls: "application/vnd.ms-excel",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  xml: "application/xml",
  txt: "text/plain",
  eml: "message/rfc822",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  bmp: "image/bmp",
  gif: "image/gif",
  webp: "image/webp",
};

const SUPPORTED_FORMATS = Object.entries(MIME_MAP).map(([ext, mime]) => ({ ext, mime }));

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

async function handleConvert(req: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "Invalid request. Send multipart/form-data with a 'file' field." }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "No file uploaded. Send a 'file' field." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const rawMime = file.type || guessMime(file.name);
  const mime = rawMime.split(";")[0].trim();

  // Check for OCR options in form data
  const ocrEnabled = formData.get("ocr") === "true" || formData.get("ocr") === "1";
  const ocrForce = formData.get("ocr") === "force";
  const ocrLang = formData.get("ocr_lang") as string | null;
  // Auto-enable OCR for images
  const isImage = isImageMime(mime);
  const ocrOpts = (ocrEnabled || ocrForce || ocrLang)
    ? { enabled: true, force: ocrForce, language: ocrLang ?? undefined }
    : isImage
      ? { enabled: true, force: true }
      : undefined;

  try {
    const result = await convertBytes(bytes, mime, ocrOpts);
    const stats = getTokenStats(result.content);
    const fits = checkLLMFit(stats.tokens);
    return Response.json({
      content: result.content,
      filename: file.name,
      mimeType: result.mimeType,
      metadata: result.metadata,
      qualityScore: result.qualityScore ?? null,
      words: stats.words,
      tokens: stats.tokens,
      fits: fits.map((f) => ({ name: f.name, limit: f.limit, fits: f.fits })),
    });
  } catch (err: any) {
    return Response.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

async function handleConvertUrl(req: Request): Promise<Response> {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body. Send {\"url\": \"...\"}." }, { status: 400 });
  }

  const url = body.url;
  if (!url) {
    return Response.json({ error: "Missing 'url' field." }, { status: 400 });
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: `Fetch failed: ${res.status} ${res.statusText}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await res.arrayBuffer());

    let content: string;
    let mime = contentType.split(";")[0].trim();

    if (mime === "text/html" || mime === "application/xhtml+xml") {
      const html = new TextDecoder().decode(bytes);
      content = await convertHtmlToMarkdown(html);
      mime = "text/html";
    } else {
      const result = await convertBytes(bytes, mime || "application/octet-stream");
      content = result.content;
      mime = result.mimeType;
    }

    const stats = getTokenStats(content);
    const fits = checkLLMFit(stats.tokens);
    return Response.json({
      content,
      url,
      mimeType: mime,
      words: stats.words,
      tokens: stats.tokens,
      fits: fits.map((f) => ({ name: f.name, limit: f.limit, fits: f.fits })),
    });
  } catch (err: any) {
    return Response.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

async function handleConvertClipboard(req: Request): Promise<Response> {
  let body: { html?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body. Send {"html": "...", "text": "..."}.' }, { status: 400 });
  }

  const html = body.html?.trim();
  const text = body.text?.trim();

  if (!html && !text) {
    return Response.json({ error: "Provide at least 'html' or 'text'." }, { status: 400 });
  }

  try {
    const content = html ? await convertHtmlToMarkdown(html) : text!;
    const stats = getTokenStats(content);
    const fits = checkLLMFit(stats.tokens);
    return Response.json({
      content,
      words: stats.words,
      tokens: stats.tokens,
      fits: fits.map((f) => ({ name: f.name, limit: f.limit, fits: f.fits })),
    });
  } catch (err: any) {
    return Response.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

function handleFormats(): Response {
  return Response.json({ formats: SUPPORTED_FORMATS });
}

function cors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function startServer(port = 3000): { stop: () => void } {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return cors(new Response(null, { status: 204 }));
      }

      if (url.pathname === "/" && req.method === "GET") {
        return cors(new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
      }

      if (url.pathname === "/convert" && req.method === "POST") {
        return cors(await handleConvert(req));
      }

      if (url.pathname === "/convert/url" && req.method === "POST") {
        return cors(await handleConvertUrl(req));
      }

      if (url.pathname === "/convert/clipboard" && req.method === "POST") {
        return cors(await handleConvertClipboard(req));
      }

      if (url.pathname === "/formats" && req.method === "GET") {
        return cors(handleFormats());
      }

      return cors(Response.json({ error: "Not found" }, { status: 404 }));
    },
  });

  console.log(`docs2llm server running at http://localhost:${port}`);
  return { stop: () => server.stop() };
}

// --- Inlined Web UI ---

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>docs2llm</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; display: flex; flex-direction: column; }
  header { padding: 1.5rem 2rem; border-bottom: 1px solid #262626; display: flex; align-items: center; gap: 1rem; }
  header h1 { font-size: 1.25rem; font-weight: 600; }
  header span { color: #737373; font-size: 0.875rem; }

  /* Toolbar */
  .toolbar { display: flex; gap: 0.5rem; padding: 0.75rem 2rem; border-bottom: 1px solid #262626; align-items: center; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: #262626; border: 1px solid #404040; border-radius: 6px; padding: 0.5rem 1rem; color: #e5e5e5; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
  .toolbar button:hover:not(:disabled) { background: #333; }
  .toolbar button:disabled { opacity: 0.35; cursor: default; }
  .toolbar button.primary { background: #e5e5e5; color: #0a0a0a; border-color: #e5e5e5; }
  .toolbar button.primary:hover:not(:disabled) { background: #d4d4d4; }
  .toolbar button.primary:disabled { background: #e5e5e5; }

  /* Stats */
  .stats { padding: 0.75rem 2rem; border-bottom: 1px solid #262626; font-size: 0.8rem; color: #a3a3a3; display: none; }
  .stats.visible { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: center; }
  .stat-pill { background: #171717; padding: 0.25rem 0.625rem; border-radius: 99px; }
  .fit-yes { color: #4ade80; }
  .fit-no { color: #f87171; }

  /* Content area */
  main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .content { flex: 1; overflow: auto; }

  /* Input view */
  .input-view { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100%; padding: 2rem; }
  .drop-zone { width: 100%; max-width: 600px; border: 2px dashed #262626; border-radius: 12px; padding: 3rem 2rem; display: flex; flex-direction: column; align-items: center; gap: 1rem; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
  .drop-zone:hover { border-color: #404040; }
  .drop-zone.over { background: #171717; border-color: #525252; }
  .drop-icon { font-size: 3rem; opacity: 0.3; }
  .drop-text { color: #737373; text-align: center; line-height: 1.6; }
  .drop-text a { color: #a3a3a3; text-decoration: underline; cursor: pointer; }

  .separator { display: flex; align-items: center; gap: 1rem; width: 100%; max-width: 600px; margin: 1.5rem 0; color: #525252; font-size: 0.8rem; }
  .separator::before, .separator::after { content: ""; flex: 1; border-top: 1px solid #262626; }

  .url-bar { display: flex; gap: 0.5rem; width: 100%; max-width: 600px; }
  .url-bar input { flex: 1; background: #171717; border: 1px solid #262626; border-radius: 6px; padding: 0.5rem 0.75rem; color: #e5e5e5; font-size: 0.875rem; outline: none; }
  .url-bar input:focus { border-color: #525252; }
  .url-bar button { background: #262626; border: 1px solid #404040; border-radius: 6px; padding: 0.5rem 1rem; color: #e5e5e5; font-size: 0.875rem; cursor: pointer; white-space: nowrap; }
  .url-bar button:hover { background: #333; }

  /* Output view */
  .output-view { display: none; padding: 2rem; }
  .output-view.visible { display: block; }
  .output-view pre { white-space: pre-wrap; word-wrap: break-word; font-family: "SF Mono", "Fira Code", monospace; font-size: 0.8125rem; line-height: 1.7; color: #d4d4d4; }

  /* Spinner */
  .spinner { display: none; }
  .spinner.visible { display: flex; align-items: center; gap: 0.5rem; color: #737373; font-size: 0.875rem; }
  .spinner::before { content: ""; width: 1rem; height: 1rem; border: 2px solid #404040; border-top-color: #e5e5e5; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Toast */
  .toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: #262626; border: 1px solid #404040; border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.8125rem; color: #e5e5e5; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }

  /* Source label */
  .source-label { padding: 0.5rem 2rem; border-bottom: 1px solid #262626; font-size: 0.8125rem; color: #a3a3a3; display: none; align-items: center; gap: 0.5rem; }
  .source-label.visible { display: flex; }
  .source-label .name { color: #e5e5e5; }
  .source-label .size { color: #737373; }

  input[type=file] { display: none; }
</style>
</head>
<body>

<header>
  <h1>docs2llm</h1>
  <span>Convert documents to LLM-friendly text</span>
</header>

<div class="toolbar">
  <button class="primary" id="btnCopy" disabled onclick="copyToClipboard()">Copy</button>
  <button id="btnDownload" disabled onclick="downloadMd()">Download .md</button>
  <button id="btnPaste" onclick="pasteFromClipboard()">Paste</button>
  <div class="spacer"></div>
  <button id="btnClear" disabled onclick="reset()">Clear</button>
</div>

<div class="source-label" id="sourceLabel">
  <span class="name" id="sourceName"></span>
  <span class="size" id="sourceSize"></span>
</div>

<div class="stats" id="stats"></div>

<main>
  <div class="content">
    <div class="input-view" id="inputView">
      <div class="drop-zone" id="dropZone" onclick="fileInput.click()">
        <div class="drop-icon">&#8595;</div>
        <div class="drop-text">
          Drop a file here or <a>browse</a><br>
          PDF, DOCX, PPTX, XLSX, images, and 70+ more formats
        </div>
        <div class="spinner" id="spinner">Converting&hellip;</div>
      </div>

      <div class="separator">or paste a URL</div>

      <div class="url-bar">
        <input type="text" id="urlInput" placeholder="https://example.com/page">
        <button onclick="convertUrl()">Convert URL</button>
      </div>
    </div>

    <div class="output-view" id="outputView">
      <pre id="outputText"></pre>
    </div>
  </div>
</main>

<input type="file" id="fileInput">
<div class="toast" id="toast"></div>

<script>
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const spinner = document.getElementById('spinner');
const inputView = document.getElementById('inputView');
const outputView = document.getElementById('outputView');
const outputText = document.getElementById('outputText');
const stats = document.getElementById('stats');
const sourceLabel = document.getElementById('sourceLabel');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const btnClear = document.getElementById('btnClear');
const toast = document.getElementById('toast');

let currentContent = '';
let currentFilename = 'output';

// Drag and drop
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
});

// Paste via Cmd+V / Ctrl+V
document.addEventListener('paste', async (e) => {
  // Don't intercept paste in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  const items = e.clipboardData;
  // 1. Check for files first
  if (items.files.length > 0) {
    uploadFile(items.files[0]);
    return;
  }
  // 2. Check for HTML
  const html = items.getData('text/html');
  if (html) {
    convertClipboard(html, null);
    return;
  }
  // 3. Fall back to plain text
  const text = items.getData('text/plain');
  if (text) {
    convertClipboard(null, text);
  }
});

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    // Check for files (image blobs)
    for (const item of items) {
      const fileType = item.types.find(t => t.startsWith('image/') || t === 'application/pdf');
      if (fileType) {
        const blob = await item.getType(fileType);
        uploadFile(new File([blob], 'clipboard-file', { type: blob.type }));
        return;
      }
    }
    // Check for HTML
    if (items[0] && items[0].types.includes('text/html')) {
      const blob = await items[0].getType('text/html');
      const html = await blob.text();
      convertClipboard(html, null);
      return;
    }
    // Fall back to plain text
    const text = await navigator.clipboard.readText();
    if (text) convertClipboard(null, text);
  } catch (err) {
    showToast('Clipboard access denied');
  }
}

async function convertClipboard(html, text) {
  showLoading('Clipboard', '');
  currentFilename = 'clipboard';
  try {
    const res = await fetch('/convert/clipboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, text }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showResult(data);
  } catch (err) {
    showError(err.message);
  }
}

async function uploadFile(file) {
  showLoading(file.name, formatBytes(file.size));
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/convert', { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentFilename = file.name.replace(/\\.[^.]+$/, '');
    showResult(data);
  } catch (err) {
    showError(err.message);
  }
}

async function convertUrl() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;
  showLoading(url, '');
  try {
    const res = await fetch('/convert/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentFilename = new URL(url).hostname;
    showResult(data);
  } catch (err) {
    showError(err.message);
  }
}

function showLoading(name, size) {
  document.getElementById('sourceName').textContent = name;
  document.getElementById('sourceSize').textContent = size;
  sourceLabel.classList.add('visible');
  spinner.classList.add('visible');
  dropZone.querySelector('.drop-icon').style.display = 'none';
  dropZone.querySelector('.drop-text').style.display = 'none';
  outputView.classList.remove('visible');
  stats.classList.remove('visible');
  setToolbarEnabled(false);
}

function showResult(data) {
  spinner.classList.remove('visible');
  currentContent = data.content;

  // Stats
  let html = '<span class="stat-pill">' + data.words.toLocaleString() + ' words</span>';
  html += '<span class="stat-pill">~' + data.tokens.toLocaleString() + ' tokens</span>';
  if (data.fits) {
    html += data.fits.map(f =>
      '<span class="' + (f.fits ? 'fit-yes' : 'fit-no') + '">' + f.name + ' ' + (f.fits ? '\\u2713' : '\\u2717') + '</span>'
    ).join('  ');
  }
  stats.innerHTML = html;
  stats.classList.add('visible');

  outputText.textContent = data.content;
  inputView.style.display = 'none';
  outputView.classList.add('visible');
  setToolbarEnabled(true);
}

function showError(msg) {
  spinner.classList.remove('visible');
  outputText.textContent = 'Error: ' + msg;
  inputView.style.display = 'none';
  outputView.classList.add('visible');
  btnClear.disabled = false;
}

function reset() {
  sourceLabel.classList.remove('visible');
  stats.classList.remove('visible');
  outputView.classList.remove('visible');
  spinner.classList.remove('visible');
  inputView.style.display = '';
  dropZone.querySelector('.drop-icon').style.display = '';
  dropZone.querySelector('.drop-text').style.display = '';
  document.getElementById('urlInput').value = '';
  fileInput.value = '';
  currentContent = '';
  setToolbarEnabled(false);
}

function setToolbarEnabled(enabled) {
  btnCopy.disabled = !enabled;
  btnDownload.disabled = !enabled;
  btnClear.disabled = !enabled;
}

async function copyToClipboard() {
  await navigator.clipboard.writeText(currentContent);
  showToast('Copied to clipboard');
}

function downloadMd() {
  const blob = new Blob([currentContent], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentFilename + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Downloaded ' + a.download);
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
</script>
</body>
</html>`;
