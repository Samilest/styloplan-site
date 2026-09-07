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
function wallGrid(W, H, segments, pad) {
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
function inkNear(mask, W, H, x, y, tol) {
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
 * Is the swept quarter EMPTY?
 *
 * A door is drawn open because the space it needs is clear — that is what the
 * arc is telling the builder. So the inside of the sweep is floor, and if it is
 * full of ink the shape is a bath, a stair, a shower screen or a worktop
 * curve, not a door. This is the constraint that costs the false positives
 * nothing to satisfy and everything to fake.
 */
function sweptIsClear(mask, W, H, hinge, along, into, r, deg, tol) {
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

  // Padded by the tolerance, so ink just off a wall's face still counts as the
  // wall's own edge rather than as a mark beside it.
  const wall = wallGrid(W, H, segments, tol);

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
      const hit = bestAt(mask, W, H, [x, y], along, into, list, tol, wall, o.off || {}, o);
      if (hit) found.push({ x, y, deg: hit.deg, radius: hit.radius, along, into, score: hit.score });
    }
  }

  for (const horizontal of [true, false]) {
    for (const seg of horizontal ? segments.horizontal : segments.vertical) {
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
            const hit = bestAt(mask, W, H, [hx, hy], along, into, radii, tol, wall, o.off || {}, o);
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
