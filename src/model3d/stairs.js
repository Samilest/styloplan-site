// STAIRS, READ OFF THE RENDER AND STOOD UP IN THE 3D.
//
// Three things live here, and the app, the probes and the corpus gate all run
// THESE (one notion of stair, as one-notion-of-wall): the flight reader
// (`flightsIn`), the grouping of flights into staircases by the blank landing
// that joins them (`groupFlights`), and the reading of a floor's confirmed
// stairs into pieces in travel order (`readStairs`) with the boxes the engine
// builds them from (`stairBoxes`) and the wells it cuts from the floor
// (`cutWells`). No three.js here: engine.js is the only file that imports it,
// and this module hands it plain boxes.
//
// THE RECORD DECIDES, THE RENDER MEASURES. Whether a stair exists, which way
// it goes (UP/DN) and where travel starts come from Review's confirmed record;
// where its treads are, how many, and how its flights join come from the
// render's ink around that marker. Nothing is invented: a marker with no
// flight read near it or a direction the reviewer did not confirm leaves
// the stair flat -- and one such stair leaves the WHOLE FLOOR flat, because
// a floor with one stair standing and another flat shows a defect where a
// flat floor shows what it showed yesterday. An exterior stair (a deck's
// steps) descends as treads alone, with no well: the model has no ground
// below the sheet for a well to reach.
//
// History: a first attempt (2026-09-03) matched one stair in three on Jordan
// and was removed. Its reader lost flights broken up by landings and rails
// and its marker matched on distance to the flight's centre. The reader
// since reads the thin part of a wall-touching tread, keeps the longest row
// of a tread's ink, and thresholds between the floor and the ink instead of
// the window's mean (three defects found by test/stair-window-probe.html,
// 2026-09-21); the marker matches on distance to the FOOTPRINT. Measured:
// every confirmed stair on The Sky (an L of 7+6), Jordan (4, 12, 8) and the
// two-flight drafter's blocks in Guidelines/Staircases reads and joins as
// drawn. docs/plan-symbols.md, thirteenth reading, has the measurements.

/**
 * Every flight of stairs in a render.
 *
 * A TREAD IS A THIN LONG LINE. A wall is a thick long line, a fixture outline
 * is short or closed, and hatching is thin but runs the wrong length. Thinness
 * is checked at five points along the run rather than at the middle, because a
 * flight has a centre line drawn down it and the midpoint lands on that — which
 * is what made the first version of this find nothing at all.
 *
 * @param {number} ftPerNative feet per pixel of the RENDER, not of the mask
 * @param {number|Object} minTreadsOrOpts the tread floor, or `{minTreads, region, invert, threshold, onLevels}`
 */
export function flightsIn(img, ftPerNative, minTreadsOrOpts = 5) {
  // AROUND THE MARKER, NOT THE WHOLE SHEET: `region` (render px) reads a
  // window with its own floor and ink levels and returns positions in the
  // whole picture's frame. `invert` reads a light look (dark treads on a pale
  // floor); 'auto' decides by the window's median. `threshold` overrides the
  // derived one (diagnostics).
  const opts = typeof minTreadsOrOpts === 'number' ? { minTreads: minTreadsOrOpts } : (minTreadsOrOpts || {});
  const minTreads = opts.minTreads ?? 5;
  const R = opts.region
    ? { x0: Math.max(0, Math.floor(opts.region.x0)), y0: Math.max(0, Math.floor(opts.region.y0)),
        x1: Math.min(img.naturalWidth, Math.ceil(opts.region.x1)), y1: Math.min(img.naturalHeight, Math.ceil(opts.region.y1)) }
    : { x0: 0, y0: 0, x1: img.naturalWidth, y1: img.naturalHeight };
  const N = R.x1 - R.x0, M = R.y1 - R.y0;
  if (N < 8 || M < 8) return [];
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = M;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, R.x0, R.y0, N, M, 0, 0, N, M);
  const d = g.getImageData(0, 0, N, M).data;
  const L = new Float32Array(N * M);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) L[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
  // The look by the MEDIAN, not the mean: a window's mean climbs with every
  // white wall in it and read The Sky's dark floor as a light look; the
  // median is the floor, which is most of any window.
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) hist[L[i] | 0]++;
  const pct = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= L.length * q) return v; } return 255; };
  const invert = opts.invert === 'auto' ? pct(0.5) > 128 : Boolean(opts.invert);
  if (invert) { for (let i = 0; i < L.length; i++) L[i] = 255 - L[i]; hist.reverse(); }
  const ftPx = 1 / ftPerNative;
  const MIN = 2.0 * ftPx, MAX = 6.5 * ftPx, THICK = 3;
  const at = (h, a, b) => ((a < 0 || b < 0 || a >= (h ? M : N) || b >= (h ? N : M))
    ? 0 : (h ? L[a * N + b] : L[b * N + a]));

  // THE THRESHOLD IS HALFWAY BETWEEN THE FLOOR AND THE INK. It was the
  // window's mean + 0.8 sigma, which is a statement about how much wall the
  // window holds, not about the lines: swept on three plans (2026-09-21) every
  // flight read at any fixed threshold from ~90 to ~130 and the statistic
  // wandered from 91 to 165 with the walls in view, losing Jordan's 12-tread
  // flight at 152. The floor is the window's median; the ink is the median of
  // the THIN bright pixels (brighter than halfway to the window's white, with
  // both sides at THICK px darker than that) -- walls are bright but thick.
  const floor = pct(0.5), white = pct(0.99), prov = (floor + white) / 2;
  const inkHist = new Uint32Array(256);
  let inkN = 0;
  for (let y = THICK; y < M - THICK; y++) for (let x = THICK; x < N - THICK; x++) {
    const v = L[y * N + x];
    if (v <= prov) continue;
    const thinY = L[(y - THICK) * N + x] <= prov && L[(y + THICK) * N + x] <= prov;
    const thinX = L[y * N + x - THICK] <= prov && L[y * N + x + THICK] <= prov;
    if (thinY || thinX) { inkHist[v | 0]++; inkN++; }
  }
  let ink = white;
  if (inkN) { let acc = 0; for (let v = 0; v < 256; v++) { acc += inkHist[v]; if (acc >= inkN / 2) { ink = v; break; } } }
  const thr = opts.threshold ?? (floor + ink) / 2;
  opts.onLevels?.({ floor, white, ink, thr, invert });

  const thinAt = (h, a, p) => at(h, a - THICK, p) <= thr && at(h, a + THICK, p) <= thr;
  const collect = (h) => {
    const A = h ? M : N, B = h ? N : M, raw = [];
    const keep = (a, s, b) => {
      // NO WALL INSIDE A TREAD. A tread drawn up to a wall is one run of ink
      // with the wall it meets, and the run was kept whole whenever it stayed
      // under MAX and three of its five thinness samples missed the wall --
      // wall and all. The flight's footprint is the union of its lines, so
      // ONE such tread carried the whole flight a wall's thickness into the
      // wall: The Star's porch steps stood 0.6ft under BEDROOM #2's wall and
      // its corner (Saman, 2026-09-23), Jordan's 4-tread flight 1.2ft into its
      // stair wall, The Sky's L 0.6ft through the wall at its foot, where the
      // light render's treads ran on across the wall into the door jambs
      // beyond. Trimming the ends was tried first and is not the rule: a
      // wall's anti-aliased edge row reads thin for one pixel, the trim
      // stopped there, and Jordan's 12-tread flight kept a 1.2ft wall. The
      // rule is the one this reader already uses for crossings: a thick
      // stretch no longer than 2 x THICK is a stringer or the arrow's shaft,
      // and anything longer is a wall, which a tread never contains. Such a
      // run fails whole, and the cut below keeps its thin pieces.
      for (let p = s, thick = 0; p < b; p++) {
        if (thinAt(h, a, p)) thick = 0;
        else if (++thick > 2 * THICK) return false;
      }
      const len = b - s;
      if (len < MIN || len > MAX) return false;
      let thin = 0;
      for (let k = 1; k <= 5; k++) if (thinAt(h, a, s + Math.round((len * k) / 6))) thin++;
      if (thin >= 3) raw.push({ a, b0: s, b1: b, len });
      return thin >= 3;
    };
    for (let a = THICK; a < A - THICK; a++) {
      let s = -1;
      for (let b = 0; b <= B; b++) {
        const on = b < B && at(h, a, b) > thr;
        if (on) { if (s < 0) s = b; } else if (s >= 0) {
          // A TREAD THAT TOUCHES A WALL is one run with the wall's edge row:
          // too long, or thick where the wall is. The thin part of such a run
          // is still the tread (The Sky's third tread of five, 2026-09-21),
          // so a run that fails whole is cut where its ink gets thick and
          // its thin pieces are tried on their own. CUT AT A WALL, NOT AT A
          // CROSSING LINE: a stringer or the arrow's shaft crossing the tread
          // is thick for the width of a line (The Sky's light render cut one
          // tread into four pieces at its stringers and its centre line, all
          // too short); a wall's edge is thick for a wall's length. A thick
          // stretch no longer than twice the thinness gauge is bridged.
          if (!keep(a, s, b)) {
            let t = -1, gap = 0;
            for (let p = s; p <= b; p++) {
              const thin = p < b && thinAt(h, a, p);
              if (thin) {
                if (t < 0) t = p;
                else if (gap > 2 * THICK) { keep(a, t, p - gap); t = p; }
                gap = 0;
              } else if (t >= 0) {
                gap++;
                if (p === b) keep(a, t, p - gap);
              }
            }
          }
          s = -1;
        }
      }
    }
    // Ink is two or three rows wide and its outer rows read as fragments at
    // the threshold: of overlapping rows within 2px, the LONGEST is the line.
    // (Keeping the first by position kept an 80px fragment over the 162px
    // tread beside it, and the flight then failed the length match.)
    const out = [];
    for (const l of raw.sort((p, q) => p.a - q.a || p.b0 - q.b0)) {
      const i = out.findIndex((o) => Math.abs(o.a - l.a) <= 2
        && Math.min(o.b1, l.b1) - Math.max(o.b0, l.b0) > Math.min(o.len, l.len) * 0.7);
      if (i < 0) out.push(l);
      else if (l.len > out[i].len) out[i] = l;
    }
    return out;
  };

  const flights = [];
  for (const h of [true, false]) {
    const lines = collect(h);
    opts.onLines?.(h, lines.map((l) => ({ ...l, a: l.a + (h ? R.y0 : R.x0), b0: l.b0 + (h ? R.x0 : R.y0), b1: l.b1 + (h ? R.x0 : R.y0) })));
    const used = new Set();
    // CHAINED BY OVERLAP, NOT BY LIST ORDER. Lines from elsewhere in the plan
    // interleave in a list sorted by position, and requiring adjacency in that
    // list breaks a flight at the first unrelated line that lands between two
    // of its treads — which is exactly what happened, and why the first working
    // version reported no flights on a plan with two.
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const grp = [i];
      for (;;) {
        const p = lines[grp[grp.length - 1]];
        let best = -1, bestGap = Infinity;
        for (let j = 0; j < lines.length; j++) {
          if (used.has(j) || grp.includes(j)) continue;
          const q = lines[j], gap = q.a - p.a;
          if (gap < 0.4 * ftPx || gap > 1.3 * ftPx) continue;
          if (Math.min(p.b1, q.b1) - Math.max(p.b0, q.b0) <= Math.min(p.len, q.len) * 0.7) continue;
          if (Math.abs(q.len - p.len) / Math.max(p.len, q.len) >= 0.35) continue;
          if (gap < bestGap) { bestGap = gap; best = j; }
        }
        if (best < 0) break;
        grp.push(best);
      }
      if (grp.length < minTreads) continue;
      grp.forEach((k) => used.add(k));
      const G = grp.map((k) => lines[k]);
      const gaps = [];
      for (let k = 1; k < G.length; k++) gaps.push(G[k].a - G[k - 1].a);
      const s2 = gaps.slice().sort((x, y) => x - y), med = s2[s2.length >> 1];
      const even = gaps.filter((v) => Math.abs(v - med) <= med * 0.3).length / gaps.length;
      if (even < 0.7) continue;
      // Back into the whole picture's frame: `a` is the axis across the
      // treads (y for horizontal treads), `b` along them.
      const oa = h ? R.y0 : R.x0, ob = h ? R.x0 : R.y0;
      flights.push({
        horizontal: h, treads: G.length, evenness: even,
        a0: G[0].a + oa, a1: G[G.length - 1].a + oa,
        b0: Math.min(...G.map((x) => x.b0)) + ob, b1: Math.max(...G.map((x) => x.b1)) + ob,
        treadIn: med * ftPerNative * 12,
        runFt: (G[G.length - 1].a - G[0].a) * ftPerNative,
        widthFt: (Math.max(...G.map((x) => x.b1)) - Math.min(...G.map((x) => x.b0))) * ftPerNative,
      });
    }
  }
  return flights;
}

/**
 * The fraction of THIN ink in a box of the picture: bright pixels with both
 * sides dark 3px away, in either axis -- a tread's ink, not a wall's. This is
 * the reader's own notion of ink, and what "a landing is blank" is measured
 * with. `thr` is the reader's threshold for the window (see `onLevels`).
 */
export function thinInkFraction(img, px0, py0, px1, py1, thr, axis) {
  const x0 = Math.max(0, Math.floor(px0)), y0 = Math.max(0, Math.floor(py0));
  const w = Math.min(img.naturalWidth, Math.ceil(px1)) - x0, h = Math.min(img.naturalHeight, Math.ceil(py1)) - y0;
  if (w < 8 || h < 8) return 1;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const Lm = new Float32Array(w * h);
  for (let k = 0, q = 0; k < d.length; k += 4, q++) Lm[q] = (d[k] + d[k + 1] + d[k + 2]) / 3;
  let on = 0;
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    const v = Lm[y * w + x];
    if (v <= thr) continue;
    // `axis` 'y': only lines that are thin top-to-bottom (horizontal lines);
    // 'x': thin side-to-side (vertical lines); unset: either; 'wall': the
    // opposite -- bright and thick both ways, a wall's ink.
    const thinY = Lm[(y - 3) * w + x] <= thr && Lm[(y + 3) * w + x] <= thr;
    const thinX = Lm[y * w + x - 3] <= thr && Lm[y * w + x + 3] <= thr;
    if (axis === 'wall' ? !(thinY || thinX) : axis === 'y' ? thinY : axis === 'x' ? thinX : (thinY || thinX)) on++;
  }
  return on / (w * h);
}

/**
 * Flights grouped into staircases.
 *
 * A STAIRCASE IS FLIGHTS JOINED BY A LANDING, and a landing is drawn as a
 * BLANK rectangle that touches the end of each flight (the thirteen blocks;
 * The Sky's L). Two joins are read: an L, where the flights are perpendicular
 * and the landing is the corner square between their ends; and a U, where
 * they run side by side and the landing lies a flight's width beyond their
 * common end. Everything else is a flight on its own. Two flights per stair
 * for now (a bifurcated stair's five come out as pairs and singles).
 *
 * Works in whatever frame `rect` returns (render px or model feet), so long
 * as `near` (how far a landing may sit from a flight's end) and `ink(rect,
 * axis)` (the thin-ink fraction of a rect in that frame, of lines thin
 * along `axis` -- see thinInkFraction) agree with it. A landing has no
 * TREAD-LIKE lines: its thin ink in the treads' orientation is at most a
 * QUARTER of the lesser of its flights' -- a flight is a line every tread,
 * a landing a stray mark -- measured against the flights, not a fixed
 * number, and on the rectangles' INTERIORS (inset by half of `near`), so
 * the wall a landing ends at is not counted against it.
 *
 * `pitch(f)` is a flight's tread run in the frame's units. A flight's LAST
 * LINE IS ONE TREAD SHORT OF ITS LANDING -- the nosing is drawn, the
 * landing's edge is the landing's -- so the landing may sit a tread's run
 * beyond the footprint, and the join's reach is that run (and a half, for
 * the ink's width) or `near`, whichever is more.
 *
 * @returns {Array<{flights:Array, join:null|'L'|'U', landing:Object|null, ends:Array|null}>}
 *   `landing` is the L's corner square; a U lists its candidate `ends`
 *   ({at:'lo'|'hi', r}) for the caller to pick by the marker's travel.
 */
export function groupFlights(flights, { rect, ink, near: NEAR, pitch, trace }) {
  let reach = NEAR;
  const near = (a, b) => Math.abs(a - b) <= reach;
  const reachFor = (A, B) => Math.max(NEAR, 1.5 * Math.max(pitch?.(A) || 0, pitch?.(B) || 0));
  const inset = (r) => { const m = NEAR / 2; return { x0: r.x0 + m, x1: r.x1 - m, z0: r.z0 + m, z1: r.z1 - m }; };
  // Treads of a north-south flight (horizontal treads) are lines thin along y.
  const treadAxis = (f) => (f.horizontal ? 'y' : 'x');
  const blankBetween = (r, A, B) => {
    const iR = Math.max(ink(inset(r), treadAxis(A)), ink(inset(r), treadAxis(B)));
    const iA = ink(inset(rect(A)), treadAxis(A)), iB = ink(inset(rect(B)), treadAxis(B));
    trace?.(`landing ink ${(iR * 100).toFixed(2)}% vs flights ${(iA * 100).toFixed(2)}% / ${(iB * 100).toFixed(2)}%`);
    return iR <= 0.25 * Math.min(iA, iB);
  };
  const joinL = (A, B) => {
    if (A.horizontal === B.horizontal) return null;
    reach = reachFor(A, B);
    const E = rect(A.horizontal ? B : A), Nf = rect(A.horizontal ? A : B);   // E runs east-west, Nf north-south
    const C = { x0: Nf.x0, x1: Nf.x1, z0: E.z0, z1: E.z1 };                   // the corner square
    const eSide = near(E.x1, C.x0) ? 'w' : near(E.x0, C.x1) ? 'e' : null;     // E lies west/east of C
    const nSide = near(Nf.z1, C.z0) ? 'n' : near(Nf.z0, C.z1) ? 's' : null;   // Nf lies north/south of C
    if (!eSide || !nSide || !blankBetween(C, A, B)) return null;
    // The landing keeps its own square -- the other flight's width is its
    // true edge; the flights are FITTED to it by the caller (fitToLanding),
    // each footprint stretched over its last tread's run to the edge.
    return { kind: 'L', landing: C };
  };
  const joinU = (A, B) => {
    if (A.horizontal !== B.horizontal) return null;
    reach = reachFor(A, B);
    const h = A.horizontal, a = rect(A), b = rect(B);
    const ac = h ? [a.x0, a.x1] : [a.z0, a.z1], bc = h ? [b.x0, b.x1] : [b.z0, b.z1];             // across
    const aAlong = h ? [a.z0, a.z1] : [a.x0, a.x1], bAlong = h ? [b.z0, b.z1] : [b.x0, b.x1];     // along
    const sideBySide = near(ac[1], bc[0]) || near(bc[1], ac[0]);
    const overlap = Math.min(aAlong[1], bAlong[1]) - Math.max(aAlong[0], bAlong[0]);
    trace?.(`U? ${A.treads}+${B.treads}: across ${ac.map((v) => v.toFixed(0))} | ${bc.map((v) => v.toFixed(0))} sideBySide ${sideBySide}; along ${aAlong.map((v) => v.toFixed(0))} | ${bAlong.map((v) => v.toFixed(0))} overlap ${overlap.toFixed(0)}`);
    if (!sideBySide || overlap < 0.5 * Math.min(aAlong[1] - aAlong[0], bAlong[1] - bAlong[0])) return null;
    // TWO FLIGHTS WITH A WALL BETWEEN THEM ARE TWO STAIRS, not a U: the UP
    // to the floor above beside the DN to the floor below, each in its own
    // well (Jordan's third stair). A U's flights share a landing and are
    // parted by a rail -- a line -- which every U block draws; a wall's ink
    // is thick. The strip between the flights, over their common run, is
    // read for wall ink once it is wider than a line.
    const lo0 = Math.min(ac[1], bc[1]), hi0 = Math.max(ac[0], bc[0]);   // the strip across
    const o0 = Math.max(aAlong[0], bAlong[0]), o1 = Math.min(aAlong[1], bAlong[1]);
    if (hi0 - lo0 > NEAR * 0.3) {
      const strip = h ? { x0: lo0, x1: hi0, z0: o0, z1: o1 } : { x0: o0, x1: o1, z0: lo0, z1: hi0 };
      const wall = ink(strip, 'wall');
      trace?.(`U? wall between: ${(wall * 100).toFixed(0)}%`);
      if (wall > 0.5) return null;
    }
    const width = (ac[1] - ac[0] + bc[1] - bc[0]) / 2;
    const lo = Math.min(ac[0], bc[0]), hi = Math.max(ac[1], bc[1]);
    // The landing begins at the flights' last line: the top of the last
    // riser is the landing's edge, and the blocks draw it as one line.
    const ends = [];
    if (near(aAlong[0], bAlong[0])) { const e0 = Math.min(aAlong[0], bAlong[0]); ends.push({ at: 'lo', r: h ? { x0: lo, x1: hi, z0: e0 - width, z1: e0 } : { x0: e0 - width, x1: e0, z0: lo, z1: hi } }); }
    if (near(aAlong[1], bAlong[1])) { const e1 = Math.max(aAlong[1], bAlong[1]); ends.push({ at: 'hi', r: h ? { x0: lo, x1: hi, z0: e1, z1: e1 + width } : { x0: e1, x1: e1 + width, z0: lo, z1: hi } }); }
    const open = ends.filter((x) => blankBetween(x.r, A, B));
    if (!open.length) return null;
    // Both ends blank: the marker decides (travel ends at the landing).
    return { kind: 'U', ends: open };
  };
  const groups = flights.map((f) => ({ flights: [f], landing: null, join: null, ends: null }));
  const groupOf = (f) => groups.find((g) => g.flights.includes(f));
  for (let i = 0; i < flights.length; i++) for (let j = i + 1; j < flights.length; j++) {
    const A = flights[i], B = flights[j];
    const ga = groupOf(A), gb = groupOf(B);
    if (ga === gb || ga.flights.length > 1 || gb.flights.length > 1) continue;
    const jn = joinL(A, B) || joinU(A, B);
    if (!jn) continue;
    ga.flights.push(B); ga.join = jn.kind; ga.landing = jn.landing || null; ga.ends = jn.ends || null;
    groups.splice(groups.indexOf(gb), 1);
  }
  return groups;
}

/** Model feet and render px, each from the other, from an extrusion's extent and trim. */
export function frameOf(img, ex) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const e = ex.extent, t = ex.trim;
  const tw = t.x1 - t.x0, th = t.y1 - t.y0;
  const unTrim = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : v);
  return {
    W, H,
    ftPerPx: (e.x1 - e.x0) / (tw * W),
    X: (px) => e.x0 + ((px / W - t.x0) / tw) * (e.x1 - e.x0),
    Z: (py) => e.z0 + ((py / H - t.y0) / th) * (e.z1 - e.z0),
    PX: (x) => ((x - e.x0) / (e.x1 - e.x0) * tw + t.x0) * W,
    PY: (z) => ((z - e.z0) / (e.z1 - e.z0) * th + t.y0) * H,
    // a confirmed x/y (fraction of the whole render) in model feet
    atFrac: (fx, fy) => ({ x: e.x0 + unTrim(fx, t.x0, t.x1) * (e.x1 - e.x0), z: e.z0 + unTrim(fy, t.y0, t.y1) * (e.z1 - e.z0) }),
  };
}

/** How far around a confirmed marker the render is read, feet each way. */
export const REACH_FT = 12;
/** How far a marker may sit from the footprint of the flight it names, feet. */
export const MARKER_REACH_FT = 8;
/** Lines that make a flight beside a confirmed marker; on the bare sheet. */
export const MIN_LINES_MARKED = 4;
export const MIN_LINES_SHEET = 5;
/** How far a landing may sit from a flight's end, feet. */
export const LANDING_NEAR_FT = 1.0;
/** A confirmed label this close names the space the stair is in, feet. */
const LABEL_REACH_FT = 12;
// The outdoor spaces a plan names (gridsnap's patio/terrace/deck guide, the
// fifteenth reading in docs/plan-symbols.md, plus the regional words it
// lists: verandah, lanai, stoop, alfresco). `\b` needs the spelling whole:
// "verandah" and "courtyard" did not match "veranda" and "yard".
const OUTDOORS = /\b(deck|sundeck|porch|patio|terrace|balcony|verandah?|lanai|stoop|garden|yard|courtyard|alfresco|pergola|loggia|portico|gazebo|carport)\b/i;

/**
 * WHAT IS OUTSIDE THE HOUSE, by flooding the sheet.
 *
 * The traced walls with EVERY opening between them sealed -- doors, windows,
 * cased openings, garage doors, the gaps the reader lists -- are a barrier;
 * the sheet flooded from its border reaches whatever the barrier does not
 * enclose: the yard, a deck, a porch between two wings. A room is not
 * reached. This is the same trick rooms.js uses to tell the sheet from the
 * rooms, on the model's own feet, so a visitor's page (which has the walls
 * and the openings from the record and no ink) can ask it too.
 *
 * Without the openings the flood walks in through the front door and calls
 * the whole house outside, so with none given the answer is `null`: not
 * known, and the caller falls back to the nearest label's name.
 *
 * @param {object} ex the extrusion (walls in feet, extent, wallFloorFt)
 * @param {Array<{x0,x1,z0,z1}>} openings in model feet, every kind
 * @returns {null|((x:number, z:number) => boolean)} true = outside the walls
 */
export function outsideOf(ex, openings) {
  if (!ex?.extent || !Array.isArray(ex.walls) || !ex.walls.length || !Array.isArray(openings) || !openings.length) return null;
  const e = ex.extent;
  const cell = Math.max(0.25, (ex.wallFloorFt || 0.5) / 2);
  const M = 3;                                           // cells of sheet around the building
  const x0 = e.x0 - M * cell, z0 = e.z0 - M * cell;
  const W = Math.ceil((e.x1 - e.x0) / cell) + 2 * M, H = Math.ceil((e.z1 - e.z0) / cell) + 2 * M;
  if (W * H > 4e6) return null;
  const barrier = new Uint8Array(W * H);
  const paint = (r) => {
    // half a cell each way, so two rectangles that touch also touch on the grid
    const ax = Math.max(0, Math.floor((Math.min(r.x0, r.x1) - x0) / cell - 0.5)), bx = Math.min(W - 1, Math.ceil((Math.max(r.x0, r.x1) - x0) / cell + 0.5));
    const az = Math.max(0, Math.floor((Math.min(r.z0, r.z1) - z0) / cell - 0.5)), bz = Math.min(H - 1, Math.ceil((Math.max(r.z0, r.z1) - z0) / cell + 0.5));
    for (let y = az; y <= bz; y++) for (let x = ax; x <= bx; x++) barrier[y * W + x] = 1;
  };
  for (const r of ex.walls) paint(r);
  for (const o of openings) if (typeof o?.x0 === 'number' && typeof o?.z0 === 'number') paint(o);
  const out = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => { const k = y * W + x; if (!barrier[k] && !out[k]) { out[k] = 1; stack.push(k); } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k - x) / W;
    if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
  }
  return (x, z) => {
    const gx = Math.round((x - x0) / cell), gz = Math.round((z - z0) / cell);
    if (gx < 0 || gz < 0 || gx >= W || gz >= H) return true;
    return out[gz * W + gx] === 1;
  };
}

/**
 * A floor's confirmed stairs, read off its render.
 *
 * @param {HTMLImageElement} img the styled render the model is built from
 * @param {Object} ex the extrusion (extent, trim)
 * @param {{openings?:Array, minTreads?:number, exteriorToo?:boolean}} [opts] `openings`: every
 *   opening between the walls in model feet, which is what lets the sheet be
 *   flooded to tell outside from inside (outsideOf); without them the nearest
 *   confirmed label's name decides
 * @param {{confirmedStairs?:Array, confirmedLabels?:Array, below?:boolean}} rec the confirmed
 *   record, positions as fractions of the render (mapped, see label-frame);
 *   `below` is the reviewer's answer to "is this floor below grade"
 *   (Review's specs card), which decides which way an exterior stair goes
 *   when the reviewer has not said
 * @returns {{stairs:Array, flat:boolean, flights:number, notes:string[]}}
 *   each stair: `{st, pieces, n, down, exterior, why}`; `pieces` in travel
 *   order, each `{f, sign}` (a flight; sign +1 when travel runs toward +axis)
 *   or `{landing}` (a rect in model feet); null pieces = left flat.
 *   `flat` when any confirmed interior stair is not read: the floor stays flat.
 */
export function readStairs(img, ex, rec, opts = {}) {
  const notes = [];
  const list = (rec?.confirmedStairs || []).filter((st) => st && (st.position || typeof st.x === 'number'));
  if (!list.length || !ex?.extent || !ex?.trim) return { stairs: [], flat: false, flights: 0, notes };
  const F = frameOf(img, ex);
  const { W, H, ftPerPx } = F;
  const pxPerFt = 1 / ftPerPx;
  const minTreads = opts.minTreads ?? MIN_LINES_MARKED;
  let levels = { thr: 128 };
  const posOf = (st) => ({ x: st.position?.x ?? st.x, y: st.position?.y ?? st.y });

  // ---- the flights, read around each marker (a window with its own levels)
  const inModel = (f) => ({
    ...f,
    x0: F.X(f.horizontal ? f.b0 : f.a0), x1: F.X(f.horizontal ? f.b1 : f.a1),
    z0: F.Z(f.horizontal ? f.a0 : f.b0), z1: F.Z(f.horizontal ? f.a1 : f.b1),
  });
  const flights = [];
  for (const st of list) {
    const p = posOf(st);
    const px = p.x * W, py = p.y * H, r = REACH_FT * pxPerFt;
    for (const f of flightsIn(img, ftPerPx, { minTreads, invert: 'auto', region: { x0: px - r, y0: py - r, x1: px + r, y1: py + r }, onLevels: (l) => { levels = l; } })) {
      const dup = flights.find((o) => o.horizontal === f.horizontal && Math.abs(o.a0 - f.a0) < 6 && Math.abs(o.b0 - f.b0) < 6);
      if (!dup) flights.push(inModel(f));
    }
  }

  // ---- grouped into staircases by their landings
  const rectOf = (f) => ({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
  const near = (a, b) => Math.abs(a - b) <= LANDING_NEAR_FT;
  const groups = groupFlights(flights, {
    rect: rectOf, near: LANDING_NEAR_FT, pitch: (f) => f.treadIn / 12,
    ink: (r, axis) => thinInkFraction(img, F.PX(r.x0), F.PY(r.z0), F.PX(r.x1), F.PY(r.z1), levels.thr, axis),
  });
  const groupOf = (f) => groups.find((g) => g.flights.includes(f));

  // ---- each confirmed stair to the flight it names, then its group in travel order
  const labelNear = (x, z) => {
    let best = null, bd = Infinity;
    for (const l of rec.confirmedLabels || []) {
      if (typeof l?.x !== 'number') continue;
      const m = F.atFrac(l.x, l.y);
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < bd) { bd = d; best = l; }
    }
    return bd <= LABEL_REACH_FT ? best : null;
  };
  const outside = outsideOf(ex, opts.openings);
  const stairs = [];
  const claimed = new Set();
  for (const st of list) {
    const p = posOf(st);
    const m = F.atFrac(p.x, p.y), mx = m.x, mz = m.z;
    // The space the marker sits in, by the nearest confirmed label: what the
    // page calls this stair when it has to say why it is flat.
    const by = labelNear(mx, mz);
    const near = by ? (by.name || by.text || '') : '';
    if (st.kind === 'spiral') { stairs.push({ st, pieces: null, near, unread: 'spiral', why: 'spiral: flat' }); continue; }
    // Whether the stair is outside the house is decided on its FLIGHT, once
    // matched -- The Star's porch steps are outside while their marker sits
    // inside the bedroom's wall -- so the direction question waits below.
    const alongZ = st.heading === 'up' || st.heading === 'down';   // the flight runs north-south
    // THE NEAREST FLIGHT ON THE HEADING'S AXIS, by distance to its FOOTPRINT:
    // the word sits anywhere along the arrow, and the marker beside it. The
    // reach is tolerance for the marker itself, placed by hand or estimated.
    let best = null, bd = Infinity;
    const tried = [];
    for (const f of flights) {
      if (claimed.has(f)) continue;
      const dx = Math.max(f.x0 - mx, 0, mx - f.x1), dz = Math.max(f.z0 - mz, 0, mz - f.z1);
      const d = Math.hypot(dx, dz);
      tried.push(`${f.treads}t@${d.toFixed(1)}ft${f.horizontal !== alongZ ? '(axis)' : ''}`);
      if (f.horizontal !== alongZ) continue;
      if (d <= MARKER_REACH_FT && d < bd) { bd = d; best = f; }
    }
    const tail = ` [marker ${mx.toFixed(1)},${mz.toFixed(1)}; ${tried.join(' ') || 'no flights read'}]`;
    const unconfirmed = st.direction !== 'up' && st.direction !== 'down';
    if (!best) {
      stairs.push({ st, pieces: null, near, unread: unconfirmed ? 'direction' : 'treads', mx, mz,
        why: (unconfirmed ? `direction '${st.direction}' not confirmed and no flight read near the marker: flat` : 'no flight read near the marker: flat') + tail });
      continue;
    }
    // OUTSIDE THE HOUSE? By the walls first -- the sheet flooded from its
    // border with every opening and gap sealed reaches a porch and not a
    // room -- and by the nearest confirmed label's name where there is
    // nothing to seal.
    const bc = { x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2 };
    const outdoorName = (l) => Boolean(l && OUTDOORS.test(l.name || l.text || ''));
    const exteriorHere = outside ? (outside(bc.x, bc.z) || outside(mx, mz)) : outdoorName(labelNear(bc.x, bc.z));
    // UP or DN is the reviewer's answer, never a guess -- for a stair INSIDE
    // the house, where both answers exist. Outside, only one does: steps off
    // a porch or a deck go DOWN to the ground (UP from a floor the reviewer
    // said is below grade), so an exterior stair the reviewer has not
    // answered takes that, and says so, until they say otherwise.
    let direction = st.direction;
    let derived = false;
    if (unconfirmed) {
      if (exteriorHere && !opts.exteriorToo) { direction = rec.below === true ? 'up' : 'down'; derived = true; }
      else { stairs.push({ st, pieces: null, near, unread: 'direction', mx, mz, why: `direction '${st.direction}' not confirmed: flat` + tail }); continue; }
    }
    const g = groupOf(best);
    g.flights.forEach((f) => claimed.add(f));
    // `sign` is +1 when travel runs toward +axis (right / down the plan).
    const sign = (st.heading === 'right' || st.heading === 'down') ? 1 : -1;
    const startEnd = (f, sgn) => (f.horizontal ? (sgn > 0 ? f.z0 : f.z1) : (sgn > 0 ? f.x0 : f.x1));
    const endEnd = (f, sgn) => (f.horizontal ? (sgn > 0 ? f.z1 : f.z0) : (sgn > 0 ? f.x1 : f.x0));
    let pieces = [{ f: best, sign }], why = '';
    if (g.flights.length === 2) {
      const other = g.flights.find((f) => f !== best);
      if (g.join === 'L') {
        // Which end of the marker's flight touches the landing? Travel runs
        // INTO a landing at its end (the other flight follows) and OUT of one
        // at its start (the other flight came first).
        const L = g.landing;
        const reach = Math.max(LANDING_NEAR_FT, 1.5 * best.treadIn / 12);
        const touchAt = (v) => Math.abs(v - (best.horizontal ? (v <= (L.z0 + L.z1) / 2 ? L.z0 : L.z1) : (v <= (L.x0 + L.x1) / 2 ? L.x0 : L.x1))) <= reach;
        const atEnd = touchAt(endEnd(best, sign)), atStart = touchAt(startEnd(best, sign));
        const oc = other.horizontal ? (L.z0 + L.z1) / 2 : (L.x0 + L.x1) / 2;
        const of = other.horizontal ? (other.z0 + other.z1) / 2 : (other.x0 + other.x1) / 2;
        const toward = oc > of ? 1 : -1;    // +1 when the landing lies at +axis of the other flight
        if (atEnd) { pieces = [{ f: best, sign }, { landing: L }, { f: other, sign: -toward }]; why = 'L, marker flight first: '; }
        else if (atStart) { pieces = [{ f: other, sign: toward }, { landing: L }, { f: best, sign }]; why = 'L, marker flight second: '; }
        else why = 'L read but its landing touches neither end of the marker flight, one flight: ';
      } else if (g.join === 'U') {
        // Travel ends at the landing: the end of the marker flight in its heading.
        const pick = g.ends.find((x) => x.at === (sign > 0 ? 'hi' : 'lo'));
        if (pick) { pieces = [{ f: best, sign }, { landing: pick.r }, { f: other, sign: -sign }]; why = 'U: '; }
        else why = 'U read but its landing is not at the end of travel, one flight: ';
      }
    }
    // THE FOOTPRINT IS THE TREADS, NOT THE LINES. A flight of n lines is n
    // treads, and the last tread runs one pitch past its nosing -- onto the
    // landing, or onto the floor it arrives at. Each flight's copy is
    // stretched at its end of travel: to the landing's edge where there is
    // one (and at its start, where it leaves a landing), by one pitch where
    // there is not.
    pieces = pieces.map((x) => (x.f ? { ...x, f: { ...x.f } } : x));
    for (let i = 0; i < pieces.length; i++) {
      const x = pieces[i]; if (!x.f) continue;
      const f = x.f, run = f.treadIn / 12, sgn = x.sign, alongZ = f.horizontal;
      const fit = (endOf, L) => {
        // the flight's edge at that end, and the landing's edge facing it
        const key = alongZ ? (endOf > 0 ? 'z1' : 'z0') : (endOf > 0 ? 'x1' : 'x0');
        if (L) { const lk = alongZ ? (endOf > 0 ? 'z0' : 'z1') : (endOf > 0 ? 'x0' : 'x1'); f[key] = L[lk]; return; }
        // one pitch, but never into a wall: the tread ends at the wall's face
        const from = f[key];
        let to = from + endOf * run;
        for (const w of ex.walls || []) {
          const across = alongZ ? (w.x1 > f.x0 && w.x0 < f.x1) : (w.z1 > f.z0 && w.z0 < f.z1);
          if (!across) continue;
          const face = alongZ ? (endOf > 0 ? w.z0 : w.z1) : (endOf > 0 ? w.x0 : w.x1);
          if (endOf > 0 ? (face >= from - 0.05 && face < to) : (face <= from + 0.05 && face > to)) to = face;
        }
        f[key] = to;
      };
      fit(sgn, pieces[i + 1]?.landing || null);          // the end of travel
      if (pieces[i - 1]?.landing) fit(-sgn, pieces[i - 1].landing);   // the start, off a landing
    }
    const n = pieces.filter((x) => x.f).reduce((a, x) => a + x.f.treads, 0);
    // AN EXTERIOR STAIR HAS NO WELL. The steps of a deck go down to ground
    // the model does not have -- its ground is the sheet, at the deck's own
    // level -- so a well there is a box hanging under the deck (seen,
    // 2026-09-21). Saman: the treads alone, descending, say the stair goes
    // down, and that is enough. So an exterior DN stair is its treads cut
    // into the deck with no walls and no floor under them. The space is
    // named by the nearest confirmed label. `opts.exteriorToo` builds the
    // well anyway (a probe's comparison; not the app).
    const c0 = pieces[0].f, lbl = labelNear((c0.x0 + c0.x1) / 2, (c0.z0 + c0.z1) / 2);
    const exterior = !opts.exteriorToo && exteriorHere;
    // WHERE THE STAIR SITS is not the same question as which way it is
    // walked. Inside the house the word decides both: DN is a well below the
    // floor, UP a flight rising toward the next one. OUTSIDE, the stair joins
    // the floor to the ground, and the ground is below an above-grade floor
    // whichever word the marker carries: from the porch it is DN, from the
    // yard it is UP, and it is the same six steps. The Star's porch stair,
    // set to UP in Review, stood as a block as tall as the porch posts
    // (Saman, 2026-09-23: "it should start from below and reach the
    // floor"). So `sink` is where the treads are -- below the floor, or
    // above it on a floor the reviewer said is below grade -- and the word
    // says which end of travel meets the floor (stairBoxes).
    const sink = exterior ? rec.below !== true : direction === 'down';
    stairs.push({ st, pieces, n, down: direction === 'down', sink, mx, mz, exterior, near, derived,
      why: why + `${n} treads in ${pieces.filter((x) => x.f).length} flight(s), ${bd.toFixed(1)}ft from the marker`
        + (exterior ? ` -- outside the walls${lbl ? ` (by ${lbl.name || lbl.text})` : ''}: treads only, ${sink ? 'down to the ground' : 'up to grade'}` : '')
        + (derived ? `; direction not set, read as ${direction} (steps to the ground)` : '') + tail });
  }
  const interior = stairs.filter((s) => s.st.kind !== 'spiral' && !s.exterior);
  const flat = interior.some((s) => !s.pieces);
  if (flat) notes.push('a confirmed stair could not be read: the floor keeps its stairs flat');
  return { stairs, flat, flights: flights.length, notes };
}

/** The wall's section height the stairs are sized against, and a riser. */
export const STAIR_SECTION_H = 5.0;
export const STAIR_RISER = 7 / 12;

/**
 * The boxes a floor's read stairs are built from, in model feet, for the
 * engine: `{x0,y0,z0,x1,y1,z1, tone, k}` where `tone` is 'tread' (k: how
 * bright, 1 at the top of a well, dimmer with depth), 'wellWall' or
 * 'wellFloor'; `exterior: true` on the boxes of an exterior stair, which the
 * engine draws over the sheet's rim (see there). Plus the `wells`: the
 * rectangles to cut out of the floor.
 *
 * DARKER AS IT GOES DOWN. Steps at the wall's own tone read as a block that
 * could as well be rising; a well is a hole, and a hole is in shadow: the
 * treads dim with depth, the well's walls are darker, its floor darkest.
 * The well's walls follow the outline of the pieces' union and leave the
 * start of travel open. An UP stair rises from the floor; its landing is a
 * platform at the level reached.
 */
export function stairBoxes(reading, opts = {}) {
  const boxes = [], wells = [];
  if (!reading || reading.flat) return { boxes, wells };
  const near = (a, b) => Math.abs(a - b) <= LANDING_NEAR_FT;
  const sectionH = opts.sectionH ?? STAIR_SECTION_H, riser = opts.riser ?? STAIR_RISER;
  let outsideNow = false;   // the stair being built is an exterior one (its boxes say so)
  const box = (x0, y0, z0, x1, y1, z1, tone, k = 1) => { if (x1 > x0 && z1 > z0 && y1 > y0) boxes.push({ x0, y0, z0, x1, y1, z1, tone, k, ...(outsideNow ? { exterior: true } : {}) }); };
  const rectOf = (f) => ({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
  for (const s of reading.stairs) {
    if (!s.pieces) continue;
    outsideNow = Boolean(s.exterior);
    const down = s.down;
    // Below the floor or above it (readStairs `sink`); a reading from before
    // the field existed is an interior one, where the word decided both.
    const sink = s.sink ?? down;
    const rise = Math.min(sectionH / s.n, riser);
    const depthTotal = rise * s.n;
    // THE LEVEL AFTER k RISERS ALONG TRAVEL, from one rule. The floor is 0;
    // the word says whether travel climbs or descends; an exterior stair
    // whose travel runs TOWARD the floor (UP from the yard below a porch, DN
    // from grade into a basement's areaway) starts a whole flight away and
    // ends flush with it. Interior stairs and every stair walked away from
    // the floor start at it, exactly as before.
    const off = s.exterior && sink && !down ? -depthTotal : s.exterior && !sink && down ? depthTotal : 0;
    const level = (k) => off + (down ? -k : k) * rise;
    // A tread or landing at or below the floor is a slab one riser deep, dimmer
    // the deeper it lies (a well is a hole, and a hole is in shadow); above
    // the floor it is a block standing on it.
    const place = (x0, z0, x1, z1, top, always) => {
      if (top > 1e-9) { box(x0, 0, z0, x1, top, z1, 'tread'); return; }
      if (top < -1e-9 || always) {
        const deep = Math.round(-top / rise);
        box(x0, top - rise, z0, x1, top, z1, 'tread', 0.9 - 0.5 * (deep / Math.max(1, s.n - 1)));
      }
    };
    let k = 0;                                  // risers so far along travel
    const rects = [];
    for (const p of s.pieces) {
      if (p.landing) {
        const L = p.landing;
        place(L.x0, L.z0, L.x1, L.z1, level(k), down);
        rects.push({ ...L });
        continue;
      }
      const f = p.f, sign = p.sign, alongZ = f.horizontal, n = f.treads;
      const lo = alongZ ? f.z0 : f.x0, hi = alongZ ? f.z1 : f.x1;
      const run = (hi - lo) / n;
      for (let i = 0; i < n; i++) {
        const a0 = sign > 0 ? lo + i * run : hi - (i + 1) * run;
        const a1 = a0 + run;
        const r = k + i;
        // descending, a tread is the level it is stepped onto from; climbing,
        // the level one riser up
        const top = down ? level(r) : level(r + 1);
        if (alongZ) place(f.x0, a0, f.x1, a1, top, true);
        else place(a0, f.z0, a1, f.z1, top, true);
      }
      k += n;
      rects.push(rectOf(f));
    }
    if (!sink) continue;
    // Outside, the treads are cut into the deck and that is all: no well.
    if (s.exterior) { wells.push(...rects); continue; }
    const wt = 0.25, y0 = -depthTotal - 0.15;
    const first = s.pieces[0], f0 = first.f, r0 = rects[0];
    const skip = f0.horizontal
      ? { r: r0, side: first.sign > 0 ? 'n' : 's', c0: r0.x0, c1: r0.x1 }
      : { r: r0, side: first.sign > 0 ? 'w' : 'e', c0: r0.z0, c1: r0.z1 };
    for (const w of outlineWalls(rects, skip, near)) {
      if (w.side === 'w') box(w.at - wt, y0, w.s0 - wt, w.at, 0, w.s1 + wt, 'wellWall');
      else if (w.side === 'e') box(w.at, y0, w.s0 - wt, w.at + wt, 0, w.s1 + wt, 'wellWall');
      else if (w.side === 'n') box(w.s0 - wt, y0, w.at - wt, w.s1 + wt, 0, w.at, 'wellWall');
      else box(w.s0 - wt, y0, w.at, w.s1 + wt, 0, w.at + wt, 'wellWall');
    }
    for (const r of rects) box(r.x0, y0, r.z0, r.x1, y0 + 0.1, r.z1, 'wellFloor');
    wells.push(...rects);
  }
  return { boxes, wells };
}

/**
 * The outline of a union of touching rectangles, as wall segments: each
 * rectangle's four edges, less the parts where another abuts from outside,
 * less the `skip` edge (the open start of travel).
 */
function outlineWalls(rects, skip, near) {
  const out = [];
  for (const r of rects) {
    for (const side of ['w', 'e', 'n', 's']) {
      const vert = side === 'w' || side === 'e';
      const at = side === 'w' ? r.x0 : side === 'e' ? r.x1 : side === 'n' ? r.z0 : r.z1;
      let spans = [vert ? [r.z0, r.z1] : [r.x0, r.x1]];
      for (const q of rects) {
        if (q === r) continue;
        const facing = side === 'w' ? q.x1 : side === 'e' ? q.x0 : side === 'n' ? q.z1 : q.z0;
        const outside = side === 'w' ? q.x0 < r.x0 : side === 'e' ? q.x1 > r.x1 : side === 'n' ? q.z0 < r.z0 : q.z1 > r.z1;
        if (!outside || !near(facing, at)) continue;
        const c0 = vert ? q.z0 : q.x0, c1 = vert ? q.z1 : q.x1;
        const next = [];
        for (const [s0, s1] of spans) {
          if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
          if (c0 > s0) next.push([s0, c0]);
          if (c1 < s1) next.push([c1, s1]);
        }
        spans = next;
      }
      for (const [s0, s1] of spans) {
        if (s1 - s0 < 0.2) continue;
        if (skip && skip.side === side && skip.r === r && s0 >= skip.c0 - 0.01 && s1 <= skip.c1 + 0.01) continue;
        out.push({ side, at, s0, s1 });
      }
    }
  }
  return out;
}

/**
 * The floor texture with the wells cut out of it: a COPY of `canvas` (the
 * sheet is shared by every build of the floor) with each well cleared, so
 * the treads below floor level show through. The plane that carries the
 * texture must not write depth where it is clear (alphaTest), or the well
 * stays hidden -- the engine sets that.
 *
 * @param {HTMLCanvasElement} canvas the floor texture (ex.floor)
 * @param {Array} wells rects in model feet
 * @param {{x0:number,z0:number,x1:number,z1:number}} floorRect where the texture lies in model feet
 */
export function cutWells(canvas, wells, floorRect) {
  if (!wells?.length || !canvas) return canvas;
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const fw = floorRect.x1 - floorRect.x0, fd = floorRect.z1 - floorRect.z0;
  const sx = c.width / fw, sy = c.height / fd;
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (const r of wells) {
    g.fillRect((r.x0 - floorRect.x0) * sx, (r.z0 - floorRect.z0) * sy, (r.x1 - r.x0) * sx, (r.z1 - r.z0) * sy);
  }
  return c;
}
