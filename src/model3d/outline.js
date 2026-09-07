// The wall network as OUTLINES, not as a pile of rectangles.
//
// WHY THIS FILE EXISTS. `traceRects` in extrude.js cuts the wall mask into
// axis-aligned rectangles with a greedy row scan, and every artefact the 3D view
// has ever shown follows from that one decision: a wall arrives as several boxes,
// so it shows seams where they meet, slivers where the scan clipped a face,
// crumbs at the jambs of every opening, and a stripe of the wrong shade wherever
// two boxes of different sizes sit side by side. Eight cleanup passes were
// written against those symptoms, each measured, each correct on its own, and
// the next artefact always appeared somewhere else. They are all reverted.
//
// The mask is ALREADY the union of every wall. Its boundary is the thing to
// build from — one closed outline per connected wall network, with a hole for
// each room — which is exactly what THREE.Shape and ExtrudeGeometry take. No
// boolean library is needed for the same reason: the union was done by the
// thresholding, in pixels.
//
// The chain and its constants come from two independent reviews of the problem
// (docs/research-brief-wall-geometry.md), with one correction of my own noted at
// `open`.

/** For every ink pixel, the distance to the nearest pixel that is not ink. */
function distanceToEdge(mask, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => ((x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      d[y * W + x] = Math.min(d[y * W + x], at(x - 1, y) + 1, at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      if (!mask[y * W + x]) continue;
      d[y * W + x] = Math.min(d[y * W + x], at(x + 1, y) + 1, at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  return d;
}

const invert = (mask) => {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
};

/** Grow the ink by `r` pixels. */
export function dilate(mask, W, H, r) {
  if (r <= 0) return mask;
  const d = distanceToEdge(invert(mask), W, H);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = (mask[i] || d[i] <= r) ? 1 : 0;
  return out;
}

/** Shrink the ink by `r` pixels. */
export function erode(mask, W, H, r) {
  if (r <= 0) return mask;
  const d = distanceToEdge(mask, W, H);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = (mask[i] && d[i] > r) ? 1 : 0;
  return out;
}

/**
 * Close gaps up to `2r` wide, then take the same amount back off.
 *
 * This is what removes a break the tracer left across a wall: measured on Plan A
 * those slits run 0.38ft, which is 19px on a plan whose wall is 20px, so a
 * radius of half a wall bridges them. A real door on the corpus is 1.65ft, about
 * 85px, and nothing this size can reach across that.
 */
export const close = (mask, W, H, r) => {
  const out = erode(dilate(mask, W, H, r), W, H, r);
  // CLOSING ONLY EVER ADDS. That is its definition, and the chamfer distance
  // this is built on is an approximation which can break it: measured on a
  // plain 20px ring of wall, dilate-then-erode came back with 12,956 ink pixels
  // where it started with 26,400 — half the wall gone before anything was even
  // traced, which is why the ring came out as four little corner squares.
  // Unioning with what went in restores the guarantee and cannot cost anything
  // the operation was supposed to keep.
  for (let i = 0; i < out.length; i++) if (mask[i]) out[i] = 1;
  return out;
};

/**
 * Take off anything thinner than `2r`, then put the rest back.
 *
 * MY CORRECTION TO BOTH REVIEWS, which proposed a radius of half a wall for this
 * as well. Opening at half a wall erodes 10px off each side of a 20px wall and
 * deletes the wall. The radius has to be well under half the thickness; a
 * quarter clears the 0.06ft slivers and the five-inch jamb crumbs and leaves a
 * wall 20px thick standing at 20px.
 */
export const open = (mask, W, H, r) => {
  const out = dilate(erode(mask, W, H, r), W, H, r);
  // And opening only ever removes, for the same reason.
  for (let i = 0; i < out.length; i++) if (!mask[i]) out[i] = 0;
  return out;
};

/**
 * Trace the boundary of every blob and every hole, as closed rings.
 *
 * COLLECT THE EDGES, THEN STITCH THEM. Every ink pixel whose neighbour is
 * background contributes one unit edge, directed so the ink is always on the
 * same side; joining them end to end gives closed rings, with holes coming out
 * wound the opposite way for free.
 *
 * A DIRECTION TABLE WAS TRIED FIRST and got the turns wrong — the first ring it
 * produced ran diagonally across half the plan. This has no table and no turn
 * logic to get wrong: an edge either exists or it does not, and a ring is closed
 * when it returns to where it started.
 */
export function contours(mask, W, H, only = null) {
  // `only` restricts the trace to one connected component, which is what makes
  // outer-versus-hole answerable without a geometric test — see wallShapes.
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const v = mask[y * W + x];
    return only === null ? (v ? 1 : 0) : (v === only ? 1 : 0);
  };
  // Directed unit edges, keyed by their start corner.
  const from = new Map();
  const add = (ax, ay, bx, by) => {
    const k = `${ax},${ay}`;
    if (!from.has(k)) from.set(k, []);
    from.get(k).push([bx, by]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      // Wound so the ink is on the right of travel.
      if (!at(x, y - 1)) add(x + 1, y, x, y);          // top edge, going left
      if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1);  // bottom, going right
      if (!at(x - 1, y)) add(x, y, x, y + 1);          // left, going down
      if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y);  // right, going up
    }
  }
  const rings = [];
  for (const [startKey, list] of from) {
    while (list.length) {
      const ring = [];
      let [sx, sy] = startKey.split(',').map(Number);
      let cx = sx, cy = sy;
      // A WALK THAT DOES NOT COME BACK IS NOT A RING. Starting from an edge in
      // the middle of a boundary can run into a corner that has already been
      // consumed, and the half-walk that results closes across the plan as a
      // diagonal — which is exactly what the first version drew.
      let closed = false;
      for (let guard = 0; guard < W * H * 4; guard++) {
        const k = `${cx},${cy}`;
        const outs = from.get(k);
        if (!outs || !outs.length) break;
        // THE NEXT EDGE IN THE ROTATION, which is how a planar graph is walked
        // face by face. At a corner four edges can meet, and the choice decides
        // whether the walk follows the boundary or closes a loop around the
        // corner itself.
        //
        // "Sharpest right of the incoming direction" was tried and is wrong: on
        // a plain rectangular ring of wall it returned four little squares of
        // 425px, one per corner, instead of the ring and its hole. The rule that
        // works is measured from the REVERSE of the incoming edge — the next
        // outgoing edge clockwise from where we came in — which is the standard
        // way to enumerate the faces of an embedded graph.
        let pick = 0;
        if (ring.length && outs.length > 1) {
          const prev = ring[ring.length - 1];
          const back = Math.atan2(prev[1] - cy, prev[0] - cx);
          let best = Infinity;
          outs.forEach(([nx2, ny2], i) => {
            const ang = Math.atan2(ny2 - cy, nx2 - cx);
            let turn = back - ang;
            while (turn <= 0) turn += Math.PI * 2;
            while (turn > Math.PI * 2) turn -= Math.PI * 2;
            if (turn < best) { best = turn; pick = i; }
          });
        }
        const [nx, ny] = outs.splice(pick, 1)[0];
        ring.push([cx, cy]);
        cx = nx; cy = ny;
        if (cx === sx && cy === sy) { closed = true; break; }
      }
      if (closed && ring.length > 3) rings.push(ring);
    }
  }
  return rings;
}

/** Twice the signed area — positive is counter-clockwise in image coordinates. */
export function signedArea2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a;
}

/** Douglas-Peucker, iterative. */
export function simplify(ring, tol) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * Pull every vertex onto the plan's own grid, and drop the ones that then sit
 * on a straight line.
 *
 * Douglas-Peucker alone leaves a wall a degree or two off vertical, which reads
 * as a bent wall in the model. Snapping to a grid of a quarter wall makes two
 * faces of the same wall land on exactly the same coordinate, which is what
 * makes the extruded solid come out straight.
 */
export function snap(ring, grid) {
  const q = (v) => Math.round(v / grid) * grid;
  const out = [];
  for (const [x, y] of ring) {
    const p = [q(x), q(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  // THE RING CLOSES, SO THE DUPLICATE CHECK HAS TO CLOSE WITH IT.
  //
  // The loop above compares each point with the one before it and never with
  // the FIRST, so a ring whose start and end land on the same grid point keeps
  // both copies. The collinear pass below then reads cyclically, finds vertex 0
  // with vertex 0 on one side of it, computes a cross product of zero, and
  // deletes it — and finds the trailing copy in the same position and deletes
  // that too. Both copies go, and the ring loses that corner entirely.
  //
  // On a plan's usual jagged wall ribbon one vertex among two hundred is
  // nothing, which is why no fixture ever showed it. On a wall that closes a
  // clean loop it is a quarter of the geometry: the outer boundary of a
  // rectangular building came back as a TRIANGLE of exactly half the area,
  // failed `usable`'s four-vertex floor, and was dropped — leaving the room
  // voids as the only rings, so the model would have extruded the ROOMS as
  // solids and left no walls at all. Found by drawing a plain rectangular plan
  // as a control, which is a thing the corpus does not contain.
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  // Drop a vertex that lies between two others on the same line.
  const flat = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross !== 0) flat.push(b);
  }
  return flat.length > 2 ? flat : out;
}

/**
 * Is one ring inside another?
 *
 * ON A SAMPLE, NOT ON ONE POINT. The two boundaries of a perimeter wall run a
 * wall's thickness apart and start at the same corner of the drawing, so the
 * inner ring's FIRST vertex sits on the outer ring's own boundary, where ray
 * casting can answer either way. Measured on Plan A: the inner ring tested
 * outside, was filed as a second outline, and the building extruded as a solid
 * slab with every wall swallowed inside it.
 *
 * Vertices spread around the ring cannot all be on the boundary, so a majority
 * of them settles it.
 */
export function ringInside(ring, outer, samples = 9) {
  let hits = 0, tried = 0;
  const step = Math.max(1, Math.floor(ring.length / samples));
  for (let i = 0; i < ring.length; i += step) {
    tried++;
    if (inside(ring[i], outer)) hits++;
  }
  return tried > 0 && hits * 2 > tried;
}

/** Is a point inside a ring? Ray casting. */
export function inside(pt, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The wall network as shapes with holes, ready for ExtrudeGeometry.
 *
 * @param {Uint8Array} mask  wall ink, 1 per pixel
 * @param {number} W
 * @param {number} H
 * @param {number} wallPx  the plan's own median wall thickness, in pixels
 * @returns {Array<{outer:Array, holes:Array}>} rings in pixel coordinates
 */
/**
 * A PIECE IS A WALL OR IT IS NOT. IT IS NEVER HALF A WALL.
 *
 * Opening prunes thin ink, which is what stops a fin sticking out of a wall,
 * and it does that pixel by pixel — so a line lying right on the threshold
 * survives exactly where it happens to be a pixel fatter. Measured on a
 * straight 520px line one pixel thicker over its middle third: at half the wall
 * thickness it came back as a single 145px stub, at 0.6 it came back whole, and
 * below half it vanished. That stub is a wall drawn half its length, which is
 * the fault Saman circled beside the stairs.
 *
 * So the survival is judged per connected piece rather than per pixel. A piece
 * that mostly survives keeps its opened form, fins and all pruned. A piece that
 * opening tore most of the way through was never wall-thick to begin with and
 * goes entirely — a railing beside a stair is not a wall and must not become
 * one, and neither may it become a fragment of one.
 *
 * @param {Uint8Array} before ink before opening
 * @param {Uint8Array} after  ink after opening
 * @param {number} keepAbove  fraction of a piece that must survive
 */
export function keepWholePieces(before, after, W, H, keepAbove = 0.6) {
  const label = new Int32Array(W * H);
  const stack = [];
  const total = [0], left = [0];
  let n = 0;
  for (let i = 0; i < before.length; i++) {
    if (!before[i] || label[i]) continue;
    n++;
    total.push(0);
    left.push(0);
    label[i] = n;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      total[n]++;
      if (after[p]) left[n]++;
      const px = p % W, py = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (before[q] && !label[q]) { label[q] = n; stack.push(q); }
      }
    }
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    const c = label[i];
    if (c && left[c] / total[c] >= keepAbove) out[i] = after[i];
  }
  return out;
}

export function wallShapes(mask, W, H, wallPx, opts = {}) {
  const closeR = opts.closeR ?? wallPx * 0.5;
  const openR = opts.openR ?? wallPx * 0.25;
  const grid = opts.grid ?? wallPx * 0.25;
  // THE TOLERANCE IS WHAT THE SNAP CAN DO, AND IT IS DERIVED.
  //
  // `snap` above quantises every vertex onto `grid`, which is what makes two
  // faces of one wall land on the same coordinate and a near-vertical wall come
  // out vertical. It is also what turns a genuinely DIAGONAL wall into a
  // staircase: a smooth 45-degree boundary lands on grid multiples, and because
  // the quantisation aliases, some of those steps come out one grid unit long
  // and some come out TWO.
  //
  // That is the whole of the second seam. A staircase of step s puts its corner
  // s/sqrt(2) from the chord, so a tolerance of one grid removes the one-unit
  // steps and leaves the two-unit ones — which is exactly what Saman saw and
  // described precisely: clean from inside the room, ridged from the other side.
  // One face of that wall stepped by one grid and collapsed; the other stepped
  // by two and survived. Measured on his published render, the outer face kept
  //
  //   (10.767, 12.684) (10.767, 12.875) (10.958, 12.875) (10.958, 13.067)
  //
  // — four steps of 0.192 ft, which is two grid units on a 0.383 ft wall.
  //
  // So the floor is sqrt(2) * grid, and it is not a number to tune: below it a
  // snap can leave a staircase the snap itself created. Above it there is a
  // cliff — the two faces of a wall are only four grid units apart, so at two
  // grid units the tolerance starts moving a face rather than a step, and wall
  // area jumps from 1.2% to 9.0%. sqrt(2) sits comfortably below that.
  //
  //   tol        1.00 g   1.41 g   1.50 g   2.00 g
  //   stair runs      1        0        0        0
  //   wall area   +1.07%   +1.24%   +1.24%   +8.98%
  //
  // Across seven plans the change costs at most 0.7 points of wall area and
  // moves the silhouette 0.000 ft. NONE OF THE FIXTURES SHOWED THIS — all seven
  // already had zero staircase runs at one grid, and only Saman's own render
  // had the two-unit case. A corpus that passes is not the same as a corpus that
  // covers.
  //
  // The number this replaces was pinned to `grid` against a different metric:
  // segments shorter than 4 cm remaining. By that metric it succeeded. Segment
  // LENGTH was the wrong thing to count — a two-unit staircase has segments
  // twice as long and reads twice as badly.
  //
  // AND DO NOT MEASURE THIS AGAINST THE UNSIMPLIFIED RING. That comparison says
  // the outline loses 10.8% of its area on The Avi Top and 8.0% on Avi Main,
  // against roughly 1% elsewhere, and it looks like a defect in the tolerance.
  // It is not: the reference moves. `snap` absorbs the single-pixel wobble of a
  // drawn wall edge when the grid is bigger than a pixel — but `grid` is
  // wallPx * 0.25, so on a plan whose walls are FOUR pixels the grid is exactly
  // 1 and snapping integer coordinates onto a grid of 1 does nothing at all.
  // The wobble then survives into the "unsimplified" baseline on those two
  // plans and not on the others, so the two are not comparable.
  //
  // Measured against the ink instead, which cannot move — the share of wall
  // pixels the rasterised outline covers:
  //
  //                 tol:   0     0.5g    1g    1.41g    2g
  //   avitop  (4px)      99.2   99.2   88.2    88.2    88.2
  //   avimain (4px)      99.6   99.6   91.9    91.7    91.9
  //   sky     (6px)      97.9   97.9   97.9    97.9    98.1
  //
  // The whole of it lands the moment the tolerance reaches ONE PIXEL, which is
  // the size of a step in a raster contour, and nothing further is lost above
  // that. So it is not this constant: any usable tolerance is over a pixel.
  //
  // What it IS, is the floor of what a 700px mask can carry. On a four-pixel
  // wall the outline settles on the inner envelope and gives up the wobble —
  // about 0.09 ft on The Avi Top. Median wall thickness comes back exactly
  // (4px in, 4px out), no gap between solids moves by a thousandth of a foot,
  // the silhouette does not move, and the plan renders with no visible fault.
  // Left alone deliberately: raising the grid to make `snap` work again would
  // put the tolerance at 53% of a four-pixel wall, which moves wall FACES
  // rather than steps. test/wall-network-probe.html reports ink coverage so
  // this is measured the right way next time.
  const tol = opts.simplifyTol ?? Math.SQRT2 * grid;

  // A PIXEL OF AIR ALL ROUND, ALWAYS.
  //
  // Ink that reaches the edge of the raster has no boundary there to trace, so
  // the ring that should go around the outside of the wall is never closed and
  // the piece comes back as its own hole — measured on a plain rectangular ring
  // of wall, the shape returned was 93,500 where the wall's outline is 120,000.
  // Padding here rather than at the caller means every caller gets it.
  const PW = W + 2, PH = H + 2;
  const padded = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (mask[y * W + x]) padded[(y + 1) * PW + (x + 1)] = 1;
  }
  const closed = close(padded, PW, PH, closeR);
  const cleaned = keepWholePieces(closed, open(closed, PW, PH, openR), PW, PH,
    opts.survival ?? 0.6);

  // ONE COMPONENT AT A TIME, AND THEN THERE IS NOTHING TO DECIDE.
  //
  // Four rules for telling an outline from a hole were tried against the
  // polygons and all four failed on real plans — winding (both rings came back
  // the same sign), containment between rings (they start at the same corner,
  // where ray casting can answer either way), the ring's own ink side (true of
  // a hole's boundary as much as a blob's), and the same test asked before
  // snapping (right, and still lost one ring to a filter). Each time the inner
  // ring of the perimeter was filed as a second outline and the building
  // extruded as a slab a thousand square feet across, swallowing every wall
  // inside it. That is the wall Saman circled as deleted.
  //
  // Traced ONE COMPONENT at a time the question disappears: a connected piece of
  // wall has exactly one boundary that goes around it and any number of
  // boundaries around the voids it encloses, so the biggest ring is the outline
  // and every other ring is one of its holes. No winding, no ray casting, no
  // threshold.
  const label = new Int32Array(PW * PH).fill(0);
  const stack = [];
  let n = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (!cleaned[i] || label[i]) continue;
    n++;
    stack.push(i); label[i] = n;
    while (stack.length) {
      const p = stack.pop();
      const px = p % PW, py = (p / PW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= PW || ny >= PH) continue;
        const q = ny * PW + nx;
        if (cleaned[q] && !label[q]) { label[q] = n; stack.push(q); }
      }
    }
  }

  const areaOf = (r) => Math.abs(signedArea2(r)) / 2;
  const usable = (r) => {
    if (r.length < 4) return false;
    if (areaOf(r) < wallPx * wallPx) return false;
    // AND IT HAS TO ENCLOSE SOMETHING. A ring that runs out along a line and
    // back along the same line closes with a real area by the shoelace sum but
    // covers almost none of its own bounding box — a crease, not a wall.
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return box > 0 && areaOf(r) / box > 0.05;
  };

  const shapes = [];
  for (let c = 1; c <= n; c++) {
    const rings = contours(label, PW, PH, c)
      // SNAP STRAIGHTENS, THEN SIMPLIFY UNSTAIRCASES — one undoing what the
      // other had to do. `snap` makes two faces of an axis-aligned wall land on
      // exactly the same coordinate, which is what makes a near-vertical wall
      // come out vertical; the price is that a genuinely DIAGONAL wall lands on
      // a staircase instead. `simplify` takes that staircase back off, at a
      // tolerance derived from what the snap can leave. See `tol` above.
      //
      // TWO INDEPENDENT PASSES WENT INTO GETTING THIS RIGHT and each fixed one
      // half: wiring `simplify` in at all (it sat here unused, so every diagonal
      // was a staircase), then raising the tolerance from one grid to sqrt(2),
      // which is what removes the two-unit steps aliasing leaves behind.
      .map((r) => simplify(snap(r, grid), tol).map(([x, y]) => [x - 1, y - 1]))
      .filter(usable);
    if (!rings.length) continue;
    rings.sort((a, b) => areaOf(b) - areaOf(a));
    shapes.push({ outer: rings[0], holes: rings.slice(1) });
  }
  return shapes;
}
