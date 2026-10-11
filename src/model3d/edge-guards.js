// GUARDS ROUND A DECK: every open edge of an outdoor floor a stair shows is
// high above the ground.
//
// Saman, 2026-09-30, on The Sky's covered deck: the stair's side along the
// deck had its railing and the rest of the same edge did not -- was it meant
// to have one at all? The standard says yes: IRC R312.1.1 wants a guard on
// every open side of a walking surface more than 30in above the grade below,
// and a deck that fifteen steps go down from is some nine feet up. The plan
// agrees: it draws the deck's edge all round with the same two-and-three
// line symbol, the posts standing in it.
//
// WHY NOT READ THE SYMBOL ALONE. Reading "two lines or more on an outdoor
// edge" as a guard was built first and measured on the corpus: besides The
// Sky it railed a garage door (apt413201, its two lines in the wall's gap),
// the edges of two paved areas the styling had drawn beside Jordan 4 that
// its source does not have, and it read Geena's deck edge as two lines in
// light and one in dark. A drawn edge says where a floor ends, not how high
// it is. What says how high is the stair: the reviewer confirmed it, the
// reader counted its risers, and five risers is more than 30in.
//
// SO: an outdoor floor is where the sheet is a SURFACE (extrude.js's
// occluder) and the flood from the border reaches it (outsideOf, every
// opening sealed). The floor a confirmed exterior stair of five risers or
// more leaves at its top is flooded from that end; its edges with anything
// that is not floor, straight and two feet or longer, carry a guard -- except
// the house's side (within a wall's reach of a wall or an opening) and the
// stair's own top, which is the way down. Where the drawing puts its lines on
// an edge the guard stands on them (stairs.js sideLine); elsewhere just inside
// the edge.
//
// Read on the render at view time, like the stairs and the posts, so a
// visitor's page finds the same guards.

import { outsideOf, sideLine, frameOf } from './stairs.js';
import { inkMaskOf, lineLevels } from './window-read.js';

/** The grid the edges are found on, feet. */
const CELL_FT = 0.25;
/** An edge shorter than this is a corner's jog or a post, not a deck's side. */
const MIN_RUN_FT = 2;
/** How far from a wall or an opening an edge is the house's side, feet. */
const HOUSE_REACH_FT = 0.75;
/** Risers that put a floor more than 30in above the ground (at 7in, 35in; R312.1.1). */
export const DECK_GUARD_RISERS = 5;
/** A guard's band where the drawing gives none, feet. */
const BAND_FT = 0.33;

/**
 * The guards round the outdoor floors a stair shows are high.
 *
 * @param {HTMLImageElement} img the render
 * @param {object} ex the extrusion, with its floor (`floor.occluder`, `floorRect`)
 * @param {{stairs?:object, openings?:Array, exclude?:Array, ink?:object, trace?:Function}} [o]
 *   `stairs`: readStairs' reading; `openings`: every opening and gap between
 *   the walls in model feet (the flood's seals); `exclude`: guards already
 *   read (a stair's sides), not built twice; `ink`: inkMaskOf's record if
 *   the caller has one
 * @returns {Array<{x0,x1,z0,z1,out:number[]}>} in model feet; `out` points off the deck
 */
export function edgeGuards(img, ex, o = {}) {
  const occ = ex?.floor?.occluder, fr = ex?.floorRect;
  if (!ex?.extent || !ex.trim || !occ || !fr) return [];
  const high = (o.stairs?.stairs || []).filter((s) => s.pieces && s.exterior && s.sink && s.n >= DECK_GUARD_RISERS
    && s.pieces.some((p) => p.f));
  if (!high.length) return [];
  const outside = outsideOf(ex, o.openings || []);
  if (!outside) return [];
  const od = occ.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, occ.width, occ.height).data;
  const surface = (x, z) => {
    const u = Math.floor(((x - fr.x0) / (fr.x1 - fr.x0)) * occ.width), v = Math.floor(((z - fr.z0) / (fr.z1 - fr.z0)) * occ.height);
    return u >= 0 && v >= 0 && u < occ.width && v < occ.height && od[(v * occ.width + u) * 4] >= 128;
  };
  // THE OUTDOOR FLOOR, on a grid over the whole drawing's ground (floorRect:
  // the deck and the porch too -- the walls' extent stops at the house).
  const gx0 = Math.min(fr.x0, fr.x1), gz0 = Math.min(fr.z0, fr.z1);
  const W = Math.ceil(Math.abs(fr.x1 - fr.x0) / CELL_FT), H = Math.ceil(Math.abs(fr.z1 - fr.z0) / CELL_FT);
  if (W * H > 4e6) return [];
  const deck = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    deck[j * W + i] = outside(gx0 + (i + 0.5) * CELL_FT, gz0 + (j + 0.5) * CELL_FT) && surface(gx0 + (i + 0.5) * CELL_FT, gz0 + (j + 0.5) * CELL_FT) ? 1 : 0;
  }
  // NOT FLOOR: a stair's own footprint (its tread lines are drawn ink, and
  // ink is surface to the occluder), and anything a line wide. A floor is
  // wider than two cells; opened by one (eroded, then grown back), the lines
  // that joined The Sky's deck to its stair's treads let go of it.
  for (const s of o.stairs?.stairs || []) {
    for (const p of s.pieces || []) {
      const r = p.f || p.landing;
      if (!r) continue;
      for (let j = Math.max(0, Math.floor((r.z0 - gz0) / CELL_FT)); j <= Math.min(H - 1, Math.floor((r.z1 - gz0) / CELL_FT)); j++)
        for (let i = Math.max(0, Math.floor((r.x0 - gx0) / CELL_FT)); i <= Math.min(W - 1, Math.floor((r.x1 - gx0) / CELL_FT)); i++) deck[j * W + i] = 0;
    }
  }
  const morph = (src, grow) => {
    const dst = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = grow ? 0 : 1;
      for (let dj = -1; dj <= 1 && (grow ? !v : v); dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        const s = ii >= 0 && jj >= 0 && ii < W && jj < H ? src[jj * W + ii] : 0;
        if (grow ? s : !s) { v = grow ? 1 : 0; break; }
      }
      dst[j * W + i] = v;
    }
    return dst;
  };
  const opened = morph(morph(deck, false), true);
  for (let k = 0; k < W * H; k++) deck[k] = deck[k] && opened[k] ? 1 : 0;
  const cellOf = (x, z) => {
    const i = Math.floor((x - gx0) / CELL_FT), j = Math.floor((z - gz0) / CELL_FT);
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  // THE HIGH FLOORS: flooded from the top of each such stair. A DN stair's
  // top is where travel starts; an exterior UP stair (from the yard) ends
  // there. The top edge itself is the way down and stays open.
  const hi = new Uint8Array(W * H);
  const ways = [];
  for (const s of high) {
    const fl = s.pieces.filter((p) => p.f);
    const p = s.down ? fl[0] : fl[fl.length - 1];
    const f = p.f, alongZ = f.horizontal;
    const toward = s.down ? -p.sign : p.sign;          // from the stair onto the floor
    const end = alongZ ? (toward < 0 ? f.z0 : f.z1) : (toward < 0 ? f.x0 : f.x1);
    const w0 = alongZ ? f.x0 : f.z0, w1 = alongZ ? f.x1 : f.z1, mid = (w0 + w1) / 2;
    ways.push({ alongZ, end, w0, w1 });
    let seed = -1;
    for (let d = CELL_FT / 2; d <= 2 && seed < 0; d += CELL_FT) {
      const a = end + toward * d;
      const k = alongZ ? cellOf(mid, a) : cellOf(a, mid);
      if (k >= 0 && deck[k]) seed = k;
    }
    if (seed < 0 || hi[seed]) continue;
    const stack = [seed];
    hi[seed] = 1;
    while (stack.length) {
      const k = stack.pop(), i = k % W, j = (k - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const q = jj * W + ii;
        if (deck[q] && !hi[q]) { hi[q] = 1; stack.push(q); }
      }
    }
  }
  // The house's side: near a wall or an opening.
  const houseRects = (ex.walls || []).concat(o.openings || []);
  const nearHouse = (x, z) => houseRects.some((r) => x > Math.min(r.x0, r.x1) - HOUSE_REACH_FT && x < Math.max(r.x0, r.x1) + HOUSE_REACH_FT
    && z > Math.min(r.z0, r.z1) - HOUSE_REACH_FT && z < Math.max(r.z0, r.z1) + HOUSE_REACH_FT);
  // The way down: across a stair's top, within a tread of it.
  const wayDown = (x, z, horizontalEdge) => ways.some((w) => {
    if (horizontalEdge !== w.alongZ) return false;       // the top edge runs across travel
    const a = w.alongZ ? z : x, c = w.alongZ ? x : z;
    return Math.abs(a - w.end) <= 1 && c >= w.w0 - 0.3 && c <= w.w1 + 0.3;
  });
  // THE EDGES: a high floor's cell beside one that is not floor, in straight
  // runs along x (at a z between two rows) and along z; a cell or two
  // missing is bridged (a post's box, a hatch line at the boundary).
  // Pieces from a foot up are kept here and joined below; the two-foot
  // floor is the joined line's (a post or a gap in the hatch breaks an edge
  // into pieces shorter than that).
  const runs = [];
  const minCells = Math.round(1 / CELL_FT);
  const scan = (horizontal) => {
    const A = horizontal ? W : H, B = horizontal ? H : W;
    const at = (arr, a, b) => (horizontal ? arr[b * W + a] : arr[a * W + b]);
    for (let b = 0; b + 1 < B; b++) {
      // +1: the floor on the low side (b), not floor beyond (b+1); -1 the other way
      for (const out of [1, -1]) {
        let s = -1, miss = 0;
        const flush = (end) => {
          if (s >= 0 && end - s + 1 >= minCells) runs.push({ horizontal, b, out, a0: s, a1: end });
          s = -1; miss = 0;
        };
        for (let a = 0; a <= A; a++) {
          let edge = false;
          if (a < A) {
            edge = out > 0 ? at(hi, a, b) && !at(deck, a, b + 1) : at(hi, a, b + 1) && !at(deck, a, b);
            if (edge) {
              const x = horizontal ? gx0 + (a + 0.5) * CELL_FT : gx0 + (b + 1) * CELL_FT;
              const z = horizontal ? gz0 + (b + 1) * CELL_FT : gz0 + (a + 0.5) * CELL_FT;
              if (nearHouse(x, z) || wayDown(x, z, horizontal)) edge = false;
            }
          }
          if (edge) { if (s < 0) s = a; miss = 0; }
          else if (s >= 0) { if (++miss > 2 || a === A) flush(a - miss); }
        }
      }
    }
  };
  scan(true);
  scan(false);
  // WHERE THE GUARD STANDS ACROSS: on the drawing's lines when it draws two
  // or more there (sideLine, with the drawing's own levels -- window-read.js),
  // else a band just inside the edge.
  const F = frameOf(img, ex);
  const m = o.ink || inkMaskOf(img);
  const { floor, line } = lineLevels(m.ink, m.pos, m.w, m.h);
  const lv = { thr: (floor + line) / 2, invert: !m.inverted };
  const found = [];
  for (const r of runs) {
    const vert = !r.horizontal;                       // a run along z is a vertical side
    const at = (vert ? gx0 : gz0) + (r.b + 1) * CELL_FT;
    const g0 = (vert ? gz0 : gx0) + r.a0 * CELL_FT, g1 = (vert ? gz0 : gx0) + (r.a1 + 1) * CELL_FT;
    const drawn = sideLine(img, F, { vert, at, s0: g0, s1: g1 }, lv);
    o.trace?.({ vert, at: +at.toFixed(2), s0: +g0.toFixed(2), s1: +g1.toFixed(2), out: r.out, drawn });
    found.push(drawn
      ? { vert, c: drawn.c, t: Math.max(0.25, drawn.t), a0: g0, a1: g1, out: r.out }
      : { vert, c: at - (r.out * BAND_FT) / 2, t: BAND_FT, a0: g0, a1: g1, out: r.out });
  }
  // ONE LINE, ONE GUARD: a post's box breaks an edge in two, and pieces that
  // sit together across and meet or overlap along are one.
  const lines = [];
  for (const f of found.sort((p, q) => p.a0 - q.a0)) {
    const l = lines.find((q) => q.vert === f.vert && Math.abs(q.c - f.c) < 0.3 && f.a0 <= q.a1 + 1);
    if (l) { l.a1 = Math.max(l.a1, f.a1); l.t = Math.max(l.t, f.t); }
    else lines.push({ ...f });
  }
  // WHAT A STAIR'S SIDE ALREADY STANDS ON IS NOT BUILT AGAIN, and only that
  // stretch: the deck's edge runs on past the stair's foot.
  const pieces = [];
  for (const l of lines) {
    let spans = [[l.a0, l.a1]];
    for (const q of o.exclude || []) {
      const qv = q.x1 - q.x0 < q.z1 - q.z0;
      if (qv !== l.vert) continue;
      const qc = qv ? (q.x0 + q.x1) / 2 : (q.z0 + q.z1) / 2;
      if (Math.abs(qc - l.c) >= 0.6) continue;
      const q0 = qv ? q.z0 : q.x0, q1 = qv ? q.z1 : q.x1;
      spans = spans.flatMap(([a, b]) => (q1 <= a || q0 >= b ? [[a, b]] : [[a, q0], [q1, b]].filter(([u, v]) => v - u > 0)));
    }
    for (const [a, b] of spans) if (b - a >= MIN_RUN_FT) pieces.push({ ...l, a0: a, a1: b });
  }
  const out = pieces.map((l) => (l.vert
    ? { x0: l.c - l.t / 2, x1: l.c + l.t / 2, z0: l.a0, z1: l.a1, out: [l.out, 0] }
    : { x0: l.a0, x1: l.a1, z0: l.c - l.t / 2, z1: l.c + l.t / 2, out: [0, l.out] }));
  // A GUARD MEETS THE STAIR'S RAIL IT CONTINUES: where the deck's edge and a
  // stair's side run on in one line, the strip between the top tread and the
  // deck (The Sky's, 0.7ft) is not floor to either reading, and the two
  // stopped short of each other at the top of the stair.
  for (const g of out) {
    const vert = g.x1 - g.x0 < g.z1 - g.z0;
    const c = vert ? (g.x0 + g.x1) / 2 : (g.z0 + g.z1) / 2;
    const k0 = vert ? 'z0' : 'x0', k1 = vert ? 'z1' : 'x1';
    for (const q of o.exclude || []) {
      const qv = q.x1 - q.x0 < q.z1 - q.z0;
      if (qv !== vert || Math.abs((qv ? (q.x0 + q.x1) / 2 : (q.z0 + q.z1) / 2) - c) >= 0.6) continue;
      if (q[k1] <= g[k0] && g[k0] - q[k1] <= 1) g[k0] = q[k1];
      if (q[k0] >= g[k1] && q[k0] - g[k1] <= 1) g[k1] = q[k0];
    }
  }
  // A GUARD RUNS TO THE HOUSE. Its last cells were left out as the house's
  // side; an end within that reach of a wall is carried to the nearest face.
  for (const g of out) {
    const vert = g.x1 - g.x0 < g.z1 - g.z0;
    const c = vert ? (g.x0 + g.x1) / 2 : (g.z0 + g.z1) / 2;
    const slack = HOUSE_REACH_FT / 2, reach = HOUSE_REACH_FT + CELL_FT;
    const k0 = vert ? 'z0' : 'x0', k1 = vert ? 'z1' : 'x1';
    let lo = null, hi2 = null;
    for (const w of ex.walls || []) {
      const across = vert ? w.x0 - slack <= c && w.x1 + slack >= c : w.z0 - slack <= c && w.z1 + slack >= c;
      if (!across) continue;
      if (w[k0] >= g[k1] && w[k0] - g[k1] <= reach && (hi2 === null || w[k0] < hi2)) hi2 = w[k0];
      if (w[k1] <= g[k0] && g[k0] - w[k1] <= reach && (lo === null || w[k1] > lo)) lo = w[k1];
    }
    if (hi2 !== null) g[k1] = hi2;
    if (lo !== null) g[k0] = lo;
  }
  return out;
}
