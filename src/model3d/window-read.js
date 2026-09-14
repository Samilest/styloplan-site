// THE WINDOWS OF A RENDER, READ ONCE AND READ THE SAME WAY EVERYWHERE.
//
// view3d read the windows for the builder's own model and cloud-publish read
// them again, in its own copy of the same steps, for the published record —
// and the copies drifted: the publisher filled windows the viewer had stopped
// filling, and knew nothing of the kinds the viewer had learned to draw. One
// reading now, in one file, and the record a visitor is handed carries every
// opening the builder saw, with its kind and its units.
//
// Everything here is in the render's own pixels. The caller maps to the
// model's feet, because only the caller knows the extent it traced.

import {
  planGaps, glazedOpenings, exteriorGaps, medianWallThickness, classifyOpening,
  outdoorSeeds, interiorWindows, windowStyle, mergeParallel, bandStats,
  wallSegments, ftPerPx,
} from './openings.js';
import { roomGraph } from './rooms.js';
import { calibrateWidthFt } from './calibrate.js';
import { findDoors, findArcDoors, findBifolds, findSlidingDoors, wallGrid } from './doors.js';
import { findDoorSymbols } from './door-symbols.js';
import { findFireplaces } from './fireplace.js';
import { findClosets } from './closets.js';

// ---------------------------------------------------------------------------
// THE WHOLE READING OF A RENDER, IN ONE PLACE, because it was in three.
//
// view3d, the publisher (cloud-publish.js) and the corpus gate
// (test/trace-coverage.mjs) each carried their own copy of the same five
// steps -- threshold the ink, trace at the assumed width, calibrate the width
// from the confirmed rooms, trace again at the measured width, read the
// openings between the walls -- and two of the three copies read the openings
// between the walls of the FIRST trace while shipping or drawing the second.
// The Star, assumed 40ft and measured 101ft: at 40ft the tracer seals a
// bedroom closet's corner into one 44px block; the reader took the block for
// a wall end, looked down from it, and found a 12.9ft "opening" along the
// west wall, four walls deep, which the market look framed as a glass slab
// over the bedroom -- on the builder's page and in the record every visitor
// got. The gate, whose copy read between the second trace's walls, passed.
//
// One function now; the three callers hand it the picture and get back the
// width, the trace and the reading, made from each other. A gate that runs
// the same function the page runs measures the page.

/**
 * The plan's ink and its wall runs, the one way every reader thresholds it.
 * Browser-only (a canvas); a caller that keeps its own cache wraps this.
 *
 * Polarity is MEASURED, never assumed. On a dark render the walls are the
 * bright minority; reading it the other way returns the negative of the plan,
 * which still looks like a floor plan and is entirely wrong.
 */
export function planInkOf(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let total = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
    total += lum[p];
  }
  const inverted = total / (w * h) < 128;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) ink[p] = (inverted ? lum[p] > 150 : lum[p] < 105) ? 1 : 0;
  // openings.js carries the measured defaults; overriding them here is what
  // made view3d disagree with every sweep run against it.
  const seg = wallSegments(ink, w, h, {});
  // Both directions and the sparse-band symbols, from one place (planGaps).
  const gaps = planGaps(seg, { minGap: 20, maxGap: 400 });
  return { ink, w, h, seg, gaps };
}

/**
 * Calibrate, trace, read -- from one picture, on one set of walls.
 *
 * @param {object} o
 * @param {object} o.plan  planInkOf's record (ink, w, h, seg, gaps)
 * @param {object} o.first  the extrudeWalls result at `assumedWidthFt`; the
 *   contest between a floor's renders needs one before anything is measured
 * @param {Array}  o.labels  the confirmed room names, in the render's frame
 * @param {number} o.assumedWidthFt  what `first` was traced at
 * @param {function} o.retrace  `(widthFt) => extrudeWalls(img, widthFt, ...)`
 *   with the caller's own options (sheet colour, floor texture or not)
 * @returns {{widthFt:number, calibrated:boolean, why:string, ex:object,
 *   scale:number|null, plan:object, read:{fills:Array, openings:Array, note:string}}}
 *   `ex` is the trace the openings were read between -- the one to build,
 *   ship and measure; `plan` is planFromReading's, its walls `ex`'s.
 */
export function readPlan({ plan, first, labels = [], assumedWidthFt, retrace }) {
  let widthFt = assumedWidthFt, why = 'no labels', calibrated = false;
  if (first?.trim && labels.length) {
    // The plan flooded into rooms with no scale at all; each labelled room
    // votes with its confirmed dimension (calibrate.js).
    const g = roomGraph({ mask: plan.ink, W: plan.w, H: plan.h, segments: plan.seg, gaps: plan.gaps, doors: [] });
    const cal = calibrateWidthFt({
      labels, rooms: g.rooms, roomAt: g.roomAt, imgW: plan.w, imgH: plan.h,
      buildingPx: (first.trim.x1 - first.trim.x0) * plan.w, fallback: assumedWidthFt,
    });
    why = cal.why;
    if (cal.calibrated) { widthFt = cal.widthFt; calibrated = true; }
  }
  // THE WALLS THE OPENINGS ARE READ BETWEEN ARE THE WALLS THAT ARE BUILT. A
  // trace at the assumed width is a trace of a different-sized house: its
  // brush, its floors and its size test are all in feet.
  const ex = calibrated ? retrace(widthFt) : first;
  const scale = ex?.extent ? ftPerPx(plan.seg, widthFt) : null;
  const between = ex?.extent && scale ? planFromReading(plan, ex, scale) : plan;
  const read = scale
    ? readWindows(between, scale, labels, { wallPx: ex.wallFloorFt ? ex.wallFloorFt / scale : undefined })
    : { fills: [], openings: [], note: 'no scale' };
  return { widthFt, calibrated, why, ex, scale, plan: between, read };
}

/**
 * THE WALLS THE 3D IS BUILT FROM, in the render's pixels, as the wall runs the
 * opening reader works between.
 *
 * ONE NOTION OF WALL. The reader used to trace its own walls out of the raw
 * ink (`wallSegments`) while the extruder traced the ones it builds out of a
 * mask it has opened with a brush the plan's own thickness sets -- and the
 * two disagreed exactly where it mattered. Plan A: the extruder cut every
 * front window out of the wall, so the model showed a gap there; the reader
 * kept the window's 2px face line as a "wall", found no gap, classified
 * nothing, and the gap stood bare. The master closet's hanger hatch was ink
 * enough to be a wall to the reader and a 10ft-thick "interior window" to the
 * engine, which drew a slab over the closet. Neither can happen when the
 * reader's walls ARE the extruder's: every gap the model shows is a gap the
 * reader classifies, and nothing the brush erased can be a wall.
 *
 * `inkRects` are tiles in mask pixels (extrudeWalls' working width); scaled
 * here to the render, split by orientation and merged where two tiles are
 * one wall (mergeParallel, the same fold wallSegments makes) -- traceRects
 * tiles a thick wall into stacked slices, and unmerged each slice is its own
 * line with its own copy of every gap: The Star's top wall came back with
 * eight windows twice, at two bands, with two verdicts. No bridges, no
 * symbols: a symbol line is not a wall in the mask, so it is a gap here,
 * read from the raw ink by classifyOpening and windowStyle like any other.
 *
 * @param {object} ex  an extrudeWalls result (needs inkRects, maskW, maskH)
 * @param {number} w  render width in pixels
 * @param {number} h  render height in pixels
 * @returns {{horizontal:Array, vertical:Array, bridges:Array, symbols:Array}|null}
 */
export function wallsFromReading(ex, w, h) {
  if (!ex?.inkRects?.length || !ex.maskW || !ex.maskH) return null;
  const sx = w / ex.maskW, sy = h / ex.maskH;
  const horizontal = [], vertical = [];
  for (const r of ex.inkRects) {
    const s = {
      x0: Math.round(r.x0 * sx), y0: Math.round(r.y0 * sy),
      x1: Math.round(r.x1 * sx), y1: Math.round(r.y1 * sy),
    };
    if (s.x1 - s.x0 >= s.y1 - s.y0) horizontal.push(s); else vertical.push(s);
  }
  // The fold's ceiling rides on the plan's own thickness, as in wallSegments:
  // two slices of one wall are at most a wall apart; two walls of a corridor
  // are further.
  // The plan's own wall thickness, as the extruder measured it (wallFloorFt in
  // feet, feetPerPixel in mask pixels), rather than the median tile: on Jordan
  // (2) the tiles' median is a sliver and 2.2 of it does not reach across a
  // wall's two slices, so every gap in that wall came back twice.
  const th = [...horizontal.map((r) => r.y1 - r.y0), ...vertical.map((r) => r.x1 - r.x0)].sort((a, b) => a - b);
  const median = th.length ? th[Math.floor(th.length / 2)] : 0;
  // A wall and a quarter reaches across one wall's slices and stops short of
  // the next wall over (2.2 of the extruder's thickness merged a corridor's
  // two walls on The Star and lost the windows in one of them).
  const wallPx = ex.wallFloorFt && ex.feetPerPixel ? (ex.wallFloorFt / ex.feetPerPixel) * sx : 0;
  const maxThick = Math.round(Math.max(median * 2.2, wallPx * 1.25));
  return {
    horizontal: mergeParallel(horizontal, true, maxThick),
    vertical: mergeParallel(vertical, false, maxThick),
    bridges: [], symbols: [],
  };
}

/**
 * A gap with a solid pier inside it is two gaps.
 *
 * The extruder drops a pier narrower than the plan's wall floor (Plan A: the
 * 0.4ft nib between the living room's slider and the front door, on a plan
 * whose walls are 0.44ft), so between its walls the window and the door are
 * one 12.7ft hole that classifies as nothing. The ink still has the pier:
 * solid across the whole band, a few pixels wide. Cut there and each side
 * reads as what it is. A pier is ink through at least nine tenths of the
 * band's rows over at least three columns -- the raw-ink signature of a wall
 * end, the same one the jamb-return test keys on.
 */
export function splitAtPiers(gaps, ink, W, H, opts = {}) {
  const solidFrac = opts.solidFrac ?? 0.9;
  const minPier = opts.minPier ?? 3;
  const minGap = opts.minGap ?? 20;
  const out = [];
  for (const g of gaps) {
    const [c0, c1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const lo = Math.max(0, Math.floor(c0)), hi = Math.min(g.horizontal ? H : W, Math.ceil(c1));
    const rows = hi - lo;
    const a0 = g.horizontal ? g.x0 : g.y0, a1 = g.horizontal ? g.x1 : g.y1;
    if (rows <= 0 || a1 - a0 < minGap * 2) { out.push(g); continue; }
    const solid = (a) => {
      let n = 0;
      for (let c = lo; c < hi; c++) n += ink[g.horizontal ? c * W + a : a * W + c];
      return n / rows >= solidFrac;
    };
    const cuts = [];
    for (let a = a0; a < a1;) {
      if (!solid(a)) { a++; continue; }
      let e = a;
      while (e + 1 < a1 && solid(e + 1)) e++;
      if (e - a + 1 >= minPier) cuts.push([a, e + 1]);
      a = e + 1;
    }
    if (!cuts.length) { out.push(g); continue; }
    let start = a0;
    for (const [p0, p1] of cuts.concat([[a1, a1]])) {
      if (p0 - start >= minGap) {
        out.push(g.horizontal
          ? { ...g, x0: start, x1: p0, split: true }
          : { ...g, y0: start, y1: p0, split: true });
      }
      start = p1;
    }
  }
  return out;
}

/**
 * The band a gap is read in is the wall's INK band at its jambs, not the
 * extruder's tile.
 *
 * The extruder works at a working width (700k pixels) and opens the mask with
 * a brush, so the rectangle it hands back for a wall sits a few pixels inside
 * the wall as drawn -- and the window symbol is drawn at the wall's faces.
 * Madison (4): the wall runs y84-124 in the render, the extruder's tile
 * y97-121, and the two sash lines sit at y90 and y96. Read in the tile's band
 * the opening holds no lines at all and is "not glazed"; read in the ink's
 * band it is the window it is.
 *
 * MEASURED WHERE THE COLUMNS AGREE, WITHOUT HOPPING. The first version took
 * the union of the runs at three columns either side and let a run hop a
 * one-pixel break, and The Sky's bedroom window came back 71px deep in a
 * 23px wall: the drafter draws a casing tick at each jamb that reaches past
 * the face, and a sill projection outside it as lines a pixel apart, and the
 * walk climbed both. So: eight columns into the wall on each side, the run
 * of ink that holds the tile's middle with NO break allowed (a solid wall
 * has no holes; the lines outside it do), and the band is what every probed
 * column AGREES on -- a tick or a wall meeting the jamb end-on is one column
 * among eight and cannot widen it. Never narrower than the tile, never more
 * than twice its thickness.
 */
export function bandFromInk(gap, ink, W, H, opts = {}) {
  const probe = opts.probe ?? 8;
  const capFactor = opts.capFactor ?? 2;
  const [c0, c1] = gap.face || (gap.horizontal ? [gap.y0, gap.y1] : [gap.x0, gap.x1]);
  const thick = c1 - c0;
  if (thick <= 0) return gap;
  const cross = gap.horizontal ? H : W;
  const a0 = gap.horizontal ? gap.x0 : gap.y0, a1 = gap.horizontal ? gap.x1 : gap.y1;
  const along = gap.horizontal ? W : H;
  const at = (a, c) => ink[gap.horizontal ? c * W + a : a * W + c];
  const mid = Math.floor((c0 + c1) / 2);
  const cap = thick * capFactor;
  let lo = -Infinity, hi = Infinity, agreed = 0;
  for (let k = 1; k <= probe; k++) {
    for (const a of [a0 - k, a1 - 1 + k]) {
      if (a < 0 || a >= along || !at(a, mid)) continue;
      let u = mid, v = mid;
      while (u - 1 >= 0 && at(a, u - 1) && mid - u < cap) u--;
      while (v + 1 < cross && at(a, v + 1) && v - mid < cap) v++;
      lo = Math.max(lo, u); hi = Math.min(hi, v + 1);
      agreed++;
    }
  }
  if (agreed) { lo = Math.min(lo, c0); hi = Math.max(hi, c1); } else { lo = c0; hi = c1; }
  // A LINE ACROSS THE GAP JUST OUTSIDE THE FACE IS THE SYMBOL'S. Geena draws
  // a window's frame two pixels wider than the wall on each side, so both
  // glazing lines lie outside the wall's own band and a band that stops at
  // the face holds no glazing at all. So the rows beside the band are read
  // along the GAP itself: a row inked across most of the gap's run, within a
  // quarter wall of the band's edge, joins the band, and the walk goes on
  // while the next row does too. A sill projection or a deck edge beyond a
  // solid wall is further than a quarter wall; a bay's front is not read
  // here at all (bayFronts).
  const margin = Math.max(2, Math.round(thick / 4));
  const spanRow = (c) => {
    if (c < 0 || c >= cross) return 0;
    let n = 0;
    for (let a = a0; a < a1; a++) n += at(a, c);
    return n / Math.max(1, a1 - a0);
  };
  const edge = (from, dir) => {
    let far = from;
    for (let m = 1; m <= margin; m++) {
      const c = dir < 0 ? from - m : from - 1 + m;
      if (spanRow(c) < 0.5) continue;
      far = dir < 0 ? c : c + 1;
    }
    return far;
  };
  lo = edge(lo, -1); hi = edge(hi, 1);
  if (lo === c0 && hi === c1) return gap;
  return gap.horizontal
    ? { ...gap, y0: lo, y1: hi, face: [lo, hi], inkBand: true }
    : { ...gap, x0: lo, x1: hi, face: [lo, hi], inkBand: true };
}

/**
 * The walls, as a raster: 1 where an extruder wall stands, in render pixels.
 * What the exterior flood runs over -- see readWindows.
 */
export function wallRaster(seg, W, H) {
  const out = new Uint8Array(W * H);
  for (const r of [...seg.horizontal, ...seg.vertical]) {
    const x0 = Math.max(0, r.x0), x1 = Math.min(W, r.x1), y0 = Math.max(0, r.y0), y1 = Math.min(H, r.y1);
    for (let y = y0; y < y1; y++) out.fill(1, y * W + x0, y * W + x1);
  }
  return out;
}

/**
 * A BAY IS TWO WALLS STANDING OUT FROM A GAP, and its window is at their far
 * ends, not in the gap.
 *
 * The Sky's bedroom draws one: the main wall opens for 6.7ft, two short walls
 * run outward from the opening's ends, and the sash lines sit across their
 * tips, three feet out. The extruder builds the two side walls (they are
 * wall-thick), so the reader saw the opening in the main wall between them
 * and framed it -- a window at the bay's mouth, with the band walked out to
 * twice the wall, drawn as a slab of slats across the whole box. The mouth
 * is open floor. What carries glass is the line joining the two side walls'
 * tips, which no collinear gap can find because it lies between the ENDS of
 * two parallel walls.
 *
 * So, for every gap: a wall standing on each end of it, both leaving on the
 * same side and reaching at least a wall's thickness past the band, is a
 * bay. The gap is marked a mouth (left open, never framed) and a front gap is
 * added between the tips, banded to the side walls' thickness at their far
 * end, where the drafter puts the glazing. `bay: true` keeps bandFromInk off
 * it: its band is the tips by construction.
 */
export function bayFronts(gaps, seg, opts = {}) {
  const touch = opts.touch ?? 6;
  const out = [];
  for (const g of gaps) {
    const [c0, c1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const thick = c1 - c0;
    const a0 = g.horizontal ? g.x0 : g.y0, a1 = g.horizontal ? g.x1 : g.y1;
    // The walls that could flank it run the other way.
    const flank = g.horizontal ? seg.vertical : seg.horizontal;
    const run = (r) => (g.horizontal ? [r.x0, r.x1] : [r.y0, r.y1]);       // along the gap
    const cross = (r) => (g.horizontal ? [r.y0, r.y1] : [r.x0, r.x1]);     // across it
    const standing = (end) => flank.filter((r) => {
      const [ra0, ra1] = run(r);
      if (ra1 < end - touch || ra0 > end + touch) return false;             // not at this end
      const [rc0, rc1] = cross(r);
      return rc1 >= c1 + thick || rc0 <= c0 - thick;                         // reaches past the band
    });
    const pick = (rs, side) => rs.find((r) => (side > 0 ? cross(r)[1] >= c1 + thick : cross(r)[0] <= c0 - thick));
    const left = standing(a0), right = standing(a1);
    let side = 0, L = null, R = null;
    for (const sd of [1, -1]) {
      const l = pick(left, sd), r = pick(right, sd);
      if (l && r) { side = sd; L = l; R = r; break; }
    }
    if (!side) { out.push(g); continue; }
    const tipL = side > 0 ? cross(L)[1] : cross(L)[0];
    const tipR = side > 0 ? cross(R)[1] : cross(R)[0];
    const sideThick = Math.round((run(L)[1] - run(L)[0] + run(R)[1] - run(R)[0]) / 2);
    if (Math.abs(tipL - tipR) > sideThick) { out.push(g); continue; }         // not one front
    const tip = side > 0 ? Math.min(tipL, tipR) : Math.max(tipL, tipR);
    const band = side > 0 ? [tip - sideThick, tip] : [tip, tip + sideThick];
    const f0 = run(L)[1], f1 = run(R)[0];                                    // between the inner faces
    if (f1 - f0 < (opts.minGap ?? 20)) { out.push(g); continue; }
    out.push({ ...g, bayMouth: true });
    out.push(g.horizontal
      ? { x0: f0, x1: f1, y0: band[0], y1: band[1], horizontal: true, face: band, bay: true }
      : { y0: f0, y1: f1, x0: band[0], x1: band[1], horizontal: false, face: band, bay: true });
  }
  return out;
}

/**
 * AN OPENING AT A CORNER: a wall that ends, and the next wall along its line
 * is not collinear with it.
 *
 * Jordan (3) enters its stair hall through a door at the corner where the
 * left wall stops and the garage's wall runs across: the jambs belong to two
 * walls of different orientation, so no collinear search finds the gap. Over
 * the ink the door's own arc and threshold held the flood; over the walls
 * (readWindows) nothing did, the outdoors walked in through that door and
 * through the hall into every room, and a window on the far side of the
 * house had the outdoors on both sides. So every free wall end looks ahead
 * along its own line, across the middle of its band, for the first wall it
 * meets within the widest opening; what lies between is a gap like any
 * other -- sealed before the flood, classified after it (the arc makes it a
 * door). One that a collinear gap already covers is dropped as a duplicate.
 */
export function endGaps(seg, ground, W, H, opts = {}) {
  const minGap = opts.minGap ?? 20, maxGap = opts.maxGap ?? 400;
  const out = [];
  const probeAt = (horizontal, a, c) => ground[horizontal ? c * W + a : a * W + c];
  for (const horizontal of [true, false]) {
    const rects = horizontal ? seg.horizontal : seg.vertical;
    const along = horizontal ? W : H;
    for (const r of rects) {
      const [a0, a1] = horizontal ? [r.x0, r.x1] : [r.y0, r.y1];
      const [c0, c1] = horizontal ? [r.y0, r.y1] : [r.x0, r.x1];
      const rows = [c0 + Math.floor((c1 - c0) / 4), Math.floor((c0 + c1) / 2), c1 - 1 - Math.floor((c1 - c0) / 4)];
      for (const [end, dir] of [[a1, 1], [a0 - 1, -1]]) {
        let hit = -1;
        for (let k = 1; k <= maxGap; k++) {
          const a = end + dir * k;
          if (a < 0 || a >= along) break;
          if (rows.some((c) => probeAt(horizontal, a, c))) { hit = k; break; }
        }
        // Touching a wall (k of a pixel or two) is a junction, not an opening.
        if (hit < minGap) continue;
        const g0 = dir > 0 ? a1 : a0 - hit, g1 = dir > 0 ? a1 + hit : a0;
        out.push(horizontal
          ? { x0: g0, x1: g1, y0: c0, y1: c1, horizontal: true, face: [c0, c1], endGap: true }
          : { y0: g0, y1: g1, x0: c0, x1: c1, horizontal: false, face: [c0, c1], endGap: true });
      }
    }
  }
  return out;
}

/** Drop gaps that another gap of the same orientation already covers by half or more. */
export function dedupeGaps(gaps) {
  const run = (g) => (g.horizontal ? [g.x0, g.x1] : [g.y0, g.y1]);
  const cross = (g) => (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
  const kept = [];
  for (const g of gaps) {
    const dup = kept.some((k) => {
      if (k.horizontal !== g.horizontal) return false;
      // The same wall, not the wall beside it: the bands must share most of
      // the thinner one, else a window and the gap in the next parallel wall
      // -- bands touching by a pixel -- read as one.
      const [c0, c1] = cross(g), [kc0, kc1] = cross(k);
      const cov = Math.min(c1, kc1) - Math.max(c0, kc0);
      if (cov <= 0 || cov / Math.min(c1 - c0, kc1 - kc0) < 0.5) return false;
      const [a0, a1] = run(g), [ka0, ka1] = run(k);
      const ov = Math.min(a1, ka1) - Math.max(a0, ka0);
      return ov > 0 && ov / Math.min(a1 - a0, ka1 - ka0) >= 0.5;
    });
    if (!dup) kept.push(g);
  }
  return kept;
}

/**
 * The plan as the reader now reads it: the extruder's walls, the gaps between
 * them up to the widest opening a house draws, cut at any pier the ink still
 * shows. `plan` is planInk's record (ink, w, h, and its own seg/gaps, which
 * stay for calibration); `ex` the extrudeWalls result of the same picture.
 * Without an extruder result the reader's own walls stand, as before.
 *
 * The ceiling is in feet, not pixels: 400px was 7ft on Plan A at its assumed
 * width and 15ft on a small render, and the 9ft slider on Plan A's front
 * wall fell outside it. Twenty feet is where the classifier stops calling a
 * gap a garage door (`garageMax`), so nothing wider was ever going to be
 * framed anyway.
 */
export function planFromReading(plan, ex, scale, opts = {}) {
  const seg = wallsFromReading(ex, plan.w, plan.h);
  if (!seg || !scale) return plan;
  const maxGap = Math.round((opts.maxGapFt ?? 20) / scale);
  // Bays first, on the tiles' own bands: the test for a wall standing out
  // from a gap's end measures against the band's thickness, and a band
  // already walked out to the side walls (bandFromInk does that at a bay's
  // mouth, since the jamb columns ARE the side walls) is twice too thick to
  // let any wall "reach past" it. A mouth and a front keep their bands.
  const ground = wallRaster(seg, plan.w, plan.h);
  // Collinear gaps first (they carry the narrow band collinearGaps measures),
  // then the corner openings a wall end looks ahead to, deduplicated against
  // them and against each other -- a thick wall traced as stacked slices
  // otherwise yields the same window twice at two bands (Madison 3).
  const between = dedupeGaps(planGaps(seg, { minGap: 20, maxGap })
    .concat(endGaps(seg, ground, plan.w, plan.h, { minGap: 20, maxGap })));
  // Deduplicated once more at the end, on the bands the ink gave them: two
  // lines of one wall can still hand back one window twice a pixel apart (The
  // Star's back wall: y1439-1452 and y1438-1453), and the baseline had been
  // counting both.
  const gaps = dedupeGaps(splitAtPiers(
    bayFronts(between, seg)
      .map((g) => (g.bay || g.bayMouth ? g : bandFromInk(g, plan.ink, plan.w, plan.h))),
    plan.ink, plan.w, plan.h, { minGap: 20 },
  ));
  // The reader's own walls are NOT kept for sealing the flood, and that was
  // measured both ways. Sealed with both lists, Sky (2b, light) lost five of
  // ten exterior windows to "interior": the reader's thin-line gaps seal the
  // slot between a wall and the line drawn beside it, which is the very slot
  // the exterior probe reads. The leak that made the union look necessary --
  // Madison (4), the flood reaching the garage and a bedroom -- was the tile
  // band, not the list: sealed across the wall's ink band (bandFromInk) the
  // extruder's own gaps hold the flood out, and every window keeps its side.
  // The reader's own walls and gaps stay on the record (`own`): the door
  // finder proposes its hinges from them -- see readDoors for the numbers.
  return { ...plan, seg, gaps, own: { seg: plan.seg, gaps: plan.gaps }, fromReading: true };
}

/**
 * What the exterior flood runs over and what seals it -- one place, so the
 * probes under test/ cannot drift from the reader.
 *
 * THE FLOOD RUNS OVER THE WALLS, NOT OVER THE INK. Only walls enclose; the
 * ink also holds the deck's bright floor, a hatch, a car, a label -- and on
 * The Sky's dark render the covered deck is a bright fill from edge to
 * edge, so a flood over the ink could not cross it, and the four windows
 * onto it were "interior" whenever a grid line failed to fall within reach
 * of the wall face. Over the extruder's walls the deck is open ground, the
 * house is closed by its walls and the seals across their gaps, and a
 * window onto a porch faces out because a porch has no walls. Without an
 * extruder reading the ink stands, as it always did.
 *
 * SEALED: every gap between two walls; the bay fronts (bayFronts), which lie
 * between the ENDS of two walls and no collinear search finds; and the
 * corner openings a wall end looks ahead to (endGaps) when they are a
 * doorway's size. Jordan (3) leaks through a 3ft door at the corner of its
 * stair hall; sealing every wall-end gap instead enclosed Jordan (2)'s side
 * notch and the way off its deck -- open ground with nothing across it --
 * and the windows onto them read "interior". A door's own arc cannot decide
 * it: the arc swings into the room, outside the wall's band. 4.2ft is the
 * widest a single leaf is drawn (findDoors' MAX_FT); a wider corner opening
 * is a notch.
 *
 * A PORCH IS OUTDOORS, whatever its outline does to the flood. The Star's
 * covered porch is drawn closed -- posts, slab edge, dashed roof line -- so
 * the living room's three glazed openings onto it were never exterior and
 * never classified; Saman circled them. The customer's own PORCH / DECK /
 * PATIO label says where the outdoors is, and the flood starts there too.
 */
export function floodPlan(plan, scale, labels = [], opts = {}) {
  const { ink, w, h, seg, gaps } = plan;
  const doorSized = (g) => (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale <= (opts.cornerDoorMaxFt ?? 4.2);
  const bridge = planGaps(seg, { minGap: 20, maxGap: 4000 })
    .concat(gaps.filter((g) => g.bay || (g.endGap && doorSized(g))));
  const wallPx = medianWallThickness(ink, w, h) || Math.round(w / 100);
  const seeds = outdoorSeeds(labels, ink, w, h, wallPx * 3);
  const ground = plan.fromReading ? wallRaster(seg, w, h) : ink;
  return { bridge, seeds, ground, wallPx };
}

/**
 * A DOOR IS ITS LEAF, hung in a doorway the model has.
 *
 * findDoors reads the symbol -- the leaf and the arc, both marks at one
 * hinge -- and hands back the hinge, the leaf's length and the angle it is
 * drawn at. This attaches each leaf to the gap its CLOSED position lies in:
 * the doorway between the extruder's walls, which is the only place the
 * model can stand a door, since a leaf anywhere else stands in a wall. A leaf
 * that does not span its doorway is not its door: a single leaf must reach
 * within a fifth of the gap's width -- or within one wall's thickness, when
 * that is more, because the extruder's brush eats the jamb ends and hands
 * back a doorway a wall wider than the drafter drew it (The Sky: 17px walls,
 * 52px doors, gaps of 70px, and a third of the doors read at 0.73 of their
 * gap before this allowance); two leaves (a pair of French doors) each
 * within the same margin of half of it. Anything else is dropped, and the
 * doorway stays open with the plan's own symbol on the floor under it, which
 * is the honest answer when the marks and the walls disagree.
 *
 * WHICH WALLS THE FINDER PROPOSES ITS HINGES FROM was measured, 2026-09-14,
 * on every render (test/doors-read-probe.html). Hinges are looked for at
 * wall ends, and the extruder's tiles end a few pixels short of the jamb
 * the door is hung on (the brush erodes them, the fold merges them), so from
 * the extruder's walls the finder read 8 of Jordan's 14 verified doors; from
 * the reader's own walls (`plan.own`, wallSegments on the raw ink -- what
 * ?doors=1 always read from) it reads all 14, of which 11 close into a
 * doorway the extruder has. The other three are wall defects, not door
 * defects. So the finder keeps its own walls for LOOKING, and this function
 * keeps the extruder's gaps for PLACING: nothing is drawn where the model
 * has no opening, which is the rule one-notion-of-wall exists for.
 *
 * @returns {Map<object, Array>}  gap -> its leaves, each `{ x, y, ax, ay,
 *   ix, iy, r, deg }` in render pixels: the hinge, the closed leaf's
 *   direction along the wall, the side it swings to, the leaf's length, and
 *   the angle it is drawn open at
 */
export function attachDoors(gaps, doors, opts = {}) {
  const tol = opts.tol ?? 3;
  const wallPx = opts.wallPx ?? 0;
  const out = new Map();
  const widthOf = (g) => (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0);
  for (const d of doors) {
    const cx = d.x + d.along[0] * d.radius * 0.6, cy = d.y + d.along[1] * d.radius * 0.6;
    const g = gaps.find((q) => cx >= q.x0 - tol && cx <= q.x1 + tol && cy >= q.y0 - tol && cy <= q.y1 + tol);
    if (!g) continue;
    // The leaf lies along the wall: its direction and the gap's must agree.
    if (!!g.horizontal !== (Math.abs(d.along[0]) > Math.abs(d.along[1]))) continue;
    const leaf = { x: d.x, y: d.y, ax: d.along[0], ay: d.along[1], ix: d.into[0], iy: d.into[1], r: d.radius, deg: d.deg };
    out.set(g, (out.get(g) || []).concat([leaf]));
  }
  // The leaf spans `span` when it is short of it by no more than a fifth or
  // a wall (whichever is more), and long of it by no more than a quarter.
  const spans = (r, span) => r >= span - Math.max(span * 0.2, wallPx + 2) && r <= span * 1.25;
  for (const [g, leaves] of [...out]) {
    const w = widthOf(g);
    // A leaf that spans the doorway is its door; the best-fitting one when
    // the finder offered several (the same door read from the other jamb
    // comes back shorter and is not a second door). Failing that, two
    // leaves from opposite jambs each spanning half are a pair.
    const singles = leaves.filter((l) => spans(l.r, w)).sort((a, b) => Math.abs(a.r - w) - Math.abs(b.r - w));
    if (singles.length) { out.set(g, [singles[0]]); continue; }
    const halves = leaves.filter((l) => spans(l.r, w / 2));
    const pair = halves.length === 2 && Math.hypot(halves[0].x - halves[1].x, halves[0].y - halves[1].y) >= w * 0.5;
    if (pair) out.set(g, halves); else out.delete(g);
  }
  return out;
}

/**
 * Every opening the render draws, with its kind, for the market look to frame
 * or shutter: 'win' gets glass, 'garage' a roller door, 'door' a leaf hung
 * as the plan draws it, the rest stay open. Exterior openings first, then
 * the interior windows, then the doors that are not already among them.
 *
 * The same reading windowsFromWireframe makes -- glazing symbol, exterior
 * test -- and then classifyOpening's structural test on top, because
 * "exterior and glazed" also catches a porch bay under its roof line and a
 * garage door behind its panel line. A porch bay stays open. A window wider
 * than the classifier's band (7ft) is not a window either, which is the known
 * limit of this rule and is reported rather than hidden.
 *
 * @param {object} plan  `{ ink, w, h, seg, gaps }` -- the ink mask, its size,
 *   the wall runs (wallSegments) and the gaps (planGaps, 20..400px)
 * @param {number} scale  feet per pixel (ftPerPx); nothing is read without it
 * @param {Array}  labels  the confirmed room names, positioned as fractions of
 *   the render -- the outdoors and the garage are named by them
 * @returns {{fills: Array, openings: Array, note: string}} `fills` are the
 *   exterior windows alone (what wallMask once painted back in as wall)
 */
export function readWindows(plan, scale, labels = [], opts = {}) {
  const { ink, w, h, seg, gaps } = plan;
  if (!scale) return { fills: [], openings: [], note: 'no scale' };
  const glazed = glazedOpenings({ w }, { mask: ink, low: null }, gaps);
  // Every gap between two walls, plus the bay fronts (bayFronts), which lie
  // between the ENDS of two walls and no collinear search seals: unsealed, the
  // flood walks in through the front, the bay is "outside", and its window
  // has the outdoors on both sides.
  // A corner opening is sealed when it is a doorway's size. Jordan (3) leaks
  // through a 3ft door at the corner of its stair hall; sealing every
  // wall-end gap instead enclosed Jordan (2)'s side notch and the way off its
  // deck -- open ground with nothing across it -- and the windows onto them
  // read "interior". A door's own arc cannot decide it: the arc swings into
  // the room, outside the wall's band. 4.2ft is the widest a single leaf is
  // drawn (findDoors' MAX_FT); a wider corner opening is a notch.
  const doorSized = (g) => (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale <= (opts.cornerDoorMaxFt ?? 4.2);
  const { bridge, seeds, ground, wallPx } = floodPlan(plan, scale, labels, opts);
  const exterior = exteriorGaps(ground, w, h, seg, glazed, {
    bridge, faceDepth: Math.max(3, Math.round(wallPx * 2)), seeds,
  });
  const kinds = exterior.map((g) => (g.bayMouth
    ? { kind: 'opening', widthFt: (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale, why: 'the mouth of a bay: open floor, the glass is at the front' }
    : classifyOpening(ink, w, h, g, scale, {})));
  // A GARAGE'S OPENING IS A GARAGE DOOR. The classifier reads the symbol, and
  // The Star's two garage doors came back "cased opening" -- the drawing puts
  // a dashed apron outside them and nothing across them -- while an 8.1ft
  // porch bay came back "garage". The confirmed labels settle it more simply
  // (Saman's rule, 2026-09-12): an exterior opening whose nearest confirmed
  // room name is GARAGE is a garage door, and nothing else is. Flooding the
  // plan into rooms was tried first and does not work here, because a garage
  // with its doors open is not an enclosed room to a flood.
  const garageLabels = labels.filter((l) => /garage/i.test(l.name || ''));
  const nearest = (x, y) => {
    let best = null, bd = Infinity;
    for (const l of labels) {
      const d = Math.hypot(l.x * w - x, l.y * h - y);
      if (d < bd) { bd = d; best = l; }
    }
    return { label: best, ft: bd * scale };
  };
  exterior.forEach((gp, i) => {
    const cx = (gp.x0 + gp.x1) / 2, cy = (gp.y0 + gp.y1) / 2, off = wallPx * 3;
    const probes = gp.horizontal ? [[cx, cy - off], [cx, cy + off]] : [[cx - off, cy], [cx + off, cy]];
    const garage = garageLabels.length && probes.some(([x, y]) => {
      const n = nearest(x, y);
      return n.label && /garage/i.test(n.label.name || '') && n.ft < 30;
    });
    if (garage) kinds[i] = { ...kinds[i], kind: 'garage', why: `${kinds[i].widthFt.toFixed(1)}ft, nearest room is the garage` };
    else if (kinds[i].kind === 'garage') kinds[i] = { ...kinds[i], kind: 'opening', why: kinds[i].why + ' — but no garage named here' };
  });
  const fills = exterior.filter((g, i) => kinds[i].kind === 'win');
  const left = kinds.filter((k) => k.kind !== 'win').map((k) => `${k.widthFt.toFixed(1)}ft ${k.kind}`);
  // AN INTERIOR WINDOW IS STILL A WINDOW. The Star draws its window symbol
  // on the foyer's wall onto the living room and on the guest bath's; the
  // exterior test kept both empty, and Saman said the symbol cannot be
  // ignored. interiorWindows frames the interior openings drawn the way this
  // plan draws its windows, and its comment carries the measured trade.
  const interior = interiorWindows({
    mask: ink, W: w, H: h, seg, glazed: glazed.filter((g) => !g.bayMouth), exterior, exteriorWindows: fills, scale,
  });
  // WHICH KIND OF WINDOW, from the symbol: fixed, slider or double-hung, and
  // the units between its mullions (windowStyle). The engine draws each.
  const styled = (g) => (g.kind === 'win'
    ? { ...g, units: windowStyle(ink, w, h, g, { widthFt: (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale }).units }
    : g);
  // THE DOORS, exterior and interior alike (attachDoors). An exterior gap the
  // classifier called a door from its arc alone -- a fixed quarter circle
  // sampled at the gap's width, which misses every plan that draws its doors
  // half open -- is a door only when the finder hangs a leaf in it; without
  // one it is an opening, drawn as nothing, its `why` kept for the console.
  // Precision over recall, as doors.js says: a door missed stays the symbol
  // on the floor; a door invented stands in somebody's marketing image.
  // `opts.wallPx` is the extruder's own wall thickness (readPlan hands it
  // over), which is what its brush ate from each jamb.
  // THE FIREPLACES FIRST (fireplace.js): a firebox's mouth is a gap between
  // the breast's front-face pieces, and its splayed sides read as a pair of
  // doors at 60 degrees before there was a reader for it (The Star). A mouth
  // is no doorway to the door readers below.
  const fires = opts.fireplaces === false || !plan.fromReading ? [] : findFireplaces(ink, ground, w, h, gaps, { ftPerPx: scale });
  const fireOf = new Map(fires.map((f) => [f.gap, f]));
  // Every mouth a firebox was read from, the duplicates included: no doorway.
  const fireMouths = new Set(fires.flatMap((f) => [f.gap, ...f.also]));
  const leavesOf = opts.doors === false ? new Map() : attachDoors(gaps, findDoors(ink, w, h, plan.own?.seg || seg, {
    ftPerPx: scale, gaps: plan.own?.gaps || gaps, wallPx: opts.wallPx ?? wallPx,
  }), { wallPx: opts.wallPx ?? wallPx });
  for (const g of fireMouths) leavesOf.delete(g);
  // THE ARC FIRST (findArcDoors), in the doorways findDoors left bare: the
  // leaf drawn as a bar, drawn shut, or lying against a thick wall is what
  // the hinge-first reader misses, and the arc is what every one of those
  // still has. Read from the doorway's own jambs at the doorway's own width;
  // never in a glazed opening (a window's lines run along the doorway, where
  // a shut leaf would) or a firebox's mouth.
  const orphans = [], madeDoorways = [];
  if (opts.doors !== false) {
    const glazedGap = new Set(exterior.filter((g, i) => kinds[i].kind === 'win' || kinds[i].kind === 'garage'));
    const sameRect = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
    const isBare = (g) => !leavesOf.has(g) && !fireMouths.has(g) && !glazedGap.has(g) && !interior.some((i) => sameRect(i, g));
    // Parallel lines along an opening are a window's; no leaf is read shut there.
    const lined = glazed.filter((g) => g.byLines);
    const linedKey = new Set(lined.map((g) => `${g.x0},${g.y0},${g.x1},${g.y1}`));
    // THE SYMBOL FIRST (findDoorSymbols): every arc-and-leaf the drawing
    // carries, found where it is drawn, its chord the doorway it describes.
    // Each is hung in the bare doorway its chord lies along -- same axis,
    // in the doorway's band, overlapping its run by half the chord -- and
    // one whose chord lies along no doorway at all is an ORPHAN: a door the
    // plan draws where the tracer merged the wall, reported, not built.
    const sym = findDoorSymbols(ink, w, h, {
      ftPerPx: scale, segments: plan.own ? [seg, plan.own.seg] : [seg], wallPx: opts.wallPx ?? wallPx,
      shutOk: (c) => !lined.some((g) => {
        const hz = Math.abs(c.x1 - c.x0) >= Math.abs(c.y1 - c.y0);
        if (!!g.horizontal !== hz) return false;
        const lo = Math.min(c.x0, c.x1), hi = Math.max(c.x0, c.x1), lo2 = Math.min(c.y0, c.y1), hi2 = Math.max(c.y0, c.y1);
        return hz ? (Math.min(hi, g.x1) - Math.max(lo, g.x0) > 0 && c.y0 >= g.y0 - wallPx && c.y0 <= g.y1 + wallPx)
          : (Math.min(hi2, g.y1) - Math.max(lo2, g.y0) > 0 && c.x0 >= g.x0 - wallPx && c.x0 <= g.x1 + wallPx);
      }),
    });
    const gapOf = (d) => {
      const hz = Math.abs(d.along[0]) > Math.abs(d.along[1]);
      const c = d.chord, len = d.radius;
      const lo = hz ? Math.min(c.x0, c.x1) : Math.min(c.y0, c.y1), hi = lo + len;
      const band = hz ? c.y0 : c.x0;
      let best = null, bestOv = 0;
      for (const g of gaps) {
        if (!!g.horizontal !== hz) continue;
        const b0 = hz ? g.y0 : g.x0, b1 = hz ? g.y1 : g.x1;
        // The hinge sits on the drawn wall's FACE; the extruder's band is the
        // wall's core, a wall's thickness narrower on a fuzzy-edged render.
        if (band < b0 - wallPx * 1.5 - 4 || band > b1 + wallPx * 1.5 + 4) continue;
        const r0 = hz ? g.x0 : g.y0, r1 = hz ? g.x1 : g.y1;
        const ov = Math.min(hi, r1) - Math.max(lo, r0);
        if (ov >= len * 0.5 && ov > bestOv) { best = g; bestOv = ov; }
      }
      return best;
    };
    const leafOf = (d) => ({ x: d.x, y: d.y, ax: d.along[0], ay: d.along[1], ix: d.into[0], iy: d.into[1], r: d.radius, deg: d.deg });
    const hungHere = new Map();
    // A symbol with no doorway under it: where the MODEL's walls leave the
    // chord open (the tracer built the hole but the gap finder never listed
    // it -- a doorway at a wall's end, a corner), the chord IS the doorway,
    // and one is made from it: a wall's thickness deep behind the hinge's
    // face, the leaf hung in it. Where the model has wall along the chord
    // (the render closed the doorway), nothing is built: that is a wall to
    // cut, reported as an orphan for the gate and the panel.
    const exWall = wallGrid(w, h, seg, 0);
    const walled = (d) => {
      let n = 0, on = 0;
      for (let k = 0.15; k <= 0.9; k += 0.05) {
        const x = Math.round(d.x + d.along[0] * d.radius * k), y = Math.round(d.y + d.along[1] * d.radius * k);
        n++;
        if (x >= 0 && y >= 0 && x < w && y < h && exWall[y * w + x]) on++;
      }
      return on / n > 0.3;
    };
    const made = [];
    for (const d of sym.doors) {
      const g = gapOf(d);
      if (!g) {
        if (walled(d)) { orphans.push(d); continue; }
        // With no traced doorway to vouch for it, only the strongest symbol
        // makes one: both marks three quarters covered and a whole quarter
        // drawn. A water tank's rounded corner with a line of its outline
        // for a leaf scored 0.6 at 48 degrees inside a closet (Madison).
        if (d.score < 0.75 || d.deg < 75) continue;
        const hz = Math.abs(d.along[0]) > Math.abs(d.along[1]);
        const wp = opts.wallPx ?? wallPx;
        const lo = hz ? Math.min(d.chord.x0, d.chord.x1) : Math.min(d.chord.y0, d.chord.y1);
        const hi = hz ? Math.max(d.chord.x0, d.chord.x1) : Math.max(d.chord.y0, d.chord.y1);
        // The wall lies on the far side of the hinge's face from the swing.
        const face = hz ? d.y : d.x, back = face - (hz ? d.into[1] : d.into[0]) * wp;
        const b0 = Math.round(Math.min(face, back)), b1 = Math.round(Math.max(face, back));
        const gm = hz ? { x0: Math.round(lo), x1: Math.round(hi), y0: b0, y1: b1, horizontal: true } : { x0: b0, x1: b1, y0: Math.round(lo), y1: Math.round(hi), horizontal: false };
        gm.fromSymbol = true;
        made.push(gm);
        leavesOf.set(gm, [leafOf(d)]);
        continue;
      }
      if (!isBare(g)) continue;
      hungHere.set(g, (hungHere.get(g) || []).concat([leafOf(d)]));
    }
    madeDoorways.push(...made);
    // One leaf spanning the doorway, or two from opposite jambs: a pair.
    for (const [g, leaves] of hungHere) {
      const wgap = g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0;
      const singles = leaves.filter((l) => l.r >= wgap * 0.6).sort((a, b) => Math.abs(a.r - wgap) - Math.abs(b.r - wgap));
      if (singles.length) { leavesOf.set(g, [singles[0]]); continue; }
      if (leaves.length === 2 && Math.hypot(leaves[0].x - leaves[1].x, leaves[0].y - leaves[1].y) >= wgap * 0.5) leavesOf.set(g, leaves);
    }
    const bareGaps = gaps.filter(isBare);
    const arcs = findArcDoors(ink, w, h, bareGaps, {
      ftPerPx: scale, segments: plan.own?.seg || seg, wallPx: opts.wallPx ?? wallPx,
      shutOk: (g) => !linedKey.has(`${g.x0},${g.y0},${g.x1},${g.y1}`),
    });
    for (const [g, leaves] of arcs) leavesOf.set(g, leaves);
  }
  // BIFOLDS, in the INTERIOR doorways no leaf was hung in (findBifolds): the
  // zigzag is drawn between the jambs as the plan draws them, which is the
  // reader's own gap where it has one (the extruder's is a wall wider, see
  // attachDoors); the panels are attached to the extruder's gap. Interior
  // only: a folding door is a closet's or a room divider's, and an exterior
  // opening's symbol -- a window's lines, a slider's tracks -- is where a
  // zigzag can be walked that is not there.
  const folded = new Set();
  const sliding = new Map();
  const pocketWall = new Map();
  if (opts.doors !== false) {
    const exteriorKind = new Map(exterior.map((g, i) => [g, kinds[i].kind]));
    // The reader's own gap for this doorway: a doorway's width at least (a
    // 1.3ft scrap inside a 6.3ft opening gave a railing line a pocket door,
    // Jordan 2), and mostly inside the extruder's gap. It may be narrower
    // than the extruder's: a pocket door's wall is hollow where the panel
    // goes, and the extruder's gap runs on through it (The Sky: 5.5ft for a
    // 2.7ft doorway).
    const ownRect = (g) => (plan.own?.gaps || []).find((q) => {
      if (!!q.horizontal !== !!g.horizontal) return false;
      const lq = g.horizontal ? q.x1 - q.x0 : q.y1 - q.y0;
      if (lq * scale < 2) return false;
      const ov = g.horizontal ? Math.min(q.x1, g.x1) - Math.max(q.x0, g.x0) : Math.min(q.y1, g.y1) - Math.max(q.y0, g.y0);
      const band = g.horizontal ? Math.min(q.y1, g.y1) - Math.max(q.y0, g.y0) : Math.min(q.x1, g.x1) - Math.max(q.x0, g.x0);
      return ov / lq >= 0.5 && band > 0;
    });
    const where = new Map();
    for (const g of gaps) {
      if (leavesOf.has(g) || exteriorKind.has(g) || fireMouths.has(g)) continue;
      where.set(ownRect(g) || g, g);
    }
    const found = findBifolds(ink, w, h, [...where.keys()], {
      ftPerPx: scale, segments: plan.own?.seg || seg, wallPx: opts.wallPx ?? wallPx,
    });
    // One Λ over the doorway is two leaves meeting -- a pair of doors drawn
    // with their tips together (Avi main, Another 2), the same thing
    // findDoors reads when their arcs are long enough. Two Λ is a zigzag:
    // the bifold, named as one on the row.
    for (const [rect, b] of found) { const g = where.get(rect); leavesOf.set(g, b.leaves); if (b.panels >= 4) folded.add(g); }
    // SLIDING DOORS last (findSlidingDoors), in the doorways still bare: a
    // pocket door's panel or a bypass pair's, read as bars in the band.
    const bare = [...where.entries()].filter(([, g]) => !leavesOf.has(g));
    // Each with the extruder gap's band (the wall's thickness the panel lies
    // in) and run (where the pocket wall is to be built).
    const rects = bare.map(([rect, g]) => ({
      ...rect, own: rect,
      band: g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]),
      run: g.horizontal ? [g.x0, g.x1] : [g.y0, g.y1],
    }));
    // CLOSETS (closets.js): a doorway with a shallow closed cell and a rod,
    // a shelf or a row of hangers behind it is a closet's mouth, and only
    // there is the bypass pair -- a sliding window's symbol anywhere else --
    // read as the closet's doors, and a single bar across the mouth as its
    // door drawn shut.
    const closetOf = findClosets(ink, ground, w, h, bare.map(([, g]) => g), { ftPerPx: scale, wallPx: opts.wallPx ?? wallPx });
    const closetRects = new Set(bare.filter(([, g]) => closetOf.has(g)).map(([rect]) => rect));
    const slid = findSlidingDoors(ink, w, h, rects, { ftPerPx: scale, wallPx: opts.wallPx ?? wallPx, closet: (r) => closetRects.has(r.own) });
    for (const [rect, b] of slid) {
      const g = where.get(rect.own);
      leavesOf.set(g, b.leaves);
      if (b.pocket || b.bypass) sliding.set(g, b.pocket ? 'pocket' : 'bypass');
      if (b.wall) pocketWall.set(g, b.wall);
    }
  }
  // What the record and the engine need of a fireplace: the mouth is the
  // opening's own rectangle; `fire` carries the firebox and the hearth.
  const asFire = (g) => {
    const f = fireOf.get(g);
    return { ...g, kind: 'fireplace', fire: { side: f.side, face: f.face, depth: f.depth, back: f.back, hearth: f.hearth } };
  };
  const withDoor = (g, kind) => {
    if (fireOf.has(g)) return asFire(g);
    const leaves = leavesOf.get(g);
    if (leaves) return { ...g, kind: 'door', leaves, ...(folded.has(g) ? { bifold: true } : {}), ...(sliding.has(g) ? { sliding: sliding.get(g) } : {}), ...(pocketWall.has(g) ? { wall: pocketWall.get(g) } : {}) };
    return { ...g, kind: kind === 'door' || kind === 'double' ? 'opening' : kind };
  };
  const listed = new Set([...exterior, ...interior]);
  const doors = [...gaps, ...madeDoorways].filter((g) => !listed.has(g) && (leavesOf.has(g) || fireOf.has(g))).map((g) => ({ ...withDoor(g, 'door'), interior: true }));
  const openings = [...exterior.map((g, i) => withDoor(g, kinds[i].kind)), ...interior, ...doors].map(styled);
  const styles = {};
  for (const g of openings) for (const u of g.units || []) styles[u.style] = (styles[u.style] || 0) + 1;
  const nDoors = openings.filter((g) => g.kind === 'door').length;
  const nFires = openings.filter((g) => g.kind === 'fireplace').length;
  return {
    fills,
    openings,
    // Door symbols whose doorway the tracer has not got: the plan draws a
    // door there and the model shows a wall. Positions only, for the panel
    // and the gate; nothing is built from them yet.
    orphans: orphans.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), r: Math.round(d.radius), deg: d.deg, along: d.along, into: d.into })),
    note: `${fills.length} of ${exterior.length} exterior openings framed as windows`
      + (left.length ? ` · left open: ${left.join(', ')}` : '')
      + (interior.length ? ` · ${interior.length} interior window(s)` : '')
      + (nDoors ? ` · ${nDoors} door(s) hung` : '')
      + (nFires ? ` · ${nFires} fireplace(s)` : '')
      + (Object.keys(styles).length ? ` · units: ${Object.entries(styles).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''),
  };
}

/**
 * What a published record keeps of a reading: the rectangles, their kinds and
 * their units, and nothing the viewer recomputes. The `why` strings and the
 * classifier's scores stay behind -- they are for the console, and a record
 * is read by every visitor on every open.
 */
export function publishableOpenings(openings) {
  const r1 = (v) => Math.round(v * 10) / 10;
  return (openings || [])
    .filter((g) => g.kind === 'win' || g.kind === 'garage' || g.kind === 'door' || g.kind === 'fireplace')
    .map((g) => ({
      x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, horizontal: !!g.horizontal, kind: g.kind,
      ...(g.units?.length ? { units: g.units.map((u) => ({ lo: u.lo, hi: u.hi, style: u.style, ...(u.sashes?.length ? { sashes: u.sashes } : {}) })) } : {}),
      // A door's leaves: hinge, direction, side, length, angle -- render px.
      ...(g.leaves?.length ? { leaves: g.leaves.map((l) => ({ x: r1(l.x), y: r1(l.y), ax: +l.ax.toFixed(4), ay: +l.ay.toFixed(4), ix: l.ix, iy: l.iy, r: r1(l.r), deg: l.deg })) } : {}),
      ...(g.bifold ? { bifold: true } : {}),
      ...(g.sliding ? { sliding: g.sliding } : {}),
      // A pocket door's wall, to be built: the plan draws it hollow and the tracer left it out.
      ...(g.wall ? { wall: { x0: r1(g.wall.x0), y0: r1(g.wall.y0), x1: r1(g.wall.x1), y1: r1(g.wall.y1) } } : {}),
      // A fireplace's firebox and hearth, render px, rounded like the leaves.
      ...(g.fire ? { fire: {
        side: g.fire.side, face: r1(g.fire.face), depth: r1(g.fire.depth), back: g.fire.back.map(r1),
        hearth: g.fire.hearth ? { far: r1(g.fire.hearth.far), lo: r1(g.fire.hearth.lo), hi: r1(g.fire.hearth.hi) } : null,
      } } : {}),
    }));
}

// ---------------------------------------------------------------------------
// THE BUILDER'S DECISIONS, and how they meet a fresh reading.
//
// The reader makes a draft; the person makes it exact. What the builder
// decides on the 3D page is kept on the floor's own record (`verified.
// openings`), in the render's own fractions like a published label, and
// applied to every later reading -- the builder's, the publisher's, and so
// the visitor's. A reader that changes tomorrow cannot undo a decision made
// today: an opening the builder named is named, and one they removed stays
// removed, whatever the pixels say next time.
//
// Kinds a person chooses from are fewer than the reader's: `window`, `patio`
// (glass to the floor), `garage`, `door`, `open` (nothing drawn -- a cased
// opening, a mistake). Each maps onto what the engine draws.

/** The kind a person would call a read opening, from the reader's own kind and units. */
export function kindOf(g) {
  if (g.kind === 'garage') return 'garage';
  if (g.kind === 'door') return 'door';
  if (g.kind === 'fireplace') return 'fireplace';
  if (g.kind === 'win') return g.units?.some((u) => u.style === 'patio') ? 'patio' : 'window';
  return 'open';
}

/** A stable id for an opening: its place on the render, to the nearest 0.5%. */
export function openingId(g, w, h) {
  const r = (v) => Math.round(v * 200) / 200;
  return `${g.horizontal ? 'h' : 'v'}:${r(g.x0 / w)},${r(g.y0 / h)}-${r(g.x1 / w)},${r(g.y1 / h)}`;
}

/** Do two rectangles (render pixels) cover half of the smaller, both ways? */
function sameOpening(a, b) {
  if (!!a.horizontal !== !!b.horizontal) return false;
  const ov = (p0, p1, q0, q1) => Math.min(p1, q1) - Math.max(p0, q0);
  const ax = ov(a.x0, a.x1, b.x0, b.x1), ay = ov(a.y0, a.y1, b.y0, b.y1);
  if (ax <= 0 || ay <= 0) return false;
  const run = a.horizontal ? ax / Math.min(a.x1 - a.x0, b.x1 - b.x0) : ay / Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const band = a.horizontal ? ay / Math.min(a.y1 - a.y0, b.y1 - b.y0) : ax / Math.min(a.x1 - a.x0, b.x1 - b.x0);
  return run >= 0.5 && band >= 0.5;
}

/** What the engine draws for a chosen kind: the reader's fields, rewritten. */
function asKind(g, kind) {
  if (kind === 'garage') return { ...g, kind: 'garage', units: undefined, leaves: undefined, fire: undefined };
  // A fireplace keeps what was read; named where none was read it has no
  // firebox to draw and stays an opening.
  if (kind === 'fireplace') return g.fire ? { ...g, kind: 'fireplace', units: undefined, leaves: undefined } : { ...g, kind: 'opening', units: undefined, leaves: undefined };
  if (kind === 'patio') return { ...g, kind: 'win', units: [{ lo: 0, hi: 1, style: 'patio', sashes: [[0, 0.53], [0.5, 1]] }], leaves: undefined, fire: undefined };
  if (kind === 'window') {
    const units = g.units?.length && !g.units.some((u) => u.style === 'patio') ? g.units : [{ lo: 0, hi: 1, style: 'fixed', sashes: [] }];
    return { ...g, kind: 'win', units, leaves: undefined, fire: undefined };
  }
  // A door the reader hung keeps its leaves and is drawn as the plan draws
  // it; one the person named where the reader hung none has no hinge to
  // stand on, and is drawn shut across the opening (engine.js).
  if (kind === 'door') return { ...g, kind: 'door', units: undefined, leaves: g.leaves?.length ? g.leaves : undefined, fire: undefined };
  return { ...g, kind: 'opening', units: undefined, leaves: undefined, fire: undefined, wall: undefined };
}

/**
 * A fresh reading with the builder's decisions applied.
 *
 * @param {Array} openings  readWindows' openings, render pixels
 * @param {object|null} decisions  `verified.openings`: `{ items: [{ id, x0, y0,
 *   x1, y1, horizontal, kind, interior? }], confirmedAt, look, renderKey }`,
 *   rectangles as fractions of the render
 * @param {number} w  render width, @param {number} h  render height
 * @returns {{ openings: Array, rows: Array }}  the openings to draw (kinds
 *   rewritten, removed ones gone, kept ones added back), and one row per
 *   opening for the page: `{ id, g, raw: the reader's kind, read: kindOf(read),
 *   kind, decided, kept }`
 */
export function applyDecisions(openings, decisions, w, h) {
  const items = (decisions?.items || []).map((d) => ({
    ...d, x0: d.x0 * w, y0: d.y0 * h, x1: d.x1 * w, y1: d.y1 * h,
  }));
  const used = new Set();
  const rows = openings.map((g) => {
    const read = kindOf(g);
    const d = items.find((it, i) => !used.has(i) && sameOpening(it, g) && (used.add(i) || true));
    const kind = d ? d.kind : read;
    return { id: d?.id || openingId(g, w, h), g: asKind(g, kind), raw: g.kind, read, kind, decided: !!d, kept: false };
  });
  // A decision the reader no longer finds an opening for is kept as the
  // person made it, drawn from its own rectangle. Not for `open`: nothing to
  // draw, and a removed opening that the reader also stopped finding is done.
  items.forEach((it, i) => {
    if (used.has(i) || it.kind === 'open') return;
    const g = asKind({ x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, horizontal: !!it.horizontal, interior: !!it.interior, kind: 'win' }, it.kind);
    rows.push({ id: it.id, g, raw: 'kept', read: 'open', kind: it.kind, decided: true, kept: true });
  });
  return { openings: rows.map((r) => r.g), rows };
}

/**
 * The record to keep, from the rows the page shows: every opening with the
 * kind it has now, as fractions of the render. Written whole on every change,
 * so a later reading meets the complete list rather than a diff.
 */
export function decisionsFrom(rows, w, h, meta = {}) {
  const items = rows.map((r) => ({
    id: r.id,
    x0: +(r.g.x0 / w).toFixed(4), y0: +(r.g.y0 / h).toFixed(4),
    x1: +(r.g.x1 / w).toFixed(4), y1: +(r.g.y1 / h).toFixed(4),
    horizontal: !!r.g.horizontal, interior: !!r.g.interior, kind: r.kind,
  }));
  return { ...meta, items };
}
