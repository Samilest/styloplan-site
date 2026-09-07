// X-Ray guardrails (handoff L2, mandatory):
// 1. Auto-align the wireframe over the original (scale + center registration)
//    BEFORE any overlay is shown.
// 2. If measured deviation exceeds a threshold, do NOT present a raw slider —
//    return the specific mismatch areas so the UI can flag them instead.
// A misaligned overlay would destroy the very trust this feature builds.
//
// Everything here works on the BUILDING STRUCTURE, not on raw ink. A
// construction drawing carries dimension lines, joist callouts and title
// blocks that reach the sheet edges, while the wireframe correctly strips
// them — comparing raw ink made the cleaner wireframe look like the bigger
// error. Eroding the ink map deletes thin annotation strokes and keeps the
// thick wall bands, which is exactly what "did the new linework land on my
// walls" means.

import { inkMap as sharedInkMap } from './ink.js';

const INK_LUM = 120;      // dark-on-light: pixels darker than this are linework
// Light-on-dark (the Dark theme): walls land near #F2F1EE (lum ~241) and
// fixture strokes near #C9C5BD (~199), while floors (~72) and the ground (~61)
// stay well below — so this cut keeps the linework and drops the field.
//
const INK_LUM_INVERTED = 140;
// The same image, cut higher, keeping only the built fabric. The dark palette
// paints outdoor hatch in light beige-grey (#B8B3A9, lum ~180) while walls sit
// near #F2F1EE (~241) and fixture strokes near #C9C5BD (~199), so this drops
// the hatched field and keeps the linework. Measured sweep on a real dark
// render: 175 → 10.4% ink, 190 → 4.0%, flat to 230 — the value sits in the
// middle of a wide plateau, not on an edge.
//
// Why a SECOND constant instead of moving the first: INK_LUM_INVERTED also
// feeds the silhouette bounding box, where the deck legitimately belongs.
// Raising that one cured a 45.8% coverage rejection and caused a 29% aspect
// rejection in its place.
const STRUCTURE_LUM_INVERTED = 190;
const GRID = 48;          // comparison grid resolution
const CELL_DIFF = 0.25;   // a cell is flagged when >25% of its structure misses
const DEVIATION_MAX = 0.35; // >35% of wireframe structure off the source → no slider
// QA four-point #4: silhouette aspect within 2%.
//
// RAISING THIS TO 5% WAS TRIED AND MEASURED ON 2026-08-22, AND REVERTED.
//
// The case for raising it was that healthy plans read up to 3.4% while the
// limit is 2%, so the limit looked mis-specified against the measurement's own
// noise. It is not. Squashing a wireframe by a known amount and re-registering
// it shows the metric is faithful, not noisy:
//
//     applied   2%     4%     6%     12%    18%
//     Jordan    2.03   4.08   6.15   12.18  18.05
//     Madison   2.91   4.64   6.84   13.48  17.68
//
// So a plan reading 3.4% is a plan that really is 3.4% out of proportion, and a
// 5% limit does not sharpen a blunt ruler — it accepts up to 5% of real
// distortion, about three feet across a 62ft house.
//
// The better lever is upstream and is already in place: framing the model's
// input to the drawing rather than the canvas (frameForModel in aspect.js) took
// one plan's wireframe from 5.9% distorted to 1.6% — inside this limit, with
// nothing conceded. Reduce the distortion; do not widen the gate around it.
const ASPECT_TOL = 0.02;
// Construction drawings hatch their walls instead of filling them, so eroding
// raw ink deletes the building and leaves the annotations. Closing first fuses
// each hatched band into one solid body; only then does erosion drop the thin
// dimension lines, callouts and title-block rules. Calibrated on The Madison:
// these values recover a silhouette within 0.5% of the wireframe's own.
const CLOSE_R = 3;
const ERODE_R = 3;
// Slop allowed when testing "landed on ink". It must absorb differences in
// STROKE WEIGHT, not just position: Prompt 1 sometimes draws walls as thin
// double lines while the styled render fills them as solid bands, so the band's
// centre lands in the gap between the two lines. At r=2 that scored a perfect
// Dark render as 52% off-target; measured across good and bad pairs, r=6 keeps
// every good pair under 16% while wrong-plan and broken renders stay above 53%.
const INK_TOL_R = 6;
// Erosion only isolates the building when the walls are thick enough to
// survive it. On thin-walled drawings it deletes the structure and leaves
// blobs of merged text, which would register on garbage. Measured survival
// ratios: real plans 0.25–0.38, a thin-walled render 0.00–0.03.
//
// The Sky lands at 0.074 — inside the gap this calibration never saw, a REAL
// plan with thin walls. Its eroded map is visibly specks, not a building, so
// the veto is correct and this threshold stays. The consequence is that The
// Sky has NO usable building silhouette (raw and closed are both the whole
// sheet, eroded is destroyed) and its outline number compares the sheet to the
// wireframe's building. That is a known false alarm, not a drawing error.
const MIN_SURVIVAL = 0.10;
// A source whose raw ink already reaches the sheet edges is a construction
// drawing: dimension chains and title blocks run to the margins, so the raw
// bounding box is the SHEET, not the building, and the morphology above is
// required. A presentation plan's ink stops at the building, so raw ink is the
// truer silhouette — and it is immune to how thickly the wireframe happens to
// draw its walls. Measured sheet fill: presentation plans 0.69–0.72,
// construction drawings 0.99–1.00.
const SHEET_FILLED = 0.92;
// How much of the wireframe's structure has to land on the source before the
// fit's own scales are worth reading a verdict from. Below this the two images
// are not in correspondence and the fit is fitting noise.
const FIT_TRUST = 0.6;

export function register(sourceImg, wireframeImg) {
  const A = structureMap(sourceImg, true);
  const B = structureMap(wireframeImg, false);

  // Pick ONE description and apply it to both images, decided by the source.
  // Measuring the two differently would compare unlike things.
  const rawA = bboxOf(A.ink, A.w, A.h);
  const rawB = bboxOf(B.ink, B.w, B.h);
  const sourceIsAnnotated = rawA ? rawA.w * rawA.h > SHEET_FILLED : true;
  // Erosion only isolates a building whose walls are thick enough to survive
  // it; on a thin-walled drawing it deletes the structure entirely.
  //
  // An adaptive radius was built and MEASURED here, then reverted. Taking the
  // largest radius both drawings survive breaks Geena (4.79%, was 1.41%):
  // Geena needs r<=1 and Madison needs r>=2, so no radius rule satisfies both.
  // Choosing the radius that minimises deviation instead would make the guard
  // agree with any wireframe, which is not a guard. See test/erode-probe.html
  // for the full per-radius survey; do not retry without new evidence.
  const useEroded = A.survival >= MIN_SURVIVAL && B.survival >= MIN_SURVIVAL;

  for (const m of [A, B]) {
    // The coverage probe always compares WALL STRUCTURE, never every stroke:
    // this same function also checks a styled render against its wireframe, and
    // styling deliberately adds furniture that has no counterpart in the
    // wireframe. Probing raw ink there would score that furniture as error.
    m.mask = useEroded ? m.eroded : m.closed;
    if (!bboxOf(m.mask, m.w, m.h)) m.mask = m.ink;
  }
  // The silhouette bbox (transform + aspect) is a separate question, and there
  // raw ink is the truer outline whenever the source carries no edge-to-edge
  // annotation — it does not care how thickly the walls happen to be drawn.
  if (!sourceIsAnnotated && rawA && rawB) {
    A.bbox = rawA;
    B.bbox = rawB;
  } else {
    A.bbox = bboxOf(A.mask, A.w, A.h);
    B.bbox = bboxOf(B.mask, B.w, B.h);
  }
  if (!A.bbox || !B.bbox) {
    return { ok: false, deviation: 1, aspectDev: 1, mismatchCells: [], transform: null,
             reason: 'Could not find linework in one of the images.' };
  }

  // QA four-point #4: the outer silhouette's aspect ratio must match within
  // 2%. Registration would otherwise silently "correct" a squeezed wireframe,
  // so this is checked BEFORE the density comparison.
  const aspectA = (A.bbox.w * sourceImg.naturalWidth) / (A.bbox.h * sourceImg.naturalHeight);
  const aspectB = (B.bbox.w * wireframeImg.naturalWidth) / (B.bbox.h * wireframeImg.naturalHeight);
  const aspectDev = Math.abs(aspectA - aspectB) / aspectA;

  // Map the wireframe's silhouette onto the source's silhouette (scale + centre).
  // Semantics: srcNorm = d + wfNorm * s, so the UI can draw the wireframe
  // straight onto the source with these normalized offsets/scales.
  const transform = {
    sx: A.bbox.w / B.bbox.w,
    sy: A.bbox.h / B.bbox.h,
    dx: A.bbox.x - B.bbox.x * (A.bbox.w / B.bbox.w),
    dy: A.bbox.y - B.bbox.y * (A.bbox.h / B.bbox.h),
  };

  // Coverage, not equality. The question the X-Ray answers is "does the new
  // linework land on my original walls" — so we ask what fraction of the
  // WIREFRAME's structure falls on ink in the source. A construction drawing
  // legitimately carries extra annotation the wireframe stripped; penalising
  // that would fail the cleanest conversions. Misalignment, stretching,
  // cropping and moved walls all still show up, because those push wireframe
  // structure onto blank paper.
  const tolerantSrcInk = morph(A.target, A.w, A.h, INK_TOL_R, true);

  // THE BOX CANNOT FIND THE BUILDING ON A CONSTRUCTION SHEET, so the alignment
  // is searched for instead of derived.
  //
  // The transform above maps one ink box onto the other, which works when both
  // pictures are of the same thing. A construction drawing is not: measured,
  // the source's ink box covered 97.8% of geena's sheet and 100% of it in
  // width, because the sheet carries a border drawn edge to edge, plus
  // dimension strings and a title block. The wireframe's box is 71.4% and is
  // essentially the building. So the transform was stretching the building up
  // to the size of the page, and the X-Ray drew it that way.
  //
  // THREE OTHER WAYS WERE MEASURED AND ALL FAIL on these drawings, so do not
  // retry them without new evidence:
  //   - Eroding the annotation away: survival is 0.148/0.087 on geena and
  //     0.069/0.072 on avimain, under the 0.10 floor, so erosion is already
  //     switched off here. Forced on, its box collapses to 6% and 0%.
  //   - Largest connected component of the closed mask: on the SOURCE it is
  //     still the whole sheet (98%, 86%) because closing merges annotation into
  //     the building, and on the WIREFRAME it fragments to 14% and 69%.
  //   - Both of the above, plus folding in overlapping islands: shipped for one
  //     measurement and made it worse — geena's outline reading went from 1.41%
  //     to 41.4%.
  //
  // What is left is the definition of registration itself: the alignment is the
  // one that puts the most wireframe structure on source ink. Coarse to fine
  // over a uniform scale factor and a translation, three parameters, scored
  // with the same coverage the check already uses. Every candidate is measured
  // against the same tolerant ink, so nothing here can invent agreement that is
  // not in the two pictures.
  //
  // THE ASPECT CHECK IS NOT TOUCHED. Four-point check #4 reads the two
  // silhouettes directly, above, and the gate keeps whatever it read before.
  // SCORED AGAINST TIGHTER INK THAN THE CHECK REPORTS.
  //
  // `tolerantSrcInk` is dilated by 6px so that a wall drawn a hair off still
  // counts as landing on its original. That tolerance is right for reporting
  // and wrong for searching: on a dense construction sheet almost every pixel
  // is within 6px of something, so the search can score a perfect 1.000 by
  // parking the wireframe over the busiest part of the page. Geena did exactly
  // that on the first run. Judged against 2px it has to actually line up.
  const searchInk = morph(A.closed, A.w, A.h, 2, true);
  const fitted = bestFit(transform, B, A.w, A.h, searchInk);
  transform.sx = fitted.sx; transform.sy = fitted.sy;
  transform.dx = fitted.dx; transform.dy = fitted.dy;

  const cellTotal = new Float32Array(GRID * GRID);
  const cellHit = new Float32Array(GRID * GRID);
  let total = 0, hits = 0;
  for (let y = 0; y < B.h; y++) {
    for (let x = 0; x < B.w; x++) {
      if (!B.mask[y * B.w + x]) continue;
      const srcNX = transform.dx + (x / B.w) * transform.sx;
      const srcNY = transform.dy + (y / B.h) * transform.sy;
      const sx = Math.round(srcNX * A.w), sy = Math.round(srcNY * A.h);
      if (sx < 0 || sx >= A.w || sy < 0 || sy >= A.h) { total++; continue; }
      const hit = tolerantSrcInk[sy * A.w + sx] ? 1 : 0;
      total++; hits += hit;
      const gx = Math.floor(((srcNX - A.bbox.x) / A.bbox.w) * GRID);
      const gy = Math.floor(((srcNY - A.bbox.y) / A.bbox.h) * GRID);
      if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
        cellTotal[gy * GRID + gx]++;
        cellHit[gy * GRID + gx] += hit;
      }
    }
  }
  const mismatchCells = [];
  for (let i = 0; i < GRID * GRID; i++) {
    if (cellTotal[i] < 4) continue;                 // too little structure to judge
    if (cellHit[i] / cellTotal[i] >= 1 - CELL_DIFF) continue;
    const cx = i % GRID, cy = Math.floor(i / GRID);
    mismatchCells.push({
      x: A.bbox.x + (cx / GRID) * A.bbox.w,
      y: A.bbox.y + (cy / GRID) * A.bbox.h,
      w: A.bbox.w / GRID,
      h: A.bbox.h / GRID,
    });
  }
  const deviation = total ? 1 - hits / total : 1;

  // FOUR-POINT CHECK #4, MEASURED FROM THE INK RATHER THAN FROM TWO BOXES.
  //
  // The box reading compares the source's ink silhouette with the wireframe's.
  // On a presentation plan those are the same object and it works. On a
  // construction sheet they are not: the source's box is the whole page, border
  // and dimension chains and title block included, so the check was comparing a
  // SHEET's proportions against a BUILDING's and calling the difference a
  // distortion in the tracing.
  //
  // Measured, that failed avimain at 8.46% while 98.9% of its wireframe's
  // structure lands on the source's own ink — a tracing that fits the drawing
  // almost perfectly, blocked for the shape of the paper around it.
  //
  // The fit already knows better. It found, per axis, how far the wireframe had
  // to be scaled to land on the source's structure, so the ratio between those
  // two pixel-space scales IS the shape difference, read off the correspondence
  // instead of off two outlines that describe different things.
  //
  // IT IS STILL A GUARD. A wireframe squeezed on purpose is caught to within a
  // few tenths: jordan reads 0.12% untouched, 10.69% at 10% narrower, 9.88% at
  // 10% shorter and 20.53% at 20% narrower. A check that agreed with any
  // wireframe would be worse than none, so that was measured before this
  // shipped, not after.
  //
  // The fit has to be worth trusting first. When little of the wireframe lands
  // on the source at all, the scales it settled on mean nothing, so below the
  // coverage floor the stricter of the two readings stands.
  const kx = transform.sx * (sourceImg.naturalWidth / wireframeImg.naturalWidth);
  const ky = transform.sy * (sourceImg.naturalHeight / wireframeImg.naturalHeight);
  const fitAspectDev = Math.abs(kx - ky) / Math.max(kx, ky);
  const fitTrusted = 1 - deviation >= FIT_TRUST;
  const shapeDev = fitTrusted ? fitAspectDev : Math.max(fitAspectDev, aspectDev);
  const aspectFail = shapeDev > ASPECT_TOL;
  const densityFail = deviation > DEVIATION_MAX;
  // Stated as a fact about the drawing, with no advice attached: the same two
  // strings are shown when checking a wireframe against a source plan AND a
  // styled render against its wireframe, and the right next step differs. Each
  // caller adds its own.
  // What was MEASURED, never a conclusion about the drawing.
  //
  // These used to read "The overall shape is wrong … so it has been stretched
  // or cropped" and "The layout is wrong: 37% of the walls do not line up".
  // On a CAD framing sheet whose dimensions came back 7/7 character-perfect,
  // both statements were simply false — nothing was stretched, and the walls
  // line up fine; the sheet draws them as hatched foundation bands that the
  // wireframe re-inks as thin lines, so less new linework lands on old ink.
  // A check that cannot confirm something must say that, not invent a cause
  // (red line 7: process claims, never outcome claims).
  let reason = '';
  if (aspectFail) {
    reason = `Outline not confirmed: ${(shapeDev * 100).toFixed(1)}% apart, `
      + `over the ${(ASPECT_TOL * 100).toFixed(0)}% limit.`;
  } else if (densityFail) {
    reason = `Linework not confirmed: ${(deviation * 100).toFixed(0)}% of the new lines `
      + `miss the original.`;
  }
  return {
    ok: !aspectFail && !densityFail,
    deviation, mismatchCells, transform, reason,
    // `aspectDev` is the verdict's number, whichever reading produced it, so
    // every caller that prints it keeps agreeing with the gate. The other two
    // are exposed beside it because when they disagree the difference is the
    // interesting part, and a number nobody can see cannot be argued with.
    aspectDev: shapeDev,
    boxAspectDev: aspectDev,
    fitAspectDev,
    fitTrusted,
    // Whether the source carries edge-to-edge annotation — a construction
    // sheet rather than a presentation plan. Exposed so callers can say WHY a
    // high reading is expected on these drawings instead of alarming someone
    // whose plan is fine. Costs nothing: it is already computed above.
    sourceIsAnnotated,
    // Measured from the silhouettes themselves. The extraction's own
    // planAspectRatio is a model estimate and has been off by up to 7% on real
    // plans, so anything user-facing must use these instead.
    sourceAspect: aspectA,
    wireframeAspect: aspectB,
    aspectTolerance: ASPECT_TOL,
    // The two silhouettes the transform is built from, normalised 0..1 against
    // their own image. Exposed for diagnosis: every question of the form "why
    // is the overlay the wrong size" is answered by these two boxes, and
    // without them the transform is three numbers with no way to check what
    // they were derived from.
    sourceBox: A.bbox,
    wireframeBox: B.bbox,
  };
}

// Downsample to a fixed-width binary ink map.
// "Ink" means the linework, whichever tone it happens to be. The Dark theme
// inverts a plan — white walls on charcoal — so a fixed dark-is-ink test marked
// 92% of a Dark render as ink (the background) and none of the walls, making
// every measurement here meaningless. Polarity is therefore detected per image.
function inkMap(img) {
  return sharedInkMap(img, {
    width: 512, lum: INK_LUM, lumInverted: INK_LUM_INVERTED,
    structureLumInverted: STRUCTURE_LUM_INVERTED,
  });
}

// THE TARGET'S SHRINK POOLS THE EXTREME, IT DOES NOT AVERAGE — and this is the
// ONLY place in the module that reads the image that way.
//
// A plan drawn in single hairlines rather than solid poche walls has a pen
// narrower than one working pixel, and averaging the block it lands in returns
// paper: measured, one black line in a 2048px drawing comes back at luminance
// ~191 against a 120 cut, so the wall is not in the map at all. Counting ink at
// 512 across the corpus, pooling the darkest sample instead of the mean moves
// every poche-walled plan by 1.4-1.6x (Jordan 21432 -> 33538) and the one
// thin-lined plan by 10.6x (Plan A 2471 -> 26158). Plan A does not carry an
// order of magnitude less linework; the shrink was deleting it.
//
// What that cost was a drawing that could never be confirmed. Compared against
// a copy of ITSELF, geometry identical, re-toned and with the stroke one
// working pixel heavier — which is a thing styling legitimately does — Plan A
// read 34.9% of its linework as missing against a 35% reject line while Jordan
// read 0.0%. A 17-pixel decode difference was enough to flip the verdict,
// because 17 pixels is 1% of a 2471-pixel mask.
//
// WHY ONLY THE TARGET. Pooling the extreme on BOTH sides was built and
// MEASURED, and it breaks this module in two places, both for the same reason:
// pooling thickens THIN ANNOTATION as well as thin walls, and dropping thin
// annotation is precisely the job `closed`-then-`eroded` is doing above. The
// wireframe's own labels and furniture then survive erosion, get counted as
// structure that must land on something, and do not. Measured on the corpus:
// Madison's clean pair went 0.05% -> 1.65%, which collapsed the invented-walls
// sensitivity ratio from 75x to 3x against a 10x floor, and the Geena dark
// render — a good render that must stay accepted — went from accepted to
// rejected at 14.42% coverage and 2.45% aspect.
//
// So the reading stays exactly as it was everywhere the module asks WHAT THE
// WIREFRAME DREW, and changes only where it asks WHERE THE SOURCE HAS INK. The
// second question has no annotation problem to solve: this map is a tolerance
// target that is dilated by 6px before anything is scored against it, so a
// revived dimension line inside it is already within the slop it grants.
// Nothing else moves — not the silhouette, not the aspect, not `survival`, not
// which mask is compared. NOT THE SEARCH EITHER: `bestFit` is still scored
// against `A.closed`, deliberately, for the reason written at `searchInk` —
// a denser target flattens the surface it searches, and letting it read this
// map put the CAD sheet's outline from 0.71% to 3.31% and Geena's from 1.08%
// to 0.08% by moving the fit rather than by fitting better. Every aspect number
// in the corpus is byte-identical to what it was before this change, which is
// how you can tell only the reporting tolerance moved.
//
// WHAT IT COST, stated rather than buried. The revived ink includes thin
// ANNOTATION, so an invented wall laid across a room has a little more to land
// on: the corpus's invented-walls sensitivity fell from 75x to 57x against its
// 10x floor (clean 0.05% -> 0.04%, damaged 3.78% -> 2.15%). That is a real
// reduction in the thing quality-gate point 5 exists for. It was measured
// before this shipped, not after, and it is pinned in test/guards.html.
//
// THE OBVIOUS ALTERNATIVE IS WORSE. Widening the tolerance band — chamfer
// matching, "did the new line land within a few pixels of the old one" — is
// what INK_TOL_R already is, and it is what fails here: with the walls missing
// from the target there is nothing to land near, so widening it buys agreement
// by making the check blinder, and quality-gate point 5 (nothing architectural
// invented) is the first thing a wider band stops seeing.
function targetInkMap(img) {
  return sharedInkMap(img, {
    width: 512, lum: INK_LUM, lumInverted: INK_LUM_INVERTED,
    structureLumInverted: STRUCTURE_LUM_INVERTED,
    downsample: 'extreme',
  });
}

// Ink → closed (hatching fused into solid bands) → eroded (thin annotation
// dropped) = the building's wall structure. Falls back to raw ink if the
// morphology wipes everything out, so a hairline plan still registers.
function structureMap(img, asTarget) {
  const m = inkMap(img);
  // closed: hatched walls fused into solid bands — also the coverage target,
  // so a wireframe's solid wall can actually land on a hatched original.
  // Built from `structure`, not `ink`: coverage asks about walls, and on a dark
  // render `ink` also carries the outdoor hatch.
  const closed = morph(morph(m.structure, m.w, m.h, CLOSE_R, true), m.w, m.h, CLOSE_R, false);
  const eroded = morph(closed, m.w, m.h, ERODE_R, false);
  const closedPx = countOn(closed);
  // Only the source is ever landed ON, so only the source pays for the second
  // read. See `targetInkMap` for why it is read differently at all.
  let target = closed;
  if (asTarget) {
    const t = targetInkMap(img);
    target = morph(morph(t.structure, t.w, t.h, CLOSE_R, true), t.w, t.h, CLOSE_R, false);
  }
  return {
    // `ink` stays the full drawing; the silhouette bbox is measured from it.
    ink: m.ink, closed, eroded, target, w: m.w, h: m.h,
    survival: closedPx ? countOn(eroded) / closedPx : 0,
  };
}

// Separable binary morphology. dilate=true grows the mask by r; dilate=false
// erodes it, so strokes narrower than 2r+1 px vanish. Out-of-bounds counts as
// background in both directions.
function morph(src, w, h, r, dilate) {
  if (r === 0) return src;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        const s = (xx < 0 || xx >= w) ? 0 : src[row + xx];
        if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
      }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        const s = (yy < 0 || yy >= h) ? 0 : tmp[yy * w + x];
        if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function countOn(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/**
 * The scale and offset that land the most wireframe structure on source ink.
 *
 * TWO SCALES, NOT ONE, and that is not the same as hiding a squeeze.
 *
 * It started as a single factor for both axes, on the reasoning that letting
 * each axis stretch on its own would conceal the very thing four-point check #4
 * looks for. That reasoning was wrong about where the check reads from: the
 * aspect comparison is computed from the two silhouettes directly, above, and
 * never sees this transform. Nothing here can move it.
 *
 * What a single factor DID do was leave a systematic vertical error. Measured,
 * avimain's sheet and wireframe differ by 8.46% in aspect, and no uniform scale
 * can absorb that — so every label's mapped position was off by a few percent
 * of the plan's height, which on a real drawing is about one room. Saman found
 * it from the other end: clicking W.I.C. showed the ENSUITE above it, and
 * clicking ENSUITE showed the shower above that.
 *
 * So the uniform pass runs first, which is a cheap way to get close, and then
 * each axis is refined on its own around it.
 *
 * Scored on every fourth lit pixel: the masks carry thousands, the surface is
 * smooth, and sampling keeps a search that runs on every Review page load off
 * the frame budget.
 */
function bestFit(base, B, aw, ah, srcInk) {
  // A FIXED SAMPLE, not a fixed stride. This runs on every Review page load, and
  // scoring every fourth lit pixel took 1.5 seconds on a real sheet, which is a
  // page that visibly hangs before it draws. The surface being searched is
  // smooth, so a few hundred points locate the same optimum.
  const all = [];
  for (let y = 0; y < B.h; y++) {
    for (let x = 0; x < B.w; x++) if (B.mask[y * B.w + x]) all.push([x / B.w, y / B.h]);
  }
  if (!all.length) return base;
  // A FIXED COUNT, sampled by position — NOT a fixed stride.
  //
  // `stride = floor(all.length / 220)` looks equivalent and is not: `floor`
  // makes the stride jump a whole integer when the ink count crosses a
  // multiple of 220, and every point in the sample changes with it. The
  // objective function therefore moves in steps rather than smoothly as the
  // input changes by a pixel.
  //
  // MEASURED on Plan A, 2026-08-22: the same wireframe decoded twice differed
  // by 17 pixels out of 262144 — ordinary JPEG decode variance — and the
  // verdict moved from "matched, 1.15% apart" to "not confirmed, 25.96%
  // apart". Two screens of the same app disagreed about the same file because
  // of a rounding step in a sampling stride.
  //
  // Sampling a fixed number of points by fractional position keeps almost
  // every point where it was when the count shifts slightly, so a pixel of
  // difference perturbs the score instead of redrawing the problem.
  const N_SAMPLE = 220;
  const pts = [];
  const take = Math.min(N_SAMPLE, all.length);
  for (let i = 0; i < take; i++) pts.push(all[Math.floor(i * all.length / take)]);

  const score = (sx, sy, dx, dy) => {
    let hit = 0;
    for (const [nx, ny] of pts) {
      const px = Math.round((dx + nx * sx) * aw);
      const py = Math.round((dy + ny * sy) * ah);
      if (px < 0 || py < 0 || px >= aw || py >= ah) continue;
      if (srcInk[py * aw + px]) hit++;
    }
    return hit / pts.length;
  };

  const refineFrom = (seed) => {
  let best = { sx: seed.sx, sy: seed.sy, dx: seed.dx, dy: seed.dy, s: score(seed.sx, seed.sy, seed.dx, seed.dy) };
  // Coarse, then twice as fine around whatever won, twice.
  // THREE PASSES, AND THE THIRD IS NOT OPTIONAL. It was cut to two with a
  // wider offset step to save time, and avimain collapsed to a half-scale fit
  // — sx 0.566, sy 0.544, coverage 0.653 — because the coarse grid landed in a
  // basin where shrinking the wireframe into a dense part of the sheet scores
  // well. The cost was bought back by sampling fewer points instead, which
  // changes how finely the surface is measured, not which basin is found.
  let kStep = 0.06, kSpan = 0.5, tStep = 0.03, tSpan = 0.18;
  for (let pass = 0; pass < 3; pass++) {
    const c = { ...best };
    for (let k = 1 - kSpan; k <= 1 + kSpan + 1e-9; k += kStep) {
      const sx = c.sx * k, sy = c.sy * k;
      // Keep the box centred on what it was scaled about, so the search is
      // over shape and position rather than one dragging the other.
      for (let ox = -tSpan; ox <= tSpan + 1e-9; ox += tStep) {
        for (let oy = -tSpan; oy <= tSpan + 1e-9; oy += tStep) {
          const dx = c.dx + (c.sx - sx) / 2 + ox;
          const dy = c.dy + (c.sy - sy) / 2 + oy;
          const sc = score(sx, sy, dx, dy);
          if (sc > best.s) best = { sx, sy, dx, dy, s: sc };
        }
      }
    }
    kStep /= 3; kSpan /= 3; tStep /= 3; tSpan /= 3;
  }

  // One axis at a time, around whatever the uniform pass found. Each sweep
  // holds the other axis still, so a gain can only come from the axis being
  // moved and the two cannot chase each other.
  // THE GRID MUST BE FINER THAN THE TOLERANCE IT FEEDS.
  //
  // Four sweeps at a step of 0.005 leave the scale quantised to half a percent
  // per axis, so `aspectDev` — the difference between the two axes — carries
  // up to about a percent of pure grid noise. It is then compared against a 2%
  // limit. MEASURED on Plan A after the sampling fix: the same wireframe
  // decoded twice landed on sy 0.9894 and sy 0.9773, about two steps apart,
  // and the verdict crossed the limit from 0.72% to 2.71%.
  //
  // The wide sweeps stay coarse because their job is to travel; a final narrow
  // pass at a fifth of the step pins the answer well below the tolerance
  // without searching any more ground than it has to.
  for (const [axis, lo, hi, kStep2, oSpan, oStep] of [
    ['sy', 0.86, 1.14, 0.005, 0.05, 0.005],
    ['sx', 0.86, 1.14, 0.005, 0.05, 0.005],
    ['sy', 0.86, 1.14, 0.005, 0.05, 0.005],
    ['sx', 0.86, 1.14, 0.005, 0.05, 0.005],
    ['sy', 0.99, 1.01, 0.001, 0.01, 0.002],
    ['sx', 0.99, 1.01, 0.001, 0.01, 0.002],
  ]) {
    const c = { ...best };
    const d = axis === 'sx' ? 'dx' : 'dy';
    for (let k = lo; k <= hi + 1e-9; k += kStep2) {
      const scaled = c[axis] * k;
      for (let o = -oSpan; o <= oSpan + 1e-9; o += oStep) {
        const cand = { ...c };
        cand[axis] = scaled;
        cand[d] = c[d] + (c[axis] - scaled) / 2 + o;
        const sc = score(cand.sx, cand.sy, cand.dx, cand.dy);
        if (sc > best.s) best = { ...cand, s: sc };
      }
    }
  }
  return best;
  };

  // MORE THAN ONE STARTING POINT, because one is demonstrably not enough.
  //
  // The uniform pass scales both axes by the same factor, and the per-axis
  // sweeps that follow reach only ±14% each. From a bad start the search
  // cannot walk back out, and there IS a bad start on an annotated sheet: the
  // wireframe collapses horizontally and sits inside the dense middle of the
  // drawing, which scores respectably. The code above already records this
  // failure on avimain (sx 0.566, coverage 0.653) and answered it by adding a
  // third pass; Plan A found it again anyway, at sx 0.712.
  //
  // What makes it fixable is that the bad basin is not a close call. MEASURED
  // on Plan A: the collapsed fit covers 61.9% of the source ink and the true
  // fit covers 80.4%. The search is maximising coverage, so it would have
  // taken the better one had it ever looked there — this is a convergence
  // failure, not an ambiguity, and starting from several scales is enough to
  // see both.
  //
  // The seeds bracket the base rather than searching blind: a wireframe that
  // is genuinely squashed must still come back squashed, or the guard stops
  // being a guard. test/guards.html pins that with a deliberately squashed
  // Madison, which has to keep failing.
  // AND THE BASE STILL WINS TIES, BY A MARGIN.
  //
  // Taking whichever seed scored highest was measured against the corpus and
  // was too eager: Jordan's basement CAD sheet moved from 0.71% to 3.31% apart
  // and its verdict flipped from confirmed to not confirmed, because a fit
  // that covers very slightly better happened to be more anisotropic. Coverage
  // is a PROXY for correspondence, not correspondence itself, and small
  // differences in it do not mean what a big one means.
  //
  // So an alternative basin has to beat the base by a real margin before it is
  // taken. The two cases are far apart and nothing sits between them:
  //
  //     Plan A          base 0.619   alternative 0.804   +18.5 points
  //     basement CAD    base ~equal  alternative ~equal   under a point
  //
  // At 5 points the collapsed fit is still rejected and every plan that was
  // already fitting well keeps the answer it had.
  const SWITCH_MARGIN = 0.05;
  let winner = refineFrom(base);
  for (const k of [0.8, 1.25]) {
    const r = refineFrom({ ...base, sx: base.sx * k, sy: base.sy * k });
    if (r.s > winner.s + SWITCH_MARGIN) winner = r;
  }
  return winner;
}

function bboxOf(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % w, y = (p / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  return { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h };
}

