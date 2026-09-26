// THE CLOSET, READ AS A THING -- so its door can be read as a door.
//
// A closet door drawn shut across its mouth is two panels overlapping on two
// tracks (a bypass pair), a zigzag (a bifold), or one bar (a shut leaf). The
// first of those is also, stroke for stroke, a sliding window's symbol, and
// on Jordan's basement four windows hung as doors the day the pair was read;
// so it was not read, and Plan A's three closets stood open in the 3D with
// the symbol plain on the floor (Saman, 2026-09-14).
//
// What tells them apart is not in the symbol but around it: a closet is a
// shallow CLOSED CELL behind its mouth -- flood from just inside the mouth
// with the mouth sealed and the flood stops within a few feet on every side
// (the fireplace's own test) -- and the cell carries the drafter's closet
// furniture: a rod line parallel to the mouth, a shelf line (often dashed),
// or the row of hanger strokes along the rod. A window has no cell behind
// it, or an unbounded one.
//
// Everything in render pixels; the caller maps to the model's feet.

import { cellBehind } from './fireplace.js';

/**
 * The longest DASHED LINE among a row's hairline pieces: consecutive pieces
 * whose lengths and gaps stay within a factor of two of the first pair's.
 *
 * A shelf is drawn dashed, and a dash is whatever length the drafter's
 * pattern sets: Jordan 4 dashes its bedroom closet's shelf at 0.4ft, and the
 * hand's width that bounds a hanger stroke (0.35ft) threw all thirteen away.
 * Lifting that bound for dashes alone let a tub's outline in, its curve
 * crossing a row as short pieces (The Sky's bath read as a closet). What a
 * dashed line has and an outline does not is a PATTERN: the same piece, the
 * same gap, again and again.
 */
export function dashedRun(pieces) {
  let best = pieces.length ? 1 : 0;
  for (let i = 0; i + 1 < pieces.length; i++) {
    const len0 = pieces[i][1] - pieces[i][0], gap0 = pieces[i + 1][0] - pieces[i][1];
    if (gap0 <= 0) continue;
    let n = 1;
    for (let j = i + 1; j < pieces.length; j++) {
      const len = pieces[j][1] - pieces[j][0], gap = pieces[j][0] - pieces[j - 1][1];
      if (len < len0 / 2 || len > len0 * 2 || gap < gap0 / 2 || gap > gap0 * 2) break;
      n++;
    }
    if (n > best) best = n;
  }
  return best;
}

/**
 * The longest ROW OF HANGERS among the strokes crossing one row, `{at, len}`
 * in order along it: consecutive strokes whose lengths and spacing stay
 * within a factor of two of the first pair's -- dashedRun's rule, for the
 * same reason. A closet's hangers are one tick drawn again and again at one
 * pitch; furniture crosses a row as the edges of closed outlines, of every
 * length at every spacing. The Sky 2b vanity crossed one row twelve times
 * (each basin's double rim and its tap: 20 to 47px long, 3 to 86px apart)
 * and read as a closet with a 9ft door.
 */
export function hangerRun(strokes) {
  let best = strokes.length ? 1 : 0;
  for (let i = 0; i + 1 < strokes.length; i++) {
    const len0 = strokes[i].len, gap0 = strokes[i + 1].at - strokes[i].at;
    if (gap0 <= 0) continue;
    let n = 1;
    for (let j = i + 1; j < strokes.length; j++) {
      const len = strokes[j].len, gap = strokes[j].at - strokes[j - 1].at;
      if (len < len0 / 2 || len > len0 * 2 || gap < gap0 / 2 || gap > gap0 * 2) break;
      n++;
    }
    if (n > best) best = n;
  }
  return best;
}

/**
 * Every closet mouth among the doorways.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {Uint8Array} ground  the extruder's walls, 1 per pixel (wallRaster)
 * @param {Array} gaps  doorways `{x0,y0,x1,y1,horizontal,face?}`
 * @param {object} o  `ftPerPx`, `wallPx`
 * @returns {Map<object, {side:number, depth:number, span:number, hatch:number, rod:boolean, cell:object}>}
 */
export function findClosets(mask, ground, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  const out = new Map();
  if (!scale) return out;
  const px = (ft) => ft / scale;
  for (const gap of gaps) {
    const hz = !!gap.horizontal;
    const [c0, c1] = gap.face || (hz ? [gap.y0, gap.y1] : [gap.x0, gap.x1]);
    const a0 = hz ? gap.x0 : gap.y0, a1 = hz ? gap.x1 : gap.y1;
    const w = a1 - a0;
    if (w * scale < 2 || w * scale > 10) continue;
    for (const side of [1, -1]) {
      const cell = cellBehind(ground, W, H, gap, side, { cap: px(14) * px(5), seal: Math.round(o.wallPx || px(0.5)) });
      if (!cell) continue;
      const depth = hz ? (side > 0 ? cell.y1 - c1 : c0 - cell.y0) : (side > 0 ? cell.x1 - c1 : c0 - cell.x0);
      const span = hz ? cell.x1 - cell.x0 : cell.y1 - cell.y0;
      // A reach-in closet: a foot and a half to four and a half deep, no
      // wider than a bedroom wall, and wide enough for its own mouth.
      if (depth * scale < 1.3 || depth * scale > 4.5 || span * scale > 14 || span < w * 0.8) continue;
      // Its furniture, read along rows parallel to the mouth inside the cell:
      // a ROD is a run over half the span; HANGERS are strokes crossing a
      // row -- each a short run on the row, and walked along the stroke a
      // hand to a foot and a half long, never wall to wall (a stair's treads
      // cross the rows too, and span the cell: The Sky's stairs read as a
      // closet three times when runs alone were counted; so did Geena's bath
      // alcove on its outline); a SHELF is a dashed line, short runs along
      // one row that are no thicker than a hairline.
      const inCell = (x, y) => x >= cell.x0 && x < cell.x1 && y >= cell.y0 && y < cell.y1 && !ground[y * W + x] && mask[y * W + x];
      const face = side > 0 ? c1 : c0;
      const s0 = Math.round(hz ? cell.x0 : cell.y0), s1 = Math.round(hz ? cell.x1 : cell.y1);
      const at = (a, c) => inCell(hz ? a : c, hz ? c : a);
      // The stroke through (a, c) across the row: walked both ways along c.
      const strokeLen = (a, c) => {
        let len = 1;
        for (const dir of [1, -1]) {
          let miss = 0;
          for (let k = 1; k < span; k++) {
            const cc = c + dir * k;
            let hit = false;
            for (let da = -1; da <= 1 && !hit; da++) if (at(a + da, cc)) hit = true;
            if (hit) { len++; miss = 0; } else if (++miss > 1) break;
          }
        }
        return len;
      };
      let rod = false, hatch = 0, dashes = 0;
      // EVERY ROW FOR WHAT RUNS ALONG ONE. A rod and a shelf are hairlines,
      // one pixel where the render drew them, and a scan every other row
      // stepped over whichever fell on an odd one: Jordan 4's rod lies on a
      // single row (1363) that the scan never read, and its closet was
      // "empty". A hanger crosses the rows and cannot fall between two, so
      // it is still counted on every other row: counted on all of them, the
      // appliances in Madison's laundry and a bath's fittings in run9 found
      // one row each with four strokes, and read as closets.
      const d0 = Math.round(px(0.3));
      for (let d = d0; d < depth - 2; d += 1) {
        const everyOther = (d - d0) % 2 === 0;
        const c = Math.round(face + side * d);
        const runs = [];
        let start = null;
        for (let a = s0; a <= s1; a++) {
          const on = a < s1 && at(a, c);
          if (on && start === null) start = a;
          if (!on && start !== null) { runs.push([start, a]); start = null; }
        }
        if (runs.some(([a, b]) => b - a >= span * 0.5)) rod = true;
        let dash = 0;
        const pieces = [], strokes = [];
        for (const [a, b] of runs) {
          const wide = b - a;
          const len = strokeLen(Math.round((a + b) / 2), c);
          // A hairline piece along the row, whatever its length: the stuff
          // of a dashed line (below).
          if (len <= 3 && wide >= 2 && wide < span * 0.25) pieces.push([a, b]);
          if (wide > px(0.35)) continue;
          if (len * scale >= 0.25 && len * scale <= 1.6 && len < span * 0.8) { if (everyOther) strokes.push({ at: (a + b) / 2, len }); }
          else if (len <= 3 && wide >= 2) dash++;
        }
        hatch = Math.max(hatch, hangerRun(strokes));
        dashes = Math.max(dashes, dash, dashedRun(pieces));
      }
      if (hatch < 4 && !(dashes >= 4 && rod)) continue;
      out.set(gap, { side, depth, span, hatch, rod, dashes, cell });
      break;
    }
  }
  return out;
}

/**
 * A CLOSET DRAWN IN THIN LINES, which the walls never see.
 *
 * Plan A draws its hall closet beside BATH 2 the way its source does: a box of
 * thin double lines, a rod down its middle crossed by hangers, a pair of
 * doors on its open side, and the bath's wall behind it. The tracer builds
 * walls from wall ink, so the closet's three thin sides were never built, its
 * interior was part of the hall and its doors hung in nothing. This reads it
 * as a person reads it:
 *
 *  - THE ROD: a straight hairline a foot and a third long or more.
 *  - THE BOX: from the rod outward, the first line along its whole length on
 *    each side; from the rod's middle outward, the first line across the box
 *    from side to side at each end.
 *  - THE HANGERS: four strokes or more across the rod inside the box, each
 *    stopping short of the sides. A stair's treads cross its stringer too, but
 *    they run wall to wall (the rule findClosets holds its hangers to).
 *  - THE MOUTH: a long side drawn thin, with the most ink just beyond it,
 *    where the doors' symbol is. A closet opening on its end is a walk-in and
 *    is not read here.
 *
 * Every other side is read position by position along its length, from its
 * inner face outward: a thin wall is drawn as two faces, the second within
 * half a wall of the first. Where the inner face is a wall already
 * (`o.wallAt`), nothing is added. Where a wall stands within a wall's
 * thickness behind the line, the line is that wall's lining, and the sliver
 * between them is filled so the closet's inside is where it is drawn. Where
 * nothing stands behind it, the drawn band is the partition. A closet with
 * no thin side left is all wall, and is left to the walls.
 *
 * Handed back in the image's own pixels: the box (inner faces), the mouth (a
 * rectangle across the door line as thick as it is drawn, between the ends'
 * inner faces) and the partitions to build.
 *
 * @param {Uint8Array} mask  the symbols' ink (window-read.js symbolInk), full size
 * @param {object} o  `ftPerPx` and `wallPx` in the image's pixels,
 *   `wallAt(x, y)`: is there wall already built at this image pixel, and
 *   `minThick`: the thinnest side the model can build, in image pixels
 * @returns {Array<{box:object, mouth:object, horizontal:boolean, partitions:Array, hangers:number}>}
 */
export function findThinClosets(mask, W, H, o = {}) {
  const scale = o.ftPerPx;
  if (!scale) return [];
  const px = (ft) => ft / scale;
  const wallPx = o.wallPx || px(0.4);
  const wallAt = o.wallAt || (() => false);
  // The thinnest side the model can build (outline.js thinnestTraced); a
  // side drawn thinner is built this thick, grown away from the closet.
  const minThick = o.minThick || 0;
  const inkAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  // A thin wall's second face lies within half a wall of its first; a break
  // in a line shorter than that is the same line.
  const G = Math.max(2, Math.round(wallPx / 2));
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const out = [];
  for (const hz of [true, false]) {                 // the rod along x, or along y
    const A = hz ? W : H, C = hz ? H : W;
    const at = (a, c) => (hz ? inkAt(a, c) : inkAt(c, a));
    const walled = (a, c) => (hz ? wallAt(a, c) : wallAt(c, a));
    const rect = (aLo, aHi, cLo, cHi) => (hz ? { x0: aLo, x1: aHi, y0: cLo, y1: cHi } : { x0: cLo, x1: cHi, y0: aLo, y1: aHi });
    const rods = [];
    for (let c = 4; c < C - 4; c++) {
      let s = -1, miss = 0;
      const close = (e) => {
        if (s >= 0 && e - s >= px(1.3)) rods.push({ c, s, e });
        s = -1;
      };
      for (let a = 0; a <= A; a++) {
        if (a < A && at(a, c)) { if (s < 0) s = a; miss = 0; }
        else if (s >= 0 && ++miss > 2) close(a - miss + 1);
      }
      if (s >= 0) close(A);
    }
    for (const r of rods) {
      // A hairline: clear three pixels to either side along most of it
      // (where a hanger crosses it, it is not).
      let clear = 0, n = 0;
      for (let a = r.s; a < r.e; a += 2) { n++; if (!at(a, r.c - 3) && !at(a, r.c + 3)) clear++; }
      if (!n || clear / n < 0.5) continue;
      // The long sides: the first line along the rod's whole length.
      const sideAt = (dir) => {
        for (let d = 6; d <= px(3); d++) {
          let hit = 0, m = 0;
          for (let a = r.s; a < r.e; a += 2) { m++; if (at(a, r.c + dir * d)) hit++; }
          if (m && hit / m >= 0.8) return r.c + dir * d;
        }
        return null;
      };
      const c0 = sideAt(-1), c1 = sideAt(1);
      if (c0 == null || c1 == null) continue;
      const depth = c1 - c0;
      if (depth * scale < 1.3 || depth * scale > 5) continue;
      // The ends: from the rod's middle outward, the first line across the box
      // that reaches both sides -- a hanger stops short of them.
      const across = (a) => {
        if (!(at(a, c0 + 2) || at(a, c0 + 3)) || !(at(a, c1 - 2) || at(a, c1 - 3))) return false;
        let hit = 0, m = 0;
        for (let c = c0 + 2; c < c1 - 1; c += 2) { m++; if (at(a, c)) hit++; }
        return m > 0 && hit / m >= 0.8;
      };
      const endAt = (dir) => {
        const lim = (dir < 0 ? r.s : r.e) + dir * px(1.2);
        for (let a = (r.s + r.e) >> 1; dir < 0 ? a >= lim : a <= lim; a += dir) if (across(a)) return a;
        return null;
      };
      const a0 = endAt(-1), a1 = endAt(1);
      if (a0 == null || a1 == null) continue;
      // The rod runs between them, into their drawn lines at most.
      if (a0 - r.s > wallPx || r.e - a1 > wallPx || a1 - a0 < depth || (a1 - a0) * scale > 14) continue;
      if ((Math.min(r.e, a1) - Math.max(r.s, a0)) < (a1 - a0) * 0.6) continue;
      // Hangers: strokes through the rod inside the box, inked four pixels off
      // it on both sides within a few pixels along, each stopping short of the
      // sides. Consecutive positions are one stroke.
      const cross = [];
      for (let a = a0 + 2; a < a1 - 1; a++) {
        let up = false, dn = false;
        for (let d = -3; d <= 3 && !(up && dn); d++) { if (at(a + d, r.c - 4)) up = true; if (at(a + d, r.c + 4)) dn = true; }
        if (!(up && dn)) continue;
        if (cross.length && a - cross[cross.length - 1].e <= 2) cross[cross.length - 1].e = a; else cross.push({ s: a, e: a });
      }
      const reach = (s, dir) => {
        const lim = Math.abs((dir < 0 ? c0 : c1) - r.c) - 2;
        let far = 0;
        for (let d = 4; d < lim; d++) {
          let hit = false;
          for (let da = -8; da <= 8 && !hit; da++) if (at(((s.s + s.e) >> 1) + da, r.c + dir * d)) hit = true;
          if (hit) far = d; else break;
        }
        return far;
      };
      const hangers = cross.filter((s) => reach(s, -1) < (r.c - c0) - 3 && reach(s, 1) < (c1 - r.c) - 3).length;
      if (hangers < 4) continue;
      // THE SIDES, position by position. `L` is the inner face, `dir` outward;
      // `pix(t, d)` and `wal(t, d)` read d pixels out from it at position t.
      const sides = [
        { long: true, L: c0, dir: -1 }, { long: true, L: c1, dir: 1 },
        { long: false, L: a0, dir: -1 }, { long: false, L: a1, dir: 1 },
      ];
      for (const sd of sides) {
        sd.pix = sd.long ? (t, d) => at(t, sd.L + sd.dir * d) : (t, d) => at(sd.L + sd.dir * d, t);
        sd.wal = sd.long ? (t, d) => walled(t, sd.L + sd.dir * d) : (t, d) => walled(sd.L + sd.dir * d, t);
      }
      const probe = (sd, t) => {
        if (!(sd.pix(t, -1) || sd.pix(t, 0) || sd.pix(t, 1) || sd.pix(t, 2))) return { kind: 'none' };
        if (sd.wal(t, 0) || sd.wal(t, 1)) return { kind: 'wall' };
        let last = 0;
        for (let d = 1; d <= wallPx; d++) {
          if (sd.wal(t, d)) return { kind: 'backed', out: d };
          if (sd.pix(t, d)) last = d;
          else if (d - last > G) break;
        }
        return { kind: 'thin', out: last + 1 };
      };
      // Each side's own reading over the box's inner span: the kind most of
      // it is, and how far out its band reaches.
      for (const sd of sides) {
        const [t0, t1] = sd.long ? [a0, a1] : [c0, c1];
        const ps = [];
        for (let t = t0; t <= t1; t++) ps.push(probe(sd, t));
        const count = (k) => ps.filter((p) => p.kind === k).length;
        sd.thin = count('thin') / ps.length;
        sd.kind = ['thin', 'backed', 'wall', 'none'].reduce((b, k) => (count(k) > count(b) ? k : b), 'none');
        const outs = ps.filter((p) => p.out).map((p) => p.out);
        sd.out = outs.length ? median(outs) : 1;
      }
      // The mouth: a long side drawn thin, with the most ink just beyond its band.
      const beyond = (sd) => {
        let hit = 0, m = 0;
        for (let a = a0 + 4; a < a1 - 4; a += 2) {
          m++;
          let h = false;
          for (let d = sd.out + 2; d <= sd.out + px(1.2) && !h; d += 2) if (sd.pix(a, d)) h = true;
          if (h) hit++;
        }
        return m ? hit / m : 0;
      };
      const longs = sides.filter((sd) => sd.long && sd.kind === 'thin').map((sd) => ({ sd, ink: beyond(sd) })).sort((p, q) => q.ink - p.ink);
      if (!longs.length || longs[0].ink < 0.3) continue;
      const mouth = longs[0].sd;
      // Nothing to build unless a side other than the mouth is drawn thin for
      // a quarter of its length.
      const rest = sides.filter((sd) => sd !== mouth);
      if (!rest.some((sd) => sd.thin >= 0.25)) continue;
      // Each side over its span and across the corners (the other two sides'
      // bands), in runs: short runs of any kind belong to their neighbours.
      const band = (sd, o2) => (sd.dir < 0 ? [sd.L - o2 + 1, sd.L + 1] : [sd.L, sd.L + o2]);
      const partitions = [];
      for (const sd of rest) {
        const [lo, hi] = sd.long
          ? [band(sides[2], sides[2].out)[0], band(sides[3], sides[3].out)[1]]
          : [band(sides[0], sides[0].out)[0], band(sides[1], sides[1].out)[1]];
        const runs = [];
        for (let t = lo; t < hi; t++) {
          const p = probe(sd, t);
          const last = runs[runs.length - 1];
          if (last && last.kind === p.kind) { last.t1 = t + 1; if (p.out) last.outs.push(p.out); }
          else runs.push({ kind: p.kind, t0: t, t1: t + 1, outs: p.out ? [p.out] : [] });
        }
        for (let i = 0; i < runs.length; i++) {
          const q = runs[i];
          if (q.t1 - q.t0 >= G || runs.length === 1) continue;
          const nb = runs[i - 1] || runs[i + 1];
          if (i > 0) { nb.t1 = q.t1; nb.outs.push(...q.outs); } else { nb.t0 = q.t0; nb.outs.push(...q.outs); }
          runs.splice(i, 1);
          i--;
        }
        for (const q of runs) {
          if (q.kind !== 'thin' && q.kind !== 'backed') continue;
          const o2 = Math.max(q.kind === 'backed' ? Math.max(...q.outs) : median(q.outs), Math.ceil(minThick));
          const [b0, b1] = band(sd, o2);
          partitions.push(sd.long ? rect(q.t0, q.t1, b0, b1) : rect(b0, b1, q.t0, q.t1));
        }
      }
      if (!partitions.length) continue;
      // The doorway: across the mouth's drawn band, between the ends' inner faces.
      const [m0, m1] = band(mouth, mouth.out);
      out.push({
        box: rect(a0, a1 + 1, c0, c1 + 1),
        mouth: { ...rect(a0 + 1, a1, m0, m1), horizontal: hz },
        horizontal: hz, partitions, hangers,
      });
    }
  }
  // One closet, read once: a second rod inside a box already found is the same closet.
  const kept = [];
  const inside = (p, q) => p.box.x0 >= q.box.x0 - 4 && p.box.x1 <= q.box.x1 + 4 && p.box.y0 >= q.box.y0 - 4 && p.box.y1 <= q.box.y1 + 4;
  for (const k of out) if (!kept.some((q) => inside(k, q) || inside(q, k))) kept.push(k);
  return kept;
}
