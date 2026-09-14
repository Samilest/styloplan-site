// Where the drawing actually is inside a styled render.
//
// The image AI returns a fixed frame (1:1, 3:4, …) and draws the plan somewhere
// in the middle of it, with a wide band of its own background around the edges.
// Contain-fitting that whole frame into a template means fitting the EMPTY
// BAND too, so the plan itself lands far smaller than the space available. On a
// square export the drawing used barely half the canvas.
//
// This reports the box the drawing occupies, so the compositor can size the
// image by its CONTENT instead of by its frame. Nothing is cut out of the plan:
// only rows and columns that contain no linework at all fall outside the box,
// and the compositor still draws the image whole (see composeOne).

import { inkMap } from './review/ink.js';

// Same description of "ink" the guards use, so a pixel that counts as linework
// here counts as linework there.
const INK = { width: 512, lum: 120, lumInverted: 140, structureLumInverted: 190 };

// Breathing room around the drawing, as a fraction of the content box. The
// styled renders carry a soft drop shadow that is too faint to register as ink;
// without this the shadow's outer edge would be clipped and the plan would end
// up with a visible hard border.
const PAD = 0.035;

// IS THIS BOX THE DRAWING, OR IS THE INK TEST BROKEN?
//
// The guard used to be one number: reject any box narrower than 30% of a side,
// on the reasoning that a small island means the test found noise rather than
// linework, and enlarging the image to match it would blow the plan far past
// its frame.
//
// That number cannot tell a small island from a LONG one. A genuinely
// elongated plan — a narrow infill lot, a row of townhouses, a long single-
// storey — comes back from the model letterboxed into the nearest permitted
// frame, and its drawing can be under 30% of the frame's short side while
// spanning the whole of the other. Measured on synthetic shapes: 1:6 gives a
// box of 0.32 and squeaks through; 1:10 gives 0.23 and was rejected, so the
// MLS export kept 77% empty paper on exactly the plan that needed trimming
// most.
//
// What actually separates the two is not thinness, it is thinness WITHOUT
// extent. Real linework that is thin in one axis runs the length of the other;
// noise is small in both, or small in one and stops short in the other.
const MIN_SIDE = 0.30;   // small in both directions: a blob, not a plan
const MIN_THIN = 0.06;   // below this in either axis, nothing is trustworthy
const SPANS    = 0.85;   // ...unless the other axis runs nearly the whole frame

/**
 * Whether a measured content box is plausibly the drawing.
 * Exported so the decision can be tested without rendering an image — the
 * failure it guards against is a shape, and shapes are arithmetic.
 */
export function boxIsUsable(bw, bh) {
  const thin = Math.min(bw, bh);
  const long = Math.max(bw, bh);
  if (thin < MIN_THIN) return false;              // a streak, not a plan
  if (thin >= MIN_SIDE) return true;              // comfortably a rectangle
  return long >= SPANS;                           // thin, but it runs the length
}

// Already tight. Below this there is nothing worth doing, and skipping keeps
// the old path exactly as it was for images that never had a margin.
const NO_GAIN = 0.96;

/**
 * A caller that has already faded, tinted or otherwise re-toned the image can
 * attach `contentBox` to the canvas it hands over, and that measurement is used
 * instead. This exists because the test here is a LUMINANCE test, so measuring
 * a re-toned copy measures the treatment rather than the drawing — Studio's
 * unstyled preview draws the wireframe at 0.28 alpha, which lifts a pure black
 * line to luminance 168 against the ink threshold of 120, so not one pixel
 * counted and the plan was laid out inside its full frame, empty band and all.
 * `composeOne` already refuses to measure the RECOLOURED copy for the same
 * reason; this closes the same hole one step earlier.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img a styled render
 * @returns {{x:number,y:number,w:number,h:number}|null} normalized 0..1, or
 *   null when the image should be used as-is.
 */
export function planContentBox(img) {
  // `null` is a real answer here ("already tight"), so the presence of the
  // property is the signal rather than its truthiness.
  if (img && 'contentBox' in img) return img.contentBox;
  let m;
  try {
    m = inkMap(img, INK);
  } catch {
    return null;                       // never let framing break a render
  }
  const { ink, w, h } = m;

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!ink[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;             // no linework found at all

  let bx = x0 / w;
  let by = y0 / h;
  let bw = (x1 - x0 + 1) / w;
  let bh = (y1 - y0 + 1) / h;

  const padX = bw * PAD, padY = bh * PAD;
  bx = Math.max(0, bx - padX);
  by = Math.max(0, by - padY);
  bw = Math.min(1 - bx, bw + padX * 2);
  bh = Math.min(1 - by, bh + padY * 2);

  if (!boxIsUsable(bw, bh)) return null;
  if (bw >= NO_GAIN && bh >= NO_GAIN) return null;
  return { x: bx, y: by, w: bw, h: bh };
}
