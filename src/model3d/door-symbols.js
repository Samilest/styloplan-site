// THE DOOR SYMBOL, FOUND WHERE IT IS DRAWN -- not verified where the tracer
// guessed it might be.
//
// Every door reader before this one started from the wall tracer: a hinge at
// a traced wall's end, or a doorway's jamb, and a radius equal to the traced
// doorway's width; then it asked whether the ink agreed, within three pixels.
// The tracer is not that precise. Its brush eats the jambs, so the model's
// doorway is wider than the drawn one (Plan A: a 2.6ft doorway whose arc is
// 0.7 of the gap); a styled wall's fuzzy edge opens gaps that are not
// doorways; a wall drawn as two faces puts the jamb a wall away. Wherever the
// guess was a few pixels off, a perfectly clear symbol read as nothing --
// which is what "sometimes it reads them and sometimes it does not, with the
// same picture quality" looks like from the outside (Saman, 2026-09-14).
//
// So this file finds the symbol first and lets it define the doorway:
//
//   1. the thin ink -- what is left of the drawing once the traced walls
//      and anything wall-thick are removed;
//   2. its connected pieces, and in each piece the circular arc that fits
//      most of it (RANSAC over three points, then a least-squares circle on
//      the inliers), of a door's radius, covering a contiguous 40-100
//      degrees; a piece may carry two (a pair's arcs meet);
//   3. for each arc: the hinge is its centre, and must sit on a wall; of its
//      two ends, the SHUT end is the one that runs along the wall's axis
//      across a doorway to the far jamb (axis-aligned, its chord free of
//      wall-thick ink, its far point on wall), the other end is where the
//      leaf stands; the leaf is then looked for there, or shut along the
//      chord, or lying flat against the next wall; the sector must be clear.
//
// What comes back is a door record in doors.js' shape plus its CHORD -- the
// doorway the symbol itself describes. The caller hangs it in the traced
// doorway the chord overlaps, and where there is none, knows that the tracer
// merged a doorway the plan draws a door in.
//
// Tolerances are taken from the drawing: the hairline weight measured on this
// render's thin ink, and the scale in feet. A fixed three pixels was 0.11ft
// on The Star and 0.05ft on Plan A, and "tight within a pixel" meant a
// different thing on a 1px line and a 3px one.

import { wallGrid, solidWalls, inkNear, sweptIsClear } from './doors.js';

const MIN_R_FT = 1.4;       // a single leaf; a pair's leaves are half a doorway each
const MAX_R_FT = 5.0;
const MIN_SPAN = 40;        // degrees of arc drawn, at least (a door drawn less open is not readable)
const MAX_SPAN = 100;

/** Ink that is not a traced wall and not wall-thick: the drawing's lines. Also the hairline weight. */
export function thinInk(mask, W, H, wall, maxThick) {
  const thin = new Uint8Array(W * H);
  const hRun = new Uint16Array(W * H), vRun = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) { const p = y * W + x; run = mask[p] ? run + 1 : 0; hRun[p] = run; }
    run = 0;
    for (let x = W - 1; x >= 0; x--) { const p = y * W + x; run = mask[p] ? run + 1 : 0; if (mask[p]) hRun[p] = Math.max(hRun[p], run); }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) { const p = y * W + x; run = mask[p] ? run + 1 : 0; vRun[p] = run; }
    run = 0;
    for (let y = H - 1; y >= 0; y--) { const p = y * W + x; run = mask[p] ? run + 1 : 0; if (mask[p]) vRun[p] = Math.max(vRun[p], run); }
  }
  // A pixel's thickness is the shorter of the runs through it; a hairline's
  // is its weight, a wall's its width, a fill's the fill's.
  const weights = [];
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || wall[p]) continue;
    const t = Math.min(hRun[p], vRun[p]);
    if (t <= maxThick) { thin[p] = 1; if (weights.length < 200000) weights.push(t); }
  }
  weights.sort((a, b) => a - b);
  const lineWeight = weights.length ? weights[weights.length >> 1] : 1;
  return { thin, lineWeight };
}

/** 8-connected pieces of `thin`, as pixel lists, skipping the tiny and the huge. */
function pieces(thin, W, H, minN, maxN) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!thin[s] || seen[s]) continue;
    const pts = [];
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p - x) / W;
      pts.push(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const q = Y * W + X;
        if (thin[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const n = pts.length / 2;
    if (n >= minN && n <= maxN) out.push(pts);
  }
  return out;
}

/** Circle through three points, or null. */
function circumcircle(ax, ay, bx, by, cx, cy) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

/** Least-squares (Kasa) circle on a point list. */
function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1], z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c] = [sxz syz sz], circle x^2+y^2 = a x + b y + c.
  const m = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[piv][i])) piv = k;
    [m[i], m[piv]] = [m[piv], m[i]];
    if (Math.abs(m[i][i]) < 1e-9) return null;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  const a = m[0][3] / m[0][0], b = m[1][3] / m[1][1], c = m[2][3] / m[2][2];
  const cx = a / 2, cy = b / 2, r2 = c + cx * cx + cy * cy;
  return r2 > 0 ? { cx, cy, r: Math.sqrt(r2) } : null;
}

/**
 * The circular arcs a piece of thin ink carries: up to three, each a
 * contiguous run of 40-100 degrees at a door's radius, most of whose length
 * is inked. `tolIn` is how far off the circle a pixel may lie and still be
 * the arc -- the hairline weight.
 */
function arcsIn(pts, minR, maxR, tolIn, rng) {
  const out = [];
  let live = pts;
  // A candidate circle is judged by the longest CONTIGUOUS run of angles it
  // covers, not by how many pixels lie on it: a circle through a closet's
  // hanger hatch collects inliers from a dozen strokes and no arc at all,
  // and on Bedroom 2 it outscored the door's own arc three passes running.
  const bins = new Uint16Array(90);
  const runOf = (c) => {
    bins.fill(0);
    let inl = 0;
    for (let q = 0; q < live.length; q += 2) {
      const dx = live[q] - c.cx, dy = live[q + 1] - c.cy;
      if (Math.abs(Math.hypot(dx, dy) - c.r) <= tolIn) { inl++; bins[(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 / 4) | 0]++; }
    }
    let best = 0, run = 0, gaps = 0;
    for (let t = 0; t < 180; t++) {           // twice round, so a run across 0 degrees counts
      if (bins[t % 90]) { run++; gaps = 0; } else if (++gaps > 1) { run = 0; } else run++;
      if (run > best) best = run;
    }
    return { inl, run: Math.min(best, 90) };
  };
  for (let pass = 0; pass < 6 && live.length / 2 >= 20; pass++) {
    const n = live.length / 2;
    let best = null;
    for (let it = 0; it < 120; it++) {
      const i = (rng() * n) | 0, j = (rng() * n) | 0, k = (rng() * n) | 0;
      if (i === j || j === k || i === k) continue;
      const c = circumcircle(live[2 * i], live[2 * i + 1], live[2 * j], live[2 * j + 1], live[2 * k], live[2 * k + 1]);
      if (!c || c.r < minR || c.r > maxR) continue;
      const { inl, run } = runOf(c);
      const score = run * c.r;                   // arc length covered
      if (!best || score > best.score) best = { ...c, inl, score };
    }
    if (!best || best.inl < 20) break;
    // Refine on the inliers, then measure the run of angles they cover.
    const take = [];
    for (let q = 0; q < live.length; q += 2) if (Math.abs(Math.hypot(live[q] - best.cx, live[q + 1] - best.cy) - best.r) <= tolIn) take.push(live[q], live[q + 1]);
    const fit = fitCircle(take) || best;
    if (fit.r < minR || fit.r > maxR) break;
    const bins = new Uint16Array(90);                 // 4-degree bins
    const rest = [];
    let inliers = 0;
    for (let q = 0; q < live.length; q += 2) {
      const dx = live[q] - fit.cx, dy = live[q + 1] - fit.cy;
      if (Math.abs(Math.hypot(dx, dy) - fit.r) <= tolIn) {
        inliers++;
        bins[(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 / 4) | 0]++;
      } else rest.push(live[q], live[q + 1]);
    }
    // The longest circular run of filled bins, allowing one empty bin inside
    // it (a dimension line or a fixture crossing the arc).
    let bestRun = null;
    for (let s = 0; s < 90; s++) {
      if (!bins[s] || bins[(s + 89) % 90]) continue;        // a run starts after an empty bin
      let len = 0, filled = 0, gaps = 0;
      for (let t = 0; t < 90; t++) {
        const b = bins[(s + t) % 90];
        if (b) { filled++; gaps = 0; } else if (++gaps > 1) break;
        len = t + 1;
      }
      while (len && !bins[(s + len - 1) % 90]) len--;
      if (!bestRun || filled > bestRun.filled) bestRun = { start: s * 4, span: len * 4, filled };
    }
    if (!bestRun && inliers) { let filled = 0; for (const b of bins) if (b) filled++; bestRun = { start: 0, span: 360, filled }; }
    if (!bestRun) break;
    const span = bestRun.span;
    // Expected pixels along the run at one per pixel of arc length; a drawn
    // arc has most of them, a scatter that happens to fit a circle does not.
    const expect = fit.r * span * Math.PI / 180;
    const inRun = bestRun.filled * 4 * fit.r * Math.PI / 180;
    if (span >= MIN_SPAN && span <= MAX_SPAN && inRun >= expect * 0.7) {
      out.push({ cx: fit.cx, cy: fit.cy, r: fit.r, a0: bestRun.start, span, inliers });
    }
    if (rest.length === live.length) break;
    live = rest;
  }
  return out;
}

/** A small deterministic generator, so a reading is the same reading twice. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Every swing door the drawing carries, from its symbol.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {object} o  `ftPerPx`; `segments` and `wallPx` (the traced walls,
 *   removed from the ink and the hinge's home); `shutOk(x0,y0,x1,y1)` may
 *   refuse a shut reading on a chord (a lined opening); `trace(record)` sees
 *   every arc and why it was refused
 * @returns {{doors: Array, arcs: number, lineWeight: number}} door records
 *   `{x, y, deg, radius, along, into, score, chord: {x0, y0, x1, y1}}`
 */
export function findDoorSymbols(mask, W, H, o = {}) {
  const scale = o.ftPerPx;
  if (!scale || !o.segments) return { doors: [], arcs: 0, lineWeight: 0 };
  const wallPx = o.wallPx || 8;
  // THE WALLS ARE EVERY WALL KNOWN: the extruder's (complete, a brush
  // narrower than drawn) and the reader's own raw runs (drawn width, but the
  // raw tracer drops whole walls -- The Sky's closet wall was not in them,
  // and a leaf lying against it read as a doorway). `segments` may be one
  // set or a list of sets; their union is the grid.
  const sets = Array.isArray(o.segments) ? o.segments : [o.segments];
  const walls = { horizontal: [], vertical: [] };
  for (const set of sets) {
    const sw = solidWalls(set, wallPx, o.lineFrac, { ftPerPx: scale });
    walls.horizontal.push(...sw.horizontal); walls.vertical.push(...sw.vertical);
  }
  const wall = wallGrid(W, H, walls, 2);
  const { thin, lineWeight: lw } = thinInk(mask, W, H, wall, Math.max(3, Math.round(wallPx * 0.35)));
  const tol = Math.max(2, Math.round(lw * 1.5));          // the drawing's own tolerance
  const minR = MIN_R_FT / scale, maxR = MAX_R_FT / scale;
  const rng = lcg(0x5eed);
  const pcs = pieces(thin, W, H, 20, 60000).filter((pts) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < pts.length; i += 2) { if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i]; if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1]; }
    const side = Math.max(x1 - x0, y1 - y0);
    return side >= minR * 0.8 && side <= maxR * 3;
  });
  const onWall = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi]; };
  // A leaf drawn open flat against a wall lies ON the wall's face line, inside
  // the tolerance of the wall itself; sampled against the wall padded by that
  // tolerance, it is "on wall" everywhere, which is what against-wall means.
  const wallNear = wallGrid(W, H, walls, tol + Math.round(lw));
  const onWallNear = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && wallNear[yi * W + xi]; };
  const nearWall = (x, y, d) => { for (let dy = -d; dy <= d; dy += 2) for (let dx = -d; dx <= d; dx += 2) if (onWall(x + dx, y + dy)) return true; return false; };
  const thickAt = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && mask[yi * W + xi] && !thin[yi * W + xi]; };
  const dir = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
  // A line from the hinge: inked (within `near`) over the part not on a wall; `n` off-wall samples.
  const line = (c, d, r, near) => {
    let n = 0, hit = 0;
    for (let k = 0.2; k <= 0.95; k += 0.05) {
      const x = c.cx + d[0] * r * k, y = c.cy + d[1] * r * k;
      if (onWallNear(x, y)) continue;
      n++;
      if (inkNear(mask, W, H, x, y, near)) hit++;
    }
    return { cover: n >= 8 ? hit / n : 0, n };
  };
  // THE FIT IS A SEED, THE INK IS THE JUDGE. A restyled arc is not a true
  // circle -- the model redraws it by hand -- and a least-squares circle on
  // most of one lands its centre a hand off the hinge (Plan A: 19px on a
  // 129px radius, and the leaf was then looked for a wall's thickness away
  // from where it lies). The centre and radius are moved within a fraction
  // of the radius to where the circle actually covers ink along the arc's
  // span, tightly, and the hinge is read from there.
  const refine = (a) => {
    const span = a.span, a0 = a.a0;
    const cover = (cx, cy, r, near) => {
      let n = 0, hit = 0;
      for (let deg = a0 + 4; deg <= a0 + span - 4; deg += 3) {
        n++;
        if (inkNear(mask, W, H, cx + Math.cos(deg * Math.PI / 180) * r, cy + Math.sin(deg * Math.PI / 180) * r, near)) hit++;
      }
      return n ? hit / n : 0;
    };
    const reach = Math.max(tol, Math.round(a.r * 0.18)), step = Math.max(1, Math.round(tol / 2));
    let best = { cx: a.cx, cy: a.cy, r: a.r, loose: cover(a.cx, a.cy, a.r, tol), tight: cover(a.cx, a.cy, a.r, Math.max(1, Math.round(lw / 2))) };
    for (let dy = -reach; dy <= reach; dy += step) for (let dx = -reach; dx <= reach; dx += step) {
      for (const rr of [a.r * 0.88, a.r * 0.94, a.r, a.r * 1.06, a.r * 1.12]) {
        const loose = cover(a.cx + dx, a.cy + dy, rr, tol);
        if (loose < best.loose - 0.02) continue;
        const tight = cover(a.cx + dx, a.cy + dy, rr, Math.max(1, Math.round(lw / 2)));
        if (loose > best.loose + 0.02 || tight > best.tight) best = { cx: a.cx + dx, cy: a.cy + dy, r: rr, loose, tight };
      }
    }
    return { ...a, cx: best.cx, cy: best.cy, r: best.r, cover: best.loose, tight: best.tight };
  };
  const doors = [];
  let arcs = 0;
  for (const pts of pcs) {
    for (const raw0 of arcsIn(pts, minR, maxR, Math.max(1.5, lw), rng)) {
      arcs++;
      const a = refine(raw0);
      const c = { cx: a.cx, cy: a.cy };
      const t = o.trace && { ...a, why: null };
      const seen = (why) => { if (t) { t.why = why; o.trace(t); } };
      if (a.cover < 0.7) { seen('arc not inked'); continue; }
      // The hinge sits on a wall -- within a quarter of the radius of the
      // fitted centre, because a short or hand-drawn arc's centre lands well
      // off it (Plan A's foyer door, drawn at 45 degrees, fitted 20px into
      // the room); the joint search below puts every candidate ON a wall.
      if (!nearWall(a.cx, a.cy, Math.max(Math.round(wallPx * 0.75) + tol, Math.round(a.r * 0.25)))) { seen('hinge off wall'); continue; }
      // Which end is shut: axis-aligned, its chord a doorway (no wall-thick
      // ink along it), its far point on the wall (the far jamb).
      // The shut end crosses the DOORWAY: little of its chord lies on a wall
      // (`alongWall`); the open end of a door lying flat against the next
      // wall runs along one. Both ends can be axis-aligned with a jamb at the
      // far point, and then the chord that is the gap is the shut one.
      const ends = [a.a0, a.a0 + a.span].map((deg) => {
        const d = dir(deg);
        const axis = Math.abs(d[0]) > 0.96 ? [Math.sign(d[0]), 0] : Math.abs(d[1]) > 0.96 ? [0, Math.sign(d[1])] : null;
        if (!axis) return { deg, d, ok: false };
        // `along`: the chord runs BESIDE a wall -- a wall within a wall's
        // thickness to either side for most of its length. A doorway's chord
        // has walls at its ends and nothing alongside; a leaf lying flat
        // against the next wall (drawn a hand off its face) has the wall
        // alongside the whole way, and was taken for the doorway on The Sky
        // three times when only the chord's own pixels were asked.
        const perp = [-axis[1], axis[0]];
        let thick = 0, along = 0, n = 0;
        for (let k = 0.15; k <= 0.9; k += 0.05) {
          n++;
          const x = a.cx + axis[0] * a.r * k, y = a.cy + axis[1] * a.r * k;
          if (thickAt(x, y)) thick++;
          if (onWallNear(x, y) || [0.6, 1.2, -0.6, -1.2].some((f) => onWall(x + perp[0] * wallPx * f, y + perp[1] * wallPx * f))) along++;
        }
        // The far jamb: on the wall at the chord's end -- or further along
        // it, where the tracer's doorway is wider than the drawn door (Jordan
        // 2: a 105px leaf in a 149px gap), with nothing wall-thick between.
        let far = nearWall(a.cx + axis[0] * (a.r + tol), a.cy + axis[1] * (a.r + tol), wallPx + tol);
        for (let k = 1.05; !far && k <= 1.6; k += 0.1) {
          const x = a.cx + axis[0] * a.r * k, y = a.cy + axis[1] * a.r * k;
          if (thickAt(x, y)) break;
          if (nearWall(x, y, wallPx + tol)) far = true;
        }
        // A chord that is wall-thick end to end is a doorway the render CLOSED
        // -- the restyle drew a wall across it and the tracer built one (the
        // marks page's "closed-opening"; Jordan's four doors with no doorway)
        // -- and the symbol beside it is the only thing that still says door.
        // Kept, flagged `merged`, for the caller to cut. Anything between --
        // part wall, part not -- is a wall with a symbol beside it, not a
        // doorway, and is refused.
        // The wall the door hangs on runs along the chord's axis and continues
        // BEHIND the hinge: a chord that leaves a wall's face at right angles
        // (down a cabinet's edge into a closet, Madison 4) has floor behind it.
        let behind = 0, bn = 0;
        for (let k = 0.5; k <= 1.6; k += 0.25) { bn++; if (onWallNear(a.cx - axis[0] * wallPx * k, a.cy - axis[1] * wallPx * k)) behind++; }
        const merged = thick / n >= 0.8;
        const open = thick / n <= 0.2 && along / n <= 0.5 && behind / bn >= 0.5;
        return { deg, d: axis, ok: (open || merged) && far, merged, thick: thick / n, along: along / n, far, behind: behind / bn };
      });
      if (t) t.ends = ends.map((e) => ({ deg: Math.round(e.deg), axis: !!e.d && Math.abs(e.d[0]) + Math.abs(e.d[1]) === 1, thick: e.thick, along: e.along, far: e.far, behind: e.behind }));
      const shut = ends.filter((e) => e.ok).sort((p, q) => (p.merged - q.merged) || (p.along - q.along))[0] || null;
      if (!shut) { seen('no shut end'); continue; }
      const open = ends.find((e) => e !== shut);
      const across = shut.d;
      // `into` is the perpendicular on the open end's side.
      const perp = [-across[1], across[0]];
      const into = (open.d[0] * perp[0] + open.d[1] * perp[1]) >= 0 ? perp : [-perp[0], -perp[1]];
      // A quarter drawn: the run loses its last bins where the arc meets the
      // wall and the leaf (both removed as wall or counted as leaf), so 75
      // degrees measured is a quarter.
      const deg = a.span >= 75 ? 90 : a.span;
      const rad = deg * Math.PI / 180;
      const openDir = [across[0] * Math.cos(rad) + into[0] * Math.sin(rad), across[1] * Math.cos(rad) + into[1] * Math.sin(rad)];
      // THE HINGE IS WHERE THE LEAF MEETS THE WALL, not the arc's centre. A
      // restyled arc is drawn by hand and its curvature centre sits a hand
      // off the hinge (Plan A: 19px on a 129px radius, both doors of the
      // master suite). So the hinge is searched near the centre for the point
      // that carries BOTH marks: the arc from the shut line to the leaf (read
      // loosely, since the curve is not a true circle) and the leaf itself --
      // open at the arc's end, shut along the doorway (a whole quarter only,
      // continuous within the hairline, never where the caller says the
      // opening is lined), or, for a quarter, lying flat along the next wall,
      // where the wall's own ink is the leaf's (never for a leaf at an
      // angle: a wall is not drawn at 45 degrees).
      const arcCover = (cx, cy, r) => {
        let n = 0, hit = 0;
        for (let d = 6; d <= deg - 6; d += 3) {
          const tt = d * Math.PI / 180;
          n++;
          if (inkNear(mask, W, H, cx + (across[0] * Math.cos(tt) + into[0] * Math.sin(tt)) * r, cy + (across[1] * Math.cos(tt) + into[1] * Math.sin(tt)) * r, tol * 2)) hit++;
        }
        return n ? hit / n : 0;
      };
      const rawLine = (cx, cy, d, r) => {
        let n = 0, hit = 0;
        for (let k = 0.2; k <= 0.95; k += 0.05) { n++; if (inkNear(mask, W, H, cx + d[0] * r * k, cy + d[1] * r * k, tol)) hit++; }
        return hit / n;
      };
      const shutAllowed = deg === 90 && !shut.merged && (!o.shutOk || o.shutOk({ x0: a.cx, y0: a.cy, x1: a.cx + across[0] * a.r, y1: a.cy + across[1] * a.r }));
      const reach = Math.max(tol, Math.round(a.r * 0.2)), step = Math.max(2, Math.round(tol));
      let best = null;
      for (let dy = -reach; dy <= reach; dy += step) for (let dx = -reach; dx <= reach; dx += step) {
        const cx = a.cx + dx, cy = a.cy + dy;
        if (!nearWall(cx, cy, Math.round(wallPx * 0.75) + tol)) continue;
        for (const r of [a.r * 0.85, a.r * 0.92, a.r, a.r * 1.08, a.r * 1.16]) {
          const arc = arcCover(cx, cy, r);
          if (arc < 0.7) continue;
          const cc = { cx, cy };
          const op = line(cc, openDir, r, tol);
          const sh = shutAllowed ? line(cc, across, r, Math.max(1, Math.round(lw))) : { cover: 0, n: 0 };
          const raw = deg === 90 ? rawLine(cx, cy, openDir, r) : 0;
          const againstWall = deg === 90 && op.cover < 0.55 && raw >= 0.7;
          const leaf = againstWall ? raw : Math.max(op.cover, sh.cover);
          if (leaf < 0.55) continue;
          const score = Math.min(arc, leaf);
          if (!best || score > best.score) best = { cx, cy, r, arc, leaf, score, againstWall, shut: !againstWall && sh.cover > op.cover };
        }
      }
      if (t) { t.best = best && { x: Math.round(best.cx), y: Math.round(best.cy), r: Math.round(best.r), arc: +best.arc.toFixed(2), leaf: +best.leaf.toFixed(2) }; }
      if (!best) { seen('no leaf'); continue; }
      if (!sweptIsClear(mask, W, H, [best.cx, best.cy], across, into, best.r, deg, tol)) { seen('sector not clear'); continue; }
      seen('ok');
      doors.push({
        x: best.cx, y: best.cy, deg: best.shut ? 0 : deg, radius: best.r,
        along: across, into, score: best.score, span: a.span, merged: !!shut.merged,
        chord: { x0: best.cx, y0: best.cy, x1: best.cx + across[0] * best.r, y1: best.cy + across[1] * best.r },
      });
    }
  }
  // One record per hinge: the same arc read from two pieces, or twice at
  // close radii, is one door.
  const kept = [];
  for (const d of doors.sort((p, q) => q.score - p.score)) {
    if (kept.some((k) => Math.hypot(k.x - d.x, k.y - d.y) <= tol * 2 && Math.abs(k.radius - d.radius) <= d.radius * 0.15)) continue;
    kept.push(d);
  }
  return { doors: kept, arcs, lineWeight: lw, thin: o.keepThin ? thin : undefined, wall: o.keepThin ? wall : undefined, pieces: o.keepThin ? pcs.length : undefined };
}
