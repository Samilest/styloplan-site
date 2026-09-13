// Hatch advisory — finds every diagonally-hatched area in a styled render and
// asks the user to confirm each one is genuinely outdoor.
//
// WHAT THIS DELIBERATELY DOES NOT DO: decide whether a hatched area is inside
// the home. That was the original design and it was measured and abandoned.
// Deciding "interior" needs a closed wall envelope to flood-fill against, and a
// plan's exterior wall is broken by door and garage openings wide enough that
// the fill escapes. Sweeping the sealing radius from 4 to 20px gave interior
// fractions of 0, 2, 3.8, 9 and 30.2% on one plan and 0, 0, 13.2, 12.6, 15.4%
// on another — no stable regime, on a figure that should sit near 50%. A
// detector built on that would have been a coin toss presented as a check.
//
// WHAT IT DOES: the texture half, which measured cleanly. Per grid cell:
//   hatched field   energy 13.5–30.5   diagonal ratio 1.46–1.60
//   plain floor     energy 1.16        diagonal ratio 1.01
// So "is there a hatched field here" is answerable; "should it be here" is not.
// The count goes to the user, who can see the plan and knows whether it has a
// deck. On a plan with no outdoor space at all, "3 hatched areas" is an
// immediately actionable sentence.
//
// ADVISORY ONLY. It never rejects a render and never triggers a re-roll: a
// wrong reject would spend the customer's credits on a picture that was fine.

const W = 512;
const GRID = 24;
const ENERGY_MIN = 5;    // a hatched field is an order of magnitude above a floor
const DIAG_RATIO = 1.35; // parallel diagonals, not the floor's square grid
const MIN_CELLS = 2;     // a real region spans several cells; one is noise

function sample(img) {
  // Accepts an <img> or a canvas: once the patch tool exists the plan reaching
  // this guard is often a canvas, and naturalWidth is undefined on one.
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const h = Math.max(1, Math.round(srcH * (W / srcW)));
  const c = document.createElement('canvas');
  c.width = W; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, h);
  const { data } = ctx.getImageData(0, 0, W, h);
  const lum = new Float32Array(W * h);
  for (let p = 0, i = 0; p < W * h; p++, i += 4) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { lum, w: W, h };
}

/**
 * Gradient energy along the two diagonals. A field of parallel lines is quiet
 * ALONG the lines and loud ACROSS them, so the pair is lopsided. A square grid
 * is symmetric on both diagonals; a flat fill is quiet on both; wall and
 * fixture edges are loud but axis-aligned, so also roughly symmetric here.
 */
function diagonalScore(lum, w, x0, y0, x1, y1) {
  let down = 0, up = 0, n = 0;
  for (let y = y0; y < y1 - 1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const p = y * w + x;
      down += Math.abs(lum[p] - lum[p + w + 1]);
      up += Math.abs(lum[p + 1] - lum[p + w]);
      n++;
    }
  }
  if (!n) return { ratio: 1, energy: 0 };
  down /= n; up /= n;
  const hi = Math.max(down, up), lo = Math.min(down, up);
  return { ratio: lo > 0.01 ? hi / lo : 1, energy: hi };
}

/** Group touching cells into regions, so three cells of one deck read as one area. */
function cluster(cells) {
  const key = (c) => `${c.gx},${c.gy}`;
  const left = new Map(cells.map((c) => [key(c), c]));
  const regions = [];
  while (left.size) {
    const [k0, seed] = left.entries().next().value;
    left.delete(k0);
    const group = [seed], queue = [seed];
    while (queue.length) {
      const c = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const k = `${c.gx + dx},${c.gy + dy}`;
        const hit = left.get(k);
        if (!hit) continue;
        left.delete(k);
        group.push(hit); queue.push(hit);
      }
    }
    if (group.length < MIN_CELLS) continue;
    const xs = group.map((c) => c.gx), ys = group.map((c) => c.gy);
    regions.push({
      cells: group.length,
      // Normalised centre, so a caller can point at it on the preview.
      x: +(((Math.min(...xs) + Math.max(...xs) + 1) / 2) / GRID).toFixed(3),
      y: +(((Math.min(...ys) + Math.max(...ys) + 1) / 2) / GRID).toFixed(3),
      // The individual cells, normalised, so a caller can erase EXACTLY the
      // hatched squares rather than their bounding box. That distinction is
      // what keeps a removal from swallowing a fixture sitting next to the
      // hatching: a toilet has no diagonal texture, so it is never in this list.
      rects: group.map((c) => ({
        x: c.gx / GRID, y: c.gy / GRID, w: 1 / GRID, h: 1 / GRID,
      })),
    });
  }
  return regions.sort((a, b) => b.cells - a.cells);
}

/**
 * @param {HTMLImageElement} styledImg raw styled render
 * @returns {{regions:Array<{cells:number,x:number,y:number}>, areaPct:number}}
 *   `regions` is every hatched area found. Whether each belongs there is the
 *   user's call — this module does not claim to know.
 */
export function findHatchedAreas(styledImg) {
  const { lum, w, h } = sample(styledImg);
  const cw = Math.floor(w / GRID), ch = Math.floor(h / GRID);
  const cells = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = gx * cw, y0 = gy * ch;
      const { ratio, energy } = diagonalScore(lum, w, x0, y0, x0 + cw, y0 + ch);
      if (energy >= ENERGY_MIN && ratio >= DIAG_RATIO) cells.push({ gx, gy });
    }
  }
  const regions = cluster(cells);
  const counted = regions.reduce((s, r) => s + r.cells, 0);
  return { regions, areaPct: +((counted / (GRID * GRID)) * 100).toFixed(1) };
}
