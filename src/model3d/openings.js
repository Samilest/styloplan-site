// Telling doors from windows in a wall, by looking for the door.
//
// WHY THIS WAY ROUND. Five attempts characterised "window-ness" directly — ink
// inside the wall band, ink outside the wall face, differencing the styled
// render against the wireframe — and measurement killed every one. Surveying
// the sample plans says why: there is no shared window signature. One builder
// draws a white gap with parallel lines, another a hollow rectangle in a solid
// black wall, a third colours windows blue and door arcs green.
//
// A door has something a window does not: a swing arc, which is a quarter
// circle of radius equal to the door's width, hinged at one jamb. That is a
// geometric fact rather than a drawing convention, which is why the floor-plan
// recognition literature keys on it (arXiv 1107.3680, 1908.11025) and finds
// doors first, then treats what is left as windows and openings.
//
// AND THE GAP PREDICTS THE ARC EXACTLY. We do not have to search for circles:
// the gap gives the hinge (either jamb) and the radius (the gap's own length).
// So this samples the arc that WOULD be there and asks how much of it is inked.
// A door scores high, a window scores near zero, and the check is cheap.
//
// Everything here is pure — masks in, numbers out — so it can be measured in
// node against plans whose door counts are known.

import { traceRects } from './extrude.js';

/**
 * The wall segments of a binary plan, by direction.
 *
 * WHY RUN LENGTH. A first pass projected ink onto rows and called the busy ones
 * walls. On Jordan that produced 112 "gaps", nearly all of them artifacts: a row
 * crossing a stair, a counter and a bathroom in one line looks exactly as busy
 * as a row crossing a wall. Projection cannot tell a long thing from many short
 * ones lined up.
 *
 * A wall is a stroke that is CONTINUOUS for a long way in one direction, so
 * that is what is measured: a pixel counts as wall only if the unbroken run of
 * ink through it, along that axis, is long. Furniture, treads, glyphs and
 * dimension leaders all fail it because they are short, whatever they are
 * near.
 *
 * The two directions are kept apart rather than merged. A gap only means
 * anything relative to the wall it interrupts, and a wall that is both would
 * have gaps in two directions at once.
 *
 * @returns {{horizontal:Array, vertical:Array}} rects in mask pixels
 */
export function wallSegments(mask, W, H, opts = {}) {
  // MEASURED, on a synthetic corpus with exact truth, sweeping wall thickness
  // against a fixed 3ft opening over six plans per step:
  //
  //   wall 0.50ft   minThick 3, minRun .024   F1 0.80
  //   wall 0.50ft   minThick 2, minRun .012   F1 1.00
  //
  // 0.5ft is the wall thickness of both real test plans, so these two constants
  // — not anything about the buildings — were the reason recall sat near 0.65.
  // An earlier reading of the same sweep concluded that real plans are
  // "inherently below the threshold"; they are not, the filters were.
  //
  // minThick 1 is NOT the next step down: it takes F1 to zero, because every
  // antialiased edge in the drawing becomes a wall. Two is a floor, not a slope.
  const minRun = opts.minRun ?? Math.round(Math.min(W, H) * 0.012);
  const minThick = opts.minThick ?? 2;

  const keepRuns = (horizontal) => {
    const out = new Uint8Array(W * H);
    const outer = horizontal ? H : W;
    const inner = horizontal ? W : H;
    const at = (a, b) => (horizontal ? b * W + a : a * W + b);
    for (let b = 0; b < outer; b++) {
      let a = 0;
      while (a < inner) {
        if (!mask[at(a, b)]) { a++; continue; }
        let e = a;
        while (e + 1 < inner && mask[at(e + 1, b)]) e++;
        if (e - a + 1 >= minRun) for (let k = a; k <= e; k++) out[at(k, b)] = 1;
        a = e + 1;
      }
    }
    return out;
  };

  const shape = (rects, horizontal) => rects.filter((r) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const long = horizontal ? w : h, thick = horizontal ? h : w;
    return long >= minRun && thick >= minThick;
  });

  const h = shape(traceRects(keepRuns(true), W, H), true);
  const v = shape(traceRects(keepRuns(false), W, H), false);

  // THE MERGE THRESHOLD COMES FROM THE PLAN, NOT THE IMAGE SIZE.
  //
  // It was a fixed fraction of the image, which assumes every drawing renders
  // its walls at the same weight. They do not. A prompt change that thickened
  // Jordan's walls from a median of 18px to 25px left the threshold at 51 —
  // wide enough to fuse two genuinely separate walls across the space between
  // them. Segments halved (50 → 30), gaps halved, and doors went to ZERO on a
  // plan with several. Nothing about the detector was wrong; the constant was.
  //
  // A wall's two drawn faces are at most about its own thickness apart. The
  // plan's median thickness is the scale that matters, so the threshold rides
  // on it.
  const th = [...h.map((r) => r.y1 - r.y0), ...v.map((r) => r.x1 - r.x0)]
    .sort((a, b) => a - b);
  const median = th.length ? th[Math.floor(th.length / 2)] : 0;
  const maxThick = opts.maxThick
    ?? (median > 0 ? Math.round(median * (opts.thickFactor ?? 2.2))
      : Math.round(Math.min(W, H) * 0.035));

  // The symbol line a window or a slider draws across its opening survives every
  // filter above — it is long enough and, at 2px, exactly on the minThick floor.
  // Left in, it makes the wall read as continuous and hides the opening from
  // everything downstream. See dropSymbolBridges.
  const mh = dropSymbolBridges(mergeParallel(h, true, maxThick), true, opts);
  const mv = dropSymbolBridges(mergeParallel(v, false, maxThick), false, opts);

  return {
    horizontal: mh.walls,
    vertical: mv.walls,
    // Kept rather than discarded: these are where an opening is, measured, and
    // the classifier downstream should not have to find them again.
    bridges: [...mh.bridges, ...mv.bridges],
    wallThickness: median,
    maxThick,
  };
}

/**
 * How thick this plan draws a wall, in pixels — measured BEFORE any merging.
 *
 * The one number the rest of the file should be scaled against. Every constant
 * here — run length, minimum thickness, merge distance, arc tolerance, the
 * glazing density band — is really "so many wall-thicknesses", and was written
 * as pixels only because the first plan measured happened to have a particular
 * weight.
 *
 * Merging must be off to measure it: fused faces read as one thick wall. A
 * probe that tried to disable merging by setting `maxThick` huge did the
 * opposite and reported thicknesses of 1372px, which was the building's width.
 *
 * Long segments only. Short thin strokes — cabinet runs, stair treads, fixture
 * outlines — pass the run-length filter in numbers and drag the median down,
 * which is how one wireframe reported 7px walls that were not thin at all.
 */
export function medianWallThickness(mask, W, H, opts = {}) {
  const minRun = opts.minRun ?? Math.round(Math.min(W, H) * 0.024);
  const longEnough = opts.longEnough ?? minRun * 4;
  const seg = wallSegments(mask, W, H, { ...opts, maxThick: 0 });   // 0 = never merge
  const th = [
    ...seg.horizontal.filter((r) => r.x1 - r.x0 >= longEnough).map((r) => r.y1 - r.y0),
    ...seg.vertical.filter((r) => r.y1 - r.y0 >= longEnough).map((r) => r.x1 - r.x0),
  ].sort((a, b) => a - b);
  return th.length ? th[Math.floor(th.length / 2)] : 0;
}

/**
 * Join the two drawn faces of one wall into one wall.
 *
 * Builders draw walls two ways. Solid poché comes back as a single band and
 * needs nothing. An OUTLINED wall comes back as two thin parallel lines, and
 * then everything downstream is wrong in the same quiet way: the window gap is
 * found twice, once per face, and the glazing lines lie BETWEEN the faces
 * rather than inside either, so each half measures a span of ~0.5 and is thrown
 * out as a cased opening.
 *
 * Measured on Jordan's right exterior wall — faces at x1438-1447 and
 * x1468-1477, a real 1.1ft wall — the two halves scored span 0.00 and 0.50. The
 * merged wall is what the glazing actually crosses.
 *
 * Two segments are one wall when they run alongside each other for most of
 * their length and their combined thickness is still wall-sized. `maxThick` is
 * the guard: without it this would swallow two different walls either side of a
 * corridor.
 */
export function mergeParallel(segments, horizontal, maxThick) {
  const runOf = (r) => (horizontal ? [r.x0, r.x1] : [r.y0, r.y1]);
  const crossOf = (r) => (horizontal ? [r.y0, r.y1] : [r.x0, r.x1]);
  const out = [];
  const taken = new Set();

  for (let i = 0; i < segments.length; i++) {
    if (taken.has(i)) continue;
    let cur = segments[i];
    let merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < segments.length; j++) {
        if (j === i || taken.has(j)) continue;
        const [ra0, ra1] = runOf(cur), [rb0, rb1] = runOf(segments[j]);
        const ov = Math.min(ra1, rb1) - Math.max(ra0, rb0);
        if (ov <= 0 || ov / Math.min(ra1 - ra0, rb1 - rb0) < 0.5) continue;
        const [ca0, ca1] = crossOf(cur), [cb0, cb1] = crossOf(segments[j]);
        const span = Math.max(ca1, cb1) - Math.min(ca0, cb0);
        if (span > maxThick) continue;   // two walls, not two faces of one
        cur = horizontal
          ? { x0: Math.min(ra0, rb0), x1: Math.max(ra1, rb1),
            y0: Math.min(ca0, cb0), y1: Math.max(ca1, cb1) }
          : { y0: Math.min(ra0, rb0), y1: Math.max(ra1, rb1),
            x0: Math.min(ca0, cb0), x1: Math.max(ca1, cb1) };
        taken.add(j);
        merged = true;
      }
    }
    taken.add(i);
    out.push(cur);
  }
  return out;
}

/**
 * Drop the thin line a symbol draws ACROSS an opening, which is not a wall.
 *
 * WHAT IT IS. Measured on Plan A's front wall, the traced horizontal segments
 * read, left to right:
 *
 *     x 113-317   thickness 38     wall
 *     x 317-599   thickness  2     <- this
 *     x 599-803   thickness 39     wall
 *
 * The 2px run is the window symbol: the wall poché stops and a thin line
 * continues across the opening, jamb to jamb. `minThick` is 2, so the tracer
 * called it a wall. Two things then go wrong at once — the wall reads as
 * CONTINUOUS, so `collinearGaps` finds no opening there and the window is never
 * detected, and the 3D stands a 2px sliver up as if it were masonry.
 *
 * This is the exact inverse of the bug `wallMask`'s morphological opening
 * causes, and the same root: the symbol's line is 1-2px, and one path deletes
 * it while the other promotes it.
 *
 * WHY IT DOES NOT DECIDE WHAT THE OPENING IS. A reference sheet of door and
 * window symbols shows a thin bar spanning the gap for a window, a glider and a
 * casement — and also for a by-pass door, a sliding door and a sliding glass
 * door. So thinness alone cannot tell a window from a slider, and this does not
 * try. It only removes something that is not a wall in ANY of those cases, and
 * leaves the opening for `glazedOpenings` to classify, which is what that
 * function was built and scored for.
 *
 * THE TEST IS LOCAL AND RELATIVE, deliberately. A global thickness threshold
 * would need the plan's real wall weight, and the median is polluted by
 * fixtures and tile grid — on these renders it comes out at 2px on a plan whose
 * walls are 38. Asking instead "is this much thinner than the two walls it
 * joins" needs no threshold from outside the neighbourhood, and a wall that is
 * genuinely thin next to genuinely thick ones is a case that does not arise:
 * both faces of one wall are the same weight by construction.
 *
 * @param {Array} rects merged segments for one axis
 * @param {boolean} horizontal
 * @returns {{walls:Array, bridges:Array}}
 */
export function dropSymbolBridges(rects, horizontal, opts = {}) {
  // How much thinner than its neighbours a run must be before it is read as a
  // symbol rather than a wall. 6x is far outside the spread of one wall's two
  // faces and far inside the 19x that Plan A actually shows.
  const ratio = opts.bridgeRatio ?? 6;
  const touch = opts.bridgeTouch ?? 4;   // px of slack where the runs meet
  const run = (r) => (horizontal ? [r.x0, r.x1] : [r.y0, r.y1]);
  const cross = (r) => (horizontal ? [r.y0, r.y1] : [r.x0, r.x1]);
  const thickOf = (r) => { const [a, b] = cross(r); return b - a; };

  const walls = [], bridges = [];
  for (const r of rects) {
    const [a0, a1] = run(r), [c0, c1] = cross(r);
    const t = thickOf(r);
    // Its collinear neighbours: sharing the wall's own band, meeting end to end.
    const neighbours = rects.filter((o) => {
      if (o === r) return false;
      const [oc0, oc1] = cross(o);
      if (Math.min(c1, oc1) - Math.max(c0, oc0) <= 0) return false;  // not the same line
      const [oa0, oa1] = run(o);
      return Math.abs(oa1 - a0) <= touch || Math.abs(oa0 - a1) <= touch;
    });
    // Bridging means BOTH sides, so a thin stub hanging off the end of a wall
    // is left alone — it is not spanning anything.
    const before = neighbours.some((o) => Math.abs(run(o)[1] - a0) <= touch);
    const after = neighbours.some((o) => Math.abs(run(o)[0] - a1) <= touch);
    const thinner = neighbours.length
      && neighbours.every((o) => thickOf(o) >= t * ratio);
    if (before && after && thinner) bridges.push(r); else walls.push(r);
  }
  return { walls, bridges };
}

/**
 * The building's pixel footprint, from its WALLS.
 *
 * This is a function because getting it by eye went wrong three times in a row,
 * and every time the error was silent — it does not crash, it just reports a
 * window as the wrong size:
 *
 *   the top wall's own span   726px  → a 3ft window measured 5.77ft  (92% out)
 *   the raw ink bounding box 1488px  → 2.81ft  (6.3% out)
 *   the wall segments' extent 1369px → 3.06ft  (1.9% out)
 *
 * The ink box is wrong because a plan is not only the building: dimension
 * lines, leaders, the title block and the schedule codes are all ink, and they
 * sit outside the walls. The top wall's span is wrong because a floor is rarely
 * a rectangle — Jordan's right wing reaches well past its top wall.
 *
 * Walls are the building. Nothing else in the drawing is.
 */
export function buildingExtent(segments) {
  const all = [...(segments.horizontal || []), ...(segments.vertical || [])];
  if (!all.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of all) {
    if (r.x0 < x0) x0 = r.x0; if (r.x1 > x1) x1 = r.x1;
    if (r.y0 < y0) y0 = r.y0; if (r.y1 > y1) y1 = r.y1;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Feet per pixel, from the building's width.
 *
 * The width is the one number a drawing cannot carry — no plan has a scale bar
 * — so it comes from the confirmed record, as it does everywhere else in the
 * 3D path. One scalar: it scales uniformly and cannot distort.
 */
export function ftPerPx(segments, buildingWidthFt) {
  const e = buildingExtent(segments);
  if (!e || e.x1 <= e.x0 || !(buildingWidthFt > 0)) return null;
  return buildingWidthFt / (e.x1 - e.x0);
}

/**
 * The gaps between collinear wall segments — the openings.
 *
 * Segments are grouped by the band they share across the wall's thickness, so
 * two walls on different lines never produce a gap between them. Only the space
 * between CONSECUTIVE segments on one line counts; the open ends of a wall are
 * not gaps, they are where the wall stops.
 *
 * @param {Array} segments  one direction's segments
 * @param {boolean} horizontal
 * @returns {Array} gap rects carrying `horizontal`
 */
export function collinearGaps(segments, horizontal, opts = {}) {
  const minGap = opts.minGap ?? 12;
  const maxGap = opts.maxGap ?? 200;
  const slack = opts.slack ?? 3;   // how far two segments may be off one line

  // GROUPING MUST NOT CHAIN. A first version joined any two segments whose
  // bands overlapped at all, and grew the group's band as it went. Jordan's top
  // wall steps — its left half sits at y188-210 and its right at y178-198 — so
  // fragments chained through the step into one "line", and the gap came back
  // between segments on two different walls, in a band belonging to neither.
  // That is why the window measured there had the wrong ink.
  //
  // So a segment joins a line only if it shares most of its thickness with that
  // line's ESTABLISHED band, which never grows past what the members agree on.
  const overlapFrac = opts.overlapFrac ?? 0.5;
  const lines = [];
  for (const s of segments) {
    const a0 = horizontal ? s.y0 : s.x0, a1 = horizontal ? s.y1 : s.x1;
    let best = null, bestOv = 0;
    for (const l of lines) {
      const ov = Math.min(a1, l.a1) - Math.max(a0, l.a0);
      const frac = ov / Math.min(a1 - a0, l.a1 - l.a0);
      if (ov > 0 && frac >= overlapFrac && frac > bestOv) { best = l; bestOv = frac; }
    }
    if (best) {
      // Narrow to what they agree on, never widen.
      best.a0 = Math.max(best.a0, a0); best.a1 = Math.min(best.a1, a1);
      best.segs.push(s);
    } else lines.push({ a0: a0 - slack * 0, a1, segs: [s] });
  }

  const out = [];
  for (const line of lines) {
    const segs = [...line.segs].sort((p, q) => (horizontal ? p.x0 - q.x0 : p.y0 - q.y0));
    for (let i = 0; i + 1 < segs.length; i++) {
      const p = segs[i], q = segs[i + 1];
      const end = horizontal ? p.x1 : p.y1;
      const start = horizontal ? q.x0 : q.y0;
      const len = start - end;
      if (len < minGap || len > maxGap) continue;

      // THE BAND IS THE WALL, NOT THE LINE. Using the whole line's merged
      // extent made the gap rectangle far thicker than the wall it interrupts,
      // so bandStats measured neighbouring rows too — it swallowed enough extra
      // ink to push a real window out of its density range and to invent jamb
      // returns. The band that matters is the one the two segments either side
      // of THIS gap actually share.
      const p0 = horizontal ? p.y0 : p.x0, p1 = horizontal ? p.y1 : p.x1;
      const q0 = horizontal ? q.y0 : q.x0, q1 = horizontal ? q.y1 : q.x1;
      // The UNION of the two, not their intersection. Glazing lines span the
      // full wall thickness — they connect both faces — so a band clipped to
      // where the two segments agree cuts the lines off at the ends. Measured:
      // the same window scored span 1.00 on its wall's full 178-198 band and
      // 0.30 on the intersected 180-197. Two pixels decided it.
      const a0 = Math.min(p0, q0), a1 = Math.max(p1, q1);

      // TWO BANDS, FOR TWO DIFFERENT QUESTIONS.
      //
      // The union above is right for reading glazing: those lines span the full
      // wall thickness, and clipping the band by 2px took one window's span from
      // 1.00 to 0.30.
      //
      // It is wrong for asking what lies outside. Probing a few pixels past a
      // band that is wider than the wall lands inside the wall, so the probe
      // never reaches open air — measured on Geena, nine of ten windows read as
      // enclosed on both sides, including two on the building's outer edge.
      //
      // So the narrow band — what the two segments agree on — is carried
      // alongside, and the exterior test uses that.
      let n0 = Math.max(p0, q0), n1 = Math.min(p1, q1);
      if (n1 - n0 < 1) {
        [n0, n1] = (p1 - p0) <= (q1 - q0) ? [p0, p1] : [q0, q1];
      }
      out.push(horizontal
        ? { x0: end, x1: start, y0: a0, y1: a1, horizontal: true, face: [n0, n1] }
        : { y0: end, y1: start, x0: a0, x1: a1, horizontal: false, face: [n0, n1] });
    }
  }
  return out;
}

/** Is there ink within `tol` pixels of (x, y)? */
function inkNear(mask, W, H, x, y, tol) {
  const cx = Math.round(x), cy = Math.round(y);
  for (let dy = -tol; dy <= tol; dy++) {
    for (let dx = -tol; dx <= tol; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      if (mask[py * W + px]) return true;
    }
  }
  return false;
}

/**
 * What fraction of a quarter-circle arc is actually drawn.
 *
 * @param {Uint8Array} mask  ink mask
 * @param {number[]} hinge  [x, y] the jamb the door is hinged on
 * @param {number} r  radius — the gap's length
 * @param {number[]} along  unit vector from the hinge toward the other jamb
 * @param {number[]} into  unit vector perpendicular, into the room being tested
 * @returns {number} 0..1
 */
export function arcCoverage(mask, W, H, hinge, r, along, into, opts = {}) {
  const samples = opts.samples ?? 24;
  const tol = opts.tol ?? Math.max(2, Math.round(r * 0.06));
  // The ends of the sweep sit ON the wall and ON the door leaf, so they would
  // score for any gap at all. Only the middle of the arc is evidence.
  const from = opts.from ?? 0.12, to = opts.to ?? 0.88;
  let hit = 0, n = 0;
  for (let i = 0; i <= samples; i++) {
    const f = from + (to - from) * (i / samples);
    const t = f * (Math.PI / 2);
    const c = Math.cos(t), s = Math.sin(t);
    const x = hinge[0] + (along[0] * c + into[0] * s) * r;
    const y = hinge[1] + (along[1] * c + into[1] * s) * r;
    n++;
    if (inkNear(mask, W, H, x, y, tol)) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * The best arc score for a gap, over every way a door could be hung in it.
 *
 * A door may hinge on either jamb and swing into either room, so all four are
 * tried and the best is returned. Trying only one would call half the doors
 * windows, which is the expensive direction of the error: a missed door becomes
 * a window that is not there.
 *
 * @param {{x0,y0,x1,y1,horizontal:boolean}} gap  in mask pixels
 * @returns {{score:number, hinge:number[], into:number[]}}
 */
// ZERO DOORS ON EVERY REAL WIREFRAME, and five explanations measured and
// refuted (2026-08-19). Read this before touching anything here.
//
// Across six wireframes this returns no door at all: top scores 0.20 to 0.44
// against the 0.50 threshold, and the MEDIAN over gaps of true door width is
// 0.00 to 0.08. The gaps themselves are not the problem — converted to feet
// they are exactly where doors belong: 17 gaps of 2 to 3.6ft on jordan, 16 on
// geena, 14 on sky, 9 on avitop.
//
// Refuted, with the numbers, so none of these is retried:
//
//  1. THE WALL MASK HIDES THE ARC, since an arc is thin linework and wallMask
//     sorts thin strokes into `low`. Scoring against `mask | low` moves jordan
//     0.32 -> 0.44 and sky 0.08 -> 0.24. Still zero doors.
//  2. THE RADIUS IS WRONG. Sweeping the radius from 0.5r to 1.6r, the peaks
//     scatter at 0.65, 0.70, 1.20, 1.25, 1.40, 1.55 with no cluster at 1.0.
//     A real arc at some other radius would cluster; these do not.
//  3. THE TOLERANCE IS TOO TIGHT. Coverage climbs steadily with it — jordan
//     0.20 / 0.36 / 0.64 at tol 2 / 4 / 8 — which is what a neighbourhood
//     wide enough to catch anything looks like, not what finding an arc looks
//     like. At tol 8 on a 700px plan the probe spans a third of a metre.
//  4. THE HINGE IS ON THE WALL'S CENTRE LINE, not the face the door swings
//     from. Moving it to the face changes the medians not at all (sky's best
//     went 0.32 -> 0.44; every median stayed 0.00).
//  5. THE 700px DOWNSAMPLE DESTROYS THE ARC. At 1400 and at native 2048 the
//     ink fraction moves 4.9% -> 5.4% and the scores do not improve.
//
// What every one of them says together: there is no ink on the quarter circle
// this samples, at either jamb, in any of the four ways a door can hang, at any
// resolution. Either these wireframes do not draw a swing arc of radius equal
// to the opening, or the arcs are somewhere the gap does not predict.
//
// Numbers cannot decide which. `test/arc-probe.html` draws the gaps and the
// sampled arcs over the wireframe itself, so one look settles it. Do that
// before the sixth hypothesis.
export function doorScore(mask, W, H, gap, opts = {}) {
  const [a, b] = endScores(mask, W, H, gap, opts);
  return a.score >= b.score ? a : b;
}

/**
 * The arc score at EACH jamb, kept apart.
 *
 * A single door hinges at one jamb; a pair of French doors hinges at both and
 * sweeps two arcs. Collapsing to the best score cannot tell them apart, and a
 * double counted as a single door is a 5ft opening reported as a 2.5ft one.
 *
 * @returns {[{score,hinge,into,raw}, {score,hinge,into,raw}]} in jamb order
 */
export function endScores(mask, W, H, gap, opts = {}) {
  const horizontal = gap.horizontal;
  const r = horizontal ? gap.x1 - gap.x0 : gap.y1 - gap.y0;
  const my = (gap.y0 + gap.y1) / 2, mx = (gap.x0 + gap.x1) / 2;
  // The two jambs, and the two directions perpendicular to the wall.
  const ends = horizontal
    ? [[gap.x0, my], [gap.x1, my]]
    : [[mx, gap.y0], [mx, gap.y1]];
  const alongs = horizontal ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
  const intos = horizontal ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];

  // AN ARC IS A THIN CURVE AT ONE RADIUS, not ink in the general area. Scoring
  // coverage alone made every busy patch of drawing a perfect door: on Jordan's
  // wireframe the top eight hits were seven stair treads and a cabinet run,
  // because `inkNear` finds something wherever the drawing is dense.
  //
  // So the arc is scored against its own surroundings — the same sweep at a
  // smaller and a larger radius. A real arc is drawn at r and nowhere either
  // side of it, so it keeps its score; a dense region scores alike at all three
  // and nets out to nothing.
  const inner = opts.inner ?? 0.72, outer = opts.outer ?? 1.28;
  const out = [];
  for (let e = 0; e < 2; e++) {
    let best = { score: 0, hinge: ends[e], into: intos[0], raw: 0 };
    for (const into of intos) {
      const raw = arcCoverage(mask, W, H, ends[e], r, alongs[e], into, opts);
      if (raw <= best.score) continue;   // cannot beat the best even at full marks
      const around = Math.max(
        arcCoverage(mask, W, H, ends[e], r * inner, alongs[e], into, opts),
        arcCoverage(mask, W, H, ends[e], r * outer, alongs[e], into, opts));
      const score = Math.max(0, raw - around);
      if (score > best.score) best = { score, hinge: ends[e], into, raw };
    }
    out.push(best);
  }
  return out;
}

/**
 * What KIND of opening this gap is.
 *
 * The taxonomy is the useful half of the Qwen spec, and it needs no model to
 * apply: each tag has a geometric test. The half that was rejected is the other
 * one — asking a model for the coordinates. Its own worked example reproduced
 * `jordan-geometry.json` verbatim, and four of those six windows measured 0-19%
 * onto any wall.
 *
 * A door swings, so it is found by its arc. Everything else is separated by
 * size, which is why the widths matter: a garage door is 8-20ft and a window is
 * 1.5-7ft, and nothing straddles that.
 *
 * @param {number} ftPerPx  so the size rules can be stated in feet, where the
 *   conventions actually live
 * @returns {{kind:string, widthFt:number, ends:number[], why:string}}
 */
/**
 * How the ink inside a gap is ORGANISED, not just how much there is.
 *
 * Density alone was never going to work: a cased opening measured 45-55% and a
 * window 12.7%, but that is one sample of each and the bands overlap. What
 * separates them is structure —
 *
 *   span    the longest run parallel to the wall, over the gap's width. Window
 *           glazing lines and a garage door's panel line cross the whole
 *           opening; casing ink does not.
 *   density ink over band area.
 *   ends    how much of the ink hugs the jambs. Casing returns pile up there;
 *           glazing lines do not.
 *   returns thin ink poking out past the wall faces at the gap's ends — the
 *           jamb returns of a cased opening. A window has none.
 *
 * One sweep over the gap rectangle, O(gap), and it needs no exterior test —
 * which is what makes it the cheap fix for the four false garage doors.
 *
 * @returns {{span:number, density:number, ends:number, returns:boolean}}
 */
export function bandStats(mask, W, H, gap, opts = {}) {
  const horizontal = gap.horizontal;
  const x0 = Math.max(0, Math.round(gap.x0)), x1 = Math.min(W, Math.round(gap.x1));
  const y0 = Math.max(0, Math.round(gap.y0)), y1 = Math.min(H, Math.round(gap.y1));
  const len = horizontal ? x1 - x0 : y1 - y0;      // along the wall
  const thick = horizontal ? y1 - y0 : x1 - x0;    // across it
  if (len <= 0 || thick <= 0) {
    return { span: 0, density: 0, ends: 0, returns: false };
  }

  const at = (a, t) => (horizontal ? (y0 + t) * W + (x0 + a) : (y0 + a) * W + (x0 + t));
  let ink = 0, endInk = 0, best = 0;
  const endBand = Math.max(1, Math.round(len * (opts.endFrac ?? 0.1)));
  const touched = new Uint8Array(len);
  for (let t = 0; t < thick; t++) {
    let run = 0;
    for (let a = 0; a < len; a++) {
      if (mask[at(a, t)]) {
        ink++;
        touched[a] = 1;
        if (a < endBand || a >= len - endBand) endInk++;
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
  }
  let covered = 0;
  for (let a = 0; a < len; a++) if (touched[a]) covered++;

  // Jamb returns: ink just beyond each wall face, at each end of the gap. A
  // cased opening wraps its casing around the corner; a window stops at the
  // wall face.
  const out = opts.returnDepth ?? 3;
  const probe = (a0, a1, t0, t1) => {
    for (let a = a0; a < a1; a++) {
      for (let t = t0; t < t1; t++) {
        const px = horizontal ? x0 + a : x0 + t;
        const py = horizontal ? y0 + t : y0 + a;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        if (mask[py * W + px]) return true;
      }
    }
    return false;
  };
  const endsHaveReturns = [0, 1].every((e) => {
    const a0 = e ? len - endBand : 0, a1 = e ? len : endBand;
    return probe(a0, a1, -out, 0) || probe(a0, a1, thick, thick + out);
  });

  return {
    span: best / len,
    coverage: covered / len,
    density: ink / (len * thick),
    ends: ink ? endInk / ink : 0,
    returns: endsHaveReturns,
  };
}

export function classifyOpening(mask, W, H, gap, ftPerPx, opts = {}) {
  const arc = opts.arcThreshold ?? 0.5;
  const [a, b] = endScores(mask, W, H, gap, opts);
  const px = gap.horizontal ? gap.x1 - gap.x0 : gap.y1 - gap.y0;
  const widthFt = px * ftPerPx;
  const ends = [a.score, b.score];
  const tag = (kind, why) => ({ kind, widthFt, ends, why });

  // Two arcs is a pair of leaves. Tested before the single door, because a
  // double also satisfies the single-door test.
  if (a.score >= arc && b.score >= arc) return tag('double', 'an arc at both jambs');
  if (a.score >= arc || b.score >= arc) return tag('door', 'a swing arc at one jamb');

  // No arc. Structure decides; size is only a gate afterwards.
  //
  // Size led on the first pass and got it badly wrong: five garage doors on a
  // plan with one, and seven windows at 5.2-6.7ft where the real ones are 3-5.
  // Every false positive was an interior cased opening that happened to fall in
  // the band. Width cannot separate a 6ft cased opening from a 6ft window; how
  // the ink is arranged inside them can.
  // COVERAGE, NOT LONGEST RUN. Using the longest unbroken run assumed a window
  // is a single pane. Three of Jordan's four windows are sliders with a centre
  // mullion, so their glazing line is broken in the middle and the longest run
  // is exactly half: measured 0.52, 0.47 and 0.51 against 1.00 for the
  // single-pane one. No threshold on that number can work.
  //
  // What a window really does is reach across its opening, in however many
  // pieces. A cased opening does not — its ink is at the jambs and the middle
  // is empty — so coverage separates them where the longest run cannot.
  const s = bandStats(mask, W, H, gap, opts);
  const spans = s.coverage >= (opts.minCoverage ?? 0.8);
  const note = `covers ${s.coverage.toFixed(2)}, density ${(s.density * 100).toFixed(0)}%`
    + (s.returns ? ', jamb returns' : '');

  if (widthFt >= (opts.garageMin ?? 8) && widthFt <= (opts.garageMax ?? 20)) {
    // A vehicle door's panel line crosses the whole opening and it has no
    // casing wrapped round the jambs.
    if (s.coverage >= (opts.garageCoverage ?? 0.9) && !s.returns) {
      return tag('garage', `${widthFt.toFixed(1)}ft, ${note}`);
    }
    return tag('opening', `${widthFt.toFixed(1)}ft but ${note} — cased, not a door`);
  }

  if (widthFt >= (opts.winMin ?? 1.5) && widthFt <= (opts.winMax ?? 7)) {
    const lightEnough = s.density >= (opts.winDensityMin ?? 0.03)
      && s.density <= (opts.winDensityMax ?? 0.30);
    // `returns` is NOT consulted here, though it is still reported and still
    // gates garage doors. Measured on Jordan it fired on three of six real
    // windows — exterior walls carry enough drawing just outside the face
    // (frame lines, the wall's own outline) that it cannot separate a window
    // from a cased opening. Coverage and density already do, and tightly: all
    // six windows land in 3-8% density with 0.85-1.00 coverage.
    if (spans && lightEnough) {
      return tag('win', `${widthFt.toFixed(1)}ft, ${note}`);
    }
    return tag('opening', `${widthFt.toFixed(1)}ft but ${note} — cased, not glazed`);
  }
  // Deliberately NOT forced into a bucket. Calling an unclassifiable gap a
  // window would put glazing across the inside of a house.
  return tag('opening', `${widthFt.toFixed(1)}ft, outside every convention`);
}

/**
 * Which background is OUTSIDE the building.
 *
 * "Exterior" has an exact definition and it is worth using rather than
 * approximating: the outside is the background you can reach from the edge of
 * the image without crossing ink.
 *
 * The gaps have to be bridged first or the fill pours through every doorway and
 * the whole interior reads as outside. Every opening is bridged — doors,
 * windows, cased openings alike — because at this stage we do not yet know
 * which is which, and that is the point.
 *
 * @returns {Uint8Array} 1 where the pixel is outside the building
 */
export function sealedOutside(mask, W, H, gaps) {
  const sealed = Uint8Array.from(mask);
  for (const g of gaps) {
    // The narrow band again. A bridge as wide as the measuring band covers the
    // very pixels the exterior probe needs to read, and then a window on the
    // outer skin reports itself enclosed — the bridge, not the building, is
    // what shut it in.
    const [f0, f1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const x0 = Math.max(0, Math.floor(g.horizontal ? g.x0 : f0));
    const x1 = Math.min(W, Math.ceil(g.horizontal ? g.x1 : f1));
    const y0 = Math.max(0, Math.floor(g.horizontal ? f0 : g.y0));
    const y1 = Math.min(H, Math.ceil(g.horizontal ? f1 : g.y1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sealed[y * W + x] = 1;
  }

  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (p) => { if (!sealed[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p - x) / W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
  return outside;
}

/**
 * Did the seal hold?
 *
 * The exterior test is only as good as the sealing. Bridges are laid across the
 * gaps we FOUND, so an opening the wall tracing missed is a hole the fill pours
 * through — and then the interior reads as outside, every wall looks exterior,
 * and the test silently passes everything instead of failing loudly.
 *
 * That is not hypothetical: on Jordan the exterior test dropped none of the
 * seven candidates, including one beside a staircase, while on the other two
 * plans it dropped four. A test that discriminates on two plans and not on the
 * third is leaking on the third.
 *
 * So the seal is measured. A house fills most of its own bounding box; if the
 * enclosed area is a small fraction of it, the fill got in.
 *
 * @returns {{insideFrac:number, ok:boolean}}
 */
export function sealQuality(outside, W, H, extent, opts = {}) {
  const min = opts.minInsideFrac ?? 0.4;
  const x0 = Math.max(0, Math.floor(extent.x0)), x1 = Math.min(W, Math.ceil(extent.x1));
  const y0 = Math.max(0, Math.floor(extent.y0)), y1 = Math.min(H, Math.ceil(extent.y1));
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  let inside = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (!outside[y * W + x]) inside++;
  }
  const insideFrac = inside / area;
  return { insideFrac, ok: insideFrac >= min };
}

/**
 * Is this wall segment part of the building's outer skin?
 *
 * A wall is exterior when exactly ONE of its long faces looks at the outside.
 *
 * WHY NOT "IS IT NEAR THE EDGE OF THE BUILDING". Two traps, and the naive test
 * fails both. An interior partition that runs into the outer wall touches the
 * outline but has enclosed space on both sides — it is interior. And a wall
 * inside a notch between two wings sits well away from the bounding box, yet
 * the background in front of it escapes to the image border — it is exterior,
 * and a real window can sit in it. Distance from the outline gets the first
 * wrong by accepting and the second wrong by rejecting.
 *
 * A fraction of the face is required rather than a single sample, because a
 * junction or a shadow puts ink against a face here and there.
 */
export function faceIsOutside(outside, W, H, seg, horizontal, opts = {}) {
  const depth = opts.faceDepth ?? 3;
  const need = opts.faceFraction ?? 0.6;
  const a0 = Math.round(horizontal ? seg.x0 : seg.y0);
  const a1 = Math.round(horizontal ? seg.x1 : seg.y1);
  const len = a1 - a0;
  if (len <= 0) return [false, false];

  const look = (beyond) => {
    let hits = 0;
    for (let a = a0; a < a1; a++) {
      let seen = false;
      for (let k = 1; k <= depth && !seen; k++) {
        const t = beyond < 0
          ? Math.round((horizontal ? seg.y0 : seg.x0)) - k
          : Math.round((horizontal ? seg.y1 : seg.x1)) + k - 1;
        const x = horizontal ? a : t, y = horizontal ? t : a;
        if (x >= 0 && x < W && y >= 0 && y < H && outside[y * W + x]) seen = true;
      }
      if (seen) hits++;
    }
    return hits / len >= need;
  };
  return [look(-1), look(1)];
}

/**
 * The gaps that sit in an exterior wall.
 *
 * A gap belongs to the two segments either side of it, so it is exterior when
 * either of them is. Returns the same gap objects, so the caller can go on
 * classifying them.
 */
export function exteriorGaps(mask, W, H, segments, gaps, opts = {}) {
  // BRIDGE EVERY OPENING, TEST THE ONES YOU CARE ABOUT. They are different
  // arguments for a reason, and using one for both is the mistake that made
  // this function look broken for days.
  //
  // The flood decides what is outside the building. Every opening it can pass
  // through has to be bridged first or it walks in through a doorway and calls
  // the whole interior outside. Passing only the windows here — which is the
  // obvious thing to do when windows are what you want back — leaves every door
  // open, and then both sides of every window report the same and none of them
  // is exterior.
  //
  // MEASURED on 2026-08-19, same plans, same code, only this changed:
  //
  //     bridging windows only    geena 0/11   avitop 2/13   jordan 2/9
  //     bridging every opening   geena 11/11  avitop 11/13  jordan 7/9
  //
  // Geena's zero was recorded as an unexplained fault in the exterior test
  // itself, with two of its windows sitting literally on the building's edge.
  // The test was right; it was being asked the question wrong.
  //
  // So `opts.bridge` is what the flood is sealed with, and `gaps` is what gets
  // tested. When it is omitted the two are the same list, which is correct only
  // when `gaps` really is every opening.
  const outside = sealedOutside(mask, W, H, opts.bridge || gaps);

  // ASK THE OPENING, NOT ITS NEIGHBOURS.
  //
  // A first version marked a gap exterior when a wall segment beside it was.
  // Measured on Jordan, that put a window next to a staircase: the gap at
  // x786-826 inherited from the wall running below it, which is the garage's
  // east face and genuinely exterior — but at the gap's own height the house
  // continues eastward, so the opening itself faces another room.
  //
  // A wall can be exterior along part of its run and interior along the rest.
  // The only thing that decides an opening is what lies either side of THAT
  // opening, and the bridge laid across it in sealedOutside makes it a wall
  // like any other for this purpose.
  return gaps.filter((g) => {
    // The narrow band, not the wide one — see collinearGaps. Falls back to the
    // wide band for gaps built by hand or by an older caller.
    const [f0, f1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const seg = g.horizontal
      ? { x0: g.x0, y0: f0, x1: g.x1, y1: f1 }
      : { x0: f0, y0: g.y0, x1: f1, y1: g.y1 };
    const [a, b] = faceIsOutside(outside, W, H, seg, g.horizontal, opts);
    return a !== b;   // exactly one side of the opening looks out
  });
}

/**
 * The density band that counts as glazing ON THIS PLAN.
 *
 * WHY IT CANNOT BE A CONSTANT. Windows cluster tightly within a plan and not at
 * all between plans, because line weight and wall thickness differ:
 *
 *   Jordan   3-8%     Madison  10-16%     Geena  20-39%
 *
 * A fixed 3-30% band looked like it covered all three. It did not: three of
 * Geena's windows sit at 34-39% on the SAME WALL as one at 25% that passed.
 * Same wall, same drawing, same window — one in, three out, because of a number
 * written in this file.
 *
 * So the band comes from the plan. The median of the candidates is the glazing
 * weight this drawing uses, and the multipliers are wide enough to hold a
 * cluster that spans a factor of two, as Geena's does.
 *
 * Falls back to the absolute band when there are too few candidates to have a
 * distribution at all — three points is not a cluster.
 */
export function densityBand(densities, opts = {}) {
  const lo = opts.winDensityMin ?? 0.03, hi = opts.winDensityMax ?? 0.30;
  const d = [...densities].sort((a, b) => a - b);
  if (d.length < (opts.minSample ?? 3)) return { lo, hi, from: 'default' };
  const mid = d.length % 2
    ? d[(d.length - 1) / 2]
    : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  if (!(mid > 0)) return { lo, hi, from: 'default' };
  return {
    lo: mid * (opts.bandLo ?? 0.4),
    hi: mid * (opts.bandHi ?? 2.2),
    from: 'plan',
    median: mid,
  };
}

/**
 * Classify every opening on a plan, in two passes.
 *
 * The second pass is the point: what counts as glazing depends on what glazing
 * looks like on THIS drawing, and that cannot be known from one gap. Pass one
 * measures, pass two decides.
 *
 * @returns {{openings:Array, band:Object}}
 */
export function classifyPlan(mask, W, H, gaps, ftPerPx, opts = {}) {
  const measured = gaps.map((g) => ({
    gap: g,
    stats: bandStats(mask, W, H, g, opts),
    arc: doorScore(mask, W, H, g, opts).score,
    widthFt: (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * ftPerPx,
  }));

  // Candidates for the distribution: window-sized, reaching across, no swing.
  // Doors and garage doors are excluded so their ink cannot drag the median.
  const cand = measured.filter((m) => m.arc < (opts.arcThreshold ?? 0.5)
    && m.widthFt >= (opts.winMin ?? 1.5) && m.widthFt <= (opts.winMax ?? 7)
    && m.stats.coverage >= (opts.minCoverage ?? 0.8));
  const band = densityBand(cand.map((m) => m.stats.density), opts);

  const openings = measured.map((m) => ({
    ...classifyOpening(mask, W, H, m.gap, ftPerPx,
      { ...opts, winDensityMin: band.lo, winDensityMax: band.hi }),
    gap: m.gap,
  }));
  return { openings, band };
}

/**
 * The sanity rules an opening list has to satisfy on one wall.
 *
 * These are guards, not fixes: each returns a complaint rather than adjusting
 * anything. A detector that quietly nudges a window until it fits is how bad
 * geometry reaches a customer's drawing looking deliberate.
 *
 * @param {Array} opens  [{k, c, w}] in feet, on one wall
 * @param {{a:number, b:number}} wall  the wall's run, in feet
 * @returns {string[]} empty when everything checks out
 */
export function checkOpenings(opens, wall, opts = {}) {
  const margin = opts.margin ?? 0.5;
  const apart = opts.apart ?? 0.3;
  const out = [];
  const sorted = [...opens].sort((p, q) => p.c - q.c);

  for (const o of sorted) {
    const s = o.c - o.w / 2, e = o.c + o.w / 2;
    if (o.k === 'win' && (o.w < 1.5 || o.w > 7)) {
      out.push(`a ${o.w.toFixed(1)}ft window is outside 1.5-7ft`);
    }
    // An opening must not run into the corner: there is no wall left to carry
    // its jamb, and in 3D the frame would hang off the end of the building.
    if (s < wall.a + margin || e > wall.b - margin) {
      out.push(`an opening at ${o.c.toFixed(1)} reaches the end of its wall`);
    }
  }
  for (let i = 0; i + 1 < sorted.length; i++) {
    const end = sorted[i].c + sorted[i].w / 2;
    const next = sorted[i + 1].c - sorted[i + 1].w / 2;
    if (next - end < apart) {
      out.push(`openings at ${sorted[i].c.toFixed(1)} and `
        + `${sorted[i + 1].c.toFixed(1)} are less than ${apart}ft apart`);
    }
  }
  return out;
}

/**
 * Split a wall's gaps into doors and everything else.
 *
 * `threshold` is deliberately not tuned here — it is measured per corpus and
 * passed in, because a number picked to make one plan look right is how the
 * last five attempts got as far as they did.
 */
export function classifyGaps(mask, W, H, gaps, threshold = 0.5, opts = {}) {
  const doors = [], openings = [];
  const scores = [];
  for (const g of gaps) {
    const { score } = doorScore(mask, W, H, g, opts);
    scores.push(score);
    (score >= threshold ? doors : openings).push({ ...g, doorScore: score });
  }
  return { doors, openings, scores };
}

/**
 * WINDOWS, BY WHAT IS INSIDE THE OPENING.
 *
 * Every symbol chart draws the same thing: the wall's poché stops, and the
 * opening carries one to three thin lines running ALONG it, closed off by wall
 * at both ends. An empty opening is a doorway. A swing arc is a door. Lines
 * running the length of it are glazing.
 *
 * WHY THIS ONLY BECAME POSSIBLE ON 2026-08-19. `wallMask` ends with a
 * morphological opening that removes specks, and glazing lines are 1-2px, so it
 * deleted them while the 8-20px walls survived. Every window arrived here
 * looking exactly like an empty doorway. Five refuted explanations for
 * doorScore and six failed searches for the window signature were all reading a
 * mask the symbol had already been erased from. So `raw` must come from
 * `wallMask(img, { open: 0 })`, and `wall` from the ordinary one — walls want
 * the speckle gone, symbols cannot survive it.
 *
 * TWO TESTS, OR'd, because each fails exactly where the other holds:
 *
 *   - MOST COLUMNS SHOW TWO OR MORE ink runs through the wall's depth. This is
 *     the plain reading of the symbol and it survives a mullion, the centre
 *     break that halved every span measurement in earlier work. It cannot see a
 *     single-line window, where a column has one run by construction.
 *   - ONE DEPTH CARRIES A RUN ALONG most of the opening. This catches the
 *     single-line window and the thin-walled plan. Alone it fails on a mullion,
 *     whose break splits the long run in two.
 *
 * MEASURED over three seeds per style, positions matched at 0.03 of the plan:
 *
 *     base 0.91/1.00   thin 1.00/1.00   thick 0.82/1.00   dashed 0.91/1.00
 *     mullion 0.91/1.00   oneLine 0.91/1.00   hatch 0.13/0.97
 *
 * as precision/recall. Recall is 1.00 everywhere, against 0.53-0.60 for the
 * previous approach on the same corpus.
 *
 * HATCH IS SOLVED, and it was upstream as expected. Stipple inside the poché is
 * HOLES, and the mask's opening removes specks rather than holes, so the wall
 * came back in fragments and every fragment boundary read as an opening full of
 * ink. `closeHoles` in extrude.js is the mirror operation. Segmenting a closed
 * mask takes the hatched style from 0.15 precision to 1.00, recall staying at
 * 1.00, and costs the other six styles nothing.
 *
 * It is NOT applied in the 3D path. That reads the styled render, and the
 * styling model smooths hatching away: measured on Madison, the one test plan
 * whose source is hatched, its render gives the same 85 segments, 28 gaps and 8
 * glazed openings with and without the close, for 180ms. The remedy is real and
 * the condition is not present there.
 *
 * WHAT ELSE WEARS THIS SIGNATURE, from the standard symbol guides. None of
 * these is a bug to chase; they are the limits of reading a plan at all.
 *
 *   - A SLIDING DOOR is "parallel lines that look like they might slide past
 *     one another", and a POCKET DOOR is a panel inside the wall cavity. Both
 *     read as glazing here and always will. From a plan alone a slider and a
 *     window differ by a label, not by geometry.
 *   - A SUPPLY VENT is "a small rectangle with parallel lines indicating
 *     airflow". Dropped in practice by the 1.5ft minimum, since a vent is
 *     nowhere near that wide, but it is the same shape at a smaller size.
 *   - A CASEMENT WINDOW "swings out like a door and its symbol may include
 *     swing direction". So an arc does NOT mean door. The abandoned
 *     doors-first-by-arc strategy would have called every casement a door and
 *     then found no window there; worth knowing before anyone revives it.
 *   - A BIFOLD DOOR is "two v-shaped lines", which is a zigzag across the
 *     opening rather than lines along it, so it does not trip this test.
 *
 * @param {{mask:Uint8Array,low:Uint8Array,w:number,h:number}} wall  opened mask
 * @param {{mask:Uint8Array,low:Uint8Array}} raw  the same image at open: 0
 * @param {Array} gaps  from collinearGaps, each carrying `horizontal`
 * @returns {Array} the subset of `gaps` whose contents read as glazing
 */
export function glazedOpenings(wall, raw, gaps, opts = {}) {
  const minCols = opts.minCols ?? 0.5;    // share of columns showing 2+ runs
  const minAlong = opts.minAlong ?? 0.7;  // share of the span one depth must run
  const minSpan = opts.minSpan ?? 4;      // px; shorter than this is not an opening
  const w = wall.w;
  const out = [];
  for (const g of gaps) {
    const [f0, f1] = g.face || (g.horizontal ? [g.y0, g.y1] : [g.x0, g.x1]);
    const a0 = g.horizontal ? g.x0 : g.y0;
    const a1 = g.horizontal ? g.x1 : g.y1;
    const span = a1 - a0;
    if (span < minSpan || f1 <= f0) continue;
    const ink = (a, b) => {
      const i = g.horizontal ? b * w + a : a * w + b;
      return (raw.mask[i] || (raw.low && raw.low[i])) ? 1 : 0;
    };
    let cols = 0, twoPlus = 0;
    for (let a = a0; a < a1; a++) {
      let runs = 0, prev = 0;
      for (let b = f0; b < f1; b++) { const k = ink(a, b); if (k && !prev) runs++; prev = k; }
      cols++;
      if (runs >= 2) twoPlus++;
    }
    let longest = 0;
    for (let b = f0; b < f1; b++) {
      let cur = 0;
      for (let a = a0; a < a1; a++) {
        if (ink(a, b)) { cur++; if (cur > longest) longest = cur; } else cur = 0;
      }
    }
    // TWO WAYS IN, AND THEY ARE NOT EQUALLY SURE — which is why the winner is
    // recorded rather than thrown away.
    //
    // `byLines` is the window symbol itself: several thin lines running along
    // the opening, so most columns cross two or more of them. Every chart draws
    // a window that way, and nothing else in a wall looks like it.
    //
    // The other route accepts ONE continuous line along the gap. It is here
    // because single-line windows exist and defeated earlier work without it —
    // Madison keeps six windows on this route and one without it. But a door's
    // threshold reads exactly the same way, and measured across the corpus this
    // route alone accounts for 4 of Geena's 8, 3 of The Avi Top's 10 and 7 of
    // Plan A's 11.
    //
    // So the opening is still reported either way; what it is SURE of is not.
    // A caller drawing glazing should draw it only where `byLines` holds:
    // missing glass on a real window is a plainer model, glass across somebody's
    // front door is a claim about their house that is false.
    const byLines = Boolean(cols && twoPlus / cols >= minCols);
    if (byLines || longest / span >= minAlong) out.push({ ...g, byLines });
  }
  return out;
}
