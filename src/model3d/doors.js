// Reading the door symbol itself.
//
// THE SYMBOL, as Saman drew it over the render: a straight thick line, and a
// thin curve attached to it. The straight line IS the door. The curve is the
// path that door sweeps as it closes, ending flush against the wall. So the
// three things are one object with one origin:
//
//        leaf tip
//           |\
//           | \  ← the arc: radius = leaf length, centred on the hinge,
//     leaf  |  \    sweeping from the leaf down to the wall
//           |   `.
//    =======H=====`====   the wall; H is the hinge, on the wall's own line
//
// WHY THIS FILE EXISTS RATHER THAN ANOTHER THRESHOLD IN openings.js.
//
// `doorScore` starts from a GAP: it pairs up wall segments, finds the space
// between them, then tries the four ways a door could hang in that space. Two
// things follow, and both cost doors. It can only see a door where the gap
// finder already agreed there is an opening — so every wall the tracer merged
// or missed takes its doors with it. And it samples a fixed quarter circle,
// while a plan that draws its doors half open draws only half an arc: measured
// on The Sky, every door is drawn at 42-45 degrees, so two thirds of what that
// sampler looked at was blank paper.
//
// This starts from the SYMBOL. Hinges are looked for at the ENDS of traced
// walls, because that is where a doorway's jamb is by definition, and both
// marks must be present at the same radius and the same angle before anything
// is called a door. A wall meeting a wall gives a straight line and no arc,
// which is exactly the false positive that a leaf-only search cannot refuse:
// searching for the straight mark alone reported 77% of door-width gaps as
// doors, with the angles piled up at 85-90 degrees — the angle a perpendicular
// wall sits at. Requiring the arc took it to 32%, and those are doors.
//
// Nothing here invents. A door is reported only where the drawing has both
// marks; where it does not, the caller gets nothing and the flat drawing on the
// floor is still the whole truth about that opening (red line 5).

/** A door is between these, in feet. Below is a cupboard, above is an opening. */
const MIN_FT = 2.0;
const MAX_FT = 4.2;
/**
 * A pair's leaf is narrower than a door: two 18-inch leaves close a 3ft
 * closet, and 18 inches is the narrowest door the stock sells. The Sky's
 * closets, 185px across, were pairs at 40ft (4.6ft: halves tried) and open
 * at the door-witnessed 34.5ft (3.97ft: a hair under two whole doors).
 */
const MIN_HALF_FT = 1.5;
/**
 * Angles a plan draws a door at.
 *
 * 20 was too shallow and the measurement said so loudly: the first run reported
 * 50 doors on a plan with a dozen, and their angles piled up on exactly 20 with
 * their widths piled up on exactly the smallest radius searched. A result
 * stacked on the boundary of its own search is not a finding, it is the search
 * hitting a wall — literally, here. At 20 degrees with a short radius the
 * "leaf" lies along the wall and the "arc" is a scrap of the corner beside it.
 */
const MIN_DEG = 30;
const MAX_DEG = 92;
const DEG_STEP = 2.5;
/** Both marks must be this well covered. */
const MIN_SCORE = 0.6;

/**
 * Where the traced walls are, one byte per pixel.
 *
 * THE MARKS OF A DOOR ARE NOT WALL INK, and this is the discriminator the first
 * version lacked. Ink alone cannot tell a door leaf from the wall it is drawn
 * beside, so a search over angles will always find its best score lying flat
 * against a wall. The walls are already known — they are what was traced — so
 * the leaf and the arc are required to be drawn somewhere else.
 */
export function wallGrid(W, H, segments, pad) {
  const g = new Uint8Array(W * H);
  const paint = (r) => {
    const x0 = Math.max(0, Math.floor(r.x0 - pad));
    const x1 = Math.min(W - 1, Math.ceil(r.x1 + pad));
    const y0 = Math.max(0, Math.floor(r.y0 - pad));
    const y1 = Math.min(H - 1, Math.ceil(r.y1 + pad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * W + x] = 1;
  };
  for (const r of segments.horizontal) paint(r);
  for (const r of segments.vertical) paint(r);
  return g;
}

/** Is there ink within `tol` of this point? */
export function inkNear(mask, W, H, x, y, tol) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  for (let dy = -tol; dy <= tol; dy++) {
    const Y = yi + dy;
    if (Y < 0 || Y >= H) continue;
    for (let dx = -tol; dx <= tol; dx++) {
      const X = xi + dx;
      if (X < 0 || X >= W) continue;
      if (mask[Y * W + X]) return true;
    }
  }
  return false;
}

/** The traced segments that are walls: a segment thinner than `lineFrac` of the plan's wall is a drawn line. */
export function solidWalls(segments, wallPx, lineFrac = 0.25, o = {}) {
  const lineBelow = wallPx ? wallPx * lineFrac : 0;
  if (!lineBelow) return segments;
  const thick = {
    horizontal: segments.horizontal.filter((r) => r.y1 - r.y0 >= lineBelow),
    vertical: segments.vertical.filter((r) => r.x1 - r.x0 >= lineBelow),
  };
  // A LEAF DRAWN AS A BAR. The Sky's dark render draws the door panel as a
  // solid stroke half a wall thick (8px on a 17px wall; the light render
  // draws the same panel as two hairlines), and the tracer keeps it as a
  // wall -- past the quarter rule, so the leaf hid its own door on the dark
  // render and not on the light one. What a wall has that a leaf has not is
  // a far end that meets something: a leaf is a door's width long, thinner
  // than the wall, and touches the plan at its hinge only. Such a bar is
  // left out of the walls; its arc is what the finder then reads.
  if (!o.ftPerPx || o.bars === false) return thick;
  const minLen = 0.8 / o.ftPerPx, maxLen = 4.5 / o.ftPerPx, near = 4;
  const all = [...thick.horizontal.map((r) => ({ ...r, hz: true })), ...thick.vertical.map((r) => ({ ...r, hz: false }))];
  const thin = (r) => (r.hz ? r.y1 - r.y0 : r.x1 - r.x0) < wallPx * 0.6;
  // A thin piece collinear with `self` is the same bar traced in two (The
  // Sky's closet leaf came as 42px and 62px, 4px and 7px wide): it is not
  // something the end meets.
  const sameBar = (r, self) => r.hz === self.hz && thin(r)
    && (r.hz ? Math.min(r.y1, self.y1) - Math.max(r.y0, self.y0) : Math.min(r.x1, self.x1) - Math.max(r.x0, self.x0)) > 0;
  const touches = (x, y, self) => all.some((r) => r !== self && !sameBar(r, self)
    && x >= r.x0 - near && x <= r.x1 + near && y >= r.y0 - near && y <= r.y1 + near);
  const isBar = (r) => {
    const len = r.hz ? r.x1 - r.x0 : r.y1 - r.y0;
    if (!thin(r) || len < minLen || len > maxLen) return false;
    const mid = r.hz ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2;
    const ends = r.hz ? [[r.x0, mid], [r.x1, mid]] : [[mid, r.y0], [mid, r.y1]];
    const met = ends.filter(([x, y]) => touches(x, y, r)).length;
    return met <= 1;
  };
  return {
    horizontal: all.filter((r) => r.hz && !isBar(r)).map(({ hz, ...r }) => r),
    vertical: all.filter((r) => !r.hz && !isBar(r)).map(({ hz, ...r }) => r),
  };
}

/** How much of a straight run from `hinge` is inked. */
function leafCoverage(mask, W, H, hinge, dx, dy, len, tol, wall) {
  let hit = 0;
  let n = 0;
  let onWall = 0;
  // From 0.15 out: the first fraction is inside the wall's own thickness and
  // would score for anything at all.
  for (let k = 0.15; k <= 1.001; k += 0.05) {
    n++;
    const x = hinge[0] + dx * len * k;
    const y = hinge[1] + dy * len * k;
    if (inkNear(mask, W, H, x, y, tol)) hit++;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi]) onWall++;
  }
  // A LEAF LYING ON A WALL IS A WALL. Half its length outside the wall is a
  // generous test — a door drawn at 30 degrees still leaves most of itself in
  // open floor — and it is what separates the two.
  return n && onWall / n <= 0.5 ? hit / n : 0;
}

/**
 * How much of the sweep is inked, BETWEEN THE WALL AND THE LEAF and no further.
 *
 * This is the correction that made the arc test work. The old one always
 * sampled a quarter circle, so on a plan that draws its doors at 45 degrees it
 * spent half its samples on empty paper and scored every door a miss.
 */
function arcCoverage(mask, W, H, hinge, along, into, r, deg, tol, wall) {
  const end = deg * Math.PI / 180;
  let hit = 0;
  let n = 0;
  for (let i = 0; i <= 18; i++) {
    // The ends sit ON the wall and ON the leaf, which both score for free.
    const t = end * (0.12 + 0.76 * (i / 18));
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = hinge[0] + (along[0] * c + into[0] * s) * r;
    const y = hinge[1] + (along[1] * c + into[1] * s) * r;
    const xi = Math.round(x);
    const yi = Math.round(y);
    // Samples that fall on a wall are not evidence either way — a swing that
    // passes behind a wall is drawn as far as the wall and no further — so they
    // are left out of the count rather than scored as a miss.
    if (xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi]) continue;
    n++;
    if (inkNear(mask, W, H, x, y, tol)) hit++;
  }
  // Too little of the sweep in open floor to have measured anything.
  return n >= 8 ? hit / n : 0;
}

/**
 * How thick the ink is across a line, at one point on it.
 *
 * The PANEL is drawn solid and the SWEEP is drawn as a hairline — that is the
 * difference Saman's picture shows, and it is a property of the drawing rather
 * than of any threshold. Measured across the mark, not along it.
 */
function thicknessAt(mask, W, H, x, y, nx, ny, limit) {
  let out = 0;
  for (const dir of [1, -1]) {
    for (let k = 0.5; k <= limit; k += 0.5) {
      const xi = Math.round(x + nx * dir * k);
      const yi = Math.round(y + ny * dir * k);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H || !mask[yi * W + xi]) break;
      out = Math.max(out, k);
    }
  }
  return out;
}

/**
 * THE INK MUST HAVE THE SHAPE IT IS TAKEN FOR. Sampling "is there ink within
 * the tolerance" along a circle or a ray is satisfied by any stroke that
 * happens to lie along it: a straight stroke 60px long sits within 3px of a
 * 157px circle, and a circle sits within 3px of a ray tangent to it for 50px.
 * Plan A's small room hung a door the plan does not draw from exactly those
 * two: a closet's bifold zigzag for the arc, the next door's arc for the
 * leaf (2026-09-19). So the pixels found along the sampled curve are fitted
 * to what they are claimed to be. An arc's pixels fit a circle of about the
 * radius sampled; a leaf's pixels fit a line, or at least no circle a door
 * could draw.
 *
 * `fitLine`: PCA on the points; returns the RMS distance to the best line.
 * `fitCircle`: the algebraic (Kasa) least-squares circle; returns its centre,
 * radius and RMS radial residual, or null when the points are collinear.
 */
export function fitLine(pts) {
  const n = pts.length;
  if (n < 3) return { rms: 0 };
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  // The smaller eigenvalue of the covariance is the variance across the line.
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const small = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return { rms: Math.sqrt(Math.max(0, small / n)) };
}

export function fitCircle(pts) {
  const n = pts.length;
  if (n < 4) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  // Centred coordinates keep the normal equations well conditioned.
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-6) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let ss = 0;
  for (const [x, y] of pts) { const d = Math.hypot(x - mx - uc, y - my - vc) - r; ss += d * d; }
  return { cx: mx + uc, cy: my + vc, r, rms: Math.sqrt(ss / n) };
}

/**
 * Is the swept quarter EMPTY?
 *
 * A door is drawn open because the space it needs is clear — that is what the
 * arc is telling the builder. So the inside of the sweep is floor, and if it is
 * full of ink the shape is a bath, a stair, a shower screen or a worktop
 * curve, not a door. This is the constraint that costs the false positives
 * nothing to satisfy and everything to fake.
 */
export function sweptIsClear(mask, W, H, hinge, along, into, r, deg, tol) {
  const end = deg * Math.PI / 180;
  let inked = 0;
  let n = 0;
  for (let ri = 0.35; ri <= 0.8; ri += 0.15) {
    for (let i = 1; i < 8; i++) {
      const t = end * (i / 8);
      const c = Math.cos(t);
      const s = Math.sin(t);
      n++;
      if (inkNear(mask, W, H,
        hinge[0] + (along[0] * c + into[0] * s) * r * ri,
        hinge[1] + (along[1] * c + into[1] * s) * r * ri, tol)) inked++;
    }
  }
  return n ? inked / n <= 0.35 : false;
}

/**
 * The best door hung at one hinge, or null.
 *
 * `along` points back along the wall the door closes onto — the direction the
 * leaf lies in when shut. `into` is the room it opens into.
 */
function bestAt(mask, W, H, hinge, along, into, radii, tol, wall, off = {}, o = {}) {
  let best = null;
  const shape = o.shape || shapeTests(mask, W, H, wall, tol);
  for (const r of radii) {
    for (let deg = (o.minDeg ?? MIN_DEG); deg <= MAX_DEG; deg += DEG_STEP) {
      const t = deg * Math.PI / 180;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const dx = along[0] * c + into[0] * s;
      const dy = along[1] * c + into[1] * s;
      const leaf = leafCoverage(mask, W, H, hinge, dx, dy, r, tol, wall);
      // The arc is the expensive half, so it is only measured where the cheap
      // half already found a line. 0.65 rather than 0.8: a panel crossed by a
      // dimension line or a fixture loses a sample or two, and the arc test
      // behind it is strict enough to carry the decision.
      if (leaf < (o.leafGate ?? 0.65)) continue;
      const arc = arcCoverage(mask, W, H, hinge, along, into, r, deg, tol, wall);
      // BOTH MARKS, so the weaker one decides. A door with a strong leaf and no
      // arc is a wall; a strong arc and no leaf is a shower curtain rail, a
      // stair nosing, or the corner of a bath.
      const score = Math.min(leaf, arc);
      if (score < (o.minScore ?? MIN_SCORE)) continue;

      // ---- AND THE THREE THINGS ONLY A REAL DOOR DOES.
      //
      // Coverage alone accepted 30 doors on a plan with 8 door-width openings,
      // which is not a number a house can have. These are the constraints a
      // swing symbol satisfies for free and other linework cannot.

      // The sweep is over clear floor: that is what the arc is FOR.
      if (!off.sweep && !sweptIsClear(mask, W, H, hinge, along, into, r, deg, tol)) continue;

      // THE CLOSED DOOR MUST HAVE SOMEWHERE TO CLOSE INTO.
      //
      // The first version of this had it backwards — it demanded wall where the
      // shut leaf lies — and the synthetic caught it in one run. A closed door
      // fills the DOORWAY; it lies across the opening, not along the wall
      // beside it. So the test is the opposite, and it is the more useful one:
      // a hinge whose closed position is solid wall is not a hinge, it is a
      // corner where two walls meet, which is where the over-reading came from.
      const shutX = Math.round(hinge[0] + along[0] * r * 0.6);
      const shutY = Math.round(hinge[1] + along[1] * r * 0.6);
      const shutIntoWall = shutX >= 0 && shutY >= 0 && shutX < W && shutY < H
        && wall[shutY * W + shutX];
      if (!off.shut && shutIntoWall) continue;

      // The panel is solid and the sweep is a hairline. Compared at the middle
      // of each, across the mark rather than along it.
      const half = deg * Math.PI / 360;
      const lm = [hinge[0] + dx * r * 0.55, hinge[1] + dy * r * 0.55];
      const leafT = thicknessAt(mask, W, H, lm[0], lm[1], -dy, dx, tol * 3);
      const am = [
        hinge[0] + (along[0] * Math.cos(half) + into[0] * Math.sin(half)) * r,
        hinge[1] + (along[1] * Math.cos(half) + into[1] * Math.sin(half)) * r,
      ];
      const arcT = thicknessAt(mask, W, H, am[0], am[1],
        (am[0] - hinge[0]) / r, (am[1] - hinge[1]) / r, tol * 3);
      // Not strictly greater: a plan that draws both marks at the same weight
      // is still drawing a door, and refusing those buys nothing. What this
      // rejects is the other way round — a hairline "panel" beside a heavy
      // curve, which is furniture.
      if (!off.thick && leafT < arcT) continue;
      // THE INK HAS THE SHAPE IT IS TAKEN FOR (shapeTests, v34): the arc's
      // pixels bend and fit a circle and stay on it, the leaf's lie on the
      // ray and do not bend. Coverage alone hung a door at a cased opening
      // on apt413201 from a basin counter's edge along the next wall's face
      // and the basin's oval, at the score floor.
      if (!off.shape && (!shape.arcIsArc(hinge, along, into, r, deg) || !shape.leafIsLine(hinge, along, into, r, deg, tol))) continue;
      if (!best || score > best.score) {
        best = { score, leaf, arc, deg, radius: r, hinge, along, into };
      }
    }
  }
  return best;
}

/**
 * Every door symbol the drawing carries.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {number} W
 * @param {number} H
 * @param {{horizontal:Array,vertical:Array}} segments from wallSegments()
 * @param {object} o
 * @param {number} o.ftPerPx  so a door can be recognised by its real width
 * @param {number} [o.tol]    how far off the line ink still counts
 * @param {number} [o.wallPx] the plan's wall thickness in pixels; a traced
 *   segment thinner than a quarter of it (`o.lineFrac`) is a LINE, not a
 *   wall, and is neither a hinge candidate nor painted into the wall grid
 * @returns {Array<{x:number, y:number, deg:number, radius:number,
 *   along:number[], into:number[], score:number}>} hinge in mask pixels, `deg`
 *   the angle the leaf is drawn at, `along`/`into` unit vectors
 */
export function findDoors(mask, W, H, segments, o = {}) {
  const ftPerPx = o.ftPerPx;
  if (!ftPerPx) return [];
  const tol = o.tol ?? 3;
  const minPx = MIN_FT / ftPerPx;
  const maxPx = MAX_FT / ftPerPx;
  // FOURTEEN WIDTHS, and six was the bug.
  //
  // Saman checked one plan by hand: every door the reader found was right, and
  // it had missed five. Loosening each of the three constraints in turn
  // recovered none of them, which ruled out the scoring — and the cause turned
  // out to be here. Six radii across 2.0-4.2ft step by 0.44ft; the five missing
  // doors measure 2.0 to 3.2ft, and a 2.7ft door falls between the 2.44 and
  // 2.88 samples. A leaf that lands 0.2ft off a 3px tolerance never matches, so
  // the door was never scored at all. At fourteen the step is 0.17ft, inside
  // the tolerance, and that plan reads 14 of 14 with the nine already-verified
  // ones unchanged.
  //
  // The cost is linear and small: the arc, which is the expensive half, is only
  // measured where a leaf was already found.
  const radii = [];
  const steps = o.radiusSteps ?? 14;
  for (let i = 0; i < steps; i++) radii.push(minPx + (maxPx - minPx) * (i / (steps - 1)));

  // A LEAF DRAWN AT NINETY DEGREES IS A STRAIGHT LINE, AND THE WALL TRACER
  // KEEPS STRAIGHT LINES. The Star's front door: a 2px line 86px long from
  // the hinge into the foyer, traced by wallSegments as a wall (it is longer
  // than the tracer's minimum run), painted into the wall grid, and so
  // refused as a door mark -- the leaf was excluded by itself. Same at the
  // mudroom's door. Saman: "the symbol on the floor is completely clear, so
  // no failure to read it is acceptable." A segment thinner than a QUARTER
  // of the plan's wall is a line the plan draws, not a wall the plan has; it
  // is left out of the grid and out of the hinge candidates (its ends are a
  // leaf's tip and hinge, not jambs). A quarter, not a half: Jordan and Plan
  // A draw some walls as two faces 7-9px apart on 15-23px walls, and at a
  // half those faces went too and five doors hung from their ends were lost
  // (test/doors-read-probe.html, 2026-09-14). At a quarter no render loses
  // a door and twelve gain: the Star's two, Geena four, Sky 2b four.
  const solid = solidWalls(segments, o.wallPx, o.lineFrac, { ftPerPx, bars: o.bars });
  // The bars stay hinge CANDIDATES: a leaf drawn as a bar begins at its jamb,
  // and on Madison 4 that end was the only candidate one door had. Out of
  // the grid, in the list of ends.
  const ends = solidWalls(segments, o.wallPx, o.lineFrac, { ftPerPx, bars: false });
  // Padded by the tolerance, so ink just off a wall's face still counts as the
  // wall's own edge rather than as a mark beside it.
  const wall = wallGrid(W, H, solid, tol);
  // Built once per call: the tests stamp distance maps per candidate, the
  // grid they exclude is this one.
  const oo = { ...o, shape: shapeTests(mask, W, H, wall, tol) };

  // Along the wall, in and out, in pixels. `0` first so an exact hit keeps the
  // exact hinge when several score the same.
  // OFF BY DEFAULT, and the measurement is why. Trying seven hinge positions
  // instead of one finds more doors on four plans (+5 avitop, +4 geena,
  // +5 madison) — but on JORDAN, the only plan whose doors are confirmed one
  // by one, it goes 14 to 15. The fifteenth is wrong, because fourteen is the
  // whole truth there. It also costs seven times the work: 5-10 seconds
  // against a one-second budget.
  //
  // So it stays available and unused. More doors is not better when the one
  // plan that can tell says the extra one is invented, and precision is the
  // thing this reader is for.
  const jitter = o.jitter ? [0, tol, -tol, tol * 2, -tol * 2, tol * 3, -tol * 3] : [0];

  const found = [];
  // HINGES FROM THE OPENINGS TOO, when the caller has them.
  //
  // Wall ends alone missed five of fourteen doors on Jordan — Saman marked
  // them — and loosening every threshold recovered none of them, which said the
  // rejection was not in the scoring at all: those doorways produce no wall END
  // for a hinge to sit on, because the tracer carried the wall straight through
  // them. A gap is the same jamb seen by a different reader, so both are used.
  // This is not the old dependence on gaps coming back: a gap is now one SOURCE
  // of candidates, and a door found without one is still a door.
  const extra = [];
  for (const g of o.gaps || []) {
    const hz = g.horizontal ?? (g.x1 - g.x0) >= (g.y1 - g.y0);
    const mid = hz ? (g.y0 + g.y1) / 2 : (g.x0 + g.x1) / 2;
    if (hz) {
      extra.push([g.x0, mid, [1, 0], true, g.x1 - g.x0], [g.x1, mid, [-1, 0], true, g.x1 - g.x0]);
    } else {
      extra.push([mid, g.y0, [0, 1], false, g.y1 - g.y0], [mid, g.y1, [0, -1], false, g.y1 - g.y0]);
    }
  }
  for (const [x, y, back, horizontal, gapWidth] of extra) {
    const along = [-back[0] + 0, -back[1] + 0];
    const intos = horizontal ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    // THE OPENING KNOWS HOW WIDE ITS DOOR IS. A leaf spans the doorway when it
    // is shut, so where a gap was traced its width IS the radius, and searching
    // for others is searching for something that cannot be there.
    // OFF unless asked for. It is the obvious optimisation — a shut leaf spans
    // its doorway, so the gap's width IS the radius — and measured across five
    // plans it changed not one door, because the fourteen-step search already
    // lands inside the tolerance. Kept as an option and not as the default:
    // it would tie the radius back to the gap finder, which is the dependency
    // this reader exists to avoid.
    const useGap = o.gapRadius && gapWidth >= minPx && gapWidth <= maxPx;
    const list = useGap ? [gapWidth * 0.94, gapWidth, gapWidth * 1.06] : radii;
    for (const into of intos) {
      const hit = bestAt(mask, W, H, [x, y], along, into, list, tol, wall, o.off || {}, oo);
      if (hit) found.push({ x, y, deg: hit.deg, radius: hit.radius, along, into, score: hit.score });
    }
  }

  for (const horizontal of [true, false]) {
    for (const seg of horizontal ? ends.horizontal : ends.vertical) {
      // THE HINGE IS AT A WALL'S END. That is what a jamb is, and it is why
      // this does not need the gap finder to have paired anything up: a wall
      // that stops has an end whether or not another wall was found opposite.
      const mid = horizontal ? (seg.y0 + seg.y1) / 2 : (seg.x0 + seg.x1) / 2;
      const ends = horizontal
        ? [[seg.x0, mid, [1, 0]], [seg.x1, mid, [-1, 0]]]
        : [[mid, seg.y0, [0, 1]], [mid, seg.y1, [0, -1]]];
      // `along` points back INTO the wall the leaf closes against, so the shut
      // door lies along the wall that is actually there.
      for (const [x, y, back] of ends) {
        // `+ 0` normalises negative zero, which is arithmetically equal to 0
        // and not deep-equal to it — the sort of difference that passes every
        // eye and fails one assertion.
        const along = [-back[0] + 0, -back[1] + 0];
        const intos = horizontal ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
        // THE HINGE IS NEAR THE WALL'S END, NOT EXACTLY ON IT. The traced end
        // is where the wall's INK stops; the door is hung on the jamb, and the
        // two are a few pixels apart once the render's soft edge, the wall's
        // drop shadow and the tracer's rounding are counted. The leaf is
        // sampled from 0.15r outward, so a hinge a few pixels adrift slides the
        // whole symbol and nothing matches at any angle or radius.
        for (const shift of jitter) {
          const hx = x + along[0] * shift;
          const hy = y + along[1] * shift;
          for (const into of intos) {
            const hit = bestAt(mask, W, H, [hx, hy], along, into, radii, tol, wall, o.off || {}, oo);
            if (hit) {
              found.push({ x: hx, y: hy, deg: hit.deg, radius: hit.radius, along, into, score: hit.score });
            }
          }
        }
      }
    }
  }

  // ONE DOOR PER DOORWAY. Both jambs of one opening are wall ends, and a leaf
  // drawn at 90 degrees is a plausible read from either of them, so the same
  // door is found twice from opposite sides. Keep the better and drop anything
  // whose hinge sits within half a door width of it.
  // TWO READINGS OF ONE DOOR SWEEP THE SAME SPACE, and that is how they are
  // recognised. Both jambs of an opening are candidates, so a leaf drawn at 90
  // degrees is a plausible read from either — the same door, described from the
  // other end. Distance between hinges cannot separate that from two real doors
  // near each other: widening it to a whole door width lost a true door on
  // Jordan. What the duplicates share is the SECTOR: their arcs run through the
  // same place. So a pair is the same door when the hinges are close AND the
  // middles of their sweeps are closer still.
  const sweepMid = (d) => {
    const half = d.deg * Math.PI / 360;
    const c = Math.cos(half);
    const s = Math.sin(half);
    return [d.x + (d.along[0] * c + d.into[0] * s) * d.radius,
      d.y + (d.along[1] * c + d.into[1] * s) * d.radius];
  };
  // THE CLOSED DOOR MUST LAND IN A TRACED OPENING, when asked for. Stronger
  // than "not on a wall": it says the doorway was seen by the wall tracer too.
  const inSomeGap = (d) => {
    const cx = d.x + d.along[0] * d.radius * 0.6;
    const cy = d.y + d.along[1] * d.radius * 0.6;
    return (o.gaps || []).some((g) => cx >= g.x0 - tol && cx <= g.x1 + tol
      && cy >= g.y0 - tol && cy <= g.y1 + tol);
  };
  // ON BY DEFAULT WHENEVER THE CALLER HAS OPENINGS. It is free — the gaps are
  // already computed for the windows — and it costs no verified door: Jordan
  // reads the same 14, checked by position, while Sky drops 30 to 26, avitop
  // 9 to 8 and Madison 15 to 13. Without gaps it cannot apply, and a door
  // found from a wall end alone is still a door.
  const gated = (o.gaps?.length && o.closedInGap !== false) ? found.filter(inSomeGap) : found;
  gated.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of gated) {
    const dm = sweepMid(d);
    const clash = kept.some((k) => {
      const km = sweepMid(k);
      if (Math.hypot(k.x - d.x, k.y - d.y) < d.radius * (o.nms ?? 0.5)) return true;
      return Math.hypot(k.x - d.x, k.y - d.y) < d.radius * 1.3
        && Math.hypot(km[0] - dm[0], km[1] - dm[1]) < d.radius * 0.6;
    });
    if (!clash) kept.push(d);
  }
  return kept;
}

/**
 * THE INK MUST HAVE THE SHAPE IT IS TAKEN FOR -- for every reader. Built
 * once per (mask, wall grid, tolerance); `findArcDoors` (v29) and
 * `findDoors` (v34) both hold their candidates to it.
 *
 * What the second wiring cost, measured (2026-09-19): first three doors
 * and two of The Star's kinds, which read as "the tests are too strict"
 * and were not. The Star's half-open pairs fell to `staysOn` counting a
 * pair's OTHER arc, running on from the apex, as ink leaving this one --
 * the ends were five per cent of the samples, two pixels of a short arc
 * (fixed: an end is a length). Of the three doors, two were errors in the
 * truth (a stair's stringer on Madison, a closet's top edge on Plan A --
 * the hinge-first reader had "found" them and the judge, shown its
 * verdict, agreed) and one is Jordan 4's exterior door drawn as a wedge
 * with no arc, which no shape test can take for a door: a miss, honestly.
 */
function shapeTests(mask, W, H, wall, tol) {
  const point = (h, along, into, r, deg) => { const t = deg * Math.PI / 180; return [h[0] + (along[0] * Math.cos(t) + into[0] * Math.sin(t)) * r, h[1] + (along[1] * Math.cos(t) + into[1] * Math.sin(t)) * r]; };
  // The ink pixels within `near` of a curve, each once, off the wall.
  const pixelsAlong = (pointAt, ts, near) => {
    const seen = new Set(), pts = [];
    for (const t of ts) {
      const [x, y] = pointAt(t);
      const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const X = xi + dx, Y = yi + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const i = Y * W + X;
        if (seen.has(i) || wall[i] || !mask[i]) continue;
        seen.add(i); pts.push([X, Y]);
      }
    }
    return pts;
  };
  // THE ARC'S INK BENDS. Over the sweep the ink actually covers, the circle
  // rises from its chord by the sagitta c^2/8r, and an arc's pixels stand
  // off their best line by three tenths of that (the parabola's RMS about
  // its chord); a straight stroke lying along the circle stands off its
  // line by its own width and no more (Plan A's zigzag stroke: 0.67px where
  // an arc would give 1.6). Asked for is half an arc's bend -- and that the
  // pixels fit SOME circle a door could draw (fitCircle: within two pixels,
  // a radius between a third and three times the sampled one), which a
  // polyline of two strokes at an angle does not. The radius itself is not
  // held to the sample: a 35-degree piece of a hairline fits radii a third
  // either way (The Sky's closet pair, r 100, fitted 60). The sweep is the
  // pixels' own, not `end`: the part of a quarter that lies against the
  // next wall is inside the grid's padding and never sampled (Jordan 4).
  const arcIsArc = (h, along, into, r, end) => {
    const ts = [];
    for (let deg = 5; deg <= end - 5; deg += 1) ts.push(deg);
    const pts = pixelsAlong((deg) => point(h, along, into, r, deg), ts, tol);
    if (pts.length < 12) return false;
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of pts) {
      const dx = x - h[0], dy = y - h[1];
      const a = Math.atan2(dx * into[0] + dy * into[1], dx * along[0] + dy * along[1]);
      if (a < lo) lo = a; if (a > hi) hi = a;
    }
    const chord = 2 * r * Math.sin((hi - lo) / 2);
    const bend = 0.3 * chord * chord / (8 * r);
    if (fitLine(pts).rms < bend * 0.5) return false;
    const f = fitCircle(pts);
    if (!f || f.rms > 2 || f.r < r / 3 || f.r > r * 3) return false;
    return staysOn((deg) => point(h, along, into, r, deg), ts, tol);
  };
  // THE INK ON THE CURVE STAYS ON IT. Whatever stroke puts ink along the
  // sampled circle or ray is followed, pixel to pixel, as far as six
  // tolerances from the curve: a drawn arc or leaf runs along its curve and
  // no further; a stroke that merely touches it -- the next door's arc
  // tangent to the ray, a closet's edge line grazing the circle -- runs off
  // it, and the ink it leaves beside the curve within reach is a good part
  // of what it left on it. A fixture's line crossing the curve leaves a
  // little beside it and is let be; a leaf drawn as a hatched bar lies
  // within a tolerance and a hairline of its centre line and counts as on.
  // The walk stops at the wall grid, so the wall at the hinge and the wall
  // a leaf lies against are not the stroke's; and what leaves the curve at
  // either END is not counted -- the leaf meets its arc at the tip, and
  // the arc meets the leaf, each running off the other's curve there.
  const staysOn = (pointAt, ts, near) => {
    const onD = near + 2, offD = near * 6;
    // THE ENDS ARE A LENGTH, NOT A SHARE. They were the first and last five
    // per cent of the samples: eight pixels of a quarter circle, two of the
    // 36-degree arc a door drawn half open leaves (The Star's pairs, whose
    // two arcs meet tip to tip in an M) -- so the other arc, running on from
    // the apex, was counted as ink leaving this one, and the pair was lost
    // the moment this test reached the hinge-first reader. An end is now
    // the reach of the ink itself, a tolerance in and two out (onD), along
    // the curve from either end, whatever the sweep.
    const pos = ts.map((t) => pointAt(t));
    const fromStart = [0], fromEnd = new Array(pos.length).fill(0);
    for (let k = 1; k < pos.length; k++) fromStart[k] = fromStart[k - 1] + Math.hypot(pos[k][0] - pos[k - 1][0], pos[k][1] - pos[k - 1][1]);
    for (let k = pos.length - 2; k >= 0; k--) fromEnd[k] = fromEnd[k + 1] + Math.hypot(pos[k][0] - pos[k + 1][0], pos[k][1] - pos[k + 1][1]);
    const endPx = onD + near;
    // Distance to the curve, stamped from its pixels, over the reach, with
    // whether the nearest part of the curve is one of its ends.
    const dist = new Map();
    ts.forEach((t, k) => {
      const [x, y] = pos[k];
      const cx = Math.round(x), cy = Math.round(y);
      const atEnd = fromStart[k] <= endPx || fromEnd[k] <= endPx;
      for (let dy = -offD; dy <= offD; dy++) for (let dx = -offD; dx <= offD; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > offD) continue;
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const i = Y * W + X;
        const was = dist.get(i);
        if (was === undefined || d < was[0]) dist.set(i, [d, atEnd]);
      }
    });
    // The ink on the curve, then everything inked it reaches within the reach.
    const seen = new Set(), queue = [];
    for (const [i, [d]] of dist) if (d <= onD && mask[i] && !wall[i]) { seen.add(i); queue.push(i); }
    let on = 0, off = 0;
    while (queue.length) {
      const i = queue.pop();
      const [d, atEnd] = dist.get(i);
      if (d <= onD) on++; else if (!atEnd) off++;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (seen.has(j) || !dist.has(j) || !mask[j] || wall[j]) continue;
        seen.add(j); queue.push(j);
      }
    }
    return on === 0 || off <= on / 3;
  };
  // THE LEAF'S INK IS A LEAF'S: it stays on the ray, and it does not bend.
  // A hairline drawn straight stands off its best line by less than a pixel
  // (0.3-0.6 on these renders); what stands off more is either a leaf drawn
  // as two lines or a hatched bar (Jordan 4, The Sky), which fit no circle,
  // or an arc tangent to the ray, which fits one no bigger than a few
  // doorways (fitCircle) -- and stays on the ray along its whole length,
  // leaving it only past the ends, where staysOn does not look.
  const leafIsLine = (h, along, into, r, deg, near) => {
    const ts = [];
    for (let k = 0.2; k <= 0.95; k += 0.025) ts.push(k);
    const pointAt = (k) => point(h, along, into, r * k, deg);
    if (!staysOn(pointAt, ts, near)) return false;
    const pts = pixelsAlong(pointAt, ts, near);
    if (pts.length < 6 || fitLine(pts).rms <= 0.7) return true;
    const f = fitCircle(pts);
    return !(f && f.rms <= 1.5 && f.r <= r * 3);
  };
  return { arcIsArc, leafIsLine, staysOn, pixelsAlong };
}

/**
 * THE ARC FIRST, for the doorways findDoors left open.
 *
 * Measured against the door truth (2026-09-14), findDoors hangs 292 of 444
 * doors and invents none; of the 152 it misses, 78 have no hinge candidate
 * at any relaxation. Looked at crop by crop on six plans, every one of
 * those has the ARC drawn. What differs is the leaf: an outlined bar the
 * tolerance falls through, a leaf drawn SHUT across the doorway with its
 * sweep beside it, a leaf lying against a thick wall. findDoors starts from
 * a hinge and asks for the leaf before it will look for the arc, so each
 * way of drawing the leaf is a separate way to miss.
 *
 * This starts from the doorway and the arc. The doorway's two jambs are the
 * only hinges a door there can have; its width is the leaf's length, so the
 * arc's radius is known; the arc is a quarter (or, for a door drawn half
 * open, the part from the shut line to the leaf) centred on a jamb, on one
 * side of the wall. That is four circles per doorway to test, and a circle
 * whose sweep is inked and whose inside is clear floor is a door's. The
 * leaf is then looked for where the arc says it must be -- open at the
 * arc's end, or shut along the doorway -- and gives the angle to draw;
 * both readings are required, as in findDoors, because a bath's corner or
 * a stair's nosing can lie on a circle too, but not with a leaf as well.
 *
 * Not a fifth rule for a fifth drawing style: the arc is the invariant and
 * the leaf's style is what the styles vary.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {Array} gaps  doorways to read, `{x0,y0,x1,y1,horizontal}`
 * @param {object} o  `ftPerPx`; `segments` and `wallPx` for the wall grid;
 *   `tol`; `minArc` (0.75), `minLeaf` (0.55); `shutOk(gap)` false where the
 *   opening is drawn with parallel lines (a window's), so a line along it
 *   is never read as a leaf drawn shut
 * @returns {Map<object, Array>} gap -> its leaves as leaf records (`{x, y,
 *   ax, ay, ix, iy, r, deg}`, the shape attachDoors makes): the hinge, the
 *   direction across the doorway, the swing side, the leaf's length and the
 *   angle drawn, 0 for a leaf drawn shut. Keyed by the gap itself rather
 *   than re-found by position: a wide-band artefact gap overlapping a real
 *   doorway is what attachDoors finds first there, and the door was lost.
 */
export function findArcDoors(mask, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  if (!scale) return [];
  const tol = o.tol ?? 3;
  const minArc = o.minArc ?? 0.75, minLeaf = o.minLeaf ?? 0.55;
  const wall = o.segments ? wallGrid(W, H, solidWalls(o.segments, o.wallPx, o.lineFrac, { ftPerPx: scale }), tol) : new Uint8Array(W * H);
  const onWall = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi]; };
  const point = (h, along, into, r, deg) => { const t = deg * Math.PI / 180; return [h[0] + (along[0] * Math.cos(t) + into[0] * Math.sin(t)) * r, h[1] + (along[1] * Math.cos(t) + into[1] * Math.sin(t)) * r]; };
  // The sweep from the shut line to `end`, sampled off the wall, within the
  // tolerance and within a pixel: the tight reading separates a drawn arc
  // from a fixture's edge that happens to pass nearby.
  const arcAt = (h, along, into, r, end) => {
    let n = 0, hit = 0, tight = 0;
    for (let deg = 5; deg <= end - 5; deg += 3) {
      const [x, y] = point(h, along, into, r, deg);
      if (onWall(x, y)) continue;
      n++;
      if (inkNear(mask, W, H, x, y, tol)) hit++;
      if (inkNear(mask, W, H, x, y, 1)) tight++;
    }
    return n >= 10 ? { cover: hit / n, tight: tight / n } : null;
  };
  const { arcIsArc, leafIsLine } = shapeTests(mask, W, H, wall, tol);
  // AN ARC IS A HAIRLINE WITH CLEAR PAPER ON BOTH SIDES. A hatch (a deck, a
  // porch, grass) and a solid fill put ink within the tolerance of every
  // point on any circle, and the first run hung three doors in them. The
  // rings just inside and just outside the arc are sampled where the arc
  // was; either side more than a third inked is not a curve drawn on floor.
  const ringClear = (h, along, into, r, end) => {
    for (const rr of [r - 2 * tol - 1, r + 2 * tol + 1]) {
      let n = 0, hit = 0;
      for (let deg = 5; deg <= end - 5; deg += 3) {
        const [x, y] = point(h, along, into, rr, deg);
        if (onWall(x, y)) continue;
        n++;
        if (inkNear(mask, W, H, x, y, 1)) hit++;
      }
      if (n && hit / n > 0.34) return false;
    }
    return true;
  };
  // A radius sampled from the hinge, off the wall. `n` is how much of it
  // was off the wall to be sampled at all: a leaf drawn open flat against
  // the next wall lies inside the grid's padding and cannot be sampled.
  const line = (h, along, into, r, deg, near) => {
    let n = 0, hit = 0;
    for (let k = 0.2; k <= 0.95; k += 0.05) {
      const [x, y] = point(h, along, into, r * k, deg);
      if (onWall(x, y)) continue;
      n++;
      if (inkNear(mask, W, H, x, y, near)) hit++;
    }
    return { cover: n >= 8 ? hit / n : 0, n };
  };
  const out = new Map();
  const leafOf = (d) => ({ x: d.x, y: d.y, ax: d.along[0], ay: d.along[1], ix: d.into[0], iy: d.into[1], r: d.radius, deg: d.deg });
  for (const g of gaps) {
    const hz = g.horizontal ?? (g.x1 - g.x0 >= g.y1 - g.y0);
    const w = hz ? g.x1 - g.x0 : g.y1 - g.y0;
    const ft = w * scale;
    if (ft < MIN_FT || ft > 7) continue;
    const mid = hz ? (g.y0 + g.y1) / 2 : (g.x0 + g.x1) / 2;
    const band = hz ? g.y1 - g.y0 : g.x1 - g.x0;
    const jambs = hz
      ? [[[g.x0, mid], [1, 0]], [[g.x1, mid], [-1, 0]]]
      : [[[mid, g.y0], [0, 1]], [[mid, g.y1], [0, -1]]];
    const intos = hz ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    // A single leaf spans the doorway; a pair's leaves span half each. The
    // jamb the tracer found is a few pixels off the jamb the arc is drawn
    // from, so the hinge slides along the doorway by up to two tolerances;
    // and the drafter hangs the door on the wall's FACE, not on the middle
    // of its band, so the hinge is tried on the band's middle and on each
    // face (half a band either way -- 8px on a 16px wall, past the
    // tolerance, and the shut leaf's whole line was missed by it).
    const spans = ft <= MAX_FT + 0.5 ? [w] : [];
    if (ft >= 2 * MIN_HALF_FT) spans.push(w / 2);
    const perGap = [];
    for (const [jamb, across] of jambs) for (const into of intos) for (const span of spans) {
      let best = null;
      for (const shift of [0, tol, -tol, 2 * tol, -2 * tol]) for (const face of [0, band / 2, -band / 2]) {
        const h = [jamb[0] + across[0] * shift + into[0] * face, jamb[1] + across[1] * shift + into[1] * face];
        for (const r of [span * 0.92, span * 0.96, span, span * 1.04, span * 1.08]) {
          if (r < (span === w ? MIN_FT : MIN_HALF_FT) / scale * 0.9) continue;
          // The longest sweep that is drawn: a quarter for a door drawn open,
          // less for one drawn half open.
          for (const end of [90, 75, 60, 45]) {
            const a = arcAt(h, across, into, r, end);
            // `trace` sees every candidate's measurements (test/arc-why-probe.html).
            const t = o.trace && { g, jamb, into, span, shift, r, end, arc: a?.cover ?? 0, tight: a?.tight ?? 0, ring: null, sweep: null, open: null, shut: null };
            const seen = (why) => { if (t) { t.why = why; o.trace(t); } };
            // Tight at a fifth, not a half: the drawn circle sits a pixel or
            // two off the sampled one between radius steps (avitop's arcs
            // covered 1.00 within three pixels and 0.18 within one); the
            // ring test is what refuses a hatch now.
            if (!a || a.cover < minArc || a.tight < 0.2) { seen('arc'); continue; }
            if (!arcIsArc(h, across, into, r, end)) { seen('shape'); continue; }
            t && (t.ring = ringClear(h, across, into, r, end));
            if (!ringClear(h, across, into, r, end)) { seen('ring'); continue; }
            t && (t.sweep = sweptIsClear(mask, W, H, h, across, into, r, end, tol));
            if (!sweptIsClear(mask, W, H, h, across, into, r, end, tol)) { seen('sweep'); continue; }
            // The leaf: open at the arc's end, or shut along the doorway.
            const open0 = line(h, across, into, r, end, tol);
            const open = open0.cover && !leafIsLine(h, across, into, r, end, tol) ? { cover: 0, n: open0.n } : open0;
            // A SHUT LEAF IS ONE LINE ACROSS THE DOORWAY, and a window is
            // two or three: where the caller says the opening is drawn with
            // parallel lines (`shutOk`), the shut reading is not made -- The
            // Star's bathroom window read as a shut door with a bath's
            // rounded corner for its arc.
            // And it is claimed only on the strongest evidence: the whole
            // quarter drawn tight, and the shut line itself continuous within
            // a pixel -- a shelf's dashed edge with a neighbour's arc passing
            // by was a shut door on Jordan, a stair's top line with two
            // treads for arcs a pair on The Star.
            const shutStrict = end === 90 && a.tight >= 0.4;
            const shut = !shutStrict || (o.shutOk && !o.shutOk(g)) ? { cover: 0, n: 0 } : line(h, across, into, r, 0, 1);
            // A LEAF AGAINST A WALL: drawn open a full quarter, the leaf lies
            // flat along the next wall's face, inside the grid's padding,
            // and there is nothing off the wall to sample (Madison, avitop).
            // The arc alone decides then, and only a whole quarter, drawn
            // tight, over clear floor.
            const againstWall = end === 90 && open.n < 8 && a.cover >= 0.9 && a.tight >= 0.4;
            const leaf = againstWall ? a.cover : Math.max(open.cover, shut.cover);
            if (t) { t.open = open.cover; t.shut = shut.cover; t.againstWall = againstWall; }
            if (leaf < minLeaf) { seen('leaf'); continue; }
            seen('ok');
            const deg = againstWall || open.cover >= shut.cover ? end : 0;
            const score = Math.min(a.cover, leaf);
            if (!best || score > best.score || (score === best.score && end > best.deg)) best = { score, deg, r, h, tight: a.tight };
            break;                                   // the longest sweep drawn wins for this radius
          }
        }
      }
      if (best) perGap.push({ x: best.h[0], y: best.h[1], deg: best.deg, radius: best.r, along: across, into, score: best.score, span });
    }
    // One reading per doorway: the best single; failing that, a pair from
    // opposite jambs on the same side.
    const singles = perGap.filter((d) => d.span === w).sort((a, b) => b.score - a.score);
    if (singles.length) { out.set(g, [leafOf(singles[0])]); continue; }
    const halves = perGap.filter((d) => d.span === w / 2);
    for (const into of intos) {
      const pair = halves.filter((d) => d.into === into);
      if (pair.length === 2 && Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) >= w * 0.5) { out.set(g, pair.map(leafOf)); break; }
    }
  }
  return out;
}

/**
 * A BIFOLD IS A ZIGZAG, NOT A LEAF AND AN ARC.
 *
 * The closet door the plan draws folded: from the jamb a panel leaves the
 * doorway line at a shallow angle, and from its tip a second panel comes
 * back to the line -- a Λ over half the doorway (a pair: one from each
 * jamb, meeting in the middle) or over the whole of it (a single bifold).
 * No arc, no sweep: findDoors' sweep test refuses it because the second
 * panel fills the sector, and Saman's rule stands -- "a bifold must have a
 * door too" (2026-09-14).
 *
 * Read per doorway, from the doorway's own jambs, because the zigzag is
 * drawn to span it: for a pattern (one Λ or two), an angle (30-65°, the
 * range drafters fold them at) and a side of the wall, the panels' lengths
 * follow from the doorway's width, so the search is small and the symbol
 * is either there or not. A doorway whose band is inked along its run is a
 * window, not a doorway, and is not read. The zigzag stands on the wall's FACE and folds
 * AWAY from the wall, into the closet or the room -- never inside the
 * wall's band, where a window's three lines and their mullion ticks can
 * be walked as a zigzag (Geena's kitchen window read as a four-panel
 * bifold before this was said). Both strokes of every Λ must be inked
 * along most of their length, within a pixel as well as within the
 * tolerance, none may lie on a wall, and the triangle under each Λ must be
 * clear -- a bath's curve or a fixture's outline fills what a folded door
 * leaves empty.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {Array} gaps  doorways to read, `{x0,y0,x1,y1,horizontal}` in the
 *   same pixels, jambs where the plan draws them
 * @param {object} o  `ftPerPx`; `segments` and `wallPx` for the wall grid the
 *   panels may not lie on (as findDoors); `tol`, `minScore`
 * @returns {Map<object, {leaves: Array, score: number, panels: number}>}
 *   gap -> its panels as leaf records (`{x, y, ax, ay, ix, iy, r, deg: 0}`:
 *   a start, a unit direction and a length; `leafPose` stands each up as it
 *   is drawn)
 */
export function findBifolds(mask, W, H, gaps, o = {}) {
  const tol = o.tol ?? 3;
  const minScore = o.minScore ?? 0.6;
  const wall = o.segments ? wallGrid(W, H, solidWalls(o.segments, o.wallPx, o.lineFrac, { ftPerPx: o.ftPerPx }), tol) : null;
  const out = new Map();
  // A stroke's coverage, over the part of it that is not on a wall: its
  // ends sit on the jambs, inside the grid's padding. A stroke mostly on
  // wall is a wall.
  const cover = (x0, y0, x1, y1, wall, near = tol) => {
    let hit = 0, n = 0, onWall = 0, all = 0;
    for (let k = 0.12; k <= 0.9; k += 0.06) {
      const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
      const xi = Math.round(x), yi = Math.round(y);
      all++;
      if (wall && xi >= 0 && yi >= 0 && xi < W && yi < H && wall[yi * W + xi]) { onWall++; continue; }
      n++;
      if (inkNear(mask, W, H, x, y, near)) hit++;
    }
    if (onWall / all > 0.4 || n < 6) return 0;
    return hit / n;
  };
  // Ink inside the triangle under a Λ: sampled on three lines across it, at
  // a third, a half and two thirds of its height, between the two panels.
  const filled = (bx, by, fx, fy, ex, ey) => {
    let inked = 0, n = 0;
    for (const h of [0.33, 0.5, 0.67]) {
      const lx = bx + (fx - bx) * h, ly = by + (fy - by) * h;
      const rx = ex + (fx - ex) * h, ry = ey + (fy - ey) * h;
      for (let k = 0.2; k <= 0.8; k += 0.15) {
        n++;
        if (inkNear(mask, W, H, lx + (rx - lx) * k, ly + (ry - ly) * k, 1)) inked++;
      }
    }
    return n ? inked / n : 1;
  };
  // ONE LINE ACROSS THE FOLD, at one height: a row between the two strokes
  // inked through its middle third while the rows a fifth of the rise
  // above and below are clear there. A trapezoid's top is such a line. The
  // pair of curves many drafters hang between a fold's tips, down to the
  // middle of the doorway (Avi main, Geena, Run 9), is not: it inks the
  // middle at every height, and it is the fold's own drawing. The middle
  // third, because an outlined leaf puts ink well inside the modelled
  // stroke; rows wide enough for a middle to be clear of the strokes.
  const crossed = (bx, by, fx, fy, ex, ey) => {
    const middle = (h) => {
      const lx = bx + (fx - bx) * h, ly = by + (fy - by) * h;
      const rx = ex + (fx - ex) * h, ry = ey + (fy - ey) * h;
      if (Math.hypot(rx - lx, ry - ly) < 6 * tol) return null;
      let n = 0, inked = 0;
      for (let k = 0.35; k <= 0.65; k += 0.075) { n++; if (inkNear(mask, W, H, lx + (rx - lx) * k, ly + (ry - ly) * k, 2)) inked++; }
      return inked / n;
    };
    for (let h = 0.3; h <= 0.7; h += 0.1) {
      const at = middle(h);
      if (at === null || at < 0.8) continue;
      const above = middle(h + 0.2), below = middle(h - 0.2);
      if ((above === null || above <= 0.2) && (below === null || below <= 0.2)) return true;
    }
    return false;
  };
  // A DOORWAY WITH A DOOR IN IT HAS NOTHING DRAWN ALONG IT. A window's lines
  // run the length of the opening inside the wall's band, and a zigzag at a
  // shallow angle can be walked over them (three windows read as bifolds on
  // the first pass). The fraction of the run with ink in the band says
  // which it is; a door's band holds only the leaves' roots.
  const bandInked = (a0, a1, c0, c1, hz) => {
    let n = 0;
    for (let a = Math.round(a0); a < a1; a++) {
      let hit = false;
      for (let c = Math.round(c0); c < c1 && !hit; c++) {
        const x = hz ? a : c, y = hz ? c : a;
        if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) hit = true;
      }
      if (hit) n++;
    }
    return n / Math.max(1, a1 - a0);
  };
  for (const g of gaps) {
    const hz = g.horizontal ?? (g.x1 - g.x0 >= g.y1 - g.y0);
    const a0 = hz ? g.x0 : g.y0, a1 = hz ? g.x1 : g.y1;
    const c0 = hz ? g.y0 : g.x0, c1 = hz ? g.y1 : g.x1;
    const w = a1 - a0;
    if (!(o.ftPerPx) || w * o.ftPerPx < 1.8 || w * o.ftPerPx > 9) continue;
    if (bandInked(a0, a1, c0, c1, hz) > (o.bandMax ?? 0.5)) continue;
    const pt = (a, c) => (hz ? [a, c] : [c, a]);
    // A fold is at least a wall deep: shallower is linework beside the wall.
    const minRise = Math.max(6, o.wallPx || 0);
    let best = null;
    for (const spans of [1, 2]) {                  // one Λ over the doorway, or two over its halves
      const half = w / spans / 2;                  // each panel's reach along the doorway
      for (let deg = 30; deg <= 65; deg += 5) {
        const p = half / Math.cos((deg * Math.PI) / 180);   // panel length
        const rise = half * Math.tan((deg * Math.PI) / 180); // fold height off the line
        if (rise < minRise) continue;
        // Standing on the face the fold leaves from: the far face for a fold
        // to +c, the near face for a fold to -c.
        for (const [side, base] of [[1, c1], [-1, c0]]) {
          {
            const strokes = [], tris = [];
            for (let i = 0; i < spans; i++) {
              const s = a0 + (w / spans) * i, e = s + w / spans, f = s + half;
              strokes.push([...pt(s, base), ...pt(f, base + side * rise)], [...pt(f, base + side * rise), ...pt(e, base)]);
              tris.push([...pt(s, base), ...pt(f, base + side * rise), ...pt(e, base)]);
            }
            let score = 1;
            for (const [x0, y0, x1, y1] of strokes) score = Math.min(score, cover(x0, y0, x1, y1, wall));
            const tr = o.trace && { g, spans, deg, side, score: +score.toFixed(2) };
            if (score < minScore) { tr && o.trace({ ...tr, why: 'cover' }); continue; }
            if (tris.some(([bx, by, fx, fy, ex, ey]) => filled(bx, by, fx, fy, ex, ey) > 0.35)) { tr && o.trace({ ...tr, why: 'filled' }); continue; }
            // NOTHING IS DRAWN ACROSS A FOLD. A trapezoid's sides -- a box
            // bay's symbol on Madison 3 -- run at a fold's angle from the
            // mouth's ends, and its top runs between them; `cover` samples
            // the strokes and `filled` the triangle's fill, and one line
            // across the fold is neither. Any row between the strokes inked
            // along most of its length is that line.
            if (tris.some(([bx, by, fx, fy, ex, ey]) => crossed(bx, by, fx, fy, ex, ey))) { tr && o.trace({ ...tr, why: 'crossed' }); continue; }
            // Within a pixel as well as within the tolerance: a stroke that
            // runs beside a fixture's edge scores at three pixels and not at
            // one, and among angles that all cover at three, the one that
            // covers at one is the angle drawn.
            const tight = strokes.reduce((m, [x0, y0, x1, y1]) => Math.min(m, cover(x0, y0, x1, y1, wall, 1)), 1);
            if (tight < (o.minTight ?? 0.5)) { tr && o.trace({ ...tr, tight: +tight.toFixed(2), why: 'tight' }); continue; }
            tr && o.trace({ ...tr, tight: +tight.toFixed(2), why: 'ok' });
            if (!best || score > best.score || (score === best.score && tight > best.tight)) {
              best = {
                score, tight, panels: strokes.length, deg, spans,
                leaves: strokes.map(([x0, y0, x1, y1]) => ({
                  x: x0, y: y0, ax: (x1 - x0) / p, ay: (y1 - y0) / p, ix: 0, iy: 0, r: p, deg: 0,
                })),
              };
            }
          }
        }
      }
    }
    // ONE FOLD IS A BIFOLD WHEN NO ARC IS DRAWN. One Λ over the doorway is
    // either a two-panel bifold or a pair of doors drawn open with their
    // tips together (Avi main, Another 2); a swing door has its arc, from
    // the tip of the leaf to the jamb, and a folding door has none. Run 9's
    // two-panel bifolds were read as pairs before this was said.
    if (best && best.spans === 1) {
      const p = best.leaves[0].r, deg = best.deg;
      const arcAt = (jamb, dir, side) => {
        let n = 0, hit = 0;
        for (let a = 5; a <= deg - 5; a += 5) {
          const t = (a * Math.PI) / 180;
          const along = p * Math.cos(t), rise = p * Math.sin(t);
          const [x, y] = pt(jamb + dir * along, (side > 0 ? c1 : c0) + side * rise);
          n++;
          if (inkNear(mask, W, H, x, y, tol)) hit++;
        }
        return n ? hit / n : 0;
      };
      const side = best.leaves[0].ay * (hz ? 1 : 0) + best.leaves[0].ax * (hz ? 0 : 1) > 0 ? 1 : -1;
      const arcs = Math.max(arcAt(a0, 1, side), arcAt(a1, -1, side));
      if (arcs < 0.6) best.folded = true;
    }
    if (best) out.set(g, best);
  }
  return out;
}

/**
 * A PAIR OF DOORS DRAWN NEARLY SHUT, meeting at the middle.
 *
 * Plan A draws its linen closet's doors as two leaves opened some twenty
 * degrees, each from its own jamb and half the doorway long, the arc from
 * each tip turning back to the door line and the two arcs meeting in a notch
 * at the middle. At twenty degrees an arc is twenty-odd pixels long and bows
 * by one, so it reads as a straight return square to its leaf, and the
 * readers of an arc find none (findDoors, findDoorSymbols and findArcDoors
 * look for a quarter of one, or most of it). What is there to read is this:
 * two straight leaves, one from each jamb and about half the doorway long;
 * at each leaf's end a return square to it, back to the door line; the two
 * returns meeting at the middle; nothing drawn between a leaf and the door
 * line; nothing drawn along the doorway (a window's lines). Handed back as
 * the pair, each leaf hinged on its jamb at the angle drawn.
 *
 * Measured first as a fold (findBifolds): a return square to its leaf is an
 * arc's start, not a fold's second panel, which runs back at the mirror of
 * the first; and a test for the arc about the jamb cannot tell this return
 * from one, since at this angle they lie within two pixels of each other.
 *
 * @returns {Map<object, {leaves: Array, pair: true}>}
 */
export function findShutPairs(mask, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  const out = new Map();
  if (!scale) return out;
  const tol = o.tol ?? 3;
  const wall = o.segments ? wallGrid(W, H, solidWalls(o.segments, o.wallPx, o.lineFrac, { ftPerPx: scale }), tol) : null;
  const walled = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    return !!wall && xi >= 0 && yi >= 0 && xi < W && yi < H && !!wall[yi * W + xi];
  };
  // How much of a straight segment is inked within `near`, off the walls.
  const cover = (x0, y0, x1, y1, near) => {
    let n = 0, hit = 0;
    for (let k = 0.12; k <= 0.9; k += 0.06) {
      const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
      if (walled(x, y)) continue;
      n++;
      if (inkNear(mask, W, H, x, y, near)) hit++;
    }
    return n >= 6 ? hit / n : 0;
  };
  for (const g of gaps) {
    const hz = g.horizontal ?? (g.x1 - g.x0 >= g.y1 - g.y0);
    const a0 = hz ? g.x0 : g.y0, a1 = hz ? g.x1 : g.y1;
    const c0 = hz ? g.y0 : g.x0, c1 = hz ? g.y1 : g.x1;
    const w = a1 - a0;
    // A pair's doorway: two leaves of a foot to three and a half. A foot,
    // not more: the scale is often the assumed 40ft, and Plan A's closet
    // pair, 3.6ft on its own dimensions, reads 2.3ft at that width.
    if (w * scale < 2 || w * scale > 7) continue;
    const pt = (a, c) => (hz ? [a, c] : [c, a]);
    let lined = 0;
    for (let a = Math.round(a0); a < a1; a++) {
      let hit = false;
      for (let c = Math.round(c0); c < c1 && !hit; c++) {
        const [x, y] = pt(a, c);
        if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) hit = true;
      }
      if (hit) lined++;
    }
    // Lines along a doorway are a window's -- except at a closet's mouth
    // (`o.closet`), where they are the closet's front, drawn where its doors
    // shut (Plan A's closet beside BATH 2).
    if (lined / Math.max(1, w) > 0.5 && !(o.closet && o.closet(g))) continue;
    // A leaf opened clear of the wall: its end a wall's thickness off the line.
    const minRise = Math.max(6, o.wallPx || 0);
    // Angles stepped so the leaf's end moves a pixel.
    const step = (Math.atan(2 / w) * 180) / Math.PI;
    // A leaf's CANDIDATES: the straight runs of ink leaving the jamb, each
    // with the return at its end, longest first. More than one, because the
    // longest run is not always the leaf: a ray a few degrees shallower
    // grazes the leaf's line and runs on into the other leaf's return, and
    // what settles it is the pair -- two leaves whose returns meet.
    const leafAt = (a, dir, base, side) => {
      const runs = [];
      for (let deg = 10; deg <= 45; deg += step) {
        const t = (deg * Math.PI) / 180, ca = Math.cos(t), sa = Math.sin(t);
        let last = 0, miss = 0, on = 0, n = 0;
        for (let s = 1; s <= w * 0.7; s += 1) {
          const [x, y] = pt(a + dir * s * ca, base + side * s * sa);
          n++;
          if (walled(x, y)) on++;
          if (inkNear(mask, W, H, x, y, 1)) { last = s; miss = 0; } else if (++miss > 2) break;
        }
        // Half the doorway, give or take a sixth; clear of the wall; not along one.
        if (last < w * 0.34 || last > w * 0.66 || last * sa < minRise || on / n > 0.3) continue;
        runs.push({ deg, len: last, ca, sa });
      }
      runs.sort((p, q) => q.len - p.len);
      const out = [];
      for (const r of runs.slice(0, 12)) {
        // The return, square to the leaf, to the door line near the middle.
        const eA = a + dir * r.len * r.ca, eC = base + side * r.len * r.sa;
        const [ex, ey] = pt(eA, eC);
        const [lx, ly] = pt(dir * r.ca, side * r.sa);
        let turn = null;
        for (let tA = a + dir * r.len * 0.9; dir > 0 ? tA <= eA + r.len : tA >= eA - r.len; tA += dir) {
          const [tx, ty] = pt(tA, base);
          const ux = tx - ex, uy = ty - ey, ul = Math.hypot(ux, uy);
          if (ul < minRise * 0.5) continue;
          if (Math.abs((ux * lx + uy * ly) / ul) > Math.sin((25 * Math.PI) / 180)) continue;   // within 25 degrees of square
          const c = cover(ex, ey, tx, ty, 1);
          if (!turn || c > turn.cover) turn = { tip: tA, cover: c };
        }
        if (turn && turn.cover >= 0.7) out.push({ a, deg: r.deg, len: r.len, eA, eC, tip: turn.tip });
      }
      if (!out.length) o.trace?.({ g, a, runs: runs.length, why: runs.length ? 'no return' : 'no leaf' });
      return out;
    };
    for (const [side, base] of [[1, c1], [-1, c0]]) {
      const Ls = leafAt(a0, 1, base, side), Rs = leafAt(a1, -1, base, side);
      // The pair whose returns meet closest, within a seventh of the doorway.
      let L = null, R = null, gapBest = Infinity;
      for (const l of Ls) for (const r of Rs) {
        const d = Math.abs(l.tip - r.tip);
        if (d <= w * 0.15 && d < gapBest) { gapBest = d; L = l; R = r; }
      }
      if (!L) { o.trace?.({ g, side, Ls: Ls.length, Rs: Rs.length, why: 'no pair meets' }); continue; }
      // Nothing drawn between a leaf and the door line: sampled halfway
      // between the two, the point furthest from both, wherever that is four
      // pixels or more (the triangle of a leaf this shallow is thin, and
      // samples near its edges read the leaf's own line).
      const filled = [L, R].some((l) => {
        const d = l.a === a0 ? 1 : -1, t = (l.deg * Math.PI) / 180;
        let n = 0, hit = 0;
        for (let f = 0.3; f <= 0.8; f += 0.1) {
          const half = (f * l.len * Math.sin(t)) / 2;
          if (half < 4) continue;
          const [x, y] = pt(l.a + d * f * l.len * Math.cos(t), base + side * half);
          n++;
          if (inkNear(mask, W, H, x, y, 1)) hit++;
        }
        return n > 0 && hit / n > 0.35;
      });
      if (filled) { o.trace?.({ g, L, R, why: 'filled' }); continue; }
      const [alx, aly] = pt(1, 0), [inx, iny] = pt(0, side);
      out.set(g, {
        pair: true,
        leaves: [L, R].map((l, i) => {
          const [x, y] = pt(l.a, base);
          const d = i === 0 ? 1 : -1;
          return { x, y, ax: alx * d, ay: aly * d, ix: inx, iy: iny, r: l.len, deg: Math.round(l.deg) };
        }),
      });
      break;
    }
  }
  return out;
}

/**
 * A POCKET DOOR IS A BAR THAT RUNS INTO THE WALL. One panel, drawn part way
 * across the opening and on past the jamb into the wall beside it, where
 * the wall is drawn HOLLOW to take it (The Sky's walk-in closet: a 2.7ft
 * doorway, the panel an outlined bar from the middle of the opening 1.4ft
 * into the wall).
 *
 * Read from the ink in the doorway's band: every run of ink along the
 * doorway on each row of the band (and a row or two beyond it) that is at
 * least three tenths of the opening long is a bar; rows a few pixels apart
 * carrying the same run are one bar, and a bar is a panel when its rows
 * span four pixels or more (an outlined panel's two edges, or a solid one).
 * A panel that leaves the opening past a jamb by a quarter of the opening,
 * with the wall hollow around it there, is a pocket door.
 *
 * NOT READ, ON PURPOSE: the bypass pair -- two panels on two tracks, one
 * from each jamb, overlapping in the middle. It is the sliding WINDOW's
 * symbol at a door's size, and Jordan draws every window that way, as
 * outlined sashes in gaps the flood never reaches (a basement); four of
 * them read as doors when the pair was read here. Nothing in the drawing
 * tells the two apart, and a window read as a door is worse than a door
 * left open.
 *
 * WHAT IS BUILT FROM IT is not the panel as drawn. Drawn half open, the
 * panel stood as a piece in the middle of an opening the tracer had left
 * twice too wide -- the hollow pocket wall is no wall to it -- and Saman
 * asked what use that was: "this is a sliding door". So the reading hands
 * back the door SHUT, a panel from jamb to jamb on the wall's centre line,
 * and the POCKET WALL beside it as a rectangle to build (`wall`): the
 * extruder's gap beyond the doorway's jamb on the pocket's side, in the
 * wall's band, which the caller passes as `gap.run` and `gap.band`.
 *
 * @returns {Map<object, {leaves: Array, pocket: true, wall: object|null}>}
 *   gap -> the panel as a leaf record (start, unit direction, length, deg
 *   0) across the whole doorway, and the pocket wall's rectangle in render
 *   pixels when the extruder's gap runs past the jamb
 */
export function findSlidingDoors(mask, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  const out = new Map();
  if (!scale) return out;
  for (const g of gaps) {
    const hz = g.horizontal ?? (g.x1 - g.x0 >= g.y1 - g.y0);
    const a0 = hz ? g.x0 : g.y0, a1 = hz ? g.x1 : g.y1;
    const [c0, c1] = g.face || (hz ? [g.y0, g.y1] : [g.x0, g.x1]);
    const w = a1 - a0;
    // A pocket door is a door's width; a 6.5ft "doorway" onto a deck with a
    // railing line along it read as one before the ceiling was said. A
    // CLOSET'S MOUTH is not held to it: its doors are made the closet's
    // width, and closets.js has already said this doorway is one (2 to
    // 10ft). Jordan 4's bedroom closet is 5.95ft, and its bypass pair was
    // never looked at.
    const isCloset = !!(o.closet && o.closet(g));
    if (w * scale < 2 || w * scale > (isCloset ? 10 : 5)) continue;
    const at = (a, c) => { const x = hz ? a : c, y = hz ? c : a; return x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]; };
    // Runs of ink along the doorway on each row, from a doorway's width
    // before the opening to one after, so a bar running into the wall is
    // seen whole. One-pixel breaks are the render's, not the drawing's.
    // THE PANEL LIES IN OR BESIDE THE WALL. `gap.band` is the wall's own
    // band across the doorway (the caller's, from the extruder's gap); the
    // gap's face may be narrower -- the reader's own gap in a wall drawn
    // hollow for the pocket is the near face alone (The Sky: three pixels
    // of a seventeen-pixel wall, the panel below it) -- and Geena draws the
    // panel just outside the wall. The rows scanned are the WALL's band and a
    // wall's thickness beyond it either way, and the gap's own face only
    // where it lies within that reach: a face wider than the wall is not the
    // wall's (Plan A's closet, its interior handed over as a 105px face, had
    // its doors read off the far wall's edge).
    const [b0, b1] = g.band || [c0, c1];
    const reach = Math.max(2, Math.round(o.wallPx || 0));
    const lo0 = Math.max(Math.min(c0, b0), b0 - reach) - reach, hi1 = Math.min(Math.max(c1, b1), b1 + reach) + reach;
    const bars = [];
    for (let c = Math.round(lo0); c <= Math.round(hi1); c++) {
      let start = null, miss = 0;
      const lo = Math.round(a0 - w), hi = Math.round(a1 + w);
      const close = (end) => {
        if (start !== null && end - start >= w * 0.3) bars.push({ c, s: start, e: end });
        start = null;
      };
      for (let a = lo; a <= hi; a++) {
        if (at(a, c)) { if (start === null) start = a; miss = 0; }
        else if (start !== null && ++miss > 1) close(a - miss + 1);
      }
      if (start !== null) close(hi);
    }
    // A LINE FROM JAMB TO JAMB IS NOT A PANEL: a window's glazing line, a
    // threshold, a closed pocket door that cannot be told from a thin wall.
    // The Sky's tall side window read as a pocket door before this was
    // said, on its sill line running past the jambs. Not at a closet's
    // mouth, where the line from jamb to jamb IS its door drawn shut.
    if (!isCloset && bars.some((b) => b.s <= a0 + 2 && b.e >= a1 - 2)) continue;
    // Rows that carry the same bar are one bar (an outlined panel is two
    // rows a few pixels apart; a solid one is several).
    const merged = [];
    for (const b of bars.sort((p, q) => p.c - q.c)) {
      const m = merged.find((k) => Math.abs(k.c - b.c) <= 8 && Math.min(k.e, b.e) - Math.max(k.s, b.s) >= 0.8 * Math.min(k.e - k.s, b.e - b.s));
      if (m) { m.rows++; m.cEnd = b.c; m.s = Math.min(m.s, b.s); m.e = Math.max(m.e, b.e); } else merged.push({ ...b, rows: 1, cEnd: b.c });
    }
    // Not a wall's own row: a bar that fills the doorway from jamb to jamb
    // on every row it has is a threshold, a glazing line or a wall; and a bar
    // is drawn as a panel, two rows or more.
    const inside = (b) => Math.min(b.e, a1) - Math.max(b.s, a0);
    // A PANEL HAS THICKNESS: an outlined bar's two edges four or more pixels
    // apart, or a solid bar that tall. A sash line two pixels thick is a
    // sliding WINDOW's, and Jordan's slider windows read as pocket doors
    // before this was said.
    // A PANEL IS THE DOORWAY'S OWN WIDTH, give or take a third: a pocket
    // door is made to close the opening it slides out of. A bar much longer
    // is the edge of something beside the wall (Jordan 2's deck railing
    // ran through a 6ft opening as a "pocket door" before this was said).
    const panels = merged.filter((b) => b.rows >= 2 && b.cEnd - b.c >= 3 && inside(b) >= w * 0.3
      && b.e - b.s >= w * 0.7 && b.e - b.s <= w * 1.35);
    const row = (b) => (b.c + b.cEnd) / 2;
    const leaf = (b, s, e) => (hz
      ? { x: s, y: row(b), ax: 1, ay: 0, ix: 0, iy: 0, r: e - s, deg: 0 }
      : { x: row(b), y: s, ax: 0, ay: 1, ix: 0, iy: 0, r: e - s, deg: 0 });
    // A CLOSET'S DOORS (closets.js says which doorways are closet mouths):
    // the bypass pair -- two panels each about half the mouth, on two
    // tracks, together spanning it -- or one panel across it, drawn shut.
    // Read only at a closet mouth, because the pair is a sliding window's
    // symbol too and there is no cell behind a window.
    if (isCloset) {
      // The door is a bar across the mouth (two rows or more: an outlined
      // panel's edges), running its width give or take a sixth -- a closet's
      // front line is drawn the closet's width, past the mouth's jambs (Plan
      // A: 303px of line over a 207px mouth). A second, shorter bar on other
      // rows overlapping the mouth is the second panel's edge: the bypass
      // pair, built as two half panels on two tracks; alone, the door is one
      // panel drawn shut.
      // AND THE PANEL AS THE BYPASS BLOCK DRAWS IT: from one jamb, along the
      // mouth, not across the whole of it -- the second panel comes from the
      // other side on another track. A styled render draws them shorter than
      // the mouth as often as not (Jordan 4's bedroom closet: 72% of it, from
      // the left jamb), and with no line from jamb to jamb the closet stood
      // open. At a closet mouth, already a closet by its cell and furniture,
      // a panel anchored at a jamb over three tenths of the mouth is its
      // door; built shut from jamb to jamb, as every door here is.
      // A panel is a RECTANGLE: its two edges four pixels apart or more, as
      // a pocket door's must be below -- on the symbols' ink one hairline
      // is two rows, and Madison's laundry had a line along its passage read
      // as a door -- and it lies WITHIN the mouth, jamb to jamb: a bar that
      // runs on past a jamb is that jamb's wall (run9's bath).
      const anchored = merged.filter((b) => b.rows >= 2 && b.cEnd - b.c >= 3 && inside(b) >= w * 0.3
        && b.s >= a0 - 2 && b.e <= a1 + 2
        && (b.s <= a0 + w * 0.16 || b.e >= a1 - w * 0.16)).sort((p, q) => inside(q) - inside(p));
      const full = merged.filter((b) => b.rows >= 2 && b.s <= a0 + w * 0.16 && b.e >= a1 - w * 0.16).sort((p, q) => q.rows - p.rows)[0]
        || anchored[0];
      if (o.trace) o.trace({ g, a0, a1, w, rowsScanned: [lo0, hi1], merged: merged.map((b) => ({ c: b.c, cEnd: b.cEnd, rows: b.rows, s: b.s, e: b.e })), full: !!full });
      if (full) {
        const extra = merged.find((b) => b !== full && Math.abs(row(b) - row(full)) >= 1 && inside(b) >= w * 0.3 && inside(b) <= w * 0.75);
        if (extra) {
          const mid = (a0 + a1) / 2, off = { c: row(full) + 3, cEnd: row(full) + 3 };
          out.set(g, { leaves: [leaf(full, a0, mid + 2), leaf(off, mid - 2, a1)], bypass: true, wall: null });
        } else {
          out.set(g, { leaves: [leaf(full, a0, a1)], shut: true, wall: null });
        }
        continue;
      }
    }
    if (!panels.length) continue;
    // THE WALL IS HOLLOW WHERE THE PANEL RUNS INTO IT: between the panel's
    // two edges, past the jamb, the ink stops. A solid wall there is a
    // window's frame line running on, not a pocket.
    const hollow = (b, from, to) => {
      const mid = Math.round((b.c + b.cEnd) / 2);
      let n = 0, inked = 0;
      for (let k = 0.2; k <= 0.8; k += 0.2) { n++; if (at(Math.round(from + (to - from) * k), mid)) inked++; }
      return n && inked / n <= 0.34;
    };
    // A pocket door: past one jamb by a quarter of the opening, not past the
    // other, and the wall hollow around the part that went in.
    const pocket = panels.find((b) => (b.s <= a0 - w * 0.25 && b.e < a1 - 2 && b.e > a0 + w * 0.3 && hollow(b, b.s, a0))
      || (b.e >= a1 + w * 0.25 && b.s > a0 + 2 && b.s < a1 - w * 0.3 && hollow(b, a1, b.e)));
    if (pocket) {
      const fromLeft = pocket.s <= a0 - w * 0.25;
      // Shut, on the wall's centre line.
      const mid = { c: (b0 + b1) / 2, cEnd: (b0 + b1) / 2 };
      const panel = leaf(mid, a0, a1);
      // The pocket wall: the extruder's gap beyond the jamb on the pocket's side.
      let wall = null;
      if (g.run) {
        const [r0, r1] = g.run;
        const [p0, p1] = fromLeft ? [r0, a0] : [a1, r1];
        if (p1 - p0 >= 4) wall = hz ? { x0: p0, y0: b0, x1: p1, y1: b1 } : { x0: b0, y0: p0, x1: b1, y1: p1 };
      }
      out.set(g, { leaves: [panel], pocket: true, wall });
    }
  }
  return out;
}
