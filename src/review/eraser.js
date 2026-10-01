// Erasing things the wireframe invented.
//
// WHY AN ERASER AND NOT A REGENERATE BUTTON.
//
// Every geometry defect observed so far is an ADDITION: a closet in a bedroom
// that has none, a wall stub read off a dimension bracket, a car in a
// two-storey void, a dashed X carried through. That is the failure mode of a
// generative model — it completes a stereotype. A bedroom "should" have a
// closet, a garage "should" have a car.
//
// Removing is far cheaper than drawing. Painting out an invented closet is
// local, deterministic and needs no model; drawing a missing wall accurately is
// authoring, not confirming, and the customer should not be doing it.
//
// It also costs NOTHING. The wireframe is a raster we own, Review sits before
// the styling call, so the customer erases and the styled render is made once
// from the corrected drawing. Re-rendering to fix a defect we produced would be
// charging for our own mistake.
//
// This is the same architecture as red line 1: we composite, the model does
// not. Text and branding already work this way.

// TWO COLOURS, BECAUSE THERE ARE TWO CORRECTIONS.
//
// Painting paper removes something standing in open space — an invented closet
// in the middle of a bedroom. But the commonest defect is an invented OPENING:
// a door drawn where the source has unbroken wall. Erasing that to paper leaves
// a hole, which is a different wrong answer, not a fix. Saman found this the
// first time he used it, at the end of a staircase.
//
// A wireframe is black-on-white and means exactly this by it: black is wall,
// white is nothing. So the two corrections are the two colours, and the
// reviewer picks the one that matches what their own plan shows.
export const PAPER = '#ffffff';
export const WALL = '#000000';

/**
 * Strokes are stored NORMALISED to the image, so they survive the plan being
 * re-rendered at another size, and can be re-applied to the 2x export.
 *
 * @typedef {{x:number, y:number, r:number}} Dab  centre and radius, 0..1 of width
 */

/** A stroke's dabs, interpolated so a fast drag does not leave gaps. */
export function stroke(from, to, radius, opts = {}) {
  const step = opts.step ?? radius * 0.4;
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(d / Math.max(step, 1e-6)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push({ x: from.x + (dx * i) / n, y: from.y + (dy * i) / n, r: radius });
  }
  return out;
}

/**
 * The bounding box of a set of dabs, in normalised units, or null.
 *
 * Used to show the customer what they changed and to let a reviewer see at a
 * glance that an erase covered the thing they meant and not half a wall.
 */
export function dabBounds(dabs) {
  if (!dabs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of dabs) {
    const [a, b, c2, d2] = d.kind === 'rect'
      ? [d.x0, d.y0, d.x1, d.y1]
      : [d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r];
    x0 = Math.min(x0, a); y0 = Math.min(y0, b);
    x1 = Math.max(x1, c2); y1 = Math.max(y1, d2);
  }
  return { x0, y0, x1, y1 };
}

/**
 * How much of the drawing an erase removes, as a fraction of its ink.
 *
 * A GUARD, not a statistic. An erase is meant to remove one invented object; if
 * it takes out a large share of the plan the customer has dragged across the
 * drawing by accident, and that must be caught before it reaches the styling
 * call — a wireframe with half its walls gone still renders, and renders
 * beautifully, as a different house.
 *
 * @param {Uint8Array} ink  1 where the source drawing has ink
 * @param {Dab[]} dabs
 */
export function erasedFraction(ink, w, h, dabs) {
  let total = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i]) total++;
  if (!total) return 0;

  const hit = new Uint8Array(w * h);
  for (const d of dabs) {
    if (d.kind === 'rect') {
      const rx0 = Math.max(0, Math.floor(d.x0 * w)), rx1 = Math.min(w - 1, Math.ceil(d.x1 * w));
      const ry0 = Math.max(0, Math.floor(d.y0 * h)), ry1 = Math.min(h - 1, Math.ceil(d.y1 * h));
      for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) hit[y * w + x] = 1;
      continue;
    }
    const cx = d.x * w, cy = d.y * h, r = d.r * w;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const inside = d.shape === 'square'
          ? true                                        // the box IS the nib
          : (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        if (inside) hit[y * w + x] = 1;
      }
    }
  }
  let gone = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i] && hit[i]) gone++;
  return gone / total;
}

/**
 * Paint the dabs onto a canvas context.
 *
 * Kept separate from the geometry above so the geometry stays testable in node.
 * Radii are fractions of WIDTH in both axes, so a dab is a circle rather than
 * an ellipse on a non-square plan.
 */
/**
 * A corrected copy of a wireframe, or the original when there is nothing to do.
 *
 * Returning the source untouched when there are no dabs matters: it keeps the
 * common path free of a needless canvas copy, and callers can use the result
 * wherever they used the image.
 */
export function applyErases(img, dabs) {
  if (!dabs?.length) return img;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  applyDabs(ctx, w, h, dabs);
  return c;
}

/**
 * Normalise a dragged rectangle, whichever corner it started from.
 *
 * A DRAGGED RECTANGLE, NOT A BRUSH, FOR CLOSING WALLS. A wall IS a rectangle:
 * dragging one gives dead-straight edges and an exact extent, where any brush —
 * round or square — depends on a steady hand to end up straight. Same gesture
 * as a selection box, so nobody has to be taught it.
 */
export function rect(from, to, colour = WALL) {
  return {
    kind: 'rect', c: colour,
    x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y),
    x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y),
  };
}

/** Does a mark cover any ink at all? Used to keep an empty drag out of the list. */
export const isEmptyRect = (r) => (r.x1 - r.x0) < 1e-4 || (r.y1 - r.y0) < 1e-4;

/**
 * Is the wall either side of this gap drawn SOLID or as an OUTLINE?
 *
 * Wireframes draw walls both ways and it is not our choice which — some come
 * back as solid poché, others as two thin lines with the paper showing between.
 * Filling an opening solid in an outlined drawing leaves a black slab where the
 * rest of the plan has hollow bands, which is a different wrong answer, not a
 * fix. Saman caught this on the first plan whose walls were outlined.
 *
 * So the mark matches the drawing, and the drawing is asked rather than
 * assumed: look at the wall immediately BEYOND each end of the gap — that is
 * the wall being continued — and see whether its middle is inked.
 *
 * @param {Uint8Array} ink  1 where the drawing has ink
 * @returns {'solid'|'outline'}
 */
export function wallStyleAt(ink, w, h, r, opts = {}) {
  const horizontal = (r.x1 - r.x0) >= (r.y1 - r.y0);
  const reach = opts.reach ?? 0.02;      // how far past the end to look
  const at = (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? ink[y * w + x] : 0);

  let mid = 0, edge = 0, n = 0;
  for (const beyond of [-1, 1]) {
    // A band of samples in the existing wall, just past this end of the gap.
    for (let k = 1; k <= Math.round(reach * (horizontal ? w : h)); k++) {
      const a = beyond < 0
        ? Math.round((horizontal ? r.x0 : r.y0) * (horizontal ? w : h)) - k
        : Math.round((horizontal ? r.x1 : r.y1) * (horizontal ? w : h)) + k;
      // across the wall: its middle, and its two faces
      const t0 = (horizontal ? r.y0 : r.x0) * (horizontal ? h : w);
      const t1 = (horizontal ? r.y1 : r.x1) * (horizontal ? h : w);
      const c = Math.round((t0 + t1) / 2);
      const f0 = Math.round(t0), f1 = Math.round(t1) - 1;
      mid += horizontal ? at(a, c) : at(c, a);
      edge += (horizontal ? at(a, f0) + at(a, f1) : at(f0, a) + at(f1, a));
      n++;
    }
  }
  if (!n) return 'solid';
  // Inked faces but a clear middle is what "outline" means. Requiring the faces
  // to be present too stops an empty neighbourhood — a gap at the end of a wall
  // — from reading as outlined merely because nothing is there.
  return (edge / (n * 2) > 0.4 && mid / n < 0.4) ? 'outline' : 'solid';
}

/**
 * A short, stable signature of a floor's corrections.
 *
 * WHAT IT IS FOR. A styled render is cached against the palette and the engine
 * that drew it, and both are things the render depends on. So are the
 * corrections — the render is made from the CORRECTED drawing — but they were
 * not in the key. A customer who rendered a floor, went back to Review to add a
 * window the tracing had missed, and returned to Studio was told "reused, no
 * credit spent" and shown an image of the drawing before their correction. No
 * error, no marker. That is the same failure the engine key was added to catch,
 * one field short.
 *
 * Rounded to a thousandth of the image, because marks are stored normalised and
 * a redraw at a different size must not read as a different correction.
 *
 * @returns {string} '' when there is nothing to correct, so a floor with no
 *   corrections keys exactly as it did before this existed.
 */
export function erasesFingerprint(erases) {
  if (!erases?.length) return '';
  const r = (v) => Math.round((v || 0) * 1000);
  let h = 0x811c9dc5;                      // FNV-1a, 32-bit
  for (const d of erases) {
    const s = d.kind === 'rect'
      ? `R${d.style || ''}${d.swing ?? ''}${r(d.x0)},${r(d.y0)},${r(d.x1)},${r(d.y1)}${d.c || ''}`
      : `D${r(d.x)},${r(d.y)},${r(d.r)}${d.shape || ''}${d.c || ''}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  // The count travels with the hash: it is the part a human can check against
  // what Review says, and it makes a collision need the same number of marks.
  return `${erases.length}.${(h >>> 0).toString(36)}`;
}

/**
 * Snap a dragged box ACROSS the wall it was dragged along.
 *
 * A window or a door has to sit exactly in the wall's own thickness, and a hand
 * dragging a box on a canvas does not land there. Too shallow and a strip of
 * old wall survives above or below the symbol; too deep and the mark eats into
 * the rooms either side. Either way the reviewer has to redo the drag, aiming
 * at a band a few pixels tall.
 *
 * They should not have to. WHERE the opening goes along the wall is a real
 * choice and is left alone; how deep it is was never a choice at all — the wall
 * already knows.
 *
 * The wall is read BESIDE the box, not inside it, because inside is exactly
 * where the drawing is wrong: the reviewer is marking a window the tracing
 * missed, or a door drawn as unbroken wall. What continues past each jamb is
 * the wall being corrected. Same reasoning as `wallStyleAt`, which asks the
 * same neighbourhood a different question.
 *
 * Faces and poché both work. An outlined wall shows two thin runs with paper
 * between, and grouping ink that is closer together than one wall thickness
 * keeps them as ONE wall rather than two.
 *
 * @param {Uint8Array} ink  1 where the drawing has ink
 * @returns {object} the box, snapped, or unchanged when no wall is found
 */
export function snapToWall(ink, w, h, r, opts = {}) {
  const thick = Math.max(2, opts.thickness || 0);

  // WHICH WALL WAS MEANT. A drag along a wall is much longer than it is deep,
  // and that direction is the reviewer saying which wall they mean — so when
  // the box is decisively one shape, it is believed, and a wall at right angles
  // that happens to sit under the drag does not get to win.
  //
  // Only when the box is nearly square is there nothing to believe. That
  // happens with a drag that spills well into the rooms either side, and then
  // the WALL decides: whichever band is closest to the thickness this plan
  // draws its walls at. The plausible wrong answer there is a perpendicular
  // wall caught at a corner, and it reads far thicker or far thinner.
  const dx = r.x1 - r.x0, dy = r.y1 - r.y0;
  const decisive = Math.max(dx, dy) >= Math.min(dx, dy) * 1.5;
  const scan = (horizontal) => scanWall(ink, w, h, r, thick, horizontal, opts);
  let hit = null;
  if (decisive) {
    hit = scan(dx >= dy) || scan(dx < dy);
  } else {
    const found = [scan(true), scan(false)].filter(Boolean);
    // The wall running through the MIDDLE of the drag, and only then the one
    // whose band looks most like a wall of this plan. A drag centred on a wall
    // is aimed at it; a wall caught near one edge is the corner it happened to
    // touch.
    found.sort((a, b) => (a.dist - b.dist) || (Math.abs(a.band - thick) - Math.abs(b.band - thick)));
    hit = found[0] || null;
  }
  if (!hit) return r;
  const { horizontal, top, bot } = hit;
  return horizontal
    ? { ...r, y0: top / h, y1: bot / h }
    : { ...r, x0: top / w, x1: bot / w };
}

function scanWall(ink, w, h, r, thick, horizontal, opts) {
  const W = horizontal ? w : h;          // along the wall
  const H = horizontal ? h : w;          // across it
  const at = (a, c) => {                 // a along, c across
    const x = horizontal ? a : c, y = horizontal ? c : a;
    return (x >= 0 && x < w && y >= 0 && y < h) ? ink[y * w + x] : 0;
  };
  // Sample well past each jamb. A window commonly goes in beside an existing
  // opening, and a short reach then sees only the opening and gives up.
  const reach = Math.max(3, Math.round((opts.reach ?? 0.03) * W));
  const a0 = Math.round((horizontal ? r.x0 : r.y0) * W);
  const a1 = Math.round((horizontal ? r.x1 : r.y1) * W);
  const c0 = (horizontal ? r.y0 : r.x0) * H;
  const c1 = (horizontal ? r.y1 : r.x1) * H;
  const centre = (c0 + c1) / 2;
  // How far off the drag a wall may be and still be the one that was meant.
  //
  // NOT thickness alone. `medianWallThickness` is measured off an AI redraw and
  // is unstable — it read 3 on the very plan whose exterior wall is 5 — so a
  // range of a few thicknesses collapses to nothing on exactly the plans that
  // need help. A share of the drawing is the stable half of the rule: a hand
  // aiming at a wall lands within a percent or two of it, on any plan, at any
  // line weight.
  const span = Math.max(thick * 4, (c1 - c0) * 1.5, H * 0.03, 8);
  const lo = Math.max(0, Math.round(centre - span));
  const hi = Math.min(H - 1, Math.round(centre + span));

  const tops = [], bots = [];
  for (const beyond of [-1, 1]) {
    for (let k = 1; k <= reach; k++) {
      const a = beyond < 0 ? a0 - k : a1 + k;
      if (a < 0 || a >= W) break;
      // Ink rows in the search band, grouped: a break WIDER than one wall
      // thickness starts a different wall; anything closer is the same wall
      // seen as two faces.
      let best = null, run = null;
      for (let c = lo; c <= hi; c++) {
        if (at(a, c)) {
          if (run && c - run.last <= thick) run.last = c;
          else { if (run) best = pickNearer(best, run, centre); run = { first: c, last: c }; }
        }
      }
      if (run) best = pickNearer(best, run, centre);
      if (!best) continue;
      // The search window picks WHICH wall; it must not also decide how thick
      // it is. A wall lying half outside the window came back clipped at the
      // window's edge, and the mark then stopped a pixel or two inside the
      // wall — the hairline of leftover wall this function exists to prevent.
      while (best.first > 0 && at(a, best.first - 1)) best.first--;
      while (best.last < H - 1 && at(a, best.last + 1)) best.last++;
      // A band far thicker than the plan's walls is not one wall — it is a
      // corner, a fixture, or two walls read as one. Better to leave the drag
      // alone than to swallow a room.
      if (best.last - best.first + 1 > Math.max(thick * 3, 8)) continue;
      tops.push(best.first); bots.push(best.last);
    }
  }
  if (!tops.length) return null;
  const mid = (xs) => xs.slice().sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  const medTop = mid(tops), medBot = mid(bots);

  // ENOUGH SAMPLES THAT AGREE, not most samples. Requiring most of them was too
  // strict on the plans this is for: one jamb of a new window commonly lands
  // beside an existing opening or at the end of a wall, and that whole side
  // returns nothing. Four columns saying the same thing is a wall.
  const tol = Math.max(2, thick);
  const keep = tops
    .map((t, i) => [t, bots[i]])
    .filter(([t, b]) => Math.abs(t - medTop) <= tol && Math.abs(b - medBot) <= tol);
  if (keep.length < Math.max(3, Math.round(reach / 2))) return null;

  // The OUTER edges of the samples that agree, not their middle. A median
  // finishes a pixel or two inside the wall, and what survives is a hairline of
  // old wall along the symbol — which is the defect this whole function exists
  // to remove.
  const top = Math.min(...keep.map(([t]) => t));
  const bot = Math.max(...keep.map(([, b]) => b)) + 1;
  if (bot - top < 1) return null;

  // THE WALL HAS TO BE UNDER THE DRAG, near enough to be the one aimed at.
  // Without this the search finds SOME wall — the far side of the room, or an
  // exterior wall at right angles — and moves the mark onto it. A drag over
  // open paper should stay where it was put and read as open paper, which is
  // information, rather than being silently relocated.
  // TIGHTER THAN THE SEARCH, deliberately. The search looks wide so it can
  // measure a wall the drag overlaps; this decides whether what it found is the
  // thing the reviewer was aiming at. Measured on Geena: a drag over a stretch
  // of wall that is genuinely OPEN found the deck's outline twelve rows away
  // and moved the mark onto it. A missed snap leaves a slightly imperfect mark
  // the reviewer can see and redo; a wrong snap silently puts their mark
  // somewhere they did not put it.
  const near = Math.max(thick * 2, H * 0.02);
  if (top > c1 + near || bot < c0 - near) return null;
  return { horizontal, top, bot, band: bot - top, dist: Math.abs((top + bot) / 2 - centre) };
}
const pickNearer = (best, run, centre) => {
  if (!best) return run;
  const d = (g) => Math.abs((g.first + g.last) / 2 - centre);
  return d(run) < d(best) ? run : best;
};

export function applyDabs(ctx, w, h, dabs, colour = null) {
  ctx.save();
  for (const d of dabs) {
    if (d.kind === 'rect') {
      const rw = (d.x1 - d.x0) * w, rh = (d.y1 - d.y0) * h;
      if (d.style === 'outline') {
        // The two faces continue across the gap and the middle stays paper —
        // which is what the wall looks like either side of it.
        // Normalised to width, like every other measurement here, or the same
        // mark would be a hairline on the export and a slab on the preview.
        const lw = Math.max(1, (d.lw || 0.002) * w);
        ctx.fillStyle = PAPER;
        ctx.fillRect(d.x0 * w, d.y0 * h, rw, rh);
        ctx.fillStyle = colour || d.c || WALL;
        if (rw >= rh) {                       // a horizontal run: top and bottom
          ctx.fillRect(d.x0 * w, d.y0 * h, rw, lw);
          ctx.fillRect(d.x0 * w, d.y1 * h - lw, rw, lw);
        } else {                              // a vertical run: left and right
          ctx.fillRect(d.x0 * w, d.y0 * h, lw, rh);
          ctx.fillRect(d.x1 * w - lw, d.y0 * h, lw, rh);
        }
      } else if (d.style === 'window') {
        // THE WINDOW SYMBOL, drawn the way every symbol chart draws it: the
        // wall's poché STOPS and thin parallel lines continue across the
        // opening, jamb to jamb.
        //
        // Three lines rather than two, and the third is not decoration. In a
        // drawing whose walls are already outlined, two face lines with paper
        // between them is exactly what a plain wall looks like, so a window
        // drawn that way would be invisible in half the wireframes we get. The
        // centre line is what separates the two, and it is the standard
        // three-line window on the charts anyway.
        //
        // The jamb ticks close the ends. Without them the symbol reads as a
        // wall that simply ran out, which is the archway convention, not a
        // window.
        // THE THREE LINES HAVE TO FIT THE WALL THEY ARE IN. Line weight is
        // measured off the plan's own walls, and that measurement is taken from
        // an AI redraw — it reads high on some plans, and three lines at that
        // weight fill the band solid, which is a black slab, not a window. The
        // band is a fifth each: line, gap, line, gap, line.
        const band = Math.min(rw, rh);
        const lw = Math.max(1, Math.min((d.lw || 0.002) * w, band / 5));
        const ink = colour || d.c || WALL;
        ctx.fillStyle = PAPER;
        ctx.fillRect(d.x0 * w, d.y0 * h, rw, rh);
        ctx.fillStyle = ink;
        if (rw >= rh) {                       // along x
          ctx.fillRect(d.x0 * w, d.y0 * h, rw, lw);                       // near face
          ctx.fillRect(d.x0 * w, d.y1 * h - lw, rw, lw);                  // far face
          ctx.fillRect(d.x0 * w, (d.y0 + d.y1) / 2 * h - lw / 2, rw, lw); // the glazing
          ctx.fillRect(d.x0 * w, d.y0 * h, lw, rh);                       // jambs
          ctx.fillRect(d.x1 * w - lw, d.y0 * h, lw, rh);
        } else {                              // along y
          ctx.fillRect(d.x0 * w, d.y0 * h, lw, rh);
          ctx.fillRect(d.x1 * w - lw, d.y0 * h, lw, rh);
          ctx.fillRect((d.x0 + d.x1) / 2 * w - lw / 2, d.y0 * h, lw, rh);
          ctx.fillRect(d.x0 * w, d.y0 * h, rw, lw);
          ctx.fillRect(d.x0 * w, d.y1 * h - lw, rw, lw);
        }
      } else if (d.style === 'door') {
        // THE DOOR SYMBOL: the wall's poché STOPS at the jambs, a leaf stands
        // perpendicular at the hinge, and a quarter arc sweeps from the leaf's
        // tip to the far jamb.
        //
        // WHY THE ARC AND NOT JUST A GAP. A gap alone is the ARCHWAY symbol —
        // an opening with no door in it — and the tracing already produces
        // those. If the reviewer's plan shows a door, drawing a gap would swap
        // one wrong answer for another, and worse, the 3D reads gaps as
        // circulation.
        //
        // RADIUS IS THE OPENING'S OWN WIDTH, which is the drafting rule and
        // also the only radius available to us: it comes from the reviewer's
        // own drag, so nothing is invented. The arc reaches into the room past
        // the box, which is correct — the swing is not inside the wall.
        //
        // The swing is FOUR STATES rather than something inferred. Which end
        // hinges and which way it opens are facts about the customer's house
        // that the drawing they are correcting does not give us, and guessing
        // them would be the same mistake as guessing a dimension.
        const lw = Math.max(1, (d.lw || 0.002) * w);
        const ink = colour || d.c || WALL;
        const along = rw >= rh;
        const span = along ? rw : rh;                    // door width = arc radius
        const x0 = d.x0 * w, y0 = d.y0 * h, x1 = d.x1 * w, y1 = d.y1 * h;
        // 0 up-left, 1 down-left, 2 down-right, 3 up-right — so successive
        // turns travel round the circle rather than jumping across it.
        const s = ((d.swing | 0) % 4 + 4) % 4;
        const atEnd = s >= 2;                            // hinge at the far jamb
        const positive = s === 1 || s === 2;             // opens down / right

        ctx.fillStyle = PAPER;
        ctx.fillRect(x0, y0, rw, rh);                    // the opening

        // Hinge sits on the swing-side face of the wall, at one jamb.
        const hx = along ? (atEnd ? x1 : x0) : (positive ? x1 : x0);
        const hy = along ? (positive ? y1 : y0) : (atEnd ? y1 : y0);
        const sign = positive ? 1 : -1;
        const dir = atEnd ? -1 : 1;                      // towards the other jamb
        const leaf = along ? { x: hx, y: hy + sign * span } : { x: hx + sign * span, y: hy };
        const latch = along ? { x: hx + dir * span, y: hy } : { x: hx, y: hy + dir * span };

        ctx.strokeStyle = ink;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(leaf.x, leaf.y);
        ctx.stroke();

        // One arc for all eight cases (four swings, two wall directions): sweep
        // the quarter that actually joins the leaf to the latch jamb.
        const a1 = Math.atan2(leaf.y - hy, leaf.x - hx);
        const a2 = Math.atan2(latch.y - hy, latch.x - hx);
        let delta = a2 - a1;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        ctx.beginPath();
        ctx.arc(hx, hy, span, a1, a2, delta < 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = colour || d.c || WALL;
        ctx.fillRect(d.x0 * w, d.y0 * h, rw, rh);
      }
      continue;
    }
    // Each dab carries its own colour, so a paper stroke and a wall stroke can
    // sit in one list and replay in the order they were made — the reviewer may
    // well erase a door and then close the wall behind it.
    ctx.fillStyle = colour || d.c || PAPER;
    const r = d.r * w;
    if (d.shape === 'square') {
      // A SQUARE NIB FOR WALLS. Dragged along a wall, a round nib leaves a
      // scalloped edge that does not match a drawing made of straight bands —
      // the filled opening reads as a blob rather than as wall. A square nib
      // dragged along an axis produces exactly the straight-sided band the rest
      // of the plan is drawn with.
      ctx.fillRect(d.x * w - r, d.y * h - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
