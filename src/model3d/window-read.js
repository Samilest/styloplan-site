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
import { findDoors, findArcDoors, findBifolds, findSlidingDoors, findShutPairs, wallGrid } from './doors.js';
import { findDoorSymbols, MIN_R_FT } from './door-symbols.js';
import { findFireplaces } from './fireplace.js';
import { findClosets } from './closets.js';
import { CATALOG } from './fixtures.js';
import { hasVehicleDoor } from '../garage.js';

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
  const { ink, w, h, pos } = inkMaskOf(img);
  // openings.js carries the measured defaults; overriding them here is what
  // made view3d disagree with every sweep run against it.
  const seg = wallSegments(ink, w, h, {});
  // Both directions and the sparse-band symbols, from one place (planGaps).
  const gaps = planGaps(seg, { minGap: 20, maxGap: 400 });
  const levels = lineLevels(ink, pos, w, h);
  return { ink, w, h, seg, gaps, pos, levels, lines: symbolInk(ink, pos, levels, w) };
}

/**
 * THE SYMBOLS' INK: the ink, and every pixel standing half the drawing's own
 * line contrast above its paper (lineLevels).
 *
 * The ink's cut is fixed, and was set for the walls. A symbol is a hairline,
 * and a hairline is anti-aliased: across its width it peaks anywhere from full
 * strength to half, by where it fell on the pixel grid, so the fixed cut takes
 * one pixel of it and drops the next. Measured across the 36 renders, 4% to
 * 96% of the symbol pixels on the light look fall under it, and up to 28% on
 * the dark; Jordan 4's hairlines peak at 104 to 174 against a cut of 150, and
 * its flex room window, its closet's rod and shelf and its closet's two
 * sliding panels all read as fragments, and so as nothing. Every reader of a
 * SYMBOL -- windows, doors, closets, fireplaces -- reads this instead. The
 * walls, the wall runs and the flood keep the ink.
 */
export function symbolInk(ink, pos, levels, w) {
  const lift = (levels.line - levels.floor) / 2;
  const cut = levels.floor + lift;
  const n = ink.length, h = Math.floor(n / w);
  const out = new Uint8Array(n);
  // A HAIRLINE, NOT A TONE. What the cut drops is the anti-aliased edge of a
  // line, and such a pixel stands above the paper two pixels to either side
  // of it. A filled region at the same brightness -- the light band a dark
  // render draws inside a window -- does not, and taking it turned three
  // lines into "a solid bar" (The Avi Top: 41% of its window's band became
  // 57%, over the glazing ceiling).
  //
  // AND A HAIRLINE ALONG AN AXIS. The symbols this ink is for -- a window's
  // glazing, a closet's rod and shelf, a sliding panel -- are drawn along the
  // walls. A deck's hatch is hairlines too, strong ones on the light look,
  // and at 45 degrees: taken, two of them crossed a deck's edge in every
  // column and run9's deck edge read as two windows 7 and 5ft long. So a
  // pixel is added when it is bright enough, a ridge across one axis by half
  // the lift, and the line runs on along the other axis.
  const ridge = lift / 2;
  for (let p = 0; p < n; p++) {
    if (ink[p]) { out[p] = 1; continue; }
    const v = pos[p];
    if (v < cut) continue;
    const x = p % w, y = (p / w) | 0;
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
    const L = pos[p - 2], R = pos[p + 2], U = pos[p - 2 * w], D = pos[p + 2 * w];
    const vertical = v - Math.max(L, R) >= ridge && Math.max(U, D) >= cut;
    const horizontal = v - Math.max(U, D) >= ridge && Math.max(L, R) >= cut;
    if (vertical || horizontal) out[p] = 1;
  }
  return out;
}

/**
 * The ink alone: the same threshold, for a reader that needs no wall runs
 * (posts.js reads small closed cells of it on a visitor's page, where the
 * plan reading is a published record and the ink is not shipped).
 */
export function inkMaskOf(img) {
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
  // `pos` is the same brightness turned ink-positive (ink high on either
  // look), for the readers that read a hairline at its own contrast rather
  // than through this cut (glazedOpenings).
  const pos = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    ink[p] = (inverted ? lum[p] > 150 : lum[p] < 105) ? 1 : 0;
    pos[p] = inverted ? lum[p] : 255 - lum[p];
  }
  return { ink, w, h, inverted, pos };
}

/**
 * The drawing's own two levels, ink-positive: its FLOOR (the median of the
 * whole picture, which is paper) and its LINE (the median of the hairlines the
 * ink cut already takes whole -- ink no more than two pixels across in one
 * direction, which walls never are). Half the distance between them is where
 * a hairline is read inside an opening (glazedOpenings).
 *
 * WHY HALF IS SAFE FROM THE FLOOR GRID. The renders draw rooms on a tile grid.
 * On the dark look its lines are darker than the floor, so no ink-positive cut
 * can take them. On the light look they are ink, and strong: measured on all
 * 36 renders as long straight ridges, nine in ten stand at 69 to 116, while
 * half the line contrast above the paper lands at 120 to 131 there (108 to 134
 * across both looks). A lower cut would take the light look's grid; a higher
 * one drops the anti-aliased half of every hairline.
 */
export function lineLevels(ink, pos, w, h) {
  const floorVals = [];
  for (let p = 0; p < w * h; p += 13) floorVals.push(pos[p]);
  floorVals.sort((a, b) => a - b);
  const across = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!ink[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && ink[y * w + e]) e++;
      for (let i = x; i < e; i++) across[y * w + i] = e - x;
      x = e;
    }
  }
  const lineVals = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!ink[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && ink[e * w + x]) e++;
      for (let i = y; i < e; i++) if (Math.min(across[i * w + x], e - y) <= 2) lineVals.push(pos[i * w + x]);
      y = e;
    }
  }
  lineVals.sort((a, b) => a - b);
  const floor = floorVals[floorVals.length >> 1] ?? 0;
  return { floor, line: lineVals.length ? lineVals[lineVals.length >> 1] : 255 };
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
  let ex = calibrated ? retrace(widthFt) : first;
  let scale = null, between = plan, read = { fills: [], openings: [], note: 'no scale' };
  const readAt = () => {
    scale = ex?.extent ? ftPerPx(plan.seg, widthFt) : null;
    between = ex?.extent && scale ? planFromReading(plan, ex, scale) : plan;
    read = scale
      ? readWindows(between, scale, labels, { wallPx: ex.wallFloorFt ? ex.wallFloorFt / scale : undefined })
      : { fills: [], openings: [], note: 'no scale' };
  };
  readAt();
  // THE DOORS AS A SCALE WITNESS, when no label could calibrate. A hung
  // single leaf is a standard door almost everywhere -- 2'-8" (0.81 m) is
  // the interior door of the US stock and the metric 800 is its twin -- and
  // the reader has every doorway's width in pixels. On the corpus, 33 of 36
  // renders were standing on the assumed 40ft; their hung doors measured a
  // median of 2.0 to 3.4ft at that width, which is the same as saying the
  // plans are 32 to 54ft wide. The two label-calibrated plans put their
  // medians at 2.5-2.9ft, so a door is a witness good to about a tenth,
  // where the assumption was off by a third. Read once at the assumed
  // width, corrected, traced and read again at the corrected one -- the
  // first reading's door sizes are censored by the reader's own 2ft floor
  // when the assumption is small. A correction smaller than the witness's
  // own uncertainty, that tenth, is no evidence the assumption was wrong
  // and is not taken: at a twentieth The Sky moved 40 to 36.8ft and its
  // retrace shuffled three doors at the margins for nothing. Never over a
  // label's calibration.
  //
  // AND TAKEN BY DEGREES PAST IT (witnessShare), never all at once. Taken
  // whole the moment the doors disagreed by more than the tenth, a hair of
  // one door's reading moved the whole building by a tenth: Plan A (styled)
  // stood on 40ft with its doors 9.9% off and on 44.1ft at 10.3%, with three
  // phantom openings in its front wall; the six renders of The Sky, one
  // house, stood at 40ft (8-9% off) and at 35.6-35.9ft (10.3-11% off).
  if (!calibrated && retrace) {
    for (let pass = 0; pass < 2; pass++) {
      const w = doorWitnessWidthFt(read.openings, scale, widthFt);
      if (!w) break;
      const off = (w.widthFt - widthFt) / widthFt;
      const share = witnessShare(Math.abs(off));
      if (!share) break;
      const next = Math.round(widthFt * (1 + off * share) * 10) / 10;
      if (next === widthFt) break;
      why = share < 1 ? `${w.why}; ${Math.round(share * 100)}% of the ${(off * 100).toFixed(1)}% taken` : w.why;
      widthFt = next; calibrated = 'doors';
      ex = retrace(widthFt);
      readAt();
    }
  }
  return { widthFt, calibrated, why, ex, scale, plan: between, read };
}

/** A standard door: 2'-8", the interior door of the US stock, the metric 800 its twin. */
export const DOOR_FT = 2 + 8 / 12;
/** How far the witness can be trusted: the two label-calibrated plans put their median door 3-9% off DOOR_FT. */
export const DOOR_WITNESS_TENTH = 0.1;

/**
 * How much of the doors' disagreement with the width to take, by its size:
 * none within the witness's own uncertainty (the tenth), all of it past
 * twice that, and in between a share that grows with it, so the width taken
 * moves with the doors and never jumps (firm thresholding: the correction
 * rises from nothing at one tenth to the whole of it at two).
 *
 * The price, measured on the corpus (2026-09-24): between the tenth and
 * twice it the width moves twice as fast as the doors' reading, so the
 * renders of one house there spread further (Geena's three: 2.0ft apart, not
 * 1.0); where the old step split a house's renders across it they now agree
 * (The Sky's: 3.2ft apart, not 5.6). No plan in the corpus has a transcribed
 * width to say which is nearer the truth. Saman chose continuity.
 *
 * @param {number} off  |witness - width| / width
 * @returns {number} 0..1
 */
export function witnessShare(off) {
  const t = DOOR_WITNESS_TENTH;
  if (!(off > t)) return 0;
  if (off >= 2 * t) return 1;
  return (2 * t * (off - t)) / (t * off);
}

/**
 * The building's width the hung doors vouch for: the median single-leaf
 * swing door read as DOOR_FT. Three doors at least (one is a closet, two a
 * coincidence); folded, sliding and double doors are not a door's width;
 * the answer held to 12-160ft, outside which the doors are not doors.
 *
 * @param {Array} openings  readWindows' openings
 * @param {number} scale  ft/px of the reading they were made at
 * @param {number} widthFt  the width that reading stood on
 * @returns {{widthFt:number, why:string}|null}
 */
export function doorWitnessWidthFt(openings, scale, widthFt) {
  if (!scale || !widthFt) return null;
  const px = (openings || [])
    // A closet's door drawn shut is one leaf too, and as wide as the closet:
    // Madison 4's scale moved a foot the day closet doors began to be read
    // from one jamb, until they were left out.
    .filter((o) => o.kind === 'door' && !o.bifold && !o.sliding && !o.closet && (o.leaves?.length || 0) === 1)
    .map((o) => (o.horizontal ? o.x1 - o.x0 : o.y1 - o.y0))
    .sort((a, b) => a - b);
  if (px.length < 3) return null;
  const medianFt = px[px.length >> 1] * scale;
  if (!(medianFt > 0)) return null;
  const w = widthFt * DOOR_FT / medianFt;
  if (w < 12 || w > 160) return null;
  return { widthFt: Math.round(w * 10) / 10, why: `${px.length} hung doors, median ${medianFt.toFixed(2)}ft at ${widthFt}ft, read as ${DOOR_FT.toFixed(2)}ft` };
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
  const horizontal = [], vertical = [], sides = { horizontal: [], vertical: [] };
  for (const r of ex.inkRects) {
    const s = {
      x0: Math.round(r.x0 * sx), y0: Math.round(r.y0 * sy),
      x1: Math.round(r.x1 * sx), y1: Math.round(r.y1 * sy),
    };
    const hz = s.x1 - s.x0 >= s.y1 - s.y0;
    // A CLOSET'S SIDE DRAWN IN HAIRLINES (extrudeWalls) is a wall of its own:
    // no slice of the wall it runs beside, and no sample of how thick this
    // plan draws its walls. Folded in, Plan A's four moved the median from
    // 20px to 18, which split its front wall's two slices into three phantom
    // openings; and the closet's top, folded into the wall above it, widened
    // that wall's doorway over it, so the doorway's cut took the closet's
    // top away.
    if (r.closet) sides[hz ? 'horizontal' : 'vertical'].push(s);
    else if (hz) horizontal.push(s); else vertical.push(s);
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
    horizontal: mergeParallel(horizontal, true, maxThick).concat(sides.horizontal),
    vertical: mergeParallel(vertical, false, maxThick).concat(sides.vertical),
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
 * end, the same one the jamb-return test keys on. Nine tenths, or all but
 * two rows: the band is the wall's INK band (bandFromInk) and a wall that
 * crosses it is drawn to its own face, a line's weight off the band's edge
 * -- Jordan 4's corner door has its bottom jamb 2px inside a 16px band, and
 * read at 87% the jamb was no pier, the doorway ran 33px into the wall and
 * the truth no longer knew it (2026-09-19).
 */
/**
 * THE WALL'S OWN TONE AT A GAP: the weakest tenth of the ink in the gap's band,
 * eight columns past each jamb, in `pos` (ink-positive, so either look). What a
 * pier (splitAtPiers) and a garage door's open band (readWindows) are held to:
 * ink at this tone is wall; a hatch or a fill drawn through the band is not.
 * -1 when the jambs carry no ink.
 */
export function jambWallTone(g, ink, pos, W, H) {
  const [c0, c1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
  const lo = Math.max(0, Math.floor(c0)), hi = Math.min(g.horizontal ? H : W, Math.ceil(c1));
  const a0 = g.horizontal ? g.x0 : g.y0, a1 = g.horizontal ? g.x1 : g.y1;
  const vals = [];
  for (let k = 1; k <= 8; k++) {
    for (const a of [a0 - k, a1 - 1 + k]) {
      if (a < 0 || a >= (g.horizontal ? W : H)) continue;
      for (let c = lo; c < hi; c++) { const p = g.horizontal ? c * W + a : a * W + c; if (ink[p]) vals.push(pos[p]); }
    }
  }
  vals.sort((p, q) => p - q);
  return vals.length ? vals[Math.floor(vals.length / 10)] : -1;
}

export function splitAtPiers(gaps, ink, W, H, opts = {}) {
  const solidFrac = opts.solidFrac ?? 0.9;
  const slack = opts.slack ?? 2;
  const minPier = opts.minPier ?? 3;
  const minGap = opts.minGap ?? 20;
  const out = [];
  for (const g of gaps) {
    const [c0, c1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const lo = Math.max(0, Math.floor(c0)), hi = Math.min(g.horizontal ? H : W, Math.ceil(c1));
    const rows = hi - lo;
    const a0 = g.horizontal ? g.x0 : g.y0, a1 = g.horizontal ? g.x1 : g.y1;
    if (rows <= 0 || a1 - a0 < minGap * 2) { out.push(g); continue; }
    const need = Math.max(1, Math.min(Math.ceil(rows * solidFrac), rows - slack));
    const solid = (a) => {
      let n = 0;
      for (let c = lo; c < hi; c++) n += ink[g.horizontal ? c * W + a : a * W + c];
      return n >= need;
    };
    // A PIER IS WALL, DRAWN AS STRONG AS THE WALL BESIDE IT. A hatch drawn
    // through a doorway is nine tenths ink too on the dark look -- Madison 3's
    // stoop, carried into the stair: a beige fill at a median of 173 to 177
    // between walls at 233 to 241 -- and in a band read at the wall's own
    // thickness its rows passed as piers and cut the doorway to a sliver. So a
    // pier's ink must reach the weakest tenth of the jambs' own wall ink
    // (`pos`, ink-positive, so either look): the tone test fillRegions keys
    // on, measured on the wall at hand. An outlined wall's end is one thin
    // line, and drawn at least as strong as its faces (The Star's, at 42 to
    // 89 against faces at 60 to 82).
    const tone = (a, into) => { for (let c = lo; c < hi; c++) { const p = g.horizontal ? c * W + a : a * W + c; if (ink[p]) into.push(opts.pos[p]); } };
    const wallTone = opts.pos ? jambWallTone(g, ink, opts.pos, W, H) : -1;
    const asWall = (p0, p1) => {
      if (wallTone < 0) return true;
      const vals = [];
      for (let a = p0; a < p1; a++) tone(a, vals);
      vals.sort((p, q) => p - q);
      return vals.length > 0 && vals[vals.length >> 1] >= wallTone;
    };
    const cuts = [];
    for (let a = a0; a < a1;) {
      if (!solid(a)) { a++; continue; }
      let e = a;
      while (e + 1 < a1 && solid(e + 1)) e++;
      if (e - a + 1 >= minPier && asWall(a, e + 1)) cuts.push([a, e + 1]);
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
 * among eight and cannot widen it -- read past any wall standing across the
 * jamb (below). Never narrower than the tile, never more than twice its
 * thickness.
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
  // THE COLUMNS ARE READ WHERE THIS WALL RUNS ALONE. A wall standing across
  // a jamb -- a hall's side at the doorway at its end, a bay's side wall at
  // its mouth -- is usually thicker than eight columns, and a column inside
  // it measures that wall's length, not this one's thickness: every column
  // agreed on the cap, and the band came back twice the wall (276 of the 417
  // capped sides across the corpus had such a wall at both jambs). The Avi
  // Top's bay mouth took its band down the side walls to the bay's front, and
  // the front's lines read as glass across the mouth. So at each end the
  // columns start past the traced walls (`seg`) standing across it, and are
  // read as before: every one votes, the tightest agreement wins.
  const touch = 6;
  const acrossJamb = opts.seg ? (gap.horizontal ? opts.seg.vertical : opts.seg.horizontal) : [];
  const past = (end, dir) => {
    let reach = 0;
    for (const r of acrossJamb) {
      const [ra0, ra1] = gap.horizontal ? [r.x0, r.x1] : [r.y0, r.y1];
      const [rc0, rc1] = gap.horizontal ? [r.y0, r.y1] : [r.x0, r.x1];
      if (rc1 < c0 - touch || rc0 > c1 + touch || ra0 > end + touch || ra1 < end - touch) continue;
      reach = Math.max(reach, dir < 0 ? end - ra0 : ra1 - end);
    }
    return reach;
  };
  // Only where this wall GOES ON past it: this wall's section across its
  // line, ink the tile's thickness at least that stops at a face on both
  // sides before the cap. Where nothing of it stands beyond -- a strip
  // between two partitions under a wall solid above it (The Star's bath) --
  // there is nowhere it runs alone and the jamb is read where it always was;
  // read past, its band stayed a tile and the tub's rim and the window's
  // sash framed it as glass. A stroke crossing the line (the next room's door
  // swing) is not this wall, and nor are the first columns past a cross
  // wall's tile, still a pixel or two of that wall's ink along its length.
  const goesOn = (end, dir, d) => {
    for (let k = 1; k <= probe; k++) {
      const a = dir < 0 ? end - d - k : end - 1 + d + k;
      if (a < 0 || a >= along || !at(a, mid)) continue;
      let u = mid, v = mid;
      while (u - 1 >= 0 && at(a, u - 1) && mid - u < cap) u--;
      while (v + 1 < cross && at(a, v + 1) && v - mid < cap) v++;
      if (v - u + 1 >= thick && mid - u < cap && v - mid < cap) return true;
    }
    return false;
  };
  const skip = [past(a0, -1), past(a1, 1)];
  if (skip[0] && !goesOn(a0, -1, skip[0])) skip[0] = 0;
  if (skip[1] && !goesOn(a1, 1, skip[1])) skip[1] = 0;
  let lo = -Infinity, hi = Infinity, agreed = 0;
  for (let k = 1; k <= probe; k++) {
    for (const a of [a0 - skip[0] - k, a1 - 1 + skip[1] + k]) {
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
    // A BAY'S TIPS STAND FREE. Two walls leaving a gap's ends to the same
    // side and ending AT a wall are a room's or a closet's sides, not a
    // bay's, and the line between their tips is that wall -- Madison 5's
    // pantry, whose walls end at the hall wall with the pantry door in it,
    // and its kitchen, whose walls run to the outer wall with the sink's
    // window in it: a "front" was framed on the wall line each time, and the
    // door hung once in the doorway and once in the glass beside it, and an
    // 8ft window stood inside the kitchen (2026-09-18). A tip meets a wall
    // when a wall parallel to the front holds the tip in its band across
    // the side wall's own thickness. Both tips held: no bay.
    const along = g.horizontal ? seg.horizontal : seg.vertical;
    const meets = (S, tipS) => along.some((w) => {
      const [wc0, wc1] = cross(w);
      if (wc0 > tipS + touch || wc1 < tipS - touch) return false;
      const [wa0, wa1] = run(w), [sa0, sa1] = run(S);
      return wa1 >= sa0 - touch && wa0 <= sa1 + touch;
    });
    if (meets(L, tipL) && meets(R, tipR)) { out.push(g); continue; }
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
  // A wall running the gap's way, touching its band (a pixel's seam allowed,
  // the outline's snap) or in it, along half its run or more. Only walls
  // running the same way: a crossing wall's thickness beside a short corner
  // doorway is the doorway's jamb, not a wall alongside it.
  const alongside = (horizontal, g0, g1, c0, c1) => (horizontal ? seg.horizontal : seg.vertical).some((w) => {
    const [wa0, wa1] = horizontal ? [w.x0, w.x1] : [w.y0, w.y1];
    const [wc0, wc1] = horizontal ? [w.y0, w.y1] : [w.x0, w.x1];
    if (wc1 < c0 - 1 || wc0 > c1 + 1) return false;
    return (Math.min(g1, wa1) - Math.max(g0, wa0)) * 2 >= g1 - g0;
  });
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
        // A SLICE'S END IS NOT THE WALL'S. A wall thickened at its end is
        // traced as two slices side by side, and the short one ends where the
        // wall does not: Jordan 2's garage wall steps out for a foot at its
        // top, the step ended, looked down the floor beside the wall to the
        // wall across the bottom, and a 19ft "opening" was listed along a
        // wall drawn solid from end to end -- a garage door hung there once
        // the garage was named. A doorway never runs alongside a wall (the
        // jog rule in dedupeGaps says the same): with a wall beside the band
        // over half the run or more, there is nothing to walk through, and
        // nothing is listed.
        if (alongside(horizontal, g0, g1, c0, c1)) continue;
        // `dir` is the way the wall end looked: the wall stands at the gap's
        // a0 when +1, at its a1 when -1 (dedupeGaps reads it at a jog).
        out.push(horizontal
          ? { x0: g0, x1: g1, y0: c0, y1: c1, horizontal: true, face: [c0, c1], endGap: true, dir }
          : { y0: g0, y1: g1, x0: c0, x1: c1, horizontal: false, face: [c0, c1], endGap: true, dir });
      }
    }
  }
  return out;
}

/**
 * Drop gaps that another gap of the same orientation already covers by half
 * or more.
 *
 * With `wallPx` (the extruder's wall thickness), a doorway a wall JOGS at is
 * listed once, not twice. The Sky's hall (2026-09-18): the upper wall ends at
 * a corner and looks ahead down its own line, the lower wall starts a wall's
 * width over and looks back up its line, and both wall-end gaps span the one
 * doorway -- the door hung once in each, two leaves through one another in
 * the 3D. Two wall-end gaps looking towards each other from lines within a
 * wall and a half of each other are that jog. The doorway is in the line of
 * the SHORTER: the longer one runs on past the shorter one's wall end,
 * alongside that wall, and a doorway never runs alongside a wall. A jog has
 * FLOOR between its two lines, half a wall of it at least and no wall in
 * it: lines that touch are slices of one wall, and Madison 3's bay lost its
 * glass when the hairline of its back, looking down beside the end gap of
 * the wall's inner slice with the outer slice between them, was taken for
 * the jog's twin. Read on the extruder's bands, before the ink widens them
 * (planFromReading runs it on the first pass only). A corner door -- Jordan
 * 4's, off the same kind of corner -- has no such twin and is left alone.
 *
 * @param {object|null} jog  `{ wallPx, ground, w, h }` turns the jog rule
 *   on: the extruder's wall thickness and its walls as a raster
 */
export function dedupeGaps(gaps, jog = null) {
  const run = (g) => (g.horizontal ? [g.x0, g.x1] : [g.y0, g.y1]);
  const cross = (g) => (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
  // The jog's phantom: `a` contains `b`'s run and runs on past b's wall end.
  const overshoots = (a, b) => {
    const [a0, a1] = run(a), [b0, b1] = run(b);
    if (a0 > b0 || a1 < b1) return false;
    return b.dir > 0 ? a0 < b0 : a1 > b1;
  };
  const jogged = (g, k) => {
    if (!jog?.wallPx || !g.endGap || !k.endGap || g.dir !== -k.dir) return false;
    const { wallPx, ground, w, h } = jog;
    const [c0, c1] = cross(g), [kc0, kc1] = cross(k);
    const s0 = Math.min(c1, kc1), s1 = Math.max(c0, kc0), strip = s1 - s0;
    if (strip < wallPx * 0.5 || strip > wallPx * 1.5) return false;
    const [a0, a1] = run(g), [ka0, ka1] = run(k);
    const o0 = Math.max(a0, ka0), o1 = Math.min(a1, ka1), ov = o1 - o0;
    if (!(ov > 0 && ov / Math.min(a1 - a0, ka1 - ka0) >= 0.5)) return false;
    // Floor between the lines: walked down the strip's middle over the shared
    // run, no more wall than the outline's snap can put there.
    const c = Math.floor((s0 + s1) / 2);
    let wall = 0;
    for (let a = o0; a < o1; a++) {
      const x = g.horizontal ? a : c, y = g.horizontal ? c : a;
      if (x >= 0 && y >= 0 && x < w && y < h && ground[y * w + x]) wall++;
    }
    return wall <= wallPx * 0.5;
  };
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
    if (dup) continue;
    const twin = kept.findIndex((k) => jogged(g, k));
    if (twin >= 0) {
      const k = kept[twin];
      if (overshoots(g, k)) continue;             // g is the phantom
      if (overshoots(k, g)) { kept[twin] = g; continue; }   // k was
    }
    kept.push(g);
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
  const wallPx = ex.wallFloorFt ? ex.wallFloorFt / scale : 0;
  const between = dedupeGaps(planGaps(seg, { minGap: 20, maxGap })
    .concat(endGaps(seg, ground, plan.w, plan.h, { minGap: 20, maxGap })), { wallPx, ground, w: plan.w, h: plan.h });
  // Deduplicated once more at the end, on the bands the ink gave them: two
  // lines of one wall can still hand back one window twice a pixel apart (The
  // Star's back wall: y1439-1452 and y1438-1453), and the baseline had been
  // counting both. The jog rule is not run here: the ink-widened bands can
  // touch across a jog's floor (The Sky's 730-745 came back 729-768).
  let gaps = dedupeGaps(splitAtPiers(
    bayFronts(between, seg)
      .map((g) => (g.bay || g.bayMouth ? g : bandFromInk(g, plan.ink, plan.w, plan.h, { seg }))),
    plan.ink, plan.w, plan.h, { minGap: 20, pos: plan.pos },
  ));
  // A CLOSET DRAWN IN THIN LINES (extrudeWalls' closetMouths): its sides are
  // walls now, and its doorway lies between their ends, where no gap finder
  // looks. Listed as drawn; a gap already over it is the same doorway, and is
  // marked. Either way it is a closet's mouth, and the lines the plan draws
  // across it are the closet's front, not a window's glass (readWindows).
  for (const q of ex.closetMouths || []) {
    const mouth = {
      x0: Math.round(q.x0 * plan.w), x1: Math.round(q.x1 * plan.w),
      y0: Math.round(q.y0 * plan.h), y1: Math.round(q.y1 * plan.h),
      horizontal: !!q.horizontal, closetMouth: true,
    };
    const over = (g) => !!g.horizontal === mouth.horizontal
      && Math.min(mouth.x1, g.x1) > Math.max(mouth.x0, g.x0) && Math.min(mouth.y1, g.y1) > Math.max(mouth.y0, g.y0);
    gaps = gaps.some(over) ? gaps.map((g) => (over(g) ? { ...g, closetMouth: true } : g)) : gaps.concat([mouth]);
  }
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
  // The symbols' ink (symbolInk): what every reader of a symbol below reads.
  // The walls and the flood keep the ink.
  const lines = plan.lines || ink;
  // A closet's mouth (planFromReading) is a doorway whatever lines cross it.
  const glazed = glazedOpenings({ w, h }, { mask: lines, low: null }, gaps.filter((g) => !g.closetMouth));
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
    : classifyOpening(ink, w, h, g, scale, { lines })));
  // A GARAGE'S OPENING IS A GARAGE DOOR. The classifier reads the symbol, and
  // The Star's two garage doors came back "cased opening" -- the drawing puts
  // a dashed apron outside them and nothing across them -- while an 8.1ft
  // porch bay came back "garage". The confirmed labels settle it more simply
  // (Saman's rule, 2026-09-12): an exterior opening whose nearest confirmed
  // room name is GARAGE is a garage door, and nothing else is. Flooding the
  // plan into rooms was tried first and does not work here, because a garage
  // with its doors open is not an enclosed room to a flood.
  //
  // AND WIDE ENOUGH FOR THE CAR (2026-09-25). A garage door is the opening a
  // car drives through: at least as wide as the car the model parks inside
  // (CATALOG.car, fixtures.js). A window or a person's door in the garage's
  // wall is narrower, and keeps what the drawing says it is; before, any
  // lined opening near the name became a garage door. And it is found
  // whatever is drawn across it: only openings with lines along them were
  // asked, and a door drawn as dark lines on the dark look (Madison 4), as two
  // hairlines two pixels apart (newtest1) or as nothing at all was never a
  // candidate. garage.js decides what a garage is -- the word, "GAR", never a
  // carport, which has no vehicle door.
  const garageLabels = labels.filter(hasVehicleDoor);
  const carFt = CATALOG.car.w;
  const nearest = (x, y) => {
    let best = null, bd = Infinity;
    for (const l of labels) {
      const d = Math.hypot(l.x * w - x, l.y * h - y);
      if (d < bd) { bd = d; best = l; }
    }
    return { label: best, ft: bd * scale };
  };
  const inGarage = (gp) => {
    if (!garageLabels.length) return false;
    const cx = (gp.x0 + gp.x1) / 2, cy = (gp.y0 + gp.y1) / 2, off = wallPx * 3;
    const probes = gp.horizontal ? [[cx, cy - off], [cx, cy + off]] : [[cx - off, cy], [cx + off, cy]];
    return probes.some(([x, y]) => {
      const n = nearest(x, y);
      return n.label && garageLabels.includes(n.label) && n.ft < 30;
    });
  };
  const widthFtOf = (g) => (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale;
  exterior.forEach((gp, i) => {
    if (inGarage(gp) && kinds[i].widthFt >= carFt) kinds[i] = { ...kinds[i], kind: 'garage', why: `${kinds[i].widthFt.toFixed(1)}ft, nearest room is the garage` };
    else if (kinds[i].kind === 'garage') kinds[i] = { ...kinds[i], kind: 'opening', why: kinds[i].why + ' — but no garage named here' };
  });
  // The garage's openings with nothing read along them, asked the same
  // question on the same flood.
  // AN OPENING, NOT A WALL. With nothing read along it, a candidate has to be
  // open in the drawing: less than half its band is ink at the wall's own tone
  // (jambWallTone). The tracer lists gaps where the wall is drawn solid --
  // Jordan 2's garage has one down its left wall, 0.62 wall ink -- and a
  // garage door hung there is architecture invented. The garage doors read
  // this way run from 0.00 to 0.20; a hatched apron drawn into the band is not
  // wall tone and does not count (Madison 2's: 0.78 at the fixed cut).
  const wallShare = (g) => {
    const tone = plan.pos ? jambWallTone(g, ink, plan.pos, w, h) : -1;
    const [f0, f1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    let n = 0, k = 0;
    for (let a = (g.horizontal ? g.x0 : g.y0); a < (g.horizontal ? g.x1 : g.y1); a++) {
      for (let c = Math.floor(f0); c < Math.ceil(f1); c++) {
        const p = g.horizontal ? c * w + a : a * w + c;
        n++;
        if (ink[p] && (tone < 0 || plan.pos[p] >= tone)) k++;
      }
    }
    return n ? k / n : 1;
  };
  const sameRect = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
  const unlined = gaps.filter((g) => !g.closetMouth && !g.bayMouth && !g.bay
    && !glazed.some((q) => sameRect(q, g)) && widthFtOf(g) >= carFt && inGarage(g) && wallShare(g) < 0.5);
  for (const g of exteriorGaps(ground, w, h, seg, unlined, { bridge, faceDepth: Math.max(3, Math.round(wallPx * 2)), seeds })) {
    exterior.push({ ...g, byLines: false });
    kinds.push({ kind: 'garage', widthFt: widthFtOf(g), why: `${widthFtOf(g).toFixed(1)}ft, nearest room is the garage, nothing drawn across it` });
  }
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
      let best = null, bestOff = Infinity, bestOv = 0;
      for (const g of gaps) {
        if (!!g.horizontal !== hz) continue;
        const b0 = hz ? g.y0 : g.x0, b1 = hz ? g.y1 : g.x1;
        // The hinge sits on the drawn wall's FACE; the extruder's band is the
        // wall's core, a wall's thickness narrower on a fuzzy-edged render.
        const wpx = opts.wallPx ?? wallPx;
        if (band < b0 - wpx * 1.5 - 4 || band > b1 + wpx * 1.5 + 4) continue;
        const r0 = hz ? g.x0 : g.y0, r1 = hz ? g.x1 : g.y1;
        const ov = Math.min(hi, r1) - Math.max(lo, r0);
        if (ov < len * 0.5) continue;
        // THE CHORD IS THE DOORWAY. A leaf spans its doorway, or half of a
        // pair's: a gap wider than two leaves and a quarter is another
        // opening the chord happens to lie along (apt413201: an 11ft hall
        // gap 49px off the hinge, taken over the 3ft doorway the hinge sat
        // on because it overlapped the chord by more). And of the gaps in
        // reach, the one whose band the hinge is nearest is the doorway;
        // overlap decides only between bands at the same distance.
        if (r1 - r0 > len * 2.5) continue;
        const off = Math.max(0, b0 - band, band - b1);
        if (off < bestOff - 1e-9 || (Math.abs(off - bestOff) <= 1e-9 && ov > bestOv)) { best = g; bestOff = off; bestOv = ov; }
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
    // The doorway a symbol describes, as a rectangle in the wall's band: the
    // chord (or, for a pair, hinge to hinge) along the wall, a wall's
    // thickness deep on the far side of the hinge's face from the swing.
    const wp = opts.wallPx ?? wallPx;
    const mouthOf = (d, lo, hi) => {
      const hz = Math.abs(d.along[0]) > Math.abs(d.along[1]);
      const face = hz ? d.y : d.x, back = face - (hz ? d.into[1] : d.into[0]) * wp;
      const b0 = Math.round(Math.min(face, back)), b1 = Math.round(Math.max(face, back));
      const gm = hz ? { x0: Math.round(lo), x1: Math.round(hi), y0: b0, y1: b1, horizontal: true } : { x0: b0, x1: b1, y0: Math.round(lo), y1: Math.round(hi), horizontal: false };
      gm.fromSymbol = true;
      return gm;
    };
    // PAIRS FIRST: two half leaves whose mouth is hinge to hinge (The Sky's
    // bedroom closets). Both leaves go into one doorway, made when the model
    // lists none over the mouth and leaves it open.
    const pairs = new Map();
    for (const d of sym.doors) if (d.pair) pairs.set(d.pair, (pairs.get(d.pair) || []).concat([d]));
    const inPair = new Set();
    for (const [mouth, ds] of pairs) {
      if (ds.length !== 2) continue;
      ds.forEach((d) => inPair.add(d));
      const g = gapOf(ds[0]) || gapOf(ds[1]);
      if (g) { if (isBare(g)) leavesOf.set(g, ds.map(leafOf)); continue; }
      if (ds.some((d) => walled(d) || d.score < 0.75 || d.deg < 75)) { orphans.push(...ds); continue; }
      const hz = Math.abs(ds[0].along[0]) > Math.abs(ds[0].along[1]);
      const lo = hz ? Math.min(mouth.x0, mouth.x1) : Math.min(mouth.y0, mouth.y1);
      const hi = hz ? Math.max(mouth.x0, mouth.x1) : Math.max(mouth.y0, mouth.y1);
      const gm = mouthOf(ds[0], lo, hi);
      made.push(gm);
      leavesOf.set(gm, ds.map(leafOf));
    }
    for (const d of sym.doors) {
      if (inPair.has(d)) continue;
      const g = gapOf(d);
      if (!g) {
        if (walled(d)) { orphans.push(d); continue; }
        // With no traced doorway to vouch for it, only the strongest symbol
        // makes one: both marks three quarters covered and a whole quarter
        // drawn. A water tank's rounded corner with a line of its outline
        // for a leaf scored 0.6 at 48 degrees inside a closet (Madison).
        if (d.score < 0.75 || d.deg < 75) continue;
        const hz = Math.abs(d.along[0]) > Math.abs(d.along[1]);
        const lo = hz ? Math.min(d.chord.x0, d.chord.x1) : Math.min(d.chord.y0, d.chord.y1);
        const hi = hz ? Math.max(d.chord.x0, d.chord.x1) : Math.max(d.chord.y0, d.chord.y1);
        const gm = mouthOf(d, lo, hi);
        made.push(gm);
        leavesOf.set(gm, [leafOf(d)]);
        continue;
      }
      if (!isBare(g)) continue;
      hungHere.set(g, (hungHere.get(g) || []).concat([leafOf(d)]));
    }
    madeDoorways.push(...made);
    // One leaf spanning the doorway, or two from opposite jambs: a pair.
    // A leaf spans it when it covers six tenths of the traced gap -- or when
    // what the gap holds beyond its chord is narrower than any leaf a symbol
    // is read at (MIN_R_FT), so it cannot be half of a pair. Plan A's master
    // bath door is r87-90 in a 149px gap whose last 50px are a thin wall the
    // tracer does not build, and hung or not by the arc fit's draw: building
    // the closet across the house took four arcs out of the draw's sequence.
    const minLeaf = MIN_R_FT / scale;
    const spans = (l, g, wgap) => {
      if (l.r >= wgap * 0.6) return true;
      const a = g.horizontal ? l.x : l.y, d = g.horizontal ? l.ax : l.ay;
      const c0 = Math.min(a, a + d * l.r), c1 = Math.max(a, a + d * l.r);
      const [r0, r1] = g.horizontal ? [g.x0, g.x1] : [g.y0, g.y1];
      return wgap - Math.max(0, Math.min(c1, r1) - Math.max(c0, r0)) < minLeaf;
    };
    for (const [g, leaves] of hungHere) {
      const wgap = g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0;
      const singles = leaves.filter((l) => spans(l, g, wgap)).sort((a, b) => Math.abs(a.r - wgap) - Math.abs(b.r - wgap));
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
  // A closet's doors: sized to the closet, not to a person, so never one of
  // the doors the scale is read from (doorWitnessWidthFt).
  const closetDoor = new Set();
  const pocketWall = new Map();
  if (opts.doors !== false) {
    const exteriorKind = new Map(exterior.map((g, i) => [g, kinds[i].kind]));
    // The reader's own gap for this doorway: a doorway's width at least (a
    // 1.3ft scrap inside a 6.3ft opening gave a railing line a pocket door,
    // Jordan 2), and mostly inside the extruder's gap. It may be narrower
    // than the extruder's: a pocket door's wall is hollow where the panel
    // goes, and the extruder's gap runs on through it (The Sky: 5.5ft for a
    // 2.7ft doorway).
    // And IN THE SAME WALL: the bands must share half of the thinner. Plan A's
    // bedroom-3 closet had its whole interior listed by the reader as one
    // 105px-deep "gap" whose band touched the mouth's by 20px, and the
    // closet's doors were then read off its far wall's edge, a hundred pixels
    // from the doorway, and built inside that wall (2026-09-19).
    const ownRect = (g) => (plan.own?.gaps || []).find((q) => {
      if (!!q.horizontal !== !!g.horizontal) return false;
      const lq = g.horizontal ? q.x1 - q.x0 : q.y1 - q.y0;
      if (lq * scale < 2) return false;
      const ov = g.horizontal ? Math.min(q.x1, g.x1) - Math.max(q.x0, g.x0) : Math.min(q.y1, g.y1) - Math.max(q.y0, g.y0);
      const [qb0, qb1] = g.horizontal ? [q.y0, q.y1] : [q.x0, q.x1];
      const [gb0, gb1] = g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1];
      const band = Math.min(qb1, gb1) - Math.max(qb0, gb0);
      return ov / lq >= 0.5 && band > 0 && band / Math.min(qb1 - qb0, gb1 - gb0) >= 0.5;
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
    // ...and one Λ with no arc beside it is a two-panel bifold (findBifolds
    // says so with `folded`), not a pair.
    for (const [rect, b] of found) { const g = where.get(rect); leavesOf.set(g, b.leaves); if (b.panels >= 4 || b.folded) folded.add(g); }
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
    // A closet's furniture and its doors' panels are hairlines, and are read
    // on the symbols' ink (symbolInk); a pocket door's hollow wall is read on
    // the ink its test was measured on.
    const closetOf = findClosets(lines, ground, w, h, bare.map(([, g]) => g), { ftPerPx: scale, wallPx: opts.wallPx ?? wallPx });
    const closetRects = new Set(bare.filter(([, g]) => closetOf.has(g) || g.closetMouth).map(([rect]) => rect));
    // A PAIR DRAWN NEARLY SHUT (findShutPairs), in the doorways still bare:
    // two leaves opened a few degrees, their arcs too short to be read as
    // arcs. Read on the symbols' ink, like every hairline symbol here. Before
    // the sliding doors: the pair is drawn outside the door line, and a
    // closet whose front is drawn along its mouth (Plan A beside BATH 2)
    // has a bar there that the sliding reader takes for a door drawn shut.
    const shutOpts = { ftPerPx: scale, segments: plan.own?.seg || seg, wallPx: opts.wallPx ?? wallPx };
    for (const [rect, b] of findShutPairs(lines, w, h, bare.map(([rect]) => rect), { ...shutOpts, closet: (r) => closetRects.has(r) })) {
      leavesOf.set(where.get(rect), b.leaves);
      if (closetRects.has(rect)) closetDoor.add(where.get(rect));
    }
    const slideOpts = { ftPerPx: scale, wallPx: opts.wallPx ?? wallPx, closet: (r) => closetRects.has(r.own) };
    const unhung = rects.filter((r) => !leavesOf.has(where.get(r.own)));
    const slid = new Map([
      ...findSlidingDoors(lines, w, h, unhung.filter((r) => closetRects.has(r.own)), slideOpts),
      ...findSlidingDoors(ink, w, h, unhung.filter((r) => !closetRects.has(r.own)), slideOpts),
    ]);
    for (const [rect, b] of slid) {
      const g = where.get(rect.own);
      leavesOf.set(g, b.leaves);
      if (b.pocket || b.bypass) sliding.set(g, b.pocket ? 'pocket' : 'bypass');
      if (b.wall) pocketWall.set(g, b.wall);
      if (closetRects.has(rect.own)) closetDoor.add(g);
    }
    // AND WHERE THE MODEL LISTS NO DOORWAY: the reader's own gap, over a line
    // the extruder's walls leave open. Plan A's linen closet opens between
    // the tips of two parallel walls, which no gap finder lists (a bay's
    // front needs an opening in the wall behind it, and the closet has
    // none), so its doors had nowhere to hang. The symbol makes the
    // doorway, as a door's arc does above: the reader's own gap, as drawn.
    const exWall = wallGrid(w, h, seg, 0);
    const openLine = (q) => {
      const hzq = !!q.horizontal;
      const cMid = hzq ? (q.y0 + q.y1) / 2 : (q.x0 + q.x1) / 2;
      const [s0, s1] = hzq ? [q.x0, q.x1] : [q.y0, q.y1];
      let n = 0, on = 0;
      for (let k = 0.1; k <= 0.9; k += 0.05) {
        const a = s0 + (s1 - s0) * k, x = Math.round(hzq ? a : cMid), y = Math.round(hzq ? cMid : a);
        n++;
        if (x >= 0 && y >= 0 && x < w && y < h && exWall[y * w + x]) on++;
      }
      return on / n <= 0.3;
    };
    const overlaps = (q, g) => !!q.horizontal === !!g.horizontal
      && Math.min(q.x1, g.x1) > Math.max(q.x0, g.x0) && Math.min(q.y1, g.y1) > Math.max(q.y0, g.y0);
    const spare = (plan.own?.gaps || []).filter((q) => !where.has(q)
      && ![...gaps, ...madeDoorways].some((g) => overlaps(q, g)) && openLine(q));
    for (const [q, b] of findShutPairs(lines, w, h, spare, shutOpts)) {
      const gm = { x0: q.x0, x1: q.x1, y0: q.y0, y1: q.y1, horizontal: !!q.horizontal, ...(q.face ? { face: q.face } : {}), fromSymbol: true };
      madeDoorways.push(gm);
      leavesOf.set(gm, b.leaves);
    }
  }
  // Every leaf that rises off its doorway's wall is footed on that wall's
  // face (footLeaf); a bifold's panels and a sliding door's are not leaves.
  const wpFoot = opts.wallPx ?? wallPx;
  for (const [g, leaves] of leavesOf) if (!folded.has(g) && !sliding.has(g)) leavesOf.set(g, leaves.map((l) => footLeaf(l, g, wpFoot)));
  // What the record and the engine need of a fireplace: the mouth is the
  // opening's own rectangle; `fire` carries the firebox and the hearth.
  const asFire = (g) => {
    const f = fireOf.get(g);
    return { ...g, kind: 'fireplace', fire: { side: f.side, face: f.face, depth: f.depth, back: f.back, hearth: f.hearth } };
  };
  // ONE DOORWAY, ONE ENTRY. The exterior and interior lists hold COPIES of
  // the gaps (glazedOpenings hands each back with its `byLines`), while every
  // reader above hangs its leaves on the gap itself. Asked by object, the
  // copy never met its gap: a doorway with a line along it -- a threshold --
  // came back twice, the classifier's bare "opening" and the door hung in it
  // (16 doorways on 13 renders, every one a door in the truth; Another 2's
  // bypass door came back as a window too, and both were drawn). The panel
  // listed both, and naming the copy a door stood a shut door beside the
  // open one (Saman, 2026-09-25). So a listed opening is its gap by its
  // rectangle, and is drawn with what was hung in that gap.
  const rectKey = (g) => `${g.horizontal ? 'h' : 'v'}:${g.x0},${g.y0},${g.x1},${g.y1}`;
  const gapAt = new Map([...gaps, ...madeDoorways].map((g) => [rectKey(g), g]));
  const withDoor = (g, kind) => {
    const s = gapAt.get(rectKey(g)) || g;
    if (fireOf.has(s)) return asFire(s);
    const leaves = leavesOf.get(s);
    if (leaves) return { ...g, kind: 'door', leaves, ...(folded.has(s) ? { bifold: true } : {}), ...(sliding.has(s) ? { sliding: sliding.get(s) } : {}), ...(pocketWall.has(s) ? { wall: pocketWall.get(s) } : {}), ...(closetDoor.has(s) ? { closet: true } : {}) };
    return { ...g, kind: kind === 'door' || kind === 'double' ? 'opening' : kind };
  };
  const listed = new Set([...exterior, ...interior].map(rectKey));
  const doors = [...gaps, ...madeDoorways].filter((g) => !listed.has(rectKey(g)) && (leavesOf.has(g) || fireOf.has(g))).map((g) => ({ ...withDoor(g, 'door'), interior: true }));
  const openings = [...exterior.map((g, i) => withDoor(g, kinds[i].kind)), ...interior.map((g) => withDoor(g, 'win')), ...doors].map(styled);
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

/**
 * Do two rectangles (render pixels) cover half of the smaller, both ways? One
 * opening, to the panel (a decision and a reading) and to the gate (listed
 * twice, test/trace-coverage.mjs).
 */
export function sameOpening(a, b) {
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
  // firebox to draw and stays an opening (applyDecisions does not ask).
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
 * A LEAF HANGS FROM THE WALL'S FACE. The symbol reader puts the hinge where
 * the arc's circle centres, and a restyled arc is no true circle: Plan A's
 * bedroom door was hung 23px (half a foot) off the wall it swings from, its
 * foot in the air, the leaf drawn from the wall (Saman, 2026-09-19). The arc
 * reader hangs on the band's middle, half a wall inside. So the hinge slides
 * along the leaf's own line to the face of the doorway's band it rises
 * from, and the radius follows so the tip -- the arc's start, read from the
 * drawing -- stays where it is; then along the wall to the nearer jamb, the
 * tip staying again. A leaf lying along the wall (shut, a bypass panel) is
 * held by its jamb and not moved; one whose hinge is further from the face
 * than a symbol may sit from its doorway (a wall and a half) is left where
 * it was read.
 *
 * @param {object} l  a leaf `{x,y,ax,ay,ix,iy,r,deg}`, render pixels
 * @param {object} g  its doorway `{x0,y0,x1,y1,horizontal}`
 * @param {number} wallPx  the wall's thickness in render pixels
 */
export function footLeaf(l, g, wallPx) {
  if (!(l.deg > 0)) return l;
  const hz = !!g.horizontal;
  const t = (l.deg * Math.PI) / 180;
  const dx = l.ax * Math.cos(t) + l.ix * Math.sin(t), dy = l.ay * Math.cos(t) + l.iy * Math.sin(t);
  const dn = hz ? dy : dx;                                    // the leaf's rise off the wall
  if (Math.abs(dn) < 0.5) return l;
  const [b0, b1] = hz ? [g.y0, g.y1] : [g.x0, g.x1];
  const face = dn < 0 ? b0 : b1;
  const hb = hz ? l.y : l.x;
  const off = hb - face;                                        // across the wall, hinge to face
  // A hinge in the air past the face is footed when it is no further off
  // than a symbol may sit from its doorway (gapOf's own bound, across the
  // wall -- not along the leaf, which for a leaf half open is half again as
  // long and left The Sky's 40-degree doors unfooted). A hinge on the wall's
  // side of the face -- inside the band, or beyond its far face, the leaf
  // crossing the wall -- is footed whenever the band is a wall's (a band
  // walked out to twice the wall is a bay's or an ink band's, and its face
  // is nobody's hinge).
  const inAir = dn < 0 ? hb < face : hb > face;
  const s = off / dn;                                          // along the leaf, hinge to face
  const footable = (inAir ? Math.abs(off) <= wallPx * 1.5 + 4 : b1 - b0 <= wallPx * 2 + 4) && l.r + s > 0;
  const footed = footable ? { ...l, x: l.x - dx * s, y: l.y - dy * s, r: l.r + s } : l;
  // AND FROM THE JAMB. A leaf hangs from one end of its doorway, never from
  // a point inside it; the symbol reader's hinge is the arc's centre, and
  // Plan A's front door was drawn with its arc a third of the way in along
  // the leaf -- the leaf stood in the opening with air on both sides (Saman,
  // 2026-09-19). The hinge goes to the nearer jamb, on the face; the tip --
  // the arc's start, read from the drawing -- stays, so the radius and the
  // angle follow from it. Left alone when that would fold the leaf back
  // through the wall. Done whether or not the footing was: the jamb is the
  // doorway's own end, and a band too wide to name a face still has ends.
  const [a0, a1] = hz ? [g.x0, g.x1] : [g.y0, g.y1];
  const ha = hz ? footed.x : footed.y;
  const jamb = Math.abs(ha - a0) <= Math.abs(ha - a1) ? a0 : a1;
  if (Math.abs(ha - jamb) < 1) return footed;
  const tip = [footed.x + dx * footed.r, footed.y + dy * footed.r];
  const hx = hz ? jamb : footed.x, hy = hz ? footed.y : jamb;
  const vx = tip[0] - hx, vy = tip[1] - hy;
  const r = Math.hypot(vx, vy);
  if (r < 1) return footed;
  const deg = (Math.atan2((vx * l.ix + vy * l.iy) / r, (vx * l.ax + vy * l.ay) / r) * 180) / Math.PI;
  if (!(deg > 5 && deg < 175)) return footed;
  return { ...footed, x: hx, y: hy, r, deg };
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
  // A FIREPLACE IS READ, NEVER NAMED. Its firebox and hearth come from the
  // drafter's block on the plan (fireplace.js); an opening where none was read
  // has no firebox to build, and the choice drew nothing -- the door that
  // stood there simply went (Saman, 2026-09-25). The page no longer offers it
  // on such a row, and a choice made before that is not a decision the model
  // can carry out: the opening keeps what the reader read, not confirmed.
  const drawable = (d, g) => Boolean(d) && !(d.kind === 'fireplace' && !g.fire);
  // ONE OPENING, ONE DECISION. Until 2026-09-25 the reading listed a
  // doorway with a threshold line twice (readWindows, "one doorway, one
  // entry"), and a confirmed floor's record carries an item for each copy:
  // the door the reader hung, and the bare copy -- "open" as the reader read
  // it, or "door" where the person named it (a shut door beside the open
  // one). Every item over an opening is spent on it, so none outlives it as
  // an opening the reader no longer finds; and the one that decides is the
  // person's choice where there is one, else the item that agrees with the
  // reading -- never the copy's "open", which would take the door away.
  const person = (it) => it.read != null && it.kind !== it.read;
  const rows = openings.map((g) => {
    const read = kindOf(g);
    const here = [];
    items.forEach((it, i) => { if (!used.has(i) && sameOpening(it, g)) here.push(i); });
    here.forEach((i) => used.add(i));
    const pick = here.find((i) => person(items[i])) ?? here.find((i) => items[i].kind === read) ?? here[0];
    const d = pick == null ? undefined : items[pick];
    const kind = drawable(d, g) ? d.kind : read;
    return { id: d?.id || openingId(g, w, h), g: asKind(g, kind), raw: g.kind, read, kind, decided: drawable(d, g), kept: false };
  });
  // A decision the reader no longer finds an opening for is kept as the
  // person made it, drawn from its own rectangle -- WHEN IT WAS THEIR
  // DECISION. The record is written whole (decisionsFrom), so it carries the
  // reader's own verdicts beside the person's, and `read` says which: an
  // item whose kind is what the reader read is the reader's, and does not
  // outlive the reader's finding. The Sky's hall door (2026-09-19): the
  // tracer had listed the doorway twice, the list was written with both, the
  // duplicate was fixed away -- and its item, matching nothing, was kept and
  // drawn SHUT beside the real door standing open. An item written before
  // `read` was recorded cannot be told from the reader's, and nearly all are:
  // it is dropped the same way (a choice lost this way is one click to make
  // again; a phantom kept is a door invented). Not for `open` either:
  // nothing to draw, and a removed opening the reader also stopped finding
  // is done. Nor for a fireplace: a rectangle carries no firebox.
  items.forEach((it, i) => {
    if (used.has(i) || it.kind === 'open' || it.kind === 'fireplace' || it.read == null || it.read === it.kind) return;
    const g = asKind({ x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, horizontal: !!it.horizontal, interior: !!it.interior, kind: 'win' }, it.kind);
    rows.push({ id: it.id, g, raw: 'kept', read: it.read, kind: it.kind, decided: true, kept: true });
  });
  return { openings: rows.map((r) => r.g), rows };
}

/**
 * The record to keep, from the rows the page shows: every opening with the
 * kind it has now, as fractions of the render. Written whole on every change,
 * so a later reading meets the complete list rather than a diff -- and with
 * `read`, what the reader made of the opening when the list was written, so
 * the person's choices can be told from the reader's verdicts (applyDecisions).
 */
export function decisionsFrom(rows, w, h, meta = {}) {
  const items = rows.map((r) => ({
    id: r.id,
    x0: +(r.g.x0 / w).toFixed(4), y0: +(r.g.y0 / h).toFixed(4),
    x1: +(r.g.x1 / w).toFixed(4), y1: +(r.g.y1 / h).toFixed(4),
    horizontal: !!r.g.horizontal, interior: !!r.g.interior, kind: r.kind, read: r.read,
  }));
  return { ...meta, items };
}
