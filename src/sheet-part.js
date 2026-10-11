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

// ---- THE PLANS ON A SHEET, FOUND (Saman, 2026-10-04).
//
// A sheet with two floors side by side asked the builder to drag a box, and
// nothing on screen said a drag was the thing to do. Now the page finds the
// separate plans itself and outlines each, so choosing one is a click; the
// drag stays for a sheet this cannot split.
//
// The finding is a recursive XY-cut, the classic page-layout split: a band of
// paper running the whole way across a region, wide enough, separates two
// parts of it, and each part is cut again until no band is left. A floor's
// walls, its dimension chains and the extension lines between them touch, so
// a floor comes out as one part with its dimensions; two floors drawn apart
// come out as two.
//
// Measured before it went in, on the sheet that asked for it (two floors, a
// 36px band between them) and on the eleven single-floor plans in the corpus:
// the two floors came out as two parts, and every single plan as one (a title
// line under one of them is far too little ink to be a plan).

/** The long side, in cells, a sheet is read at: fine enough for a 1% band. */
export const GRID = 512;
/** A band narrower than this share of the long side does not separate plans. */
export const MIN_GAP = 0.01;
/** A part with less ink than this share of the largest is a title or a note, not a plan. */
export const PART_SHARE = 0.25;

/**
 * Pixels to an ink grid of about GRID cells on the long side.
 *
 * Ink is anything darker than the paper by a fifth. The grid keeps a cell as ink
 * if ANY pixel in it is: averaging would fade a CAD export's one-pixel walls
 * into the paper and break one building into fifty parts (measured).
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img RGBA, on white
 */
export function inkGrid({ data, width, height }) {
  const n = width * height;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    lum[p] = l;
    hist[l]++;
  }
  // The paper: the value nine pixels in ten are no lighter than (the 90th
  // percentile). Most of a sheet is paper, so this lands on it.
  let paper = 255;
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.9) { paper = v; break; } }
  const cut = paper * 0.8;
  const k = Math.max(1, Math.ceil(Math.max(width, height) / GRID));
  const w = Math.ceil(width / k), h = Math.ceil(height / k);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) {
    const row = ((y / k) | 0) * w;
    for (let x = 0; x < width; x++) if (lum[y * width + x] < cut) ink[row + ((x / k) | 0)] = 1;
  }
  return { ink, w, h };
}

/**
 * The separate plans on a sheet, as boxes in fractions of it, in reading
 * order; an empty list when there are fewer than two.
 * @param {{ink: Uint8Array, w: number, h: number}} grid
 */
export function findParts({ ink, w, h }) {
  const minGap = Math.max(2, Math.round(MIN_GAP * Math.max(w, h)));
  const leaves = [];
  const split = (x0, y0, x1, y1) => {
    let bx0 = x1, by0 = y1, bx1 = x0, by1 = y0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!ink[y * w + x]) continue;
        n++;
        if (x < bx0) bx0 = x; if (x >= bx1) bx1 = x + 1;
        if (y < by0) by0 = y; if (y >= by1) by1 = y + 1;
      }
    }
    if (!n) return;
    for (const across of ['x', 'y']) {
      const len = across === 'x' ? bx1 - bx0 : by1 - by0;
      const prof = new Uint32Array(len);
      for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) if (ink[y * w + x]) prof[across === 'x' ? x - bx0 : y - by0]++;
      }
      const bands = [];
      for (let i = 0; i < len;) {
        if (prof[i]) { i++; continue; }
        let j = i;
        while (j < len && !prof[j]) j++;
        if (j - i >= minGap) bands.push([i, j]);
        i = j;
      }
      if (!bands.length) continue;
      let from = 0;
      for (const [a, b] of [...bands, [len, len]]) {
        if (across === 'x') split(bx0 + from, by0, bx0 + a, by1);
        else split(bx0, by0 + from, bx1, by0 + a);
        from = b;
      }
      return;
    }
    leaves.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, n });
  };
  split(0, 0, w, h);
  const top = Math.max(0, ...leaves.map((l) => l.n));
  const parts = leaves.filter((l) => l.n >= PART_SHARE * top);
  if (parts.length < 2) return [];
  // Reading order: side by side, left to right; one above another, top down.
  const sideBySide = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0;
  parts.sort((a, b) => (sideBySide(a, b) ? a.x0 - b.x0 : a.y0 - b.y0));
  // Half a band of paper round each, so the box does not sit on the ink.
  const pad = minGap / 2;
  return parts.map((l) => boxFrom({ x: (l.x0 - pad) / w, y: (l.y0 - pad) / h }, { x: (l.x1 + pad) / w, y: (l.y1 + pad) / h }));
}
