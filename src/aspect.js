// Frame shapes the image API will accept, and how to pick one for a plan.
// Shared: the browser measures the image it is about to send, the adapter puts
// the answer in the request.
//
// Why this has to exist. Asking for a 2K render without naming a frame shape
// made the model choose its own — it re-framed a portrait plan (864×1248) into
// a 16:9 canvas and REDREW the plan to fill it: the plan's own ink aspect went
// 0.639 → 1.927, a 201% deviation that the registration guardrail rejected.
// Naming the nearest permitted shape keeps the plan's geometry (measured 0.62%
// aspect deviation, 4.9% coverage — well inside tolerance) and still doubles the
// resolution.

import { planContentBox } from './plan-trim.js';

const ASPECTS = [
  ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4],
  ['3:2', 3 / 2], ['2:3', 2 / 3], ['5:4', 5 / 4], ['4:5', 4 / 5], ['21:9', 21 / 9],
];

/**
 * Nearest permitted frame shape to an image, compared in log space so that
 * "10% too wide" and "10% too tall" count the same.
 * @returns {string|null} e.g. "2:3"
 */
export function nearestAspect(width, height) {
  if (!width || !height) return null;
  const target = width / height;
  return ASPECTS.reduce((best, a) =>
    Math.abs(Math.log(a[1] / target)) < Math.abs(Math.log(best[1] / target)) ? a : best)[0];
}

/**
 * Letterbox an image onto a canvas of EXACTLY the requested ratio, centred, on
 * a white ground (Prompt 1 mandates a white background, so the margin is
 * invisible in the wireframe's own language).
 *
 * Naming the nearest permitted ratio is not enough on its own: the nearest is
 * still up to ~4% away from a real plan's shape, and the model resolves that
 * gap by STRETCHING the plan to fill the frame — three consecutive renders came
 * back 8.5% off. Padding first removes the gap, so there is nothing to stretch.
 * Registration is unaffected because it measures ink bounding boxes, and the
 * compositor contain-fits, so the margin costs nothing downstream.
 */
export function padToAspect(img, ratio) {
  const [rw, rh] = String(ratio).split(':').map(Number);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!rw || !rh || !w || !h) return img;
  const target = rw / rh;
  const out = document.createElement('canvas');
  if (w / h > target) { out.width = w; out.height = Math.round(w / target); }
  else { out.width = Math.round(h * target); out.height = h; }
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, Math.round((out.width - w) / 2), Math.round((out.height - h) / 2), w, h);
  return out;
}

/**
 * The image to send the model, framed to the DRAWING rather than to the file.
 *
 * `nearestAspect` on the file's own dimensions is right only when the drawing
 * fills the file. When it does not, the frame is named correctly and the model
 * still has room to work with: it treats the empty band as space to grow into
 * and redraws the plan to fill it. This is the same failure the note at the top
 * of this file records, arriving through a different door — there the CANVAS
 * was the wrong shape, here the canvas is exactly the shape we asked for and
 * the CONTENT is not.
 *
 * MEASURED 2026-08-22 on a customer plan supplied as a 2048x2048 square holding
 * a 1.4:1 landscape drawing — 41% of the image height empty:
 *
 *     source drawing      1.399
 *     wireframe drawing   1.482      the first model pulled it 5.9% toward square
 *     styled render       rejected, 11.0% apart
 *
 * The pull compounds because every pass re-frames what the last one produced.
 * All seven fixture plans have between 0.8% and 14.9% empty height and never
 * showed it; this plan has 41.1%, and is the first to make it visible.
 *
 * So the white margin is trimmed off BEFORE the frame is chosen. The model then
 * gets a picture whose shape matches its content and has nothing left to fill.
 *
 * Only what is SENT is reframed. The stored source artifact stays the file the
 * customer uploaded, and registration compares ink silhouettes rather than
 * canvases, so trimming the input does not move any measurement.
 *
 * @returns {{canvas: HTMLCanvasElement|HTMLImageElement, aspectRatio: string|null}}
 */
export function frameForModel(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const box = planContentBox(img);

  // Already tight, or the ink test found too little to trust it. Fall back to
  // the old behaviour rather than crop on a guess.
  const TIGHT = 0.98;
  if (!box || (box.w >= TIGHT && box.h >= TIGHT)) {
    const ratio = nearestAspect(w, h);
    return { canvas: ratio ? padToAspect(img, ratio) : img, aspectRatio: ratio };
  }

  // A margin, kept deliberately: a drawing pushed hard against the frame edge
  // is its own way of telling the model to fill the frame.
  const PAD = 0.02;
  const x0 = Math.max(0, Math.round((box.x - PAD) * w));
  const y0 = Math.max(0, Math.round((box.y - PAD) * h));
  const x1 = Math.min(w, Math.round((box.x + box.w + PAD) * w));
  const y1 = Math.min(h, Math.round((box.y + box.h + PAD) * h));

  const cut = document.createElement('canvas');
  cut.width = x1 - x0; cut.height = y1 - y0;
  const ctx = cut.getContext('2d');
  // The sheet is white; anything the crop does not cover must stay white rather
  // than transparent, or the model is handed holes.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cut.width, cut.height);
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, cut.width, cut.height);

  const ratio = nearestAspect(cut.width, cut.height);
  return { canvas: ratio ? padToAspect(cut, ratio) : cut, aspectRatio: ratio };
}
