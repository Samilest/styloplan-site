// THE REVIEW STAGE, AS ARITHMETIC: where each drawing sits in the one frame,
// how big the frame is, and how a zoom or a pan moves it. No DOM here, so the
// rules are tested in node (test/review-stage.test.mjs) and review.html only
// applies the numbers.
//
// A SCENE is what the stage shows: one or two LAYERS (the customer's plan, our
// drawing) placed in one coordinate system, and the CONTENT -- the part worth
// fitting to the stage. Units are normalised to one picture: `pxW` and `pxH`
// say how many of that picture's pixels one unit is across and down, so a
// layer of another picture can sit in it at its own proportions.

/**
 * HOW WELL THE TWO PICTURES MUST AGREE BEFORE THEY ARE SHOWN OVER EACH OTHER.
 *
 * Agreement is sweepFit's own measure: the share of each picture's linework
 * within a few pixels of the other's, both ways (src/sweep-fit.js). Measured on
 * the eleven plans whose source sheet is in the corpus, laid over our drawing
 * and judged by eye (2026-10-05): the seven that line up score 0.41 to 1.00
 * (Madison's CAD sheet, full of notes the drawing leaves out, is the 0.41);
 * the four that do not score 0.04 to 0.30 (two CAD apartment sheets of many
 * units, a balcony unit on a framing sheet, and The Sky, whose sheet and
 * drawing are framed too differently to fit). The line sits in the empty band
 * between. Below it the two are shown one at a time: a comparison that does
 * not line up is worse than none, because it is believed.
 */
export const OVERLAY_MIN = 0.35;

/** The furthest in a zoom goes, as a multiple of the fit. */
export const MAX_ZOOM = 8;

/**
 * Where the customer's plan lies in our drawing's units, from the fit that maps
 * our drawing onto it (srcNorm = d + wfNorm * s, sweepFit's `T`).
 */
export function sourceRect(T) {
  return { x0: -T.dx / T.sx, y0: -T.dy / T.sy, x1: (1 - T.dx) / T.sx, y1: (1 - T.dy) / T.sy };
}

/** A box in the source's own units (planContentBox's {x,y,w,h}) in our drawing's units. */
export function sourceBoxInWire(b, T) {
  return { x0: (b.x - T.dx) / T.sx, y0: (b.y - T.dy) / T.sy, x1: (b.x + b.w - T.dx) / T.sx, y1: (b.y + b.h - T.dy) / T.sy };
}

/** planContentBox's {x,y,w,h} as a rectangle; the whole picture when there is none. */
export function boxRect(b) {
  return b ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

export function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * How tall the stage is for its width: the content at its own proportions,
 * never shorter than `minH` and never taller than `maxH` (the window less the
 * page's chrome, so the whole plan is on screen at once). Past `maxH` the
 * content is fitted inside, with paper either side.
 */
export function stageHeight(scene, width, minH, maxH) {
  const C = scene.content;
  const natural = width * ((C.y1 - C.y0) * scene.pxH) / ((C.x1 - C.x0) * scene.pxW);
  return Math.round(Math.max(minH, Math.min(maxH, natural)));
}

/** CSS px per picture px at zoom 1: the content fitted inside the stage. */
export function baseScale(scene, Sw, Sh) {
  const C = scene.content;
  return Math.min(Sw / ((C.x1 - C.x0) * scene.pxW), Sh / ((C.y1 - C.y0) * scene.pxH));
}

/**
 * Keep the view on the content: at any zoom the content fills the stage along
 * an axis where it is bigger than the stage, and is centred where it is not.
 * `view` = {z, cx, cy}: the zoom over the fit and the point at the stage's centre.
 */
export function clampView(scene, view, Sw, Sh) {
  const C = scene.content;
  const z = Math.max(1, Math.min(MAX_ZOOM, view.z));
  const s = baseScale(scene, Sw, Sh) * z;
  const hw = Sw / (2 * scene.pxW * s), hh = Sh / (2 * scene.pxH * s);
  const axis = (c, lo, hi, half) => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.max(lo + half, Math.min(hi - half, c)));
  return { z, cx: axis(view.cx, C.x0, C.x1, hw), cy: axis(view.cy, C.y0, C.y1, hh) };
}

/** The view that fits the content. */
export function fitView(scene) {
  const C = scene.content;
  return { z: 1, cx: (C.x0 + C.x1) / 2, cy: (C.y0 + C.y1) / 2 };
}

/** Zoom by `f` about a point of the stage (px from its top left), keeping that point still. */
export function zoomAt(scene, view, f, px, py, Sw, Sh) {
  const b = baseScale(scene, Sw, Sh);
  const s0 = b * view.z;
  const u = view.cx + (px - Sw / 2) / (scene.pxW * s0), v = view.cy + (py - Sh / 2) / (scene.pxH * s0);
  const z = Math.max(1, Math.min(MAX_ZOOM, view.z * f));
  const s1 = b * z;
  return clampView(scene, { z, cx: u - (px - Sw / 2) / (scene.pxW * s1), cy: v - (py - Sh / 2) / (scene.pxH * s1) }, Sw, Sh);
}

/** Move the view by a drag of (dx, dy) stage px. */
export function panBy(scene, view, dx, dy, Sw, Sh) {
  const s = baseScale(scene, Sw, Sh) * view.z;
  return clampView(scene, { ...view, cx: view.cx - dx / (scene.pxW * s), cy: view.cy - dy / (scene.pxH * s) }, Sw, Sh);
}

/** Where a layer's rectangle lands on the stage, in CSS px. */
export function placeRect(scene, view, r, Sw, Sh) {
  const s = baseScale(scene, Sw, Sh) * view.z;
  const X = (u) => Sw / 2 + (u - view.cx) * scene.pxW * s, Y = (v) => Sh / 2 + (v - view.cy) * scene.pxH * s;
  return { left: X(r.x0), top: Y(r.y0), width: (r.x1 - r.x0) * scene.pxW * s, height: (r.y1 - r.y0) * scene.pxH * s };
}

/**
 * The resolution a canvas is drawn at, as a multiple of its working width: as
 * many backing pixels as it is shown at, never fewer than the working width,
 * never more than the picture has, and never more than `maxPx` in all.
 */
export function backingScale(shownCssW, dpr, workW, workH, pictureW, maxPx = 16e6) {
  const want = (shownCssW * dpr) / workW;
  const most = Math.max(1, pictureW / workW);
  const byArea = Math.sqrt(maxPx / (workW * workH));
  return Math.max(1, Math.min(want, most, byArea));
}
