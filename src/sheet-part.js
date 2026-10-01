// WHICH PART OF THE SHEET IS THIS FLOOR (2026-09-25).
//
// A builder's plan sheet often shows two floors, or two homes, side by side.
// The upload used to say "one floor per file: a sheet with two floors needs
// splitting first", which sent the builder off to crop it in some other
// program at the first step of the product, where giving up is cheapest.
// Now the upload page shows the sheet and they drag a box around this floor,
// or keep the whole sheet with one click.
//
// These are the pure pieces of that step, so they can be tested without a
// browser: a drag into a box, a box into pixels, and the scale that renders a
// PDF region as sharp as a whole page would have been. The step itself lives
// in extract.html; the PDF rendering in pdf-input.js.

/** A box is kept in fractions of the sheet, 0..1, so it means the same thing at any size. */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Two corners of a drag, in fractions of the shown sheet, as a box.
 * Either corner can come first, and a drag that runs off the sheet stops at its edge.
 */
export function boxFrom(a, b) {
  const x0 = clamp01(Math.min(a.x, b.x)), x1 = clamp01(Math.max(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y)), y1 = clamp01(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A drag narrower than this, on either side, is a click and not a box. 3% of
 * the sheet is far smaller than any floor worth reading, and larger than a
 * hand's wobble on a click.
 */
export const MIN_BOX = 0.03;
export const isBox = (b) => Boolean(b) && b.w >= MIN_BOX && b.h >= MIN_BOX;

/** The box in whole pixels of a W x H image: inside it, and never empty. */
export function boxPixels(b, W, H) {
  const x = Math.min(W - 1, Math.max(0, Math.floor(b.x * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(b.y * H)));
  const w = Math.max(1, Math.min(W - x, Math.round(b.w * W)));
  const h = Math.max(1, Math.min(H - y, Math.round(b.h * H)));
  return { x, y, w, h };
}

/**
 * The scale to render a PDF region at, in pixels per PDF point.
 *
 * The region's short side aims at the same target a whole page gets, under the
 * same two ceilings. So a floor that fills half the sheet arrives at the
 * resolution a whole page would have had, not half of it: resolution is the
 * measured predictor of how well dimensions are read, and the 800px gate stands
 * on it. Cutting the region out of the whole-page render instead would have
 * made every split sheet the blurrier upload.
 */
export function regionScale(pageW, pageH, b, { target, maxScale, maxSide }) {
  const rw = Math.max(1e-6, b.w * pageW);
  const rh = Math.max(1e-6, b.h * pageH);
  return Math.min(maxScale, target / Math.min(rw, rh), maxSide / Math.max(rw, rh));
}
