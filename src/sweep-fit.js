// HOW THE DRAWING LIES OVER THE RENDER, in Studio's before/after.
//
// The compare handle composed the drawing and the render each on its own:
// each picture was fitted to the page by its own CONTENT BOX, the extent of
// its ink. That lines them up only when the two boxes describe the same thing.
// On The Star they do not: the tracing keeps the plan's dimension chains
// (78'-0" across the top and bottom, 38'-0" down the sides) and the render
// draws none, so the drawing's box was the dimension lines and the render's
// the building -- and the drawing came out a tenth to a fifth smaller, as
// Saman saw (2026-09-30). Site lines, a deck outline or stray marks past the
// walls do the same on other plans.
//
// The app already knows how to lay a tracing over a picture properly:
// register() in review/registration.js, which fits by the WALL STRUCTURE with
// thin lines eroded away, so dimension chains and text do not count.
//
// IT IS USED ONLY WHEN IT IS BETTER, and that is measured, not assumed. A
// trusted registration is still sometimes wrong (three fixture pairs: the
// drawing shrunk into a corner, or a wall's width off), so both fits are
// scored by one independent measure -- how much of each picture's linework
// lies within a few pixels of the other's, both ways (agreement) -- and the
// registration wins only by a clear margin. On the corpus (32 render pairs
// plus The Star as Saman has it, 2026-09-30, the render handed over as a
// canvas the way Studio holds it, every choice checked by eye on an overlay):
// where the two fits look alike they score within 0.06 of each other; the nine
// pairs where the registration is visibly right and the boxes visibly off gain
// 0.107 to 0.73 (Saman's Star: 0.12 -> 0.85 dark, 0.18 -> 0.76 light; the
// Star fixture, whose boxes sit a few pixels low, 0.70 -> 0.88); the four
// where the registration is wrong lose 0.12 or more. MARGIN sits between.
// A first version scored walls by median distance and chose wrongly on
// hollow-walled tracings, where an eroded wall is no wall at all.
//
// Only the compare handle uses this. Room labels are placed through the
// content boxes too (label-frame.js, Studio's toShown), but a label's position
// is the builder's own, dragged and checked on the render, and remapping it
// would move work they have already approved.

import { register } from './review/registration.js';
import { planContentBox } from './plan-trim.js';

/** The working width the linework is compared at. */
const WORK = 1024;
/** How near (working px) a line has to lie to the other picture's to agree. */
const NEAR = 3;
/** How much more agreement the registered fit needs to be used. */
export const MARGIN = 0.1;

/**
 * The wire -> render transform the content boxes give (renderNorm = d + wireNorm * s),
 * the same mapping mapFrame makes.
 */
export function boxFit(wire, render) {
  const f = planContentBox(wire) || { x: 0, y: 0, w: 1, h: 1 };
  const t = planContentBox(render) || { x: 0, y: 0, w: 1, h: 1 };
  const sx = t.w / f.w, sy = t.h / f.h;
  return { sx, sy, dx: t.x - f.x * sx, dy: t.y - f.y * sy };
}

/** A picture's linework at the working width: ink against its paper, whichever look it is. */
function inkOf(img) {
  const srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
  const W = WORK, H = Math.max(1, Math.round(srcH * (W / srcW)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const L = new Uint8Array(W * H);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) { L[p] = (d[i] + d[i + 1] + d[i + 2]) / 3; hist[L[p]]++; }
  // The paper is most of a plan: a light median is dark linework, a dark one light.
  let acc = 0, median = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= (W * H) / 2) { median = v; break; } }
  const light = median > 128;
  const m = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) m[p] = light ? (L[p] < 110 ? 1 : 0) : (L[p] > 200 ? 1 : 0);
  return { m, W, H };
}

/** Distance to the nearest ink pixel, in working px (two-pass 3-4 chamfer). */
export function distanceTo({ m, W, H }) {
  const D = new Float32Array(W * H).fill(1e9);
  for (let p = 0; p < W * H; p++) if (m[p]) D[p] = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x) D[p] = Math.min(D[p], D[p - 1] + 3);
      if (y) D[p] = Math.min(D[p], D[p - W] + 3);
      if (x && y) D[p] = Math.min(D[p], D[p - W - 1] + 4);
      if (y && x < W - 1) D[p] = Math.min(D[p], D[p - W + 1] + 4);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x;
      if (x < W - 1) D[p] = Math.min(D[p], D[p + 1] + 3);
      if (y < H - 1) D[p] = Math.min(D[p], D[p + W] + 3);
      if (x < W - 1 && y < H - 1) D[p] = Math.min(D[p], D[p + W + 1] + 4);
      if (y < H - 1 && x) D[p] = Math.min(D[p], D[p + W - 1] + 4);
    }
  }
  for (let p = 0; p < W * H; p++) D[p] /= 3;
  return D;
}

/**
 * How much of the two pictures' linework agrees under `T` (wire -> render,
 * normalised): the share of the drawing's ink within NEAR px of the render's,
 * the share of the render's within NEAR px of the drawing's, and their
 * harmonic mean -- so neither a render full of furniture nor a drawing full of
 * dimension lines can score by itself. 0..1.
 */
export function agreement(F, R, DF, DR, T, near = NEAR) {
  let fin = 0, fn = 0, rin = 0, rn = 0;
  for (let y = 0; y < F.H; y += 2) {
    for (let x = 0; x < F.W; x += 2) {
      if (!F.m[y * F.W + x]) continue;
      fn++;
      const rx = Math.round((T.dx + (x / F.W) * T.sx) * R.W), ry = Math.round((T.dy + (y / F.H) * T.sy) * R.H);
      if (rx >= 0 && ry >= 0 && rx < R.W && ry < R.H && DR[ry * R.W + rx] <= near) fin++;
    }
  }
  for (let y = 0; y < R.H; y += 2) {
    for (let x = 0; x < R.W; x += 2) {
      if (!R.m[y * R.W + x]) continue;
      rn++;
      const fx = Math.round(((x / R.W - T.dx) / T.sx) * F.W), fy = Math.round(((y / R.H - T.dy) / T.sy) * F.H);
      if (fx >= 0 && fy >= 0 && fx < F.W && fy < F.H && DF[fy * F.W + fx] <= near) rin++;
    }
  }
  const a = fn ? fin / fn : 0, b = rn ? rin / rn : 0;
  return a + b ? (2 * a * b) / (a + b) : 0;
}

/**
 * Which of two fits to lay the drawing with: the registered one only when the
 * registration trusts itself AND its linework agrees with the render's by at
 * least MARGIN more than the boxes' does. Pure, so it is tested without a browser.
 */
export function chooseFit(boxAgree, regAgree, trusted) {
  if (!trusted || !Number.isFinite(boxAgree) || !Number.isFinite(regAgree)) return 'box';
  return regAgree - boxAgree >= MARGIN ? 'registered' : 'box';
}

/**
 * A copy of a picture at the working width, shrunk by halves.
 *
 * THE SAME PICTURE MUST GIVE THE SAME ANSWER WHATEVER IT ARRIVES AS. register()
 * reads at 512 wide with one drawImage, and Chrome shrinks an <img> and a
 * <canvas> differently over a step that large: measured on The Star's light
 * render, the decoded image registered at agreement 0.71 and the very same
 * pixels as Studio's canvas at 0.21 -- the hairlines that one shrink keeps the
 * other drops. Halving keeps every step small enough that each source pixel is
 * read, so the image and the canvas come out alike.
 */
function working(img) {
  let src = img;
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const H = Math.max(1, Math.round(h * (WORK / w)));
  const step = (cw, ch) => {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, cw, ch);
    src = c; w = cw; h = ch;
  };
  while (w / 2 >= WORK) step(Math.round(w / 2), Math.max(1, Math.round(h / 2)));
  step(WORK, H);
  return src;
}

/**
 * The transform to lay the drawing over the render with, and how it was chosen.
 * `T` is the content boxes' mapping unless the registration won; the caller
 * keeps its own box placement in that case and uses `T` only when registered.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} wire the drawing as shown (erases applied)
 * @param {HTMLImageElement|HTMLCanvasElement} render the render it is compared with
 * @returns {{T:{sx,sy,dx,dy}, by:'box'|'registered', box?:number, fit?:number}}
 */
export function sweepFit(wire, render) {
  const box = boxFit(wire, render);
  const W = working(wire), R0 = working(render);
  let reg = null;
  try { reg = register(R0, W); } catch { reg = null; }
  if (!reg?.transform || !reg.fitTrusted) return { T: box, by: 'box' };
  const F = inkOf(W), R = inkOf(R0);
  const DF = distanceTo(F), DR = distanceTo(R);
  const a = agreement(F, R, DF, DR, box), b = agreement(F, R, DF, DR, reg.transform);
  const by = chooseFit(a, b, reg.fitTrusted);
  return { T: by === 'registered' ? reg.transform : box, by, box: a, fit: b };
}
