// The geometry decisions, with no renderer attached.
//
// Split out of engine.js on purpose: everything here is arithmetic on the
// confirmed plan, and arithmetic is the part that has to be exactly right. Kept
// beside three.js it could only be exercised in a browser, and the whole reason
// `wallPieces` is worth testing is that each way it can be wrong renders as
// something that looks intentional — a door with no header, a window with no
// sill, a garage opening that swallows the wall above it.

/** The cut plane. Above this nothing is drawn — see fixtures.js for why. */
export const SECTION_H = 5.0;

export const DOOR_H = 3.0;      // head height of a walking door
export const GARAGE_H = 3.4;    // a vehicle door is taller
export const SILL = 1.4;        // window sill
export const HEAD = 3.2;        // window head
export const WALL_T = 0.35;     // when the model does not say

/**
 * Where the windows are, from the confirmed record — not from the pixels.
 *
 * WHY NOT READ THEM OFF THE RENDER. Five attempts at detecting windows by
 * brightness were all disproved by measurement. The last one is the clearest:
 * the mid-tone components in Jordan's render sit 13 to 25 pixels away from the
 * nearest wall pixel and touch no wall along their length either. A window in
 * these renders is not a gap in the wall and not a band against one, so there
 * is nothing in the image that reliably says "window here".
 *
 * The record already says it. Every wall carries its openings, the customer
 * signs them off in Review, and that is the same source the room names, the
 * staircases and the garage already come from. Nothing is invented — which is
 * the whole reason the 3D inherits the 2D's four-point check.
 *
 * The record's coordinates and the extruded model's are two different frames:
 * one is the model's own footprint, the other is measured off the render. They
 * are mapped by footprint, which is exact when the two agree on shape. When
 * they do not, `aspectError` says so rather than quietly placing windows in the
 * wrong wall — the caller can then refuse to draw them.
 *
 * @param {Array} walls  wall runs from the confirmed record
 * @param {{x0,z0,x1,z1}} from  the record's own extent
 * @param {{x0,z0,x1,z1}} to  the extruded model's extent
 * @returns {{windows:Array, aspectError:number}}
 */
export function windowsFromRecord(walls, from, to) {
  const fw = from.x1 - from.x0, fd = from.z1 - from.z0;
  const tw = to.x1 - to.x0, td = to.z1 - to.z0;
  const sx = tw / fw, sz = td / fd;
  const X = (v) => to.x0 + (v - from.x0) * sx;
  const Z = (v) => to.z0 + (v - from.z0) * sz;

  const windows = [];
  for (const wall of walls || []) {
    const t = wall.t ?? WALL_T;
    for (const o of wall.open || []) {
      if (o.k !== 'win') continue;
      const s = o.c - o.w / 2, e = o.c + o.w / 2;
      if (wall.axis === 'x') {
        // runs along x at z = f
        windows.push({
          x0: X(s), x1: X(e), z0: Z(wall.f - t / 2), z1: Z(wall.f + t / 2),
          horizontal: true,
        });
      } else {
        windows.push({
          z0: Z(s), z1: Z(e), x0: X(wall.f - t / 2), x1: X(wall.f + t / 2),
          horizontal: false,
        });
      }
    }
  }
  // Shape disagreement between the two frames, on the same measure the
  // four-point check uses for the silhouette.
  const fa = fd / fw, ta = td / tw;
  return { windows, aspectError: Math.abs(ta - fa) / fa };
}

const EPS = 1e-6;

/** The overlap of two rects, or null. */
export function intersectRect(a, b) {
  const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
  const z0 = Math.max(a.z0, b.z0), z1 = Math.min(a.z1, b.z1);
  return (x1 - x0 > EPS && z1 - z0 > EPS) ? { x0, z0, x1, z1 } : null;
}

/**
 * The parts of `rects` not covered by `holes`, as rects.
 *
 * A wall traced off the render is one solid box, so a window drawn on top of it
 * would be invisible — the box fills the opening. The hole has to come out of
 * the wall before either is built.
 *
 * Splitting one rect by one hole gives at most four pieces: the strip below the
 * hole, the strip above it, and the two beside it. Applied hole by hole so
 * several windows in one wall all cut through.
 *
 * Pure, and worth testing hard: a subtraction that leaves a sliver behind
 * renders as a thin wall standing in the middle of a window, which looks
 * deliberate.
 */
export function subtractRects(rects, holes) {
  let out = rects.map((r) => ({ ...r }));
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      const o = intersectRect(r, h);
      if (!o) { next.push(r); continue; }
      if (o.z0 - r.z0 > EPS) next.push({ ...r, z1: o.z0 });
      if (r.z1 - o.z1 > EPS) next.push({ ...r, z0: o.z1 });
      if (o.x0 - r.x0 > EPS) next.push({ ...r, x0: r.x0, x1: o.x0, z0: o.z0, z1: o.z1 });
      if (r.x1 - o.x1 > EPS) next.push({ ...r, x0: o.x1, x1: r.x1, z0: o.z0, z1: o.z1 });
    }
    out = next;
  }
  return out;
}

/**
 * The parts of each window that actually fall on a wall.
 *
 * A window from the record is placed by footprint mapping, so its band may
 * overhang the traced wall slightly. Only the overlap is built — a frame
 * floating past the end of a wall is worse than a short one.
 */
export function windowPieces(windows, walls) {
  const out = [];
  for (const w of windows) {
    for (const r of walls) {
      const o = intersectRect(w, r);
      // `byLines` rides along. It says whether the window SYMBOL itself was read
      // at this opening, or whether the opening only qualified on the weaker
      // reading that a door's threshold also satisfies. Nothing draws with it
      // today — the glazing that used it was taken back out — but it is a
      // measurement, it was expensive to get, and losing it here once already
      // put glass across a door. See glazedOpenings.
      if (o) out.push({ ...o, horizontal: w.horizontal, byLines: w.byLines });
    }
  }
  return out;
}

/**
 * How much of each window actually falls on a traced wall, and which ones to
 * keep.
 *
 * THE GUARD THIS EXISTS FOR. A window's position is only as good as its source.
 * Measured on Jordan, whose record and render agree on footprint to 0.03%, four
 * of six windows landed 0–19% on any wall. The cause was not the mapping: the
 * record's wall array came from an image model, not from the customer, and that
 * model's linework misses the confirmed drawing 81% of the time.
 *
 * A window floating off its wall is worse than no window — it is an invented
 * feature of somebody's house, drawn confidently. So coverage is measured, and
 * anything that does not really sit in a wall is dropped and counted.
 *
 * @returns {{keep:Array, dropped:number, coverage:number[]}}
 */
export function windowsOnWall(windows, walls, minCover = 0.8) {
  const keep = [];
  const coverage = [];
  for (const w of windows) {
    const len = w.horizontal ? w.x1 - w.x0 : w.z1 - w.z0;
    const bits = windowPieces([w], walls);
    const on = bits.reduce((n, b) => n + (w.horizontal ? b.x1 - b.x0 : b.z1 - b.z0), 0);
    // Traced walls can overlap each other, so coverage can exceed 1.
    const c = len > 0 ? Math.min(1, on / len) : 0;
    coverage.push(c);
    if (c >= minCover) keep.push(w);
  }
  return { keep, dropped: windows.length - keep.length, coverage };
}

/**
 * Place a window in the wall nearest a point the reviewer clicked.
 *
 * WHY SNAPPING RATHER THAN FREE PLACEMENT. Neither source could position a
 * window: the render's pixels carry no usable signal, and the record's wall
 * array is model-produced, which put four of Jordan's six windows on no wall at
 * all. So the reviewer places them — and the one thing that must never happen
 * is a window floating beside a wall instead of in it.
 *
 * Snapping makes that unrepresentable. The window takes the wall's own line and
 * thickness, and is clipped to the wall's ends, so `windowsOnWall` passes by
 * construction rather than by luck. The reviewer only has to be roughly right.
 *
 * A window also cannot be longer than the wall holding it, and a wall shorter
 * than the window is not a wall a window goes in — both are refused rather than
 * fitted, because a 3ft window squeezed into a 2ft stub is an invention.
 *
 * @param {{x:number, z:number}} at  where the reviewer clicked, in feet
 * @param {Array} walls  traced wall rects
 * @param {number} widthFt  how wide a window to place
 * @param {number} [reach]  how far a click may be from a wall and still count
 * @returns {Object|null} a window rect, or null if no wall is close enough
 */
export function snapWindowToWall(at, walls, widthFt = 3, reach = 4) {
  let best = null, bestD = Infinity;
  for (const r of walls) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    // Distance from the click to this rect, zero if inside it.
    const dx = Math.max(r.x0 - at.x, 0, at.x - r.x1);
    const dz = Math.max(r.z0 - at.z, 0, at.z - r.z1);
    const dist = Math.hypot(dx, dz);
    if (dist > reach || dist >= bestD) continue;
    // A window runs ALONG the wall, so the long side decides its direction.
    const horizontal = w >= d;
    const run = horizontal ? w : d;
    if (run < widthFt) continue;   // too short to hold this window
    best = { r, horizontal, run }; bestD = dist;
  }
  if (!best) return null;

  const { r, horizontal } = best;
  const half = widthFt / 2;
  if (horizontal) {
    // Centre on the click, then slide inside the wall's ends rather than
    // letting it hang off — a clipped window would be shorter than asked for.
    const c = Math.min(Math.max(at.x, r.x0 + half), r.x1 - half);
    return { x0: c - half, x1: c + half, z0: r.z0, z1: r.z1, horizontal: true };
  }
  const c = Math.min(Math.max(at.z, r.z0 + half), r.z1 - half);
  return { z0: c - half, z1: c + half, x0: r.x0, x1: r.x1, horizontal: false };
}

/**
 * Split one wall run into the solid pieces left between its openings.
 *
 * Returning the pieces rather than drawing them is what makes this testable,
 * and lets the caller decide how each is built.
 *
 * @param {{a:number, b:number, open?:Array}} wall
 * @param {number} [sectionH]
 * @returns {{s:number, e:number, y0:number, y1:number}[]} along-run extents and
 *   the vertical band each piece occupies
 */
export function wallPieces(wall, sectionH = SECTION_H) {
  const out = [];
  // Sorted here rather than trusted: a model may list openings in any order,
  // and walking them unsorted produces overlapping and negative-length pieces.
  const opens = [...(wall.open || [])].sort((a, b) => a.c - b.c);
  let cursor = wall.a;
  const full = (s, e) => { if (e - s > 0.01) out.push({ s, e, y0: 0, y1: sectionH }); };

  for (const o of opens) {
    const s = o.c - o.w / 2, e = o.c + o.w / 2;
    full(cursor, s);
    if (o.k === 'win') {
      if (SILL > 0) out.push({ s, e, y0: 0, y1: SILL });
      if (HEAD < sectionH) out.push({ s, e, y0: HEAD, y1: sectionH });
    } else if (o.k === 'garage') {
      if (GARAGE_H < sectionH) out.push({ s, e, y0: GARAGE_H, y1: sectionH });
    } else if (DOOR_H < sectionH) {
      out.push({ s, e, y0: DOOR_H, y1: sectionH });
    }
    cursor = Math.max(cursor, e);
  }
  full(cursor, wall.b);
  return out;
}

/** The footprint the geometry occupies — used to place normalized label anchors
 *  and to aim the camera. */
export function extentOf(rooms) {
  return {
    x0: Math.min(...rooms.map((r) => r.x0)),
    z0: Math.min(...rooms.map((r) => r.z0)),
    x1: Math.max(...rooms.map((r) => r.x1)),
    z1: Math.max(...rooms.map((r) => r.z1)),
  };
}

/**
 * Where the camera should look and how far back it needs to be to hold the
 * whole floor.
 *
 * The ASPECT matters and leaving it out is why a first version clipped the
 * corner of Jordan's garage on a portrait window: a camera's field of view is
 * quoted vertically, and on a tall narrow viewport the horizontal angle is much
 * smaller. Framing to the vertical angle alone puts the building's width off
 * the sides of the screen.
 *
 * The reach used is the DIAGONAL, because the floor is seen at an angle and its
 * widest apparent dimension is neither side on its own.
 *
 * @param {number} aspect  viewport width / height
 */
export function framing(extent, fovDeg = 40, aspect = 1) {
  const w = extent.x1 - extent.x0, d = extent.z1 - extent.z0;
  const target = { x: (extent.x0 + extent.x1) / 2, y: 0, z: (extent.z0 + extent.z1) / 2 };
  const reach = Math.hypot(w, d) / 2;
  const vHalf = (fovDeg / 2) * Math.PI / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.05));
  // Whichever angle is tighter decides how far back to stand.
  const dist = reach / Math.min(Math.tan(vHalf), Math.tan(hHalf)) * 1.2;
  return { target, distance: dist, w, d };
}

/**
 * Fit a perspective camera to a box, so nothing falls off the edge.
 *
 * `framing()` above works from the FLOOR's diagonal with the target pinned at
 * y = 0. That is why the model kept overflowing the bottom of the viewport: the
 * walls stand 5ft above that plane and the plate sits below it, so the shape
 * the camera actually has to hold is taller than the rectangle it was measuring
 * — and on a portrait viewport the difference is most of a wall.
 *
 * Fitting a SPHERE around the whole box removes the problem instead of tuning
 * around it. A sphere has no orientation, so the same distance works from any
 * camera angle and the fit cannot break when the user orbits.
 *
 * @param {{min:{x,y,z}, max:{x,y,z}}} box  world-space bounds of everything drawn
 * @param {number} fovDeg  the camera's VERTICAL field of view
 * @param {number} aspect  viewport width / height
 * @param {number} margin  1 = touching the edges; 1.15 leaves a comfortable band
 * @returns {{target:{x,y,z}, distance:number, radius:number}}
 */
export function fitToBox(box, fovDeg = 40, aspect = 1, margin = 1.15) {
  const target = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const radius = Math.hypot(
    box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z,
  ) / 2;
  const vHalf = (fovDeg / 2) * Math.PI / 180;
  // The horizontal half-angle is the tighter one on a portrait viewport, and
  // that is exactly the case the old code got wrong.
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.05));
  const distance = (radius * margin) / Math.sin(Math.min(vHalf, hHalf));
  return { target, distance, radius };
}

/**
 * How wide the model treats a building as being, in feet.
 *
 * One number cannot be read off a drawing: a plan carries no scale bar. This is
 * a single scalar, so it scales the model uniformly and cannot distort it — it
 * sets only the proportion of wall height to footprint. It is never shown and
 * never claimed as a measurement; every printed dimension comes from the
 * confirmed record instead.
 *
 * IT LIVES HERE BECAUSE TWO MACHINES HAVE TO AGREE ON IT. The 3D page traces a
 * render with it, and since a published floor now carries a reading traced on
 * the BUILDER's machine, the publisher has to use the same number or the
 * visitor's model would be a different size than the builder's. A constant
 * declared in one page and retyped in another is exactly how those two drift.
 */
export const DEFAULT_WIDTH_FT = 40;
