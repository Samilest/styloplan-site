// Raise the walls of the confirmed 2D plan into 3D.
//
// WHY THIS REPLACED ASKING A MODEL FOR GEOMETRY.
//
// The first approach sent the confirmed render to an image model and asked for
// rooms and walls as data. Measured against our own drawing, the envelope came
// back good — 0.77% on aspect — and the interior did not: **81% of the lines it
// produced missed the lines in the plan**. It also invented ten room names,
// merged small spaces, and produced dimensions up to 37% wrong.
//
// The drawing is already right. Extruding it cannot be wrong about where a wall
// is, because the wall IS the drawing. Registration is not "good", it is
// meaningless — there is nothing to register.
//
// AND IT INHERITS THE VERIFICATION. If the walls are the confirmed plan, then
// the space count, every dimension and the silhouette are identical to the ones
// the customer signed off. The four-point check that ran on the 2D covers the
// 3D, and there is no second thing to verify. That is worth more than any
// accuracy number.
//
// It also removes an AI call: no cost, no variance, no failure mode, and it
// works on every plan rather than the ones a model happens to parse well.
//
// WHAT IT CANNOT DO. There are no room objects — a flood fill of the space
// between walls leaks straight out through the doorways, so this produces walls
// and nothing else. Everything that needs to know about a room comes from the
// confirmed record instead: names and dimensions from the labels, the staircase
// from the checklist, the garage from its own confirmed size and anchor.

/** Fraction of the plan's short side a stroke must exceed to count as a wall.
 *  Below this it is a fixture outline, a dimension leader or a glyph. */

// Imported back from openings.js, which imports `traceRects` from here. The
// cycle is safe because both directions are used inside function bodies rather
// than at module scope — nothing here runs while the other module is still
// evaluating. Kept deliberately narrow for that reason.
import { wallSegments, collinearGaps, sealedOutside } from './openings.js';
import { wallShapes } from './outline.js';
const OPEN_RADIUS = 1;
// How much of the wall mask the opening has to leave behind for its result to
// be used at all. Measured across six wireframes the survivors sit at 87-96%
// and the one failure at 0%, so anything in between separates them.
const OPEN_MIN_SURVIVAL = 0.5;

/**
 * The wall pixels of a plan render.
 *
 * Walls are the one thing drawn as a solid band: on the dark render they are
 * the brightest thing in the picture and on the light one the darkest. Fixtures,
 * text and door arcs are thin strokes, and a morphological opening removes
 * anything thinner than the brush.
 *
 * Polarity is measured rather than assumed — the same image in the other theme
 * would otherwise return the negative of the plan, which still looks like a
 * floor plan and is entirely wrong.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {{width?:number, threshold?:number, open?:number}} [opts]
 * @returns {{mask:Uint8Array, w:number, h:number, inverted:boolean}}
 */
export function wallMask(img, opts = {}) {
  const W = opts.width || 700;
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const H = Math.max(1, Math.round(srcH * W / srcW));

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  const lum = new Uint8Array(W * H);
  let total = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
    total += lum[p];
  }
  const mean = total / (W * H);
  // A dark render's page is dark, so its walls are the bright minority.
  const inverted = mean < 128;

  // THREE LEVELS, NOT TWO. Measured along an exterior wall of a real render,
  // the luminance profile reads 41 for the page, ~130 across a window, and 240
  // for the wall itself. A single threshold puts the window on one side or the
  // other: high, and every window becomes a hole indistinguishable from a
  // doorway; low, and it becomes solid wall and disappears.
  //
  // So the band between them is kept separately. It is extruded to sill height
  // rather than full height, which is what makes a window read as a window —
  // solid enough to enclose the room, low enough not to be a wall, and clearly
  // different from a door, which really is a gap.
  const solidT = opts.threshold ?? (inverted ? 190 : 90);
  const openT = opts.lowThreshold ?? (inverted ? 90 : 190);

  let solid = new Uint8Array(W * H);
  let low = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const isSolid = inverted ? lum[p] > solidT : lum[p] < solidT;
    const isAny = inverted ? lum[p] > openT : lum[p] < openT;
    solid[p] = isSolid ? 1 : 0;
    low[p] = (isAny && !isSolid) ? 1 : 0;
  }

  // THE CLEAN-UP MUST NOT BE ABLE TO DELETE THE BUILDING.
  //
  // The opening removes specks by eroding and dilating back, which works only
  // while the walls are thicker than the brush. The wireframe is an AI redraw
  // and its line weight is not reproducible — the same plan through the same
  // prompt has measured a 10px wall on one run and 3px on the next — so
  // "thicker than the brush" is not something this code can assume.
  //
  // Measured on the wireframe corpus at radius 1: it removes 4% of jordan's
  // wall pixels, 13% of geena's, and 100% of avimain's. All 12,742 of them.
  // Every stage downstream then reported nothing and looked broken on its own
  // terms: zero wall segments, zero gaps, zero doors, an empty 3D.
  //
  // So the opening is offered, not imposed. If what comes back is not most of
  // what went in, the drawing is too fine for this brush and the raw threshold
  // stands. A little speckle is recoverable by every later stage; a deleted
  // building is not.
  //
  // Same shape as MIN_SURVIVAL in registration.js, which learned this earlier
  // on the same class of image.
  //
  // AND IT ERASES THE WINDOW SYMBOL. Second victim of the same operation,
  // found 2026-08-19 and this one had been invisible for a long time.
  //
  // A window is drawn as the wall poché stopping and two or three THIN lines
  // continuing across the opening — the standard symbol, on every chart. Those
  // lines are 1 to 2px. The erode removes them while the 8 to 20px walls around
  // them survive, so a window comes out looking exactly like a doorway: an
  // empty gap. That is why five separate hypotheses about door and window
  // detection all measured zero; they were all reading a mask the symbol had
  // been deleted from.
  //
  // Proven against ground truth rather than argued: on a synthetic plan with 10
  // known windows, ZERO have any ink at their centre with the opening on and
  // TEN have it with the opening off, where the cross-section reads
  // `.......+#..+#...#........` — three separate runs through the wall's
  // thickness, which is the glazing pattern exactly.
  //
  // So anything reading SYMBOLS must ask for `{ open: 0 }`. The opening is for
  // tracing walls, where speckle matters and thin lines do not.
  const r = opts.open ?? OPEN_RADIUS;
  if (r > 0) {
    const opened = dilate(erode(solid, r, W, H), r, W, H);
    let before = 0, after = 0;
    for (let p = 0; p < W * H; p++) { if (solid[p]) before++; if (opened[p]) after++; }
    if (!before || after / before >= OPEN_MIN_SURVIVAL) {
      solid = opened;
      low = dilate(erode(low, r, W, H), r, W, H);
    }
  }
  // A pixel cannot be both; the opening can grow one into the other.
  for (let p = 0; p < W * H; p++) if (solid[p]) low[p] = 0;

  return { mask: solid, low, w: W, h: H, inverted };
}

function erode(src, r, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = r; y < H - r; y++) {
    for (let x = r; x < W - r; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        for (let dx = -r; dx <= r; dx++) if (!src[(y + dy) * W + x + dx]) { all = 0; break; }
      }
      out[y * W + x] = all;
    }
  }
  return out;
}

function dilate(src, r, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!src[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W) out[yy * W + xx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Cover a mask with axis-aligned rectangles.
 *
 * Greedy: take the longest run of set pixels on a row, extend it down while the
 * rows below carry the same run, claim the block, repeat. On a real plan this
 * turns roughly 8% of a 700px image into fewer than a hundred boxes, which is
 * the difference between a scene that renders and one made of half a million
 * cubes.
 *
 * Pure — no canvas — so it is testable in node, which matters because a tracer
 * that drops or double-counts pixels produces a plan with holes in the walls.
 *
 * @returns {{x0:number, y0:number, x1:number, y1:number}[]} pixel bounds, x1/y1
 *   exclusive
 */
// A DOORWAY IS A GAP SOMEBODY DREW. A NOTCH IS A GAP WE MADE.
//
// Saman's rule: a gap between two walls with no door or window marked on the
// floor should not be there. This is that rule, decided by width, which is the
// one measurement that cannot be faked. No door is narrower than 2 feet, so a
// gap narrower than that was never an opening in the first place.
//
// MEASURED before the threshold was picked, on eight plans, as background runs
// flanked by wall on both sides along each axis, in quarter foot buckets. Every
// plan has the same shape: a handful of runs under 1.0ft, then almost nothing
// between 1.0 and 1.5, then a real population from 1.5, then the doors from
// 2.25. Counts in the 1.25 bucket across the eight: 0, 1, 1, 0, 0, 0, 2, 0.
//
// So 1.25ft sits in an empty valley, and it is a third narrower than the
// narrowest real door. It closes 6 to 22 runs per plan and leaves every
// door-width gap alone. Median wall thickness over the same eight ran 0.38 to
// 1.16ft, so a corner notch, which is about one wall thick, falls inside it.
//
// WHY NOT A MORPHOLOGICAL CLOSE, which was the first idea. Closing is
// isotropic: it fills any concavity smaller than the kernel, including the
// inside corners of small rooms, and it thickens every wall by the kernel on
// the way. This fills a run only where wall already stands on BOTH sides of it
// along the same line, which is the rule as stated rather than an approximation
// of it.
//
// The two axes read from the same source and write to one copy, so a run closed
// horizontally cannot create a new vertical run for the same pass to close. One
// pass, no cascade.
export function closeNarrowGaps(mask, W, H, maxPx) {
  const out = mask.slice();
  if (!(maxPx >= 1)) return out;
  const line = (len, other, at) => {
    for (let o = 0; o < other; o++) {
      let bg = -1, seenWall = false;
      for (let i = 0; i <= len; i++) {
        const v = i < len ? mask[at(i, o)] : 0;
        if (v) {
          if (bg >= 0 && seenWall && i - bg <= maxPx) {
            for (let k = bg; k < i; k++) out[at(k, o)] = 1;
          }
          bg = -1; seenWall = true;
        } else if (bg < 0) bg = i;
      }
    }
  };
  line(W, H, (x, y) => y * W + x);
  line(H, W, (y, x) => y * W + x);
  return out;
}

/**
 * Fill holes smaller than the brush, leaving real gaps alone.
 *
 * The mirror of the opening at the top of this file: that one erodes then
 * dilates and removes SPECKS; this dilates then erodes and removes HOLES.
 *
 * WHAT IT IS FOR. Masonry hatching is stipple inside the wall's poché, and
 * stipple is holes. It breaks the solid runs `wallSegments` looks for, the wall
 * comes back in fragments, and every fragment boundary reads as an opening full
 * of ink. Measured on the synthetic corpus, two seeds, positions matched:
 *
 *     hatched, no close     precision 0.15, recall 1.00
 *     hatched, close r=2    precision 1.00, recall 1.00
 *
 * and it costs the other six drawing styles nothing: base, thin, dashed,
 * mullion and oneLine are unchanged to two decimals, thick goes 0.69 to 0.71.
 *
 * NOT WIRED INTO THE 3D PATH, and that is deliberate. The pipeline reads the
 * STYLED RENDER, and the styling model smooths hatching away — measured on
 * Madison, the one test plan whose source is hatched: with and without the
 * close its render gives the same 85 segments, 28 gaps and 8 glazed openings,
 * for 180ms. Paying that for a condition the input does not carry would be
 * superstition. It is here for the wireframe path, where the hatching survives,
 * and so the corpus result is not lost.
 */
export function closeHoles(mask, W, H, r) {
  if (!(r > 0)) return mask.slice();
  const dilated = dilate(mask, r, W, H);
  return erode(dilated, r, W, H);
}

/**
 * The plan's own wall thickness, as a floor rather than an average.
 *
 * The lower quartile of ink run lengths, not the median: half a plan's runs are
 * legitimately thinner than its median, because interior partitions ARE thinner
 * than structural walls — that is a drawing convention, not an error, and it is
 * on every symbol chart. What is not a convention is the tail below the
 * quartile, which is the render's own edge softening.
 *
 * The reference guides name THREE weights, not two: exterior walls thicker,
 * interior walls thinner, and structural walls thicker still and sometimes
 * marked with an S. So there is no single "the wall thickness" to find on a
 * plan, and any statistic that assumes one is wrong about the drawing before it
 * is wrong about the pixels. A low quantile is a floor under all three rather
 * than an estimate of any of them, which is the only thing a single number can
 * honestly be here.
 */
/**
 * Distance to the nearest background pixel, for every ink pixel.
 *
 * Two raster passes, forward then backward, with diagonal steps at sqrt(2) —
 * the standard chamfer approximation. Exact enough here: we compare it against
 * a wall thickness, not against another distance.
 *
 * WHAT IT BUYS. On the centre of a wall the value IS the local half-thickness,
 * so `2 * d` answers "how thick is the wall AT THIS POINT" without any global
 * statistic. That is the question the rest of this file kept needing and kept
 * approximating with a whole-image number.
 *
 * It is NOT a cure for unstable line weight, which is what it was suggested
 * for. Measured across four generations of the same plan, the transform and the
 * median run length track each other — 16/15, 16/16, 16/15, 4.83/5 — and both
 * collapse together on the fourth. The drift is in the drawing, not in the
 * statistic, and nothing can normalise away a difference that is really there.
 */
export function distanceTransform(mask, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => ((x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      d[y * W + x] = Math.min(d[y * W + x],
        at(x - 1, y) + 1, at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      if (!mask[y * W + x]) continue;
      d[y * W + x] = Math.min(d[y * W + x],
        at(x + 1, y) + 1, at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  return d;
}

/**
 * The thickest the wall gets anywhere inside a rectangle, in pixels.
 *
 * A rectangle cut out of a wall by `traceRects` can be much thinner than the
 * wall it came from, so its own dimensions do not say what it is part of. This
 * does.
 */
export function localWallPx(dist, W, rect) {
  let best = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const v = dist[y * W + x];
      if (v > best) best = v;
    }
  }
  // MINUS ONE, and it is not a fudge. The transform measures the distance to
  // the nearest BACKGROUND pixel, which lies outside the ink, so the centre of
  // a 3px bar reads 2 and a naive doubling calls it 4. Checked against bars of
  // known width: 2d-1 gives 1 for a 1px line, 3 for a 3px bar, 5 for a 5px bar.
  // Without it every thickness came back a pixel fat, which on a plan whose
  // walls are 4px is a quarter of the answer.
  return best > 0 ? best * 2 - 1 : 0;
}

export function wallFloorPx(mask, W, H) {
  const runs = [];
  const sweep = (len, other, at) => {
    for (let o = 0; o < other; o++) {
      let s = -1;
      for (let i = 0; i <= len; i++) {
        const v = i < len ? mask[at(i, o)] : 0;
        if (v) { if (s < 0) s = i; } else if (s >= 0) { runs.push(i - s); s = -1; }
      }
    }
  };
  sweep(W, H, (x, y) => y * W + x);
  sweep(H, W, (y, x) => y * W + x);
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length * 0.25)];
}

/**
 * A STUB IS NOT THINNER THAN THE WALL IT BELONGS TO.
 *
 * Saman found the little post between a window and a door coming out lean, and
 * it measured 0.26ft against The Avi Top's 0.44ft walls. The tracer was not at
 * fault: the ink run at that spot really is 0.26ft. But the drawing is not at
 * fault either — the same plan's WIREFRAME has no runs at all below 0.7 of its
 * median, while its render has 7% of them. The thin tail is the render's edge
 * softening, and a 3px nib becomes a blade once it is stood up in 3D.
 *
 * So a piece thinner than the plan's own floor is widened to it, about its own
 * centre line so it stays where it was drawn.
 *
 * ONLY SHORT ONES. A thin piece that runs a long way is a wall's EDGE, kept on
 * purpose by isWallSized, and widening one of those would stand a second wall
 * up beside a real one. Per plan this touches 6, 8 and 14 stubs and leaves 6, 9
 * and 13 edges alone.
 *
 * AND ONLY WHERE THE INK IS ACTUALLY THIN. A stub is a piece of drawing that
 * came out lean; a slice of a CURVED wall is not. `traceRects` tiles a curve
 * into a comb of one-pixel columns — each of them thin, most of them short —
 * and widening every column to a full wall stacks two hundred overlapping
 * rectangles along one arc. Measured on a drawn plan with a round room, the
 * rectangle list covered 109.6% of the wall ink it is supposed to describe; on
 * a bowed front wall, 104.0%.
 *
 * The distinction is not the piece's shape, which is identical in both cases.
 * It is how thick the INK is where the piece sits — the same question
 * `localWallPx` already answers for the size filter. A nib between a window and
 * a door sits in ink that really is 0.26ft against a 0.44ft wall, and is still
 * widened. A slice of a curve sits in ink that is already a full wall, and is
 * left alone.
 *
 * MEASURED, because this changes a list the window mapping and the label
 * anchoring both read. Union of the rectangles against the wall ink:
 *
 *   round room   1.096 -> 0.995      sky      0.991 -> 0.986
 *   bowed        1.040 -> 0.985      jordan   1.006 -> 1.004
 *   orthogonal   1.000 -> 1.000      geena    0.997 -> 0.991
 *
 * The orthogonal control does not move by a single pixel. The real plans move
 * by 25 to 191 pixels, under 0.7%, and not all of it in the good direction —
 * that is the price, and it buys a curve that is described once instead of two
 * hundred times.
 *
 * @param {Array<number>} [inkThickFt] per-wall thickness of the ink underneath,
 *   in feet, aligned with `walls`. Omitted, every thin short piece is widened,
 *   which is what this did before.
 */
export function thickenStubs(walls, floorFt, shortFt = 3, inkThickFt = null) {
  return walls.map((r, i) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const thin = Math.min(w, d), long = Math.max(w, d);
    if (thin >= floorFt * 0.99 || long >= shortFt) return r;
    if (inkThickFt && inkThickFt[i] >= floorFt * 0.99) return r;
    const grow = (floorFt - thin) / 2;
    return w <= d
      ? { ...r, x0: r.x0 - grow, x1: r.x1 + grow }
      : { ...r, z0: r.z0 - grow, z1: r.z1 + grow };
  });
}

export function traceRects(mask, W, H) {
  const used = new Uint8Array(W * H);
  const out = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const i = y * W + x;
      if (!mask[i] || used[i]) { x++; continue; }
      let end = x;
      while (end + 1 < W && mask[y * W + end + 1] && !used[y * W + end + 1]) end++;
      let bottom = y;
      while (bottom + 1 < H) {
        let same = true;
        for (let k = x; k <= end; k++) {
          const p = (bottom + 1) * W + k;
          if (!mask[p] || used[p]) { same = false; break; }
        }
        if (!same) break;
        bottom++;
      }
      for (let yy = y; yy <= bottom; yy++) for (let k = x; k <= end; k++) used[yy * W + k] = 1;
      out.push({ x0: x, y0: y, x1: end + 1, y1: bottom + 1 });
      x = end + 1;
    }
  }
  return out;
}

/**
 * The plan itself, as a texture for the floor.
 *
 * Everything the wall mask throws away is exactly what a floor plan is made of:
 * the kitchen counters, the bath fixtures, the cars, the door swing arcs, the
 * stair treads, the window lines. Modelling those would mean guessing at what
 * the drawing already states, badly — the model-geometry attempt invented ten
 * rooms trying.
 *
 * So they are not modelled. The confirmed render is laid on the floor, and the
 * walls rise out of it. Every fixture is then in exactly the right place for
 * the same reason the walls are: it IS the drawing.
 *
 * Wall pixels are knocked back to the floor tone first. They would otherwise
 * show as bright bands around the foot of each extruded wall — the same wall
 * drawn twice, once standing and once lying down.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {{mask:Uint8Array, w:number, h:number, inverted:boolean}} m
 * @param {{x0,y0,x1,y1}} bounds  crop, in mask pixels
 * @param {number} [scale] output pixels per mask pixel — the mask is coarse on
 *   purpose, the texture should not be
 * @returns {HTMLCanvasElement}
 */
/**
 * The most typical colour of the FLOOR in this render, as a css string.
 *
 * "Floor" here means every pixel inside the building's bounds that the wall
 * mask did not claim — which on these renders is floor field, tile grid and
 * fixture outlines, in that order of area. The median lands on the field.
 */
function medianFloorColour(img, m, bounds) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = m.w; c.height = m.h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, srcW, srcH, 0, 0, m.w, m.h);
  const d = cx.getImageData(0, 0, m.w, m.h).data;
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.floor(Math.min(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 120));
  for (let y = bounds.y0; y < bounds.y1; y += step) {
    for (let x = bounds.x0; x < bounds.x1; x += step) {
      const p = y * m.w + x;
      if (m.mask[p] || (m.low && m.low[p])) continue;
      rs.push(d[p * 4]); gs.push(d[p * 4 + 1]); bs.push(d[p * 4 + 2]);
    }
  }
  if (!rs.length) return m.inverted ? '#1a2029' : '#eceae4';
  const mid = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  return `rgb(${mid(rs)}, ${mid(gs)}, ${mid(bs)})`;
}

export function detailTexture(img, m, bounds, scale = 3, opts = {}, drawnBox = null,
  air = null) {
  const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;

  // NEVER FINER THAN THE PICTURE IT IS DRAWN FROM.
  //
  // The mask is always 700px wide (see wallMask), and this built the texture at
  // a fixed 3x of it — 2100px — regardless of the render it was drawing. The
  // renders are 1856px. So the texture was 13% wider than its own source in
  // each axis, which is 22% more pixels than carry any information: the extra
  // is interpolation, and interpolation is not detail.
  //
  // Every one of those pixels was then paid for three times over — the draw,
  // `liftPaper`'s pass, and `fadeSheetEdge`'s pass — which is why this is worth
  // a rule rather than a shrug.
  //
  // IT IS A CAP, NOT A SETTING. It only ever lowers the scale, and only to the
  // point where one texture pixel is one source pixel, so there is no quality
  // question to answer: upscaling cannot add detail, so declining to upscale
  // cannot remove any. A render larger than 2100px still gets the full 3x it
  // asked for, and the day the models draw bigger pictures this stops binding
  // on its own.
  const srcW = img.naturalWidth || img.width || 0;
  const native = srcW && m.w ? srcW / m.w : Infinity;
  const used = Math.max(1, Math.min(scale ?? 3, native));

  const out = document.createElement('canvas');
  out.width = Math.round(bw * used);
  out.height = Math.round(bh * used);
  const ctx = out.getContext('2d');
  scale = used;

  // Where the DRAWING sits inside this crop, in texture pixels. Everything
  // beyond it is sheet and is faded out at the end.
  const db = drawnBox || bounds;
  const inner = {
    x0: Math.round((db.x0 - bounds.x0) * scale), y0: Math.round((db.y0 - bounds.y0) * scale),
    x1: Math.round((db.x1 - bounds.x0) * scale), y1: Math.round((db.y1 - bounds.y0) * scale),
  };
  const srcH = img.naturalHeight || img.height;
  const sx = srcW / m.w, sy = srcH / m.h;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img,
    bounds.x0 * sx, bounds.y0 * sy, bw * sx, bh * sy,
    0, 0, out.width, out.height);

  // Paint out the walls, IN THE RENDER'S OWN FLOOR COLOUR.
  //
  // This used to be one of two hardcoded values picked by polarity — `#eceae4`
  // for a light render, near-black for a dark one. The light render's floor is
  // actually a greige around #D6D2CA, so the paint-out was noticeably PALER
  // than the floor it was patching. Dilating it by a pixel then guaranteed a
  // bright rim would show wherever the extruded box did not exactly cover the
  // patch, which is the light line seen at the foot of every wall.
  //
  // Measured instead of assumed: the median of the floor's own pixels. Median
  // rather than mean, so the fixture linework and the tile grid drawn on the
  // floor cannot drag it. Sampled on a stride because a full pass over a 4k
  // render buys no accuracy on a field this flat.
  const floor = medianFloorColour(img, m, bounds);
  // ONLY WHAT IS ACTUALLY EXTRUDED GETS PAINTED OUT.
  //
  // This also painted out `m.low`, and on a light render that erased most of
  // the floor's drawing. `low` is the mid band between page and wall, and its
  // threshold on a light sheet is "darker than 190" — which is the wall's own
  // drop shadow, the tile grid, and every fixture outline. The floor field
  // itself is around 209 and survived, so whole rooms came out as flat colour
  // with their contents gone: exactly the "floor detail lost in many places".
  //
  // `low` exists to extrude WINDOWS to sill height, and that is off by default
  // (see the note on `detectWindows` below) — so those pixels were being
  // removed to make room for geometry that is never built. It is painted out
  // only when the windows it stands for are actually going to be there.
  const alsoLow = opts.detectWindows && m.low;
  ctx.fillStyle = floor;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      if (!m.mask[y * m.w + x] && !(alsoLow && m.low[y * m.w + x])) continue;
      ctx.fillRect((x - bounds.x0 - 1) * scale, (y - bounds.y0 - 1) * scale,
        scale * 3, scale * 3);
    }
  }
  // The air mask is in MASK pixels; the texture is a scaled crop of the sheet.
  // This is the lookup between them, and getting it wrong is how the window
  // depths came out 41% off, so it is written once and used once.
  const isAir = air
    ? (tx, ty) => {
      const mx = Math.round(bounds.x0 + tx / scale), my = Math.round(bounds.y0 + ty / scale);
      if (mx < 0 || my < 0 || mx >= m.w || my >= m.h) return true;
      return !!air[my * m.w + mx];
    }
    : null;
  liftPaper(ctx, out, inner, opts.sheetBg, isAir);
  fadeSheetEdge(ctx, out, inner, opts.sheetBg);
  return out;
}

/**
 * Move the render's PAPER toward the scene's ground, and leave the drawing.
 *
 * The edge fade only touches pixels beyond the drawing's own box, so the paper
 * INSIDE that box — the gaps between the building and a deck, the margin the
 * plan was drawn with — kept the render's paper tone at full strength. On a
 * dark render under a light scene those gaps are near-black slabs sitting in a
 * near-white viewport, which is the ground still reading as dark.
 *
 * It cannot be done geometrically. Everything in that box is drawing as far as
 * a rectangle is concerned, and a deck is drawing that must not be washed out.
 * So it is done by COLOUR: each pixel moves toward the ground in proportion to
 * how close it already is to the paper. Paper moves nearly all the way, the
 * deck's cream hatch and the plan's own ink barely move at all, and nothing has
 * to know where anything is.
 *
 * The paper tone is measured from the texture's own corners rather than
 * assumed, for the same reason the floor tone is: the render decides it, and
 * the two themes do not agree about what paper looks like.
 */
function liftPaper(ctx, canvas, inner, sheetBg, isAir) {
  const bg = Array.isArray(sheetBg) ? sheetBg : null;
  if (!bg) return;
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // THE PAPER IS READ FROM THE RING JUST OUTSIDE THE DRAWING, not from the
  // canvas corners.
  //
  // The corners are the obvious place and they are the wrong place: this crop
  // is taken at the SHEET's box, which can reach past the source image, so the
  // corners are frequently transparent. Sampling them returned [0,0,0] — black
  // — and black-as-paper would drag the plan's own ink toward the background
  // instead of the paper. Every sample is therefore required to be opaque.
  const ring = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    if (d[p + 3] === 255) ring.push([d[p], d[p + 1], d[p + 2]]);
  };
  const PAD = Math.max(2, Math.round(Math.min(W, H) * 0.01));
  for (let x = inner.x0; x < inner.x1; x += 3) {
    push(x, inner.y0 - PAD); push(x, inner.y1 + PAD);
  }
  for (let y = inner.y0; y < inner.y1; y += 3) {
    push(inner.x0 - PAD, y); push(inner.x1 + PAD, y);
  }
  // No opaque sheet to measure means no sheet to lift. Leave it alone rather
  // than lift it toward a colour we guessed.
  if (ring.length < 16) return;
  const mid = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const paper = [mid(ring.map((c) => c[0])), mid(ring.map((c) => c[1])),
    mid(ring.map((c) => c[2]))];

  // How much the sheet differs from itself, as the 90th percentile of its own
  // samples' distance from its median. The percentile rather than the maximum,
  // so one stray sample that caught a dimension line cannot widen the threshold
  // enough to swallow the ink it came from.
  const spreads = ring
    .map((c) => Math.abs(c[0] - paper[0]) + Math.abs(c[1] - paper[1]) + Math.abs(c[2] - paper[2]))
    .sort((a, b) => a - b);
  const near = paperNear(spreads[Math.floor(spreads.length * 0.9)]);

  // THE BUILDING IS NEVER LIFTED, whatever colour its floors happen to be.
  //
  // Colour alone is not enough, and the garage is the proof: its concrete slab
  // sits within the threshold of the sheet's own tone, so it lifted too — and
  // because it lifted only where its mottling fell inside the cut, it came out
  // speckled, with the cars reduced to dotted outlines. No threshold separates
  // them, because there is genuinely nothing to separate: the two tones are the
  // same. What distinguishes them is not colour but WHERE THEY ARE.
  //
  // So the lift is confined to the open air around the building — what a flood
  // from the sheet edge reaches. Inside, the render is left exactly as drawn.
  // The deck is outside and is still protected, by colour, as before.
  const out = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 255) continue;
    if (isAir && !isAir((i >> 2) % W, (i >> 2) / W | 0)) continue;
    liftPixel([d[i], d[i + 1], d[i + 2]], paper, bg, near, out);
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Dissolve the sheet OUTSIDE the drawing, so the ground stops ending in a hard
 * rectangle of paper.
 *
 * The ground had to grow past the walls so a porch would stop being sliced off,
 * and that brought the render's own paper with it: a pale wedge lying beside the
 * porch where the property ends. Reported as "why is this space here when it is
 * not on the plan".
 *
 * THREE WAYS OF FINDING THAT PAPER WERE MEASURED, AND ALL THREE FAILED. The
 * numbers are kept because each looks reasonable until it is run.
 *   - By colour: the light render's paper is (231,225,215) and its room floor
 *     (215,208,199). Sixteen apart, because the prompt asks for a floor "subtly
 *     darker than the background". Loose enough to catch the paper is loose
 *     enough to catch the floor, and the first attempt cleared 67% of the
 *     texture including the middle of the house.
 *   - By flood: a doorway is a real gap in a real wall, so a flood from outside
 *     walks straight in. This file's own header says exactly that at line 24,
 *     and it was tried twice anyway.
 *   - By distance from ink: the furthest point INSIDE this building is 127px
 *     from any ink; the corner OUTSIDE is 42px. No threshold separates them.
 *
 * So nothing is detected. The drawing's bounding box is already known, and the
 * sheet fades to nothing beyond it. Bounds arithmetic, no colour test, no
 * flood, no threshold, identical in both themes.
 */
// How far the sheet outside the drawing sits toward the scene's own ground
// before the fade ramp even starts. At 0 the ring beside the building is the
// render's paper at full strength; at 1 it is the background exactly and there
// is no surface at all. 0.8 leaves it readable as a surface and barely darker.
const SHEET_TO_BG = 0.8;

function fadeSheetEdge(ctx, canvas, inner, sheetBg) {
  // THE SHEET DISSOLVES INTO THE SCENE, in colour as well as in alpha.
  //
  // Alpha alone is not enough, and the reason is arithmetic. The dark scene's
  // ground sits at 27 and its paper at 51, twenty-four apart; the light scene's
  // ground is 248 and its paper about 215, forty-three apart. Half-faded, the
  // dark sheet lands within a few steps of its background and vanishes, while
  // the light one is still twenty clear of it and reads as a bright slab.
  //
  // An earlier attempt darkened the light sheet by 10%, which made it WORSE:
  // the light background is nearly white, so moving the paper down moved it
  // further away. The direction that works is not "darker", it is "toward the
  // background", and that is different in each theme.
  //
  // So the caller passes the scene's own ground colour and the sheet is mixed
  // into it along the same ramp that fades it out. At the drawing's edge it is
  // untouched paper; at the frame's edge it is the background exactly, and
  // transparent as well.
  const bg = Array.isArray(sheetBg) ? sheetBg : null;
  const W = canvas.width, H = canvas.height;
  if (inner.x0 <= 0 && inner.y0 <= 0 && inner.x1 >= W && inner.y1 >= H) return;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const left = Math.max(1, inner.x0), top = Math.max(1, inner.y0);
  const right = Math.max(1, W - inner.x1), bottom = Math.max(1, H - inner.y1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ox = x < inner.x0 ? (inner.x0 - x) / left
        : x >= inner.x1 ? (x - inner.x1 + 1) / right : 0;
      const oy = y < inner.y0 ? (inner.y0 - y) / top
        : y >= inner.y1 ? (y - inner.y1 + 1) / bottom : 0;
      const t = Math.min(1, Math.max(ox, oy));
      if (t <= 0) continue;
      // Smoothstep, not a straight ramp: a linear fade shows its own starting
      // line, which is the edge being removed.
      const p = (y * W + x) * 4;
      const k = t * t * (3 - 2 * t);          // smoothstep, so the ramp shows no start line
      d[p + 3] = Math.round(255 * (1 - k));
      if (bg) {
        // IT STARTS NEAR THE BACKGROUND, it does not travel there.
        //
        // The ramp used to begin at untouched paper and only reach the scene's
        // ground at the frame's edge, so the ring closest to the building wore
        // the render's own paper colour at full strength. On a dark render
        // that ring is charcoal against a near-white scene, which is the dirty
        // grey halo Saman reported.
        //
        // Ground is ground. The paper it is printed on is not a thing the
        // model should be showing off, so the outer sheet sits most of the way
        // to the background everywhere and the ramp only carries the last of
        // it. A little darker than the background, which is what reads as a
        // surface rather than as empty space.
        const mix = SHEET_TO_BG + (1 - SHEET_TO_BG) * k;
        d[p] = Math.round(d[p] + (bg[0] - d[p]) * mix);
        d[p + 1] = Math.round(d[p + 1] + (bg[1] - d[p + 1]) * mix);
        d[p + 2] = Math.round(d[p + 2] + (bg[2] - d[p + 2]) * mix);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The open air around the building — the flood, with every opening bridged
 * first so it cannot walk in through a doorway.
 *
 * ONE LEAK SURVIVES AND IS KNOWN: the garage. Two attempts at closing it were
 * measured on test/air-probe.html and BOTH failed, leaving Jordan at exactly
 * 57.9% either way:
 *
 *   - widening the bridge cap to a quarter of the sheet, on the theory that a
 *     garage door is simply too wide to bridge. Only Sky moved, by 0.2%.
 *   - sealing the flood with the mid-tone layer as well as the wall mask, on
 *     the theory that the garage door is drawn as a thin line and so lands in
 *     `low`. It bridged more openings on four plans and still not that one.
 *
 * So the garage front is neither a wide gap nor mid-tone ink, and what it
 * actually is has not been established. The cost is contained: the garage slab
 * is toned as sheet, which on a plan whose slab happens to match the paper
 * shows as speckle across that one room. Recorded rather than papered over,
 * because a third guess should start from a measurement, not from this comment.
 */
export function sheetAir(walls, W, H) {
  const segs = wallSegments(walls, W, H);
  const gaps = [...collinearGaps(segs.horizontal, true), ...collinearGaps(segs.vertical, false)];
  return sealedOutside(walls, W, H, gaps);
}

/**
 * A raw flood from the sheet edge. NOT an inside/outside test on its own.
 *
 * "Rooms are enclosed, so a flood never reaches them" is the assumption this
 * was written on, and test/air-probe.html refuted it in one look: on the five
 * styled fixtures the flood claimed 91.9 / 97.4 / 95.5 / 93.7 / 91.1% of the
 * sheet, which with walls at 2.6-8.9% is everything there is. It walks in
 * through every doorway, because a doorway is a real hole in a real wall.
 *
 * Bridging the openings first — `sealedOutside` in openings.js, which already
 * existed for the exterior test — brings the same five to 57.9 / 64.4 / 48.1 /
 * 44.5 / 54.5%, and the probe shows red hugging the outside of the walls with
 * every room excluded. That is the function to use. This one is kept only
 * because the probe contrasts the two, and the contrast is the evidence.
 *
 * @param {Uint8Array} walls the sealed wall mask
 */
export function outsideAir(walls, W, H) {
  const out = new Uint8Array(W * H);
  const stack = [];
  const push = (p) => { if (!walls[p] && !out[p]) { out[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < W * (H - 1)) push(p + W);
  }
  return out;
}

/**
 * Connected components of a mask, as bounding boxes with a fill count.
 * Iterative flood fill — a recursive one blows the stack on a long wall.
 */
export function components(mask, W, H) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p - x) / W;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n });
  }
  return out;
}

/**
 * The discarded rectangles that were HOLDING THE WALL NETWORK TOGETHER.
 *
 * THE BUG THIS EXISTS FOR. `traceRects` tiles the wall ink losslessly, so the
 * rectangles it returns are connected exactly as the ink is. The size test then
 * throws away everything too small to be a wall — furniture, fixtures, dust —
 * and it judges each rectangle ALONE. Two kinds of real wall lose that test:
 *
 *   * the one-pixel slivers the tiling leaves where two wall runs meet, and
 *   * EVERY RECTANGLE OF A DIAGONAL WALL. A rectangle cannot be diagonal, so a
 *     wall at an angle is tiled into a comb of one-pixel columns, each of them
 *     short. This is the one Saman photographed four times: on his plan the
 *     comb runs from x=190 to x=205 and all sixteen columns are discarded, so
 *     the diagonal wall is not seamed in the model — it is ABSENT, and the two
 *     square walls it used to join stand four inches apart.
 *
 * `localWallPx` exists to rescue exactly this: keep a piece the size test hates
 * if the INK it sits in is as thick as a wall. It refuses the comb by two
 * percent — those columns measure 5.83 against a floor of 5.94 — and the reason
 * is geometry, not a bad threshold. A wall drawn at an angle is genuinely
 * thinner ACROSS than the same wall drawn square: measured with an exact
 * Euclidean transform this one is 5.33 where the plan's walls are 6. Loosening
 * the threshold to admit it would admit a great deal else, and it would be a
 * number chosen to make one plan pass.
 *
 * SO THE RULE IS CONNECTIVITY, AND IT IS NOT ABOUT SIZE AT ALL. A discarded
 * piece comes back if the wall network needs it to be whole. Rescuing a piece
 * because it TOUCHES two kept walls was tried before and refuted — the tiling
 * makes almost every piece flush with its neighbours, so the test stopped
 * testing and 27 of 29 dropped pieces came back on The Avi Top. Touching two
 * neighbours proves nothing when those neighbours are already joined by another
 * route.
 *
 * The question that does work is asked of the discarded ink as a WHOLE, not
 * piece by piece: flood the dropped pixels into connected groups, and restore a
 * group if it touches two DIFFERENT kept pieces. A comb of sixteen columns is
 * one group running from the horizontal wall to the vertical one, and it comes
 * back entire — which is what an earlier one-rectangle-at-a-time version could
 * not do, because no single column of a comb touches two kept walls. Furniture
 * against a wall is a group touching ONE kept piece and stays out. Dust in the
 * middle of a room touches none.
 *
 * No threshold, no tuning, and nothing about how big a piece is.
 *
 * IN THE INK ONLY, NOT IN `walls`. These pieces are thinner than a wall, so
 * `thickenStubs` would widen each one into a full-thickness nub standing proud
 * of the junction. They are here to restore a connection, not to be drawn, and
 * the rectangle list stays exactly as it ships — window mapping, label anchoring
 * and every guard in view3d read it unchanged.
 *
 * @param {Array<{x0,y0,x1,y1}>} all every rectangle the tiling produced
 * @param {Array<{x0,y0,x1,y1}>} kept the ones the size test allowed through
 * @returns {Array} the subset of the rest that reconnects the network
 */
export function bridgingRects(all, kept, W, H) {
  const keptSet = new Set(kept);
  const dropped = all.filter((r) => !keptSet.has(r));
  if (!dropped.length || !kept.length) return [];

  // Kept ink, labelled by piece; dropped ink, labelled by which rectangle owns
  // each pixel. Both in one pass over the rectangles rather than over the mask.
  const keptLab = new Int32Array(W * H);
  const owner = new Int32Array(W * H);
  const fill = (buf, r, v) => {
    for (let y = Math.max(0, r.y0); y < Math.min(H, r.y1); y++) {
      for (let x = Math.max(0, r.x0); x < Math.min(W, r.x1); x++) buf[y * W + x] = v;
    }
  };
  for (const r of kept) fill(keptLab, r, -1);
  dropped.forEach((r, i) => fill(owner, r, i + 1));

  const stack = [];
  let piece = 0;
  for (let s = 0; s < W * H; s++) {
    if (keptLab[s] !== -1) continue;
    piece++; keptLab[s] = piece; stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      const x = p % W;
      if (x > 0 && keptLab[p - 1] === -1) { keptLab[p - 1] = piece; stack.push(p - 1); }
      if (x < W - 1 && keptLab[p + 1] === -1) { keptLab[p + 1] = piece; stack.push(p + 1); }
      if (p >= W && keptLab[p - W] === -1) { keptLab[p - W] = piece; stack.push(p - W); }
      if (p < W * (H - 1) && keptLab[p + W] === -1) { keptLab[p + W] = piece; stack.push(p + W); }
    }
  }

  // Each group of connected dropped ink, with the kept pieces along its edge.
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let s = 0; s < W * H; s++) {
    if (!owner[s] || seen[s]) continue;
    const touches = new Set();
    const members = new Set();
    seen[s] = 1; stack.push(s);
    const group = [];
    while (stack.length) {
      const p = stack.pop();
      group.push(p);
      members.add(owner[p]);
      const x = p % W;
      const step = (q, ok) => {
        if (!ok) return;
        if (keptLab[q] > 0) { touches.add(keptLab[q]); return; }
        if (owner[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      };
      step(p - 1, x > 0);
      step(p + 1, x < W - 1);
      step(p - W, p >= W);
      step(p + W, p < W * (H - 1));
    }
    if (touches.size >= 2) for (const i of members) out.push(dropped[i - 1]);
  }
  return out;
}

/**
 * Which of the mid-tone components are actually windows.
 *
 * WHY A SHAPE TEST AND NOT JUST A BRIGHTNESS ONE. The band between page and
 * wall does not contain only windows. Antialiased wall edges, the soft side of
 * a shadow and parts of the furniture all land in it, so thresholding alone
 * returns dozens of scraps. Extruded, those render as thin posts standing
 * inside the walls — which is exactly what the first version did.
 *
 * A window is not a brightness, it is a shape: a band lying ALONG a wall, about
 * as thick as that wall, several times longer than it is thick, solid rather
 * than scattered, and closed off by wall at both ends. Anything failing those
 * is a shadow or an edge.
 *
 * Pure, so the counts can be checked in node against what a plan actually has —
 * the point being that "six windows" is verifiable and "39 rectangles" is not.
 *
 * @returns {{x0,y0,x1,y1,horizontal:boolean}[]} in mask pixels
 */
export function windowBands(low, solid, W, H, opts = {}) {
  const minRatio = opts.minRatio ?? 2.5;   // longer than it is thick, clearly
  const minThick = opts.minThick ?? 1;
  const maxThick = opts.maxThick ?? 14;
  const minFill = opts.minFill ?? 0.55;    // a band, not a spray of pixels
  const minLen = opts.minLen ?? 6;

  const at = (x, y) => (x >= 0 && x < W && y >= 0 && y < H) ? solid[y * W + x] : 0;
  const out = [];
  for (const c of components(low, W, H)) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    const long = Math.max(w, h), thick = Math.min(w, h);
    if (long < minLen) continue;
    if (thick < minThick || thick > maxThick) continue;
    if (long / thick < minRatio) continue;
    if (c.n / (w * h) < minFill) continue;

    // MEASURED, not assumed: the ends of these bands are 13 to 25 pixels away
    // from any wall, so a window is NOT a gap in the wall mask. The renders draw
    // a window as a lighter band running ALONGSIDE an unbroken wall. An earlier
    // version tested for wall beyond each end and rejected all six.
    //
    // So the test is contact along the length: a window lies against a wall for
    // most of its run. A shadow cast into a room does not.
    const horizontal = w >= h;
    let touching = 0;
    const len = horizontal ? w : h;
    for (let i = 0; i < len; i++) {
      const x = horizontal ? c.x0 + i : 0, y = horizontal ? 0 : c.y0 + i;
      const hit = horizontal
        ? (at(x, c.y0 - 2) || at(x, c.y1 + 1))
        : (at(c.x0 - 2, y) || at(c.x1 + 1, y));
      if (hit) touching++;
    }
    if (touching / len < (opts.minTouch ?? 0.5)) continue;

    out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, horizontal });
  }
  return out;
}

/** The mask's own bounding box — the building, without the render's margins. */
export function maskBounds(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Wall rectangles in FEET, ready to extrude.
 *
 * `widthFt` is the one number this cannot read off the drawing: a plan carries
 * no scale bar, and the render's margins mean the image's own width is not the
 * building's. It is a single scalar, so getting it slightly wrong scales the
 * whole model uniformly and never distorts it — unlike the per-room error the
 * model-produced geometry had.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img  the confirmed 2D render
 * @param {number} widthFt  the building's width, from the confirmed record
 * @returns {{walls:Array, extent:Object, rects:number, inverted:boolean}}
 */
/**
 * Reject the fragments the tracer finds and calls walls.
 *
 * MEASURED on four plans, and it took three attempts because each of the two
 * obvious rules is wrong on its own:
 *
 *  - A THICKNESS rule kills the long thin lines that run along real walls —
 *    the biggest things it discards are 25 x 0.07ft and 15 x 0.07ft.
 *  - A LENGTH rule keeps slivers up to 2.9 x 0.07ft, which stand in the model
 *    as black splinters at full wall height. Those are the specks that survived
 *    the first fix and were still visible on screen.
 *
 * The two together separate cleanly, because thinness only means dust when the
 * piece is also SHORT:
 *
 *     thin and short  ->  dust            12-34 per plan, largest 2.9 x 0.07ft
 *     thin and long   ->  a wall's edge   3-9 per plan, 3 to 12.7ft
 *     neither         ->  an ordinary wall
 *
 * The absolute floor stays too: nothing under 0.5ft in its LONGEST direction is
 * a wall, and at six inches the largest casualty across four plans is a
 * six-inch square.
 */
export const isWallSized = (minFt = 0.5, thinFt = 0.25, shortFt = 3, floorFt = 0) => (r) => {
  const long = Math.max(r.x1 - r.x0, r.z1 - r.z0);
  const thick = Math.min(r.x1 - r.x0, r.z1 - r.z0);
  // A SQUARE OF WALL IS A WALL, however short. The note above says the absolute
  // floor's largest casualty across four plans is a six-inch square — and a
  // six-inch square of wall is exactly the nib between two openings. Saman
  // found the one this drops: the post between a window and a door on The Avi
  // Top, 0.44 x 0.35ft, thrown away for being 0.06ft under a constant while
  // being exactly as thick as that plan's own walls in BOTH directions.
  //
  // Dust is thin by definition. Something carrying the plan's full wall
  // thickness across its short side is not dust, whatever its length, so it
  // never reaches the two rules below.
  // A PERCENT OF SLACK, and it is not decoration. The thickness arrives through
  // the coordinate mapping and the floor through a separate multiplication, so
  // a piece measured at exactly one wall thickness lands a bit under the floor
  // in the last bits of the float. That is what happened first: the nib tested
  // true in isolation and was still dropped inside extrudeWalls, and the two
  // numbers printed identical to sixteen digits. Anything within a percent of
  // the plan's wall thickness IS the plan's wall thickness.
  if (floorFt > 0 && thick >= floorFt * 0.99) return true;
  if (long < minFt) return false;
  return !(thick < thinFt && long < shortFt);
};

/**
 * How far the BUILDING reaches, ignoring anything too small to be a wall.
 *
 * The mask's own bounding box was used, and it is set by whatever pixel happens
 * to lie furthest out. On The Avi Top that was a pair of ten-pixel squares: the
 * covered deck's corner posts. They cleared the wall-size test — ten pixels is
 * about 0.6ft, over its 0.5ft floor — and they showed up on the light render
 * but not the dark one, because the outdoor hatch is specified at #B8B3A9,
 * luminance 184, and the dark render's wall threshold is 190. Six units.
 *
 * The consequence was a building 20% different in shape between the two looks
 * of the same floor, so walls traced from one stood in a frame a fifth larger
 * than the plan drawn by the other.
 *
 * MEASURED, both pairs. Requiring a piece to span at least 4% of the plan
 * before it may define the extent takes The Avi Top from 20.25% apart to 0.26%,
 * with the top edge landing on 0.244 in both, and leaves The Avi Main — which
 * already agreed — untouched at 0.16%.
 *
 * Four percent is a long way below any real wall and a long way above a post,
 * a door stop or a speck. It is a floor on what counts as structure, not a
 * threshold tuned to one drawing.
 */
const EXTENT_MIN_SPAN = 0.04;

function buildingBounds(m) {
  const raw = maskBounds(m.mask, m.w, m.h);
  if (!raw) return null;
  const span = Math.max(raw.x1 - raw.x0, raw.y1 - raw.y0);
  const big = components(m.mask, m.w, m.h)
    .filter((c) => Math.max(c.x1 - c.x0, c.y1 - c.y0) >= span * EXTENT_MIN_SPAN);
  if (!big.length) return raw;
  return big.reduce((a, c) => ({
    x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0),
    x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1),
  }), { x0: m.w, y0: m.h, x1: 0, y1: 0 });
}

// THE NOTCH AT A WALL JUNCTION, diagnosed and not yet fixed.
//
// A corner traces as its own small rectangle and the size test drops it, so two
// walls arrive at a junction and stop a step short of each other. That gap is
// what shows in the 3D as a wall left open, and it is visible on The Avi Top
// between the closet and BEDROOM-2.
//
// Rescuing a piece because it touches two kept walls DOES NOT WORK, and the
// reason is structural rather than a matter of tuning: `traceRects` tiles the
// mask, so every piece is flush with its neighbours and almost all of them
// satisfy the test. Measured, it re-admitted 27 of 29 dropped pieces on The Avi
// Top and 46 on Geena — the filter stops being a filter.
//
// Whatever fixes this has to distinguish a corner from a stub by SHAPE or by
// how the neighbours are oriented, not by contact alone.

export function extrudeWalls(img, widthFt, opts = {}) {
  const m = wallMask(img, opts);
  const bounds = buildingBounds(m);
  if (!bounds) return { walls: [], extent: null, rects: 0, inverted: m.inverted, floor: null };

  const px = widthFt / (bounds.x1 - bounds.x0);   // feet per pixel
  // The floor's own tone, measured once here so both the texture and the label
  // colour read the same number. medianFloorColour returns a css string; this
  // is the same measurement kept as components.
  // MEASURED WHEN IT IS ASKED FOR, not on the way past. Its only consumer is
  // `floorTone` in the returned object, and it costs about 600ms of the 2.4s
  // this function takes — so on the published-reading path, where the tone
  // arrives in the record, computing it here was the single largest piece of
  // work being done to produce a number we already had.
  let floorMemo = null;
  const floorRGB = () => (floorMemo ||= (() => {
    const css = medianFloorColour(img, m, bounds);
    const n = css.match(/\d+/g);
    return n ? n.slice(0, 3).map(Number) : [128, 128, 128];
  })());
  const toX = (v) => (v - bounds.x0) * px;
  const toZ = (v) => (v - bounds.y0) * px;

  // WHAT THE DRAWING COVERS, which is more than what the WALLS cover.
  //
  // A porch, deck or patio lies OUTSIDE the exterior walls, so the wall mask's
  // bounds cut straight through it: the floor texture stopped at the building
  // line and the porch came out sliced off, or missing entirely under the slab.
  //
  // `low` is every drawn pixel that is not wall — hatching included — so the
  // union of the two is the drawing's own extent. Nothing new is measured; this
  // is the mask that was already being computed and, until now, painted over.
  //
  // SCALE STILL COMES FROM THE WALLS. `px` above is feet-per-pixel across the
  // building, and the model's extent stays the building's. Only the ground the
  // plan is printed on gets larger, and it may extend to negative coordinates —
  // a porch in front of the entrance is genuinely outside the footprint.
  //
  // Clamped to half the building beyond each side, so a speck of noise in a
  // corner cannot stretch the ground across the scene.
  // The full page the model drew on. The styling prompt fixes a 7-8% margin on
  // every side, so this is the drawing plus its own paper, and it is symmetric
  // by construction.
  const sheet = { x0: 0, y0: 0, x1: m.w, y1: m.h };
  const drawn = new Uint8Array(m.w * m.h);
  for (let i = 0; i < drawn.length; i++) drawn[i] = (m.mask[i] || (m.low && m.low[i])) ? 1 : 0;
  const content = (() => {
    const c = maskBounds(drawn, m.w, m.h) || bounds;
    const padX = (bounds.x1 - bounds.x0) * 0.5, padY = (bounds.y1 - bounds.y0) * 0.5;
    return {
      x0: Math.max(c.x0, bounds.x0 - padX), y0: Math.max(c.y0, bounds.y0 - padY),
      x1: Math.min(c.x1, bounds.x1 + padX), y1: Math.min(c.y1, bounds.y1 + padY),
    };
  })();

  const toRects = (mask) => traceRects(mask, m.w, m.h).map((r) => ({
    x0: toX(r.x0), z0: toZ(r.y0), x1: toX(r.x1), z1: toZ(r.y1),
  }));
  // Gaps narrower than a door are closed before the mask is cut into
  // rectangles, so the tracer never sees the notch and there is nothing for the
  // size filter to drop. See closeNarrowGaps for the measurement behind 1.25.
  const maxGapFt = opts.maxGapFt === undefined ? 1.25 : opts.maxGapFt;
  const sealed = closeNarrowGaps(m.mask, m.w, m.h, maxGapFt / px);
  // The plan's own wall thickness, measured once and used three times: to keep
  // a nib that is as thick as a wall, to widen anything thinner than one, and
  // to recognise a slice of a wall that the size test would otherwise discard.
  const floorPx = wallFloorPx(m.mask, m.w, m.h);
  const floorFt = floorPx * px;

  // ---- THE TEXTURE, and the one thing a published floor cannot bring with it.
  //
  // Everything the floor picture needs has now been computed, and everything
  // BELOW this line is analysis: the distance transform, the segment tracing,
  // the opening detection, the outlines.
  //
  // That analysis is a pure function of the render, so it does not have to
  // happen on the visitor's phone at all. It happens once, on the machine that
  // publishes the floor, and travels with it — 2.8 KB gzipped beside a 1.5 MB
  // image. The texture cannot travel: it is a canvas built from the picture and
  // has to be built wherever it is drawn.
  //
  // WHAT IT IS WORTH, measured cold — one page load, one call, which is the
  // only shape a visitor ever runs this in. On The Sky: 2076ms becomes 1503ms,
  // so 573ms or 28%. The analysis alone is 367ms; the rest of the saving is the
  // floor tone, which the record carries and which is measured lazily below for
  // that reason.
  //
  // IT IS NOT THE BOTTLENECK, and the honest note is that this was expected to
  // save far more. `detailTexture` is about 1100ms of what remains — the floor
  // picture, not the reading of it. The next real win is a smaller texture, and
  // this change is what makes that safe to consider: once the reading travels,
  // the image is only a picture, not the source of the building's geometry.
  const floorTexture = () => (opts.floor === false ? null
    : detailTexture(img, m, sheet, opts.textureScale, opts, content,
      sheetAir(sealed, m.w, m.h)));

  // A PUBLISHED READING, USED ONLY IF IT IS THE SAME READING.
  //
  // The mask dimensions are derived from the image, so equal dimensions mean
  // the same picture at the same scale; the version means the same code drew
  // the conclusions. Either check failing falls through to the full analysis
  // below, which is what happens today — so the worst case of this whole path
  // is exactly the behaviour it replaces, and a stale record can never show a
  // visitor a building we would not draw ourselves.
  const shipped = opts.geometry;
  if (shipped && shipped.version === GEOMETRY_VERSION
      && shipped.maskW === m.w && shipped.maskH === m.h && shipped.extent) {
    // AND IT CAN STILL CUT ITS OWN OPENINGS.
    //
    // The outlines in the record were traced from solid walls, because a
    // window's position comes from the confirmed record and can change after a
    // floor is published — so they cannot be published with the holes already
    // in them. Without this a published floor showed every window bricked up
    // the moment outlines were switched on, which is why they were behind a
    // flag.
    //
    // The cost is paid only when there is something to cut: with no openings
    // the published outlines are handed straight back, untouched and free.
    // `bounds`, `px` and `floorPx` above are read from the picture, not from
    // the record, and this branch only runs when the picture matches.
    const frame = { bounds, px, floorPx, toX, toZ };
    const reshape = (openings) => (openings?.length && shipped.inkRects
      ? traceOutlines(shipped.inkRects, frame, openings)
      : (shipped.shapes || []));
    return {
      ...shipped, reshape, inverted: m.inverted, floor: floorTexture(), fromPublished: true,
    };
  }

  // A SLICE OF A WALL IS STILL A WALL, and the distance transform is what can
  // say so.
  //
  // `traceRects` tiles the mask, so a wall of one thickness can come back as
  // two rectangles side by side, each thinner than the wall. Where both
  // survive, they cover it between them and nothing is wrong. Where the size
  // test keeps one and drops the other, the wall renders thin — and at a
  // junction, where the corner comes off as its own small piece, it renders
  // with a notch. That notch has been in this file's comments as diagnosed and
  // unfixed since the beginning.
  //
  // The old attempt was to rescue a piece because it TOUCHES two kept walls,
  // and it was measured and refuted: the tiling makes almost every piece flush
  // with its neighbours, so the filter stopped filtering — 27 of 29 dropped
  // pieces came back on The Avi Top. The note that followed said whatever fixes
  // this has to work by SHAPE or by how the neighbours are ORIENTED. It turns
  // out to be neither: it works by asking how thick the INK is where the piece
  // sits, which is a fact about the drawing rather than about the piece.
  //
  // Measured across the six test plans, pieces the size test discards that the
  // transform recognises as slices of a real wall: avitop 1, geena 7, jordan 8,
  // sky 7, madison 7, avimain 2. No arrangement of the pieces' own dimensions
  // separates those from the dust beside them, and one lookup does.
  //
  // An earlier probe put avitop at eight rather than one. That probe ran before
  // the minus-one correction in `localWallPx`, so every thickness came back a
  // pixel fat and seven pieces cleared the floor that should not have. The
  // correction is verified against bars of known width; the smaller number is
  // the true one.
  //
  // COST: the transform is two raster passes over the mask, 4 to 14ms on these
  // plans, and the lookup runs only on pieces the size test already rejected,
  // which is a few dozen small rectangles. Extrusion as a whole takes 300 to
  // 430ms, so this is around 3% of it — an earlier commit message guessed
  // "roughly 150ms before" without measuring, and that was wrong.
  const dist = distanceTransform(sealed, m.w, m.h);
  const sized = isWallSized(opts.minWallFt, undefined, undefined, floorFt);
  const allPx = traceRects(sealed, m.w, m.h);
  const keptPx = allPx.filter((r) => {
    if (sized({ x0: 0, z0: 0, x1: (r.x1 - r.x0) * px, z1: (r.y1 - r.y0) * px })) return true;
    return localWallPx(dist, m.w, r) >= floorPx * 0.99;
  });
  // AND PUT BACK WHATEVER THAT FILTER HAD BEEN HOLDING TOGETHER. The size test
  // judges each rectangle alone and cannot see that some of them are junctions,
  // so it cuts the wall network into pieces — the slot in every screenshot. See
  // `bridgingRects`.
  const bridges = opts.bridge === false ? [] : bridgingRects(allPx, keptPx, m.w, m.h);
  // How thick the ink is under each kept rectangle, which is what tells a stub
  // from a slice of a curve. The same lookup the size filter above already
  // makes, kept rather than recomputed.
  const inkThickFt = keptPx.map((r) => localWallPx(dist, m.w, r) * px);
  const toFt = (r) => ({ x0: toX(r.x0), z0: toZ(r.y0), x1: toX(r.x1), z1: toZ(r.y1) });
  // BOTH LISTS DESCRIBE THE SAME INK, and until now only one of them did.
  //
  // The bridges were held out of `walls` for a good reason that has since gone:
  // they are thinner than a wall, so `thickenStubs` would have widened each one
  // into a nub standing proud of its junction. Adding them and letting that
  // happen puts a circular building's rectangles at 134.7% of its ink.
  //
  // So they are appended AFTER the widening and never subjected to it, which is
  // right on its own terms: a bridge is not a stub. A stub is a piece of wall
  // the drawing rendered lean, and widening it restores what was drawn. A
  // bridge is a restored CONNECTION, and a connection widened is a nub.
  //
  // What it buys, as the share of wall ink the rectangle list covers:
  //
  //   circular building  55.1% -> 100.0%     sky      99.3% -> 100.0%
  //   bowed front wall   99.8% -> 100.0%     avitop   99.7% -> 100.0%
  //   orthogonal        100.0% -> 100.0%     another  99.8% -> 100.0%
  //
  // Eleven plans, real and drawn, all at 100.0%. And the share sitting OFF the
  // ink does not move on any of them, to the decimal — which it cannot, because
  // a bridge is ink by construction.
  const walls = thickenStubs(keptPx.map(toFt), floorFt, 3, inkThickFt)
    .concat(bridges.map(toFt));

  // THE SAME WALLS, AS OUTLINES.
  //
  // `walls` above is the rectangle list the model has always been built from,
  // and it is kept: the window mapping, the label anchoring and every guard in
  // view3d read it. What is added is the same ink described as boundaries —
  // one closed ring per connected wall network, with a hole for each room it
  // encloses — which is what the 3D can extrude as a single solid instead of a
  // pile of boxes. See src/model3d/outline.js for why that matters and what it
  // cost to get right.
  //
  // Built from the KEPT rectangles rather than the raw mask, so everything the
  // size test already screens out — fixtures, furniture, the odd dark blob —
  // stays out of the walls here too.
  // CLIPPED TO THE BUILDING, and with a margin of empty pixels around it.
  //
  // Traced on the raster as it stands, any ink that reaches the edge of the
  // image gives a ring that runs along the border — and on Plan A that came
  // back as a 4-vertex rectangle from -2.3 to 42.3ft, bigger than the building,
  // which extrudes as a slab over the whole floor. Worse, being the largest
  // ring it also decided which winding meant "outer", so every room's ring was
  // classified as an outline too and nothing came back as a hole.
  //
  // One pixel of margin on each side is what guarantees a ring can close around
  // a blob that touches the trim line, instead of running along the border.
  const frame = { bounds, px, floorPx, toX, toZ };
  const inkRects = keptPx.concat(bridges);
  const shapes = traceOutlines(inkRects, frame, null);
  const reshape = (openings) => (openings?.length
    ? traceOutlines(inkRects, frame, openings) : shapes);
  // OFF BY DEFAULT, and it should stay that way. Measured on Jordan, the shape
  // test passes six plausible bands and every one of them turns out to sit 13
  // to 25 pixels clear of any wall — so brightness cannot locate a window in
  // these renders. Window positions come from the confirmed record instead:
  // see windowsFromRecord in geometry.js. This is kept only so the next person
  // who tries can see what was tried and what it measured.
  const bands = opts.detectWindows ? windowBands(m.low, m.mask, m.w, m.h, opts) : [];
  const windows = bands.map((b) => ({
    x0: toX(b.x0), z0: toZ(b.y0), x1: toX(b.x1), z1: toZ(b.y1), horizontal: b.horizontal,
  }));
  return {
    walls,
    shapes,
    windows,
    extent: { x0: 0, z0: 0, x1: widthFt, z1: (bounds.y1 - bounds.y0) * px },
    // WHERE THE BUILDING SITS IN THE WHOLE IMAGE, normalised 0..1.
    //
    // Everything above is expressed in the TRIMMED building's frame, but a
    // confirmed label's x/y are normalised to the FULL render — which carries
    // the styling prompt's fixed 7-8% margin on every side. Placing a label at
    // `x * width` of the trimmed extent therefore pushed every name outward
    // from the centre, which is how BATH came to sit on a wall instead of in
    // the bathroom. Callers map through this first.
    trim: {
      x0: bounds.x0 / m.w, y0: bounds.y0 / m.h,
      x1: bounds.x1 / m.w, y1: bounds.y1 / m.h,
    },
    rects: walls.length + windows.length,
    // The floor's own measured colour, as an [r,g,b] triple. The label colour
    // has to know how dark the surface under the names actually is, and the
    // palette cannot tell it: a light palette over a dark render puts near-black
    // names on a charcoal floor, which is the smudge Saman reported.
    floorTone: floorRGB(),
    // The plan's own wall thickness in feet. Exposed because two rules read it
    // — keep a nib that is as thick as a wall, widen anything thinner — and a
    // number that decides what survives should be visible from outside.
    wallFloorFt: floorFt,
    inverted: m.inverted,
    // THE GROUND IS THE WHOLE SHEET, faded out beyond the drawing.
    //
    // Cropping to the drawing left a hard-edged rectangle whose corners are
    // plain paper, and one of those corners sat beside the porch looking like
    // a piece of land that is not on the plan. A symmetric sheet that dissolves
    // into the scene reads as what it is: the paper the plan is drawn on.
    floor: floorTexture(),
    // Where that texture belongs in model space. Larger than `extent` whenever
    // the plan draws anything outside its own walls, and never smaller.
    floorRect: {
      x0: toX(sheet.x0), z0: toZ(sheet.y0),
      x1: toX(sheet.x1), z1: toZ(sheet.y1),
    },
    feetPerPixel: px,
    // The mask's own dimensions, which is how a published reading proves it
    // describes THIS picture. Derived from the image by `wallMask`, so equal
    // dimensions mean the same source at the same scale.
    maskW: m.w,
    maskH: m.h,
    // THE INK, AS THE RECTANGLES THAT DREW IT.
    //
    // `traceOutlines` rasterises exactly these and traces the result, so this is
    // the whole input to the outline half of the reading. It travels for one
    // reason: a published floor skips the trace, and without the ink it cannot
    // cut window openings into its own outlines — every opening filled back in
    // the moment outlines were switched on. That was the last thing keeping the
    // outline path behind a flag.
    //
    // NOT `walls`, which is this list in feet after `thickenStubs` has widened
    // the thin ones. The two lists cover the same ink, but only this one is the
    // ink: publishing the source rather than the adjusted copy is what makes a
    // published floor's outlines identical to the ones it would trace locally,
    // instead of merely close.
    inkRects,
    // A function, so `JSON.stringify` drops it and no published record can
    // carry a closure over a mask it has no business holding.
    reshape,
  };
}

/**
 * The wall ink as outlines, optionally with openings cut out of them.
 *
 * A FUNCTION AND NOT A CLOSURE, so a published floor can call it too. A
 * window's position comes from the confirmed record and mapping it into model
 * coordinates needs the `extent` that `extrudeWalls` computes, so the caller
 * cannot hand the openings in before the reading exists — which is why callers
 * get `ex.reshape`. But a published floor returns early and has no ink in
 * scope; giving this everything it needs as arguments is what lets that path
 * hand back a `reshape` of its own, built from the published `inkRects`.
 *
 * CUT IN THE INK, NOT IN THE POLYGON. Subtracting a rectangle from a polygon
 * with holes is a boolean operation, and this project has no library for one and
 * should not grow a hand-rolled one to put a hole in a wall. Painting the
 * opening out of the mask and tracing again asks the code that already knows how
 * to find a boundary to find the boundary of a wall that now has a gap in it.
 * The rectangle path does the same thing by a different route — see
 * subtractRects in geometry.js — so the two agree by construction rather than by
 * two implementations happening to match.
 *
 * @param {Array<{x0,y0,x1,y1}>} inkRects wall rectangles in MASK pixels
 * @param {{bounds,px,floorPx,toX,toZ}} frame the building's own coordinates
 * @param {Array<{x0,z0,x1,z1}>|null} openings in MODEL feet, as the record and
 *   `windowsFromRecord` produce them
 */
export function traceOutlines(inkRects, frame, openings) {
  const { bounds, px, floorPx, toX, toZ } = frame;
  // ONE PIXEL OF MARGIN. Ink that reaches the edge of the raster has no
  // boundary there to trace, so the ring that should go around the outside of a
  // wall never closes and the piece comes back as its own hole.
  const bw = bounds.x1 - bounds.x0 + 2, bh = bounds.y1 - bounds.y0 + 2;
  const ink = new Uint8Array(bw * bh);
  for (const r of inkRects) {
    for (let y = Math.max(r.y0, bounds.y0); y < Math.min(r.y1, bounds.y1); y++) {
      for (let x = Math.max(r.x0, bounds.x0); x < Math.min(r.x1, bounds.x1); x++) {
        ink[(y - bounds.y0 + 1) * bw + (x - bounds.x0 + 1)] = 1;
      }
    }
  }
  for (const o of openings || []) {
    // Model space back to the clipped mask: the inverse of `unclip` below, and
    // the only other place this mapping is written down.
    const at = (v) => (v / px) + 1;
    const x0 = Math.max(0, Math.floor(at(Math.min(o.x0, o.x1))));
    const x1 = Math.min(bw, Math.ceil(at(Math.max(o.x0, o.x1))));
    const z0 = Math.max(0, Math.floor(at(Math.min(o.z0, o.z1))));
    const z1 = Math.min(bh, Math.ceil(at(Math.max(o.z0, o.z1))));
    for (let y = z0; y < z1; y++) for (let x = x0; x < x1; x++) ink[y * bw + x] = 0;
  }
  const unclip = ([x, y]) => [toX(x + bounds.x0 - 1), toZ(y + bounds.y0 - 1)];
  return wallShapes(ink, bw, bh, floorPx).map((sh) => ({
    outer: sh.outer.map(unclip),
    holes: sh.holes.map((ring) => ring.map(unclip)),
  }));
}

/**
 * The version of the reading this file produces.
 *
 * A published floor carries a geometry record, and a record read by different
 * code than wrote it is the one way this optimisation could show somebody a
 * building we would not draw ourselves. So the record is stamped, and a stamp
 * that does not match is ignored rather than trusted.
 *
 * BUMP IT WHENEVER THE READING CHANGES — a threshold, a filter, a new field on
 * the result. `test/geometry-version.test.mjs` fails when the code changes and
 * the number does not, so this cannot be forgotten quietly; that test also
 * explains what to do about it.
 *
 * THE READING IS NOT WRITTEN BY THIS FILE ALONE. `shapes` travels in the record
 * and is drawn by src/model3d/outline.js, which sat outside the guard until
 * version 3 — so the commit that finally wired `simplify` in changed what every
 * record says without moving the stamp, and floors published before it went on
 * being served their staircase outlines. The guard covers both files now.
 *
 * Old published floors do not break when it moves: they fall through to a full
 * local trace, exactly as they did before any of this existed, and pick the
 * fast path up again the next time they are published.
 */
export const GEOMETRY_VERSION = 8;

/**
 * Strip an `extrudeWalls` result down to what can be published.
 *
 * The canvas cannot travel and must not be serialised — `JSON.stringify` turns
 * it into `{}`, which would sail through every check here and arrive as a floor
 * with no picture on it. It is removed by name rather than by hoping.
 *
 * @param {object} ex a result from extrudeWalls
 * @returns {object|null} a JSON-safe record, or null if there is nothing to say
 */
export function publishableGeometry(ex) {
  if (!ex || !ex.extent || !ex.maskW) return null;
  // `reshape` closes over this plan's ink. JSON drops a function on its own,
  // but the note above is about not relying on that: the canvas would have gone
  // too, as `{}`. Named, like the canvas.
  const { floor, fromPublished, reshape, ...rest } = ex;
  return { ...rest, version: GEOMETRY_VERSION };
}

/**
 * How close a pixel has to be to the paper before it counts as paper — derived
 * from the paper, not chosen.
 *
 * A FIXED threshold cannot work, and the number that proved it is 74. That is
 * how far black line work sits from a dark render's own sheet in summed RGB,
 * and it is far closer than any constant wide enough to absorb the sheet's JPEG
 * mottling. Set the constant loose and the plan's ink lifts with the paper —
 * the garage cars faded to smudges. Set it tight enough to exclude ink on a
 * DARK render and it is too tight for a light one, where the paper's own spread
 * is wider than the whole gap on the dark sheet.
 *
 * So it is measured: the threshold is a multiple of how much the paper varies
 * FROM ITSELF, sampled around the drawing. Flat sheet, tight threshold; mottled
 * sheet, loose one. Ink is excluded because ink is not the paper's noise, on
 * either kind of sheet.
 *
 * The floor of 24 stops a perfectly flat synthetic sheet from setting a
 * threshold of zero and lifting nothing.
 */
export function paperNear(spread) {
  return Math.max(24, spread * 3);
}

/**
 * One pixel's move toward the scene's ground, weighted by how much it looks
 * like paper.
 *
 * Split out of `liftPaper` because the rule is the part worth testing and the
 * canvas is not: the first version of this sampled the paper tone from the
 * texture's corners, which are transparent whenever the sheet crop reaches past
 * the source image. It read paper as BLACK, and so lifted the plan's own ink
 * toward the background instead — the garage cars faded to smudges. Nothing
 * caught it but a screenshot, because none of this was reachable from a test.
 *
 * @param {number[]} px the pixel, [r,g,b]
 * @param {number[]} paper the measured sheet tone
 * @param {number[]} bg the scene's ground
 * @param {number} near the paper-likeness threshold, from `paperNear`
 * @param {number[]} out written in place, to avoid an allocation per pixel
 */
export function liftPixel(px, paper, bg, near, out = [0, 0, 0]) {
  const dist = Math.abs(px[0] - paper[0]) + Math.abs(px[1] - paper[1])
    + Math.abs(px[2] - paper[2]);
  // Full lift through the inner half of the threshold, then a ramp to nothing
  // at its edge.
  //
  // It used to ramp from zero distance, so only a pixel EXACTLY at the paper's
  // median got the whole move and ordinary paper — eight or ten off the median,
  // which is just the sheet's mottling — got about 60% of it. The apron came out
  // at 168 against a 248 ground, still obviously a darker slab. The ramp is
  // there to stop a hard edge appearing where the threshold cuts, and that is
  // all it needs to do; taxing the middle of the range was never its job.
  const soft = near * 0.5;
  const k = dist >= near ? 0
    : SHEET_TO_BG * (dist <= soft ? 1 : (near - dist) / (near - soft));
  for (let c = 0; c < 3; c++) out[c] = Math.round(px[c] + (bg[c] - px[c]) * k);
  return out;
}
