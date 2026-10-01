// A GUARD, BUILT: the parts of a North American residential railing, as plain
// boxes and bars in model feet, for the engine to stand up (no three.js here,
// like stairs.js). Where the parts are comes from rails.js, which reads where
// the plan draws a railing; this file only knows what one is.
//
// WHAT ONE IS (IRC R311.7.8, R312; docs/plan-symbols.md): a guard at least
// 36in above the floor, 34-38in above the nosings along a flight; balusters no
// more than a 4in sphere apart; a newel post at each end and turn; a cap rail
// on top. Modelled so: posts 3.5in square a little taller than the rail,
// balusters 1.2in square every 4.8in (a 3.6in gap), a 2.6in cap, a shoe along
// the floor. A wall is never replaced by one unless the plan draws the guard
// (rails.js); Saman, 2026-09-29: "a wall is always a wall, even around a stair".
//
// ALONG A RISING FLIGHT THE RAIL CLIMBS WITH IT. Beside an UP stair's treads
// the balusters stand at the tread beside them and the cap runs 3ft above the
// nosing line, at the flight's own pitch, level again over a landing; beside
// a DN stair's well, and anywhere else, the guard is level on the floor. It
// is NOT cut at the walls' 5ft section: cut there, a rail beside a flight
// that climbs to the cut was level at the cut all along (2026-09-29), and
// Saman asked for it to climb with the stair (2026-09-30).

export const RAIL = {
  height: 3.0,        // 36in to the top of the cap
  post: 0.29,         // 3.5in newel
  postOver: 0.25,     // a newel stands 3in above the cap
  baluster: 0.1,      // 1.2in
  pitch: 0.4,         // 4.8in centre to centre: a 3.6in gap
  capW: 0.22, capH: 0.14,
  shoeW: 0.22, shoeH: 0.1,
};

/**
 * The parts of every railing on a floor.
 *
 * @param {Array<{x0,x1,z0,z1,follow?:boolean}>} rails the railing bands in model
 *   feet (rails.js, stairs.js sideLine); `follow`: the rail of a flight going
 *   DOWN beside the yard, which follows its treads below the floor
 * @param {{treads?:Array<{x0,x1,z0,z1,y1,flight?:number,landing?:boolean,exterior?:boolean}>}} [o]
 *   `treads`: the floor's stair boxes that carry a tread (stairBoxes, tone
 *   'tread', no shape) -- a rail beside a flight above the floor climbs with
 *   it; below the floor only a `follow` rail goes with an exterior flight
 * @returns {{boxes:Array<{x0,y0,z0,x1,y1,z1,part}>, bars:Array<{from:number[], to:number[], w:number, h:number, part}>}}
 *   `boxes` axis-aligned (posts, balusters, a level shoe); `bars` the cap
 *   rail's pieces between consecutive balusters, level or sloped
 */
export function railingParts(rails, o = {}) {
  const all = o.treads || [];
  // The treads a run is set from: those above the floor, and for a rail that
  // follows a flight down, an exterior flight's below it. A DN stair's well
  // inside the house is edged by a LEVEL guard on the floor above it.
  const up = all.filter((b) => b.y1 > 1e-6);
  const treadsOf = (r) => (r.follow ? all.filter((b) => b.y1 > 1e-6 || b.exterior) : up);
  // Each band as a run: its centre line across, and its extent along.
  const runs = (rails || []).map((r) => {
    const horizontal = r.x1 - r.x0 >= r.z1 - r.z0;
    return horizontal
      ? { horizontal, c: (r.z0 + r.z1) / 2, t: r.z1 - r.z0, a0: r.x0, a1: r.x1, follow: Boolean(r.follow) }
      : { horizontal, c: (r.x0 + r.x1) / 2, t: r.x1 - r.x0, a0: r.z0, a1: r.z1, follow: Boolean(r.follow) };
  }).filter((r) => r.a1 - r.a0 > 0.5);
  // A TURN IS ONE CORNER. Two bands meeting at right angles each end on the
  // other's centre line, so the rails meet at one newel instead of stopping a
  // band's width apart.
  for (const r of runs) {
    for (const q of runs) {
      if (q === r || q.horizontal === r.horizontal) continue;
      const reach = Math.max(r.t, q.t) + 0.6;
      // q's run covers r's centre line, and one of r's ends is at q's centre line
      if (r.c < q.a0 - reach || r.c > q.a1 + reach) continue;
      if (Math.abs(r.a0 - q.c) <= reach) r.a0 = q.c;
      else if (Math.abs(r.a1 - q.c) <= reach) r.a1 = q.c;
    }
  }
  const boxes = [], bars = [];
  const at = (r, a) => (r.horizontal ? [a, r.c] : [r.c, a]);          // (x, z) of a point on the run
  // The floor under a point of a run: the top of a tread beside it (below
  // the floor for a rail that follows a flight down), else the floor, 0.
  const base = (r, a) => {
    let y = null;
    const [x, z] = at(r, a);
    for (const b of treadsOf(r)) {
      const along = r.horizontal ? x >= b.x0 && x <= b.x1 : z >= b.z0 && z <= b.z1;
      if (!along) continue;
      const gap = r.horizontal ? Math.max(b.z0 - z, 0, z - b.z1) : Math.max(b.x0 - x, 0, x - b.x1);
      if (gap <= r.t / 2 + 0.6) y = y === null ? b.y1 : Math.max(y, b.y1);
    }
    return y ?? 0;
  };
  // Kept only if it has a height: a box of none has its bottom face fight its
  // top, and the bottom draws black (Plan B, 2026-09-29).
  const box = (x, z, half, y0, y1, part) => {
    if (y1 - y0 > 0.02) boxes.push({ x0: x - half, x1: x + half, z0: z - half, z1: z + half, y0, y1, part });
  };
  // THE NOSING LINE OF EACH FLIGHT BESIDE A RUN, which a handrail is set 3ft
  // above (IRC R311.7.8.1: measured vertically from the nosings), so the rail
  // climbs at the flight's own pitch however the treads step under it
  // (Saman, 2026-09-30, a red line drawn along Plan B's flight). A nosing is
  // a tread's downhill edge; the line through them is fitted (least squares)
  // and holds from one tread below the first nosing -- where it meets the
  // level the flight starts from -- to the last nosing, past which the tread
  // it stands on is level again. Treads carry their flight (stairBoxes'
  // `flight`); a run beside only one tread of a flight is not beside the
  // flight but across its head, and stays level.
  function nosingLines(r) {
    const byFlight = new Map();
    for (const b of treadsOf(r)) {
      if (b.flight == null) continue;
      const bA0 = r.horizontal ? b.x0 : b.z0, bA1 = r.horizontal ? b.x1 : b.z1;
      if (Math.min(r.a1, bA1) - Math.max(r.a0, bA0) < 0.05) continue;
      const bC0 = r.horizontal ? b.z0 : b.x0, bC1 = r.horizontal ? b.z1 : b.x1;
      if (Math.max(bC0 - r.c, 0, r.c - bC1) > r.t / 2 + 0.6) continue;
      if (!byFlight.has(b.flight)) byFlight.set(b.flight, []);
      byFlight.get(b.flight).push({ a0: bA0, a1: bA1, y: b.y1 });
    }
    const out = [];
    for (const steps of byFlight.values()) {
      if (steps.length < 2) continue;
      steps.sort((p, q) => p.a0 - q.a0);
      const up = steps[steps.length - 1].y > steps[0].y ? 1 : -1;       // uphill toward +a or -a
      if (steps.some((s, k) => k && (s.y - steps[k - 1].y) * up <= 0)) continue;
      const noses = steps.map((s) => [up > 0 ? s.a0 : s.a1, s.y]);
      let sa = 0, sy = 0, saa = 0, say = 0;
      for (const [a, y] of noses) { sa += a; sy += y; saa += a * a; say += a * y; }
      const m = noses.length, den = m * saa - sa * sa;
      if (!den) continue;
      const slope = (m * say - sa * sy) / den, icpt = (sy - slope * sa) / m;
      const depth = steps.reduce((d, s) => d + s.a1 - s.a0, 0) / m;
      const low = up > 0 ? noses[0][0] - depth : noses[m - 1][0] + depth;   // one tread below the first nosing
      const high = up > 0 ? noses[m - 1][0] : noses[0][0];                 // the last nosing
      out.push({ lo: Math.min(low, high), hi: Math.max(low, high), at: (a) => slope * a + icpt });
    }
    return out;
  }
  const posts = [];
  for (const r of runs) {
    // Points along the run: a newel at each end, balusters between.
    const len = r.a1 - r.a0;
    const n = Math.max(1, Math.round(len / RAIL.pitch));
    const pts = [];
    for (let k = 0; k <= n; k++) pts.push(r.a0 + (len * k) / n);
    // THE CAP'S HEIGHT: 3ft over the floor beside it. Beside a flight the
    // floor steps with each tread and a handrail does not: over each stretch
    // above the floor the cap follows the straight line through the treads
    // (least squares), which is the nosing line a handrail is set from.
    const floor = pts.map((a) => base(r, a));
    const slopes = nosingLines(r);
    const guide = (a, y) => slopes.reduce((m, f) => (a >= f.lo - 1e-9 && a <= f.hi + 1e-9 ? Math.max(m, f.at(a)) : m), y);
    const top = pts.map((a, k) => RAIL.height + guide(a, floor[k]));
    // a point on the shoe: at floor level with a neighbour there too (below)
    const shod = (k) => floor[k] === 0 && (floor[k - 1] === 0 || floor[k + 1] === 0);
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = at(r, pts[k]);
      if (k === 0 || k === pts.length - 1) {
        if (!posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < RAIL.post)) {
          posts.push([x, z]);
          box(x, z, RAIL.post / 2, floor[k], top[k] + RAIL.postOver, 'post');
        }
      } else {
        box(x, z, RAIL.baluster / 2, floor[k] + (shod(k) ? RAIL.shoeH : 0), top[k] - RAIL.capH, 'baluster');
      }
    }
    // A NEWEL WHERE THE RAIL TURNS FROM LEVEL TO SLOPE, at the foot of each
    // flight and the head of it, as the drafter's sections draw one (the
    // U-shaped and dog-legged blocks in Guidelines/Staircases). Not within a
    // newel's width or so of one already standing.
    for (const f of slopes) {
      for (const a of [f.lo, f.hi]) {
        if (a <= r.a0 || a >= r.a1) continue;
        const [x, z] = at(r, a);
        if (posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 2 * RAIL.post)) continue;
        posts.push([x, z]);
        const y = base(r, a);
        box(x, z, RAIL.post / 2, y, RAIL.height + guide(a, y) + RAIL.postOver, 'post');
      }
    }
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, z0] = at(r, pts[k]), [x1, z1] = at(r, pts[k + 1]);
      bars.push({ from: [x0, top[k] - RAIL.capH / 2, z0], to: [x1, top[k + 1] - RAIL.capH / 2, z1], w: RAIL.capW, h: RAIL.capH, part: 'cap' });
    }
    // THE STRINGER UNDER A CLIMBING RAIL. The flight is solid to the floor and
    // the guard stands on its edge; the band the plan draws the guard in lies
    // beside the treads, not on them. Without the stair's side carried across
    // that band, the balusters stood on air and the band was a slot down to
    // the floor (Plan B's main floor, 2026-09-29). One block per tread beside
    // the run, stepped as the treads step. (Below the floor there is no
    // stringer: steps cut into a deck have nothing under them.)
    for (const b of up) {
      const bA0 = r.horizontal ? b.x0 : b.z0, bA1 = r.horizontal ? b.x1 : b.z1;
      const bC0 = r.horizontal ? b.z0 : b.x0, bC1 = r.horizontal ? b.z1 : b.x1;
      const s0 = Math.max(r.a0, bA0), s1 = Math.min(r.a1, bA1);
      if (s1 - s0 < 0.05) continue;
      const lo = r.c - r.t / 2, hi = r.c + r.t / 2;
      const gap = Math.max(bC0 - r.c, 0, r.c - bC1);
      if (gap > r.t / 2 + 0.6) continue;
      // across: the band, and on to the tread's near face if a sliver lies between
      const c0 = Math.min(lo, bC1 < r.c ? bC1 : lo), c1 = Math.max(hi, bC0 > r.c ? bC0 : hi);
      const y1 = b.y1;
      boxes.push(r.horizontal
        ? { x0: s0, x1: s1, z0: c0, z1: c1, y0: 0, y1, part: 'stringer' }
        : { x0: c0, x1: c1, z0: s0, z1: s1, y0: 0, y1, part: 'stringer' });
    }
    // The shoe wherever the guard stands on the floor itself: each stretch of
    // points at floor level (a rail that runs past a flight's foot has one).
    const hw = RAIL.shoeW / 2;
    for (let s = 0; s < floor.length;) {
      if (floor[s] !== 0) { s++; continue; }
      let e = s;
      while (e + 1 < floor.length && floor[e + 1] === 0) e++;
      if (e > s) {
        const a0 = pts[s], a1 = pts[e];
        boxes.push(r.horizontal
          ? { x0: a0, x1: a1, z0: r.c - hw, z1: r.c + hw, y0: 0, y1: RAIL.shoeH, part: 'shoe' }
          : { x0: r.c - hw, x1: r.c + hw, z0: a0, z1: a1, y0: 0, y1: RAIL.shoeH, part: 'shoe' });
      }
      s = e + 1;
    }
  }
  return { boxes, bars };
}
