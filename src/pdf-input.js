// PDF input — turn a builder's PDF into plan images, in the browser.
//
// Why this exists: floor plans come out of CAD as PDFs, and the upload step
// rejected every one of them with "export the page as a PNG". That asked a
// builder's marketing person to do a technical task in software they may not
// have, at the first step of the product, where giving up is cheapest.
//
// Everything happens locally. The PDF is never uploaded anywhere — a floor plan
// is a builder's trade secret (handoff 9b), and rasterising on a server would
// send it somewhere it does not need to go.
//
// THIS IS THE ONLY MODULE THAT TOUCHES pdf.js. Swapping the rasteriser later
// means editing this file and nothing else.

const PDFJS_URL = './vendor/pdf.min.mjs';
const WORKER_URL = './vendor/pdf.worker.min.mjs';

// Target the SHORT SIDE in pixels, not a multiple of the page's points.
//
// A fixed 3x multiplier ties output quality to how the PDF was set up: a
// letter page (612x792pt) gives a comfortable 1836x2376, but a smaller page
// gave 841px — barely over the 800px quality gate, and one page-setup change
// away from being rejected. Aiming at a pixel count instead makes every PDF
// arrive at the same usable resolution.
const TARGET_SHORT_SIDE = 1700;
const MAX_SCALE = 6;        // a tiny page should not be blown up past sense
const MAX_SIDE = 4000;      // beyond this the canvas costs more than it returns

/** Scale that puts the short side near TARGET_SHORT_SIDE, within both limits. */
function planScale(base) {
  const short = Math.min(base.width, base.height);
  const long = Math.max(base.width, base.height);
  return Math.min(MAX_SCALE, TARGET_SHORT_SIDE / short, MAX_SIDE / long);
}

// Ceilings, not deadlines. Nothing here should take seconds; these exist so a
// stall ENDS. This feature was withheld from customers because it went from
// 78ms to hanging and the cause was never found — an unbounded await turns that
// into a frozen page with a spinner, which is worse than the plain "export a
// PNG" message the product gave before PDFs were accepted at all. With a
// ceiling, the worst case is that message, so the feature can ship while the
// underlying cause is still unknown.
const OPEN_TIMEOUT_MS = 20000;
const RENDER_TIMEOUT_MS = 20000;

/** A stall, as distinct from a corrupt or password-protected file. */
export class PdfTimeoutError extends Error {}
export const isPdfTimeout = (e) => e instanceof PdfTimeoutError;

/**
 * Bound a promise. On expiry runs `onTimeout` (to cancel the underlying work,
 * so a stalled render does not keep a worker busy forever) and rejects.
 */
function withTimeout(promise, ms, what, onTimeout) {
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* cancelling is best-effort */ }
      reject(new PdfTimeoutError(`PDF ${what} did not finish within ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

let pdfjsLib = null;
let sharedWorker = null;

async function lib() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_URL);
  // The worker keeps parsing off the main thread; without it pdf.js warns and
  // runs everything inline, which locks the page on a large drawing set.
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, import.meta.url).href;
  return pdfjsLib;
}

/**
 * ONE worker for the whole session.
 *
 * Left to itself, pdf.js spawns a worker per document — so opening four PDFs
 * meant four live workers, each holding its document's parsed state, with
 * nothing in the product ever tearing them down. Worker lifecycle was the
 * leading suspect for the stall; this removes the question by owning it. If a
 * worker is ever destroyed, the next open makes a fresh one.
 */
async function worker() {
  const pdfjs = await lib();
  if (!sharedWorker || sharedWorker.destroyed) {
    sharedWorker = new pdfjs.PDFWorker({ name: 'styloplan-pdf' });
  }
  return sharedWorker;
}

export const isPdf = (file) =>
  file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');

/**
 * Open a PDF and report what is inside, WITHOUT rendering every page. A 16-page
 * drawing set is the normal case, and rasterising all of it to show a chooser
 * would waste seconds and memory on pages the user does not want.
 *
 * The caller MUST call `close()` when finished — on selection, on cancel, and
 * on error. Documents were never closed before, so every PDF a user opened
 * stayed parsed in the worker for the life of the tab.
 *
 * @returns {Promise<{pageCount:number, doc:object, close:function}>}
 */
export async function openPdf(file) {
  const pdfjs = await lib();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, worker: await worker() });
  const doc = await withTimeout(task.promise, OPEN_TIMEOUT_MS, 'open', () => task.destroy());
  return {
    pageCount: doc.numPages,
    doc,
    // Best-effort: a document that failed to tear down cleanly is not something
    // the person holding a floor plan can act on.
    close: () => doc.destroy().catch(() => {}),
  };
}

/**
 * Render one page to a canvas at plan resolution.
 * @param {object} doc  from openPdf
 * @param {number} pageNumber 1-based, as printed on the page
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPage(doc, pageNumber) {
  const page = await withTimeout(doc.getPage(pageNumber), OPEN_TIMEOUT_MS, `page ${pageNumber}`);
  const viewport = page.getViewport({ scale: planScale(page.getViewport({ scale: 1 })) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  // A PDF page has no background of its own; without this the plan would come
  // through on transparency and every downstream ink test would misread it.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const task = page.render({ canvasContext: ctx, viewport });
  try {
    // Cancelling on expiry matters as much as rejecting: an abandoned render
    // that keeps running would slow every page after it.
    await withTimeout(task.promise, RENDER_TIMEOUT_MS, `render of page ${pageNumber}`,
      () => task.cancel());
  } finally {
    // Drops the page's parsed operator list and font references. pdf.js defers
    // this while a render is still active, so it is safe alongside the
    // concurrent case (a click landing mid-thumbnail-loop).
    page.cleanup();
  }
  return canvas;
}

/**
 * Small preview for the page chooser.
 *
 * Rendered at scale 1 and then scaled down with drawImage, rather than asking
 * pdf.js for a small viewport directly. Measured: a viewport below scale 1
 * could hang indefinitely on the same page that renders in milliseconds at
 * scale 1 and above — non-monotonic and not worth diagnosing when the
 * downscale costs nothing and uses the path already known to work.
 */
export async function renderThumb(doc, pageNumber, width = 220) {
  // Renders at the SAME scale as a plan page and shrinks the result. Asking
  // pdf.js for a smaller viewport hung indefinitely on pages that render in
  // milliseconds at plan scale — reproduced at scale 1 and below, on two
  // different documents. Reusing the one path known to work costs a little
  // memory per page and removes the failure entirely.
  const full = await renderPage(doc, pageNumber);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(1, Math.round(full.height * (width / full.width)));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A rendered page as a File, so it re-enters the normal upload path unchanged. */
export function canvasToFile(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(new File([blob], name, { type: 'image/png' })), 'image/png');
  });
}
