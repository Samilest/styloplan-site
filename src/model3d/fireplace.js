// THE FIREPLACE SYMBOL, read from the render, for the 3D to build.
//
// Saman handed over a drafter's block (Fireplace-mantel.dwg, eight mantels
// and fireboxes, plan and front view, 2026-09-14) and the rule: wherever
// the symbol is, draw the fireplace. In plan the block is a HEARTH -- a thin
// rectangle on the floor in front -- and a FIREBOX: a trapezoid whose wide
// side is the opening and whose splayed sides converge to a shorter back,
// 0.4 of the opening deep and 0.7 of it wide. On a plan the firebox sits
// inside a chimney breast: a rectangle of wall projecting from the room's
// wall, with a slot in its front face for the opening (The Star, between the
// master bath and the living room: breast 5.4ft along the wall, 1.6ft deep,
// a 3.1ft mouth, the trapezoid 1.25ft deep to a 1.9ft back, a 1ft hearth).
//
// So a fireplace is read as three things that must all be there:
//
//   1. a MOUTH: a gap of 2-6ft between two collinear wall pieces (the
//      breast's front face), which the extruder already has;
//   2. a CELL behind it: the breast's inside, enclosed by walls on the other
//      three sides -- a flood from just inside the mouth, with the mouth
//      sealed, stays inside a box no more than 5ft deep and 9ft across;
//   3. the TRAPEZOID drawn in the cell from the mouth's two ends: two splayed
//      strokes and a back, inked along their length within a pixel or two.
//
// and one that may be: the HEARTH, a thin rectangle on the room side of the
// mouth, 0.6-2.5ft deep, found by its far edge.
//
// What the door finder made of this before there was a reader: the splayed
// sides are two leaves from the mouth's jambs at 60 degrees, the back is
// their arc, and a pair of doors stood in the fireplace. A mouth read here is
// no doorway to the door readers (readWindows).
//
// Everything in render pixels; the caller maps to the model's feet.

/** The flood behind the mouth: how many pixels it reaches, and its box. */
export function cellBehind(ground, W, H, gap, side, o) {
  const hz = !!gap.horizontal;
  const [c0, c1] = gap.face || (hz ? [gap.y0, gap.y1] : [gap.x0, gap.x1]);
  const a0 = hz ? gap.x0 : gap.y0, a1 = hz ? gap.x1 : gap.y1;
  const face = side > 0 ? c1 : c0;
  const seedC = Math.round(face + side * 3), seedA = Math.round((a0 + a1) / 2);
  const sx = hz ? seedA : seedC, sy = hz ? seedC : seedA;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || ground[sy * W + sx]) return null;
  // The mouth is sealed: the gap's own rectangle blocks the flood -- and
  // `o.seal` pixels beyond it along the doorway, because the extruder's
  // walls stop short of the drawn jambs and a flood slips round the seal
  // through the sliver (Plan A's closets read as unbounded before this).
  const m = o.seal || 0;
  const inMouth = (x, y) => x >= gap.x0 - 1 - (hz ? m : 0) && x < gap.x1 + 1 + (hz ? m : 0) && y >= gap.y0 - 1 - (hz ? 0 : m) && y < gap.y1 + 1 + (hz ? 0 : m);
  const cap = o.cap;
  const seen = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  seen[sy * W + sx] = 1;
  let n = 0, bx0 = sx, bx1 = sx, by0 = sy, by1 = sy;
  while (stack.length) {
    const p = stack.pop();
    n++;
    if (n > cap) return null;
    const x = p % W, y = (p - x) / W;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return null;   // reached the sheet's edge: not a cell
      const q = ny * W + nx;
      if (seen[q] || ground[q] || inMouth(nx, ny)) continue;
      seen[q] = 1; stack.push(q);
    }
  }
  return { n, x0: bx0, x1: bx1 + 1, y0: by0, y1: by1 + 1 };
}

/** Ink along a stroke, within `near` pixels, sampled from a tenth in to a tenth short. */
function strokeInk(mask, W, H, x0, y0, x1, y1, near) {
  let hit = 0, n = 0;
  for (let k = 0.1; k <= 0.9; k += 0.05) {
    const x = Math.round(x0 + (x1 - x0) * k), y = Math.round(y0 + (y1 - y0) * k);
    n++;
    let seen = false;
    for (let dy = -near; dy <= near && !seen; dy++) for (let dx = -near; dx <= near; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && mask[Y * W + X]) { seen = true; break; }
    }
    if (seen) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * Every fireplace the render draws.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {Uint8Array} ground  the extruder's walls as a raster (wallRaster)
 * @param {Array} gaps  the reading's gaps between the extruder's walls
 * @param {object} o  `ftPerPx`
 * @returns {Array<{gap, also:Array, horizontal, side, face, mouth:[number,number],
 *   depth:number, back:[number,number], hearth:{far:number, lo:number, hi:number}|null, score:number}>}
 *   `also` holds the other mouths the same firebox was read from (a front
 *   face traced as stacked slices), which are no doorways either
 *   `face` is the mouth line's coordinate across the wall, `mouth` and `back`
 *   the extents along it, `depth` how far the back sits behind the face
 *   (towards `side`); the hearth's `far` edge lies on the other side
 */
export function findFireplaces(mask, ground, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  if (!scale) return [];
  const px = (ft) => ft / scale;
  const out = [];
  for (const gap of gaps) {
    const hz = !!gap.horizontal;
    const [c0, c1] = gap.face || (hz ? [gap.y0, gap.y1] : [gap.x0, gap.x1]);
    const a0 = hz ? gap.x0 : gap.y0, a1 = hz ? gap.x1 : gap.y1;
    const w = a1 - a0;
    if (w * scale < 2 || w * scale > 6) continue;
    for (const side of [1, -1]) {
      const cell = cellBehind(ground, W, H, gap, side, { cap: px(9) * px(5) });
      if (!cell) continue;
      const cellDepth = hz ? (side > 0 ? cell.y1 - c1 : c0 - cell.y0) : (side > 0 ? cell.x1 - c1 : c0 - cell.x0);
      const cellSpan = hz ? cell.x1 - cell.x0 : cell.y1 - cell.y0;
      if (cellDepth * scale < 0.8 || cellDepth * scale > 5 || cellSpan * scale > 9) continue;
      const face = side > 0 ? c1 : c0;
      const pt = (a, c) => (hz ? [a, c] : [c, a]);
      // THE TRAPEZOID: depth a quarter to seven tenths of the mouth, never
      // past the cell's back; a back half to nine tenths of the mouth wide.
      let best = null;
      for (let df = 0.25; df <= 0.7; df += 0.05) {
        const d = w * df;
        if (d > cellDepth - 2) break;
        for (let rf = 0.5; rf <= 0.9; rf += 0.05) {
          const inset = (w * (1 - rf)) / 2;
          const bc = face + side * d;
          const strokes = [
            [...pt(a0, face), ...pt(a0 + inset, bc)],
            [...pt(a0 + inset, bc), ...pt(a1 - inset, bc)],
            [...pt(a1 - inset, bc), ...pt(a1, face)],
          ];
          let score = 1, tight = 1;
          for (const [x0, y0, x1, y1] of strokes) {
            score = Math.min(score, strokeInk(mask, W, H, x0, y0, x1, y1, 2));
            tight = Math.min(tight, strokeInk(mask, W, H, x0, y0, x1, y1, 1));
          }
          if (score < (o.minScore ?? 0.6) || tight < (o.minTight ?? 0.45)) continue;
          if (!best || score > best.score || (score === best.score && tight > best.tight)) {
            best = { score, tight, depth: d, back: [a0 + inset, a1 - inset] };
          }
        }
      }
      if (!best) continue;
      // THE HEARTH, on the room side: the row parallel to the face, 0.6 to
      // 2.5ft out, inked along most of the mouth; its span is walked along
      // that row while the ink holds.
      let hearth = null;
      const rowInk = (c, lo, hi) => {
        let n = 0, hit = 0;
        for (let a = Math.round(lo); a < hi; a++) {
          n++;
          for (let k = -1; k <= 1; k++) {
            const [x, y] = pt(a, Math.round(c) + k);
            if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) { hit++; break; }
          }
        }
        return n ? hit / n : 0;
      };
      let farBest = null;
      for (let h = px(0.6); h <= px(2.5); h += 1) {
        const c = face - side * h;
        const cov = rowInk(c, a0, a1);
        if (cov >= 0.6 && (!farBest || cov > farBest.cov)) farBest = { c, cov };
      }
      if (farBest) {
        const c = farBest.c;
        const limit = px(3);
        const holds = (a) => rowInk(c, a, a + 1) > 0 || rowInk(c, a + 1, a + 2) > 0 || rowInk(c, a - 1, a) > 0;
        let lo = a0, hi = a1;
        while (lo > a0 - limit && holds(lo - 1)) lo--;
        while (hi < a1 + limit && holds(hi)) hi++;
        hearth = { far: c, lo, hi };
      }
      out.push({ gap, horizontal: hz, side, face, mouth: [a0, a1], depth: best.depth, back: best.back, hearth, score: best.score });
      break;   // one side is enough; the other is the room
    }
  }
  // ONE FIREPLACE PER FIREBOX. A breast's front face comes from the tracer
  // as stacked slices more often than as one piece (Madison 3), each with
  // its own mouth, and the same trapezoid is read from each. Two readings
  // whose backs overlap are one; the better-scored stays.
  // The other slice's mouth is remembered on the kept reading (`also`), so
  // the door readers leave it alone too: a leaf stood in the second slice of
  // the same firebox (Madison 3) before this was said.
  out.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of out) {
    const bc = f.face + f.side * f.depth;
    const same = kept.find((k) => k.horizontal === f.horizontal
      && Math.abs((k.face + k.side * k.depth) - bc) < Math.max(f.depth, k.depth)
      && Math.min(k.back[1], f.back[1]) - Math.max(k.back[0], f.back[0]) > 0);
    if (same) same.also.push(f.gap); else kept.push({ ...f, also: [] });
  }
  return kept;
}
