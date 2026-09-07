// Compositing engine — build-order step 1 (handoff Section 7).
// Deterministic canvas layer on top of a (future) AI-styled plan image.
// Red lines honored here:
//   - ALL text (labels, dimensions, footer, spec strip) is rendered by this
//     module as real fonts — never by the image AI.
//   - Dimension strings come verbatim from project JSON (transcribed upstream).
//   - Three formats are canvas RE-LAYOUT: the plan image is drawn whole,
//     contain-fit, never cropped.
//   - Spec strip renders only user-confirmed values (enforced in spec-strip.js).

import { FORMATS, fitFormat, planPlacement, typoScale, minLegiblePx, formatsByFit } from './formats.js';
import { FOOTER_TEMPLATES, DEFAULT_DISCLAIMER } from './footer.js';
import { applyPatches } from './patch.js';
import { planContentBox } from './plan-trim.js';
import { recolourPlan } from './recolour.js';
import { makeRecorder } from './text-runs.js';

export { FORMATS };

/**
 * Does this label have anything to print?
 *
 * A space with neither a name nor a size is review-only: it exists so the count
 * is right, and a blank caption on the image would say nothing.
 *
 * A space with a SIZE and no name is different, and the distinction cost a
 * whole plan. Catalogue and European sheets routinely caption every room with
 * its dimensions and never name one — `The Pond View #2268` prints
 * `12'-4" X 13'-8"` above `3,70 X 4,10` and not a single room name. Filtering
 * on `name` dropped those labels three separate times on the way to the canvas,
 * so that plan rendered with no captions at all: the transcribed dimensions,
 * which are the whole point of the verification step, silently absent from the
 * thing the customer receives.
 */
export const isPrintable = (l) => Boolean(l && !l.hidden && (l.name || l.dim));

/**
 * Compose one format.
 * @param {Object} p
 * @param {HTMLImageElement|HTMLCanvasElement} p.planImage - styled plan, text-free
 * @param {string} p.formatId - 'square' | 'landscape' | 'portrait'
 * @param {Array}  p.labels - [{name, dim, x, y}] with x/y NORMALIZED (0..1)
 *                            relative to the plan image (clear-area anchors)
 * @param {Object} p.brand  - {companyName, tagline, logo, font, canvasBg,
 *                            labelInk, footerInk, disclaimerOn, disclaimerText}
 * @param {Object} p.specs  - {beds, baths, sqft, confirmed:true} user-confirmed
 * @param {Object} [p.meta] - {title} optional plan title e.g. "MAIN FLOOR — THE GEENA"
 * @returns {HTMLCanvasElement}
 */
/**
 * The tone of the plan image's own margin, as a CSS colour.
 *
 * WHY THE CORNERS. The styling prompt frames every plan with a uniform margin
 * of 7-8% on all four sides and nothing in it -- "the margins stay clean and
 * empty" -- so a small patch inset from each corner is margin on every render
 * this app produces. Inset rather than the very edge, because an edge pixel can
 * carry a compression fringe.
 *
 * THE MEDIAN OF FOUR, not an average. A render whose corner is damaged, or one
 * that picked up a vignette the prompt forbids, moves one corner and not three;
 * a mean would take the damage on board and a median discards it.
 *
 * Returns null when the picture cannot be read (a tainted canvas, a zero-size
 * image), and the caller keeps the brand's own colour -- exactly the behaviour
 * this replaced, so a failure here is never worse than before.
 */
export function sheetTone(img) {
  const w = img?.naturalWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.height || 0;
  if (!w || !h) return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const inset = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const box = Math.max(2, Math.round(Math.min(w, h) * 0.01));
    const corners = [
      [inset, inset], [w - inset - box, inset],
      [inset, h - inset - box], [w - inset - box, h - inset - box],
    ];
    const reads = [];
    for (const [x, y] of corners) {
      const d = g.getImageData(x, y, box, box).data;
      let r = 0, gr = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
      if (n) reads.push([r / n, gr / n, b / n]);
    }
    if (!reads.length) return null;
    const mid = (vals) => {
      const t = [...vals].sort((a, b) => a - b);
      return Math.round((t[(t.length - 1) >> 1] + t[t.length >> 1]) / 2);
    };
    const [r, gr, b] = [0, 1, 2].map((k) => mid(reads.map((v) => v[k])));
    return `rgb(${r}, ${gr}, ${b})`;
  } catch { return null; }
}

export function composeFormat(p) {
  // THE PLAN AND ITS CONTENT BOX ARE MEASURED FIRST, because one format is
  // derived from them. Both are pure reads of the input — moving them above the
  // canvas changes nothing for the other three formats.
  //
  // Areas the user erased are applied HERE, not in Studio's preview, so every
  // format and the delivery pack all render the image the user actually
  // approved. Doing it in the preview only would repeat the bug that made
  // "Download all" ship stale label positions.
  const plan = p.patches?.length ? applyPatches(p.planImage, p.patches) : p.planImage;
  // Framing is measured on the ORIGINAL tones. planContentBox thresholds on
  // luminance, so measuring the recoloured copy would let a colour choice move
  // the plan on the page.
  const content = planContentBox(plan);

  const base = p.formatId === 'fit'
    ? fitFormat(plan.width, plan.height, content)
    : FORMATS[p.formatId];
  if (!base) throw new Error(`Unknown format: ${p.formatId}`);
  // `bare`: the plan and its labels at the three canvas sizes, without the
  // brand block or the title band, for a builder who lays the branding out
  // themselves. Giving the footer no height is the whole difference — the plan
  // then gets that space, which is the point of asking for it.
  //
  // The disclaimer still follows the brand kit's own setting. It defaults ON
  // and dropping it silently would put dimensions in front of a buyer with the
  // "marketing illustration only" line removed by a download button (red line
  // 7). Turning it off stays where it already is, in the kit.
  // THE MLS-SAFE EXPORT IS THE PLAN AND NOTHING ELSE — no brand block, no title
  // band, no margin, and no disclaimer line.
  //
  // The disclaimer used to survive here on the reading that red line 7 makes it
  // non-negotiable. Re-read, the rule says it DEFAULTS on, which is a statement
  // about the default and not a prohibition — and this is the one export whose
  // entire purpose is to carry nothing of ours into someone else's layout.
  // Saman's call, made deliberately on 2026-08-22.
  //
  // The branded exports are unchanged: they still carry the line, still default
  // to on, and still follow the brand kit. Anyone reaching for THIS file is
  // reaching for a plan to lay out themselves.
  const format = p.bare ? { ...base, footerHeight: 0, bare: true } : base;
  const canvas = document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext('2d');

  // 1. Canvas background — MEASURED FROM THE PICTURE, not assumed from the kit.
  //
  // The intent here has always been "match the styled image's background so the
  // re-layout margins blend seamlessly". It took the kit's `canvasBg` as a
  // stand-in for that, and the two agree only by luck: the plan's own margin
  // tone is baked into the styling prompt (#EDEAE3 light, #3A3D40 dark) while
  // `canvasBg` is a brand control the user may set to any preset. Saman's dark
  // render sat as a visibly lighter rectangle inside a darker page for exactly
  // that reason, while his light render blended — his light preset happened to
  // be the colour the light prompt bakes in.
  //
  // Sampling the image answers it whatever the preset is, and whatever a future
  // prompt edit changes the tone to. Sampled from the RE-TONED copy, because
  // that is the picture being drawn: the brand tint has to be in the reading or
  // the margin would match the untinted original instead of what is on screen.
  const shown = recolourPlan(plan, p.planTone);
  ctx.fillStyle = sheetTone(shown) || p.brand.canvasBg;
  ctx.fillRect(0, 0, format.width, format.height);

  // 2. Place the WHOLE plan image (contain-fit — re-layout, never crop).
  //
  // Size by the DRAWING, not by the frame the image AI returned. That frame
  // carries a wide band of its own background, and contain-fitting it fitted
  // the band too — on a square export the plan used barely half the canvas.
  //
  // The image is still drawn WHOLE. `place` still describes the whole image,
  // in the same coordinates labels and Studio's drag maths already use, so
  // nothing downstream changes; it is simply scaled up until the drawing fills
  // the area, and the empty band that now falls outside is clipped away.
  // Remapping label coordinates instead would have broken Studio, which turns
  // a drag back into `(pointer - place.x) / place.w`.
  // Display transform only: the artifact on disk keeps the tones the guards
  // measured, and every format shows the same recolour. (`shown` is built at
  // the top, because the canvas fill is sampled from it.)
  const titled = Boolean(p.meta?.title) && !p.bare;
  let place, clip = null;
  if (content) {
    // Where the drawing itself should sit, contain-fit on its own pixel size.
    clip = planPlacement(content.w * plan.width, content.h * plan.height, format, titled);
    const w = clip.w / content.w, h = clip.h / content.h;
    place = {
      x: clip.x - content.x * w, y: clip.y - content.y * h, w, h,
      scale: clip.scale, footerRect: clip.footerRect,
    };
  } else {
    place = planPlacement(plan.width, plan.height, format, titled);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
  ctx.drawImage(shown, place.x, place.y, place.w, place.h);
  // Restored before any text is drawn, so labels are never clipped.
  ctx.restore();

  // One recorder for the whole pass. It exists so every string is drawn through
  // a single call rather than scattered ctx.fillText's, which is what keeps the
  // layout in one place — and its paint-suppression mode was built for the SVG
  // export, now removed. Kept because the drawing code reads better through it
  // and it costs nothing; `paintText: false` has no consumer today.
  const rec = makeRecorder();

  // 3. Optional plan title above the plan.
  if (titled) drawTitle(ctx, p.meta.title, format, p.brand, rec);

  // 4. Room labels at their clear-area anchors, mapped through the placement
  //    transform so they stay glued to their rooms in every format.
  // `labelBoxes` is where each label actually landed, in canvas pixels. Studio
  // needs it to let the user grab a label on the rendered image; recomputing
  // the layout there would mean two copies of this maths, and they would drift.
  // Stair markers join the same list, tagged with their kind. Studio picks
  // things up off ONE array; a second one would be a second place to forget.
  canvas.labelBoxes = [
    ...drawLabels(ctx, p.labels || [], place, format, p.brand, rec, content),
    ...drawStaircases(ctx, p.staircases || [], place, format, p.brand, rec),
  ];

  // 5. Footer template for this format (logo, company, specs, disclaimer).
  if (p.bare) {
  } else {
    FOOTER_TEMPLATES[p.formatId](ctx, place.footerRect, p.brand, p.specs, format, rec);
  }

  canvas.planPlacement = place;

  return canvas;
}

/**
 * Compose all three formats from one render (handoff L4: three-format export
 * is part of the package). Keys are ordered best-fit first, so consumers that
 * lead with the first entry lead with the strongest canvas for this plan.
 */
export function composeAll(p) {
  const out = {};
  for (const id of formatsByFit(p.planImage.width, p.planImage.height)) {
    out[id] = composeFormat({ ...p, formatId: id });
  }
  return out;
}



function drawTitle(ctx, title, format, brand, rec) {
  const t = typoScale(format);
  ctx.save();
  ctx.fillStyle = brand.footerInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const size = Math.max(minLegiblePx(format), Math.round(40 * t));
  ctx.font = `600 ${size}px "${brand.font || 'Inter'}", sans-serif`;
  const prev = ctx.letterSpacing;
  const track = Math.round(6 * t);
  if (prev !== undefined) ctx.letterSpacing = `${track}px`;
  // Tracking is a canvas property with no equivalent in a bare <text>, so it is
  // carried across explicitly. Without it the SVG title is visibly narrower
  // than the PNG one.
  rec.text(ctx, title.toUpperCase(), format.width / 2, format.height * 0.055,
    prev !== undefined ? { letterSpacing: track } : undefined);
  if (prev !== undefined) ctx.letterSpacing = prev;
  ctx.restore();
}

// How much wider than the wireframe's own text a name may be drawn. The
// wireframe leaves margin around its text, so its width under-states what the
// room holds; this spends part of that margin.
export const FIT_HEADROOM = 1.35;

// The plan width `label.size` is expressed against, so a size of 26 means the
// same thing whether the model returned a 1K or a 2K render.
// Sizes are expressed against a reference plan width, so a number means the
// same thing whether the render came back at 1K or 2K. Exported because Studio's
// size control speaks in these units and had been guessing at them.
export const LABEL_REF_WIDTH = 900;

/**
 * The automatic size for a label, in the same plan-relative units as
 * `label.size`, so the Review Station's size slider and the compositor agree.
 *
 * `fitWidth` is the width the wireframe drew this name at. Because it scales
 * with the name's own length, the result is effectively "the font size the
 * wireframe used" — uniform across labels, and guaranteed to fit, since the
 * image model already fitted that text inside that room.
 *
 * @param {Object} label       needs {name, fitWidth}
 * @param {number} planWidthPx natural width of the plan image
 * @returns {number|null} null when the label was never matched to the wireframe
 */
export function autoLabelSize(label, planWidthPx, fontFamily = 'Inter', measure = null) {
  if (!label?.fitWidth || !label.name || !planWidthPx) return null;
  // MEASURED IN THE CALLER'S CONTEXT WHEN IT HAS ONE. Reaching for a fresh
  // canvas here meant this function decided type widths with a font of its own
  // choosing while its caller drew with another — and it made the whole sizing
  // path impossible to run outside a browser, which is why it went untested
  // long enough for Review and the export to drift apart over it.
  const w100 = measure
    ? measure(label.name.toUpperCase(), 100, 600)
    : document.createElement('canvas').getContext('2d')
      && measureWithOwnCanvas(label.name.toUpperCase(), fontFamily);
  if (!w100) return null;
  return (100 * label.fitWidth * planWidthPx * FIT_HEADROOM) / w100;
}

function measureWithOwnCanvas(text, fontFamily) {
  const c = document.createElement('canvas').getContext('2d');
  c.font = `600 100px "${fontFamily}", sans-serif`;
  return c.measureText(text).width;
}

export const DEFAULT_LABEL_SIZE = 26;

/**
 * ONE size for the whole plan, so labels read as a set.
 *
 * Using each label's own `fitWidth` ceiling reproduced the wireframe's own
 * scatter: measured across three real plans, the model draws its text 21–28%
 * bigger in one room than another, so two rooms with equal-length names came out
 * visibly different sizes. That scatter is an artefact of how the model drew,
 * not a design decision.
 *
 * The median of the per-label ceilings is the size the plan "wants"; a label
 * whose own room cannot hold that much still shrinks individually (see
 * drawLabels), so uniform is the rule and shrinking is the exception. The
 * median rather than the minimum, because one cramped closet should not drag
 * every room name down with it.
 */
export function uniformLabelSize(labels, planWidthPx, fontFamily = 'Inter', measure = null) {
  // A NAME THAT WILL NOT BE PRINTED DOES NOT GET A VOTE. A closet the house
  // style hides still has a `fitWidth`, and a cramped one was pulling the size
  // of every name that IS printed down with it — measured on the synthetic
  // case, one hidden BEDROOM-A took a plain BATH from 26 to 6.75.
  const ceilings = (labels || [])
    .filter((l) => l.name && !l.hidden && l.kind !== 'equipment' && l.fitWidth)
    .map((l) => autoLabelSize(l, planWidthPx, fontFamily, measure))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!ceilings.length) return null;
  // Lower-middle on an even count: erring small keeps every label inside its
  // room, and the wrap below recovers the width without touching the size.
  const median = ceilings[Math.ceil(ceilings.length / 2) - 1];
  return Math.min(median, DEFAULT_LABEL_SIZE);
}

// A single-line name wider than this fraction of the plan lies across the
// drawing like a bar. Splitting it costs a line of height but gives back about
// half the width, which is the scarcer resource on a floor plan: rooms are
// bounded left and right by walls, while the clear area a label sits in is
// usually taller than it is wide.
const WRAP_ABOVE = 0.14;

/**
 * Split a room name across at most two lines, at the space nearest the middle
 * so the two halves balance. Names with no space are left alone: breaking
 * inside a word is worse than a wide label.
 * @returns {string[]} one or two lines
 */
export function wrapName(text, oneLineWidth, planWidth, limitPx = null) {
  // THE ROOM'S OWN WIDTH WHEN WE KNOW IT, the plan's as a fallback.
  //
  // The rule used to be "wider than 14% of the whole plan", which is a fact
  // about the sheet and not about the room the name has to fit inside. So
  // MASTER BEDROOM stayed on one line — it is under 14% — and was then SHRUNK
  // to fit its room instead, which is the trade the comment above the caller
  // says it does not want to make. The customer's own sheet stacks that name
  // over two lines for the same reason.
  const limit = limitPx ?? planWidth * WRAP_ABOVE;
  if (oneLineWidth <= limit) return [text];
  const parts = text.split(/\s+/);
  if (parts.length < 2) return [text];
  // A LINE HAS TO BE A WORD. Measured on Plan A: "BEDROOM 2" is 68px against a
  // 66px budget, and the balance search happily broke it into "BEDROOM" and
  // "2" — a line holding one digit, which no plan prints and which reads as a
  // mistake. Every sheet in the corpus keeps the number with its room.
  //
  // So a split is only offered where both sides carry a letter and are long
  // enough to look deliberate. A name with no such split stays on one line and
  // is shrunk instead, which is the older, quieter failure.
  const wordish = (s) => /[a-z]/i.test(s) && s.length >= 3;
  let best = 0, bestDiff = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' ');
    const b = parts.slice(i).join(' ');
    if (!wordish(a) || !wordish(b)) continue;
    if (Math.abs(a.length - b.length) < bestDiff) { bestDiff = Math.abs(a.length - b.length); best = i; }
  }
  if (!best) return [text];
  return [parts.slice(0, best).join(' '), parts.slice(best).join(' ')];
}

// An equipment callout is secondary text in a tight space — the gap between a
// fridge and a wall, not the clear middle of a room. The room floor (~0.9% of
// the short canvas side) is sized so a room name survives print; holding a
// two-character code to the same floor makes it unplaceable. This floor is 60%
// of that, which still lands around 8–9px on a 2048 canvas: small, but a real
// plan's appliance callouts are smaller than its room names by exactly this
// kind of margin.
const EQUIPMENT_MIN_RATIO = 0.6;
// Equipment sits quieter than the room name it shares a space with.
const EQUIPMENT_SIZE = 15;
const EQUIPMENT_ALPHA = 0.85;

const isEquipment = (label) => label.kind === 'equipment';

// ---- staircase direction markers
//
// These belong to THIS layer, not to the image AI. The styling prompt keeps the
// stair's drawn treads and arrow as graphics but forbids the UP/DN letters
// (red line 1), and stripDirectionLabels removes them from the wireframe before
// styling so the model never sees them. If the compositor does not draw them,
// the direction the reviewer confirmed reaches nothing: it was stored, listed on
// the verification report, and silently absent from the image the buyer sees.
const STAIR_LEN_FRAC = { short: 0.042, medium: 0.07, long: 0.105 };
const HEADING_VECTOR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const dirWord = (d) => (d === 'down' ? 'DN' : 'UP');

/**
 * @returns {Array} where each marker landed, so Studio can pick one up. It
 *   returned nothing, so every room name could be dragged and a stair marker
 *   could not — the hit test only ever saw the boxes drawLabels handed back.
 */
function drawStaircases(ctx, staircases, place, format, brand, rec) {
  const boxes = [];
  if (!staircases.length) return boxes;
  const minPx = minLegiblePx(format);
  const scale = place.w / LABEL_REF_WIDTH;
  ctx.save();
  // Same ink as the room labels: this marker is the same class of thing, and on
  // the dark theme a separate default would have been charcoal on charcoal.
  ctx.strokeStyle = ctx.fillStyle = brand.labelInk || brand.ink || '#211E19';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const st of staircases) {
    // Off unless asked for. `undefined` prints, so a project saved before the
    // field existed keeps the image it was approved with — only new ones start
    // quiet. See `printed` in review/state.js for why the default flipped.
    if (st.printed === false) continue;
    const cx = place.x + st.position.x * place.w;
    const cy = place.y + st.position.y * place.h;
    const len = place.h * STAIR_LEN_FRAC[st.length ?? 'medium'];
    const [ux, uy] = HEADING_VECTOR[st.heading ?? (st.direction === 'down' ? 'down' : 'up')]
      || HEADING_VECTOR.up;
    const px = -uy, py = ux;
    const head = Math.max(6, len * 0.22);
    ctx.lineWidth = Math.max(1.5, 2.5 * scale);
    const spiral = st.kind === 'spiral';

    if (spiral) {
      // A CURVED ARROW AROUND THE CENTRE, which is how a drawing marks a stair
      // that turns. A straight arrow across a spiral describes a run the
      // building does not have.
      //
      // Three quarters of a turn rather than a full circle, so the gap shows
      // where the arrow starts and the head is unmistakable. The radius comes
      // from the same length preset as the straight marker, so Short / Medium /
      // Long keep meaning the same thing to the reviewer.
      const r = len * 0.8;
      // Anticlockwise for DN, clockwise for UP: the arrow reads as the way you
      // would walk it, and the two must differ or the marker says nothing the
      // word below it does not already say.
      const cw = st.direction !== 'down';
      // The gap sits at the BOTTOM, centred, because that is where UP/DN is
      // written. Starting it elsewhere put the word on top of the arc.
      const start = cw ? Math.PI * 0.75 : Math.PI * 0.25;
      const sweep = Math.PI * 1.5 * (cw ? 1 : -1);
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + sweep, !cw);
      ctx.stroke();

      // Head on the tangent at the end of the sweep.
      const end = start + sweep;
      const tipX = cx + Math.cos(end) * r, tipY = cy + Math.sin(end) * r;
      const tx = -Math.sin(end) * (cw ? 1 : -1), ty = Math.cos(end) * (cw ? 1 : -1);
      const nx2 = -ty, ny2 = tx;
      ctx.beginPath();
      ctx.moveTo(tipX - tx * head + nx2 * head * 0.7, tipY - ty * head + ny2 * head * 0.7);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - tx * head - nx2 * head * 0.7, tipY - ty * head - ny2 * head * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - ux * len, cy - uy * len);
      ctx.lineTo(cx + ux * len, cy + uy * len);
      ctx.stroke();

      const tipX = cx + ux * len, tipY = cy + uy * len;
      ctx.beginPath();
      ctx.moveTo(tipX - ux * head + px * head * 0.78, tipY - uy * head + py * head * 0.78);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - ux * head - px * head * 0.78, tipY - uy * head - py * head * 0.78);
      ctx.stroke();
    }

    // Under the marker, centred, the way a construction drawing writes it.
    // Same rule Review uses, so the marker the reviewer positioned looks like
    // the one that prints.
    const size = Math.max(minPx * 0.85, 15 * scale);
    ctx.font = `600 ${size}px "${brand.font || 'Inter'}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A spiral marker has no axis, so `uy` says nothing about how far down the
    // word should sit. Its own radius does.
    const below = spiral ? len * 0.8 : Math.abs(uy) * len;
    rec.text(ctx, dirWord(st.direction), cx, cy + below + size * 0.9);

    // The whole marker, arrow and word together: grabbing it by the arrow is
    // what a reviewer will try first, and a box around the word alone would
    // make most of the thing they can see inert.
    const halfW = (spiral ? len * 0.8 : Math.abs(ux) * len) + Math.max(size * 1.6, head);
    const halfH = below + size * 1.6;
    boxes.push({ kind: 'stair', id: st.id,
      x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 });
  }
  ctx.restore();
  return boxes;
}

/**
 * @returns {Array<{id,x,y,w,h}>} where each label landed, in canvas pixels.
 *
 * Exported because the wireframe download needs the SAME typesetting as the
 * branded render. It used to ship the image model's own baked room names, in
 * whatever font that run chose, so a reviewer who corrected a name got a file
 * still showing the old one. Writing a second label renderer for it was tried
 * and thrown away: this one already has the shared size, the wrap-before-shrink
 * rule, the fitWidth budget, the legibility floor and the house style, and two
 * implementations of one job is how the eraser came to reach the styled render
 * and not the wireframe.
 *
 * It takes nothing exotic: `place` is where the plan sits (for a bare wireframe
 * that is the whole canvas), `format` is read only for `minLegiblePx`, and
 * `brand` only for the font and ink.
 */
/**
 * ONE SHRINK FOR THE WHOLE PLAN: the tightest room decides for all of them.
 *
 * Wrapping recovers width for a name with a space in it. A name without one
 * cannot wrap, so the only recourse left is to shrink — and that was done per
 * label, which put five room names on one sheet at five sizes. The Sky prints
 * BATH, LIVING and CL. at full size beside BEDROOM-A, BEDROOM-3, BEDROOM-B and
 * KITCHEN visibly smaller, purely because those four have no space to break at.
 *
 * A plan whose labels are all one size reads as typeset. The same plan with
 * four of them shrunk to fit reads as broken, which is how Saman described it.
 *
 * @param {Array<{widest:number, budget:number}>} fits measured at full size
 * @returns {number} a factor in (0, 1] to apply to every room name
 */
export function sharedShrink(fits) {
  let worst = 1;
  for (const { widest, budget } of fits || []) {
    if (!(budget > 0) || !(widest > budget)) continue;
    worst = Math.min(worst, budget / widest);
  }
  return worst;
}

/**
 * The median of the widths the matcher DID measure on this drawing.
 *
 * `fitWidth` comes from matching a label back to the wireframe's own text, and
 * on a real plan a few always miss — on Plan A, MASTER BEDROOM and LIVING ROOM
 * are two of them. With no width they fell back to the 14%-of-the-sheet rule
 * and stayed on one line while their matched neighbours wrapped, which is the
 * inconsistency Saman could see in a single glance. A guess about extent, taken
 * from this drawing rather than from a constant.
 */
/**
 * The same point on the drawing, read off a differently framed picture of it.
 *
 * A label's x/y are a fraction of the IMAGE. The wireframe, the light render
 * and the dark render are three different images of one drawing: the wireframe
 * is padded to the model's aspect before it is sent, and each render comes back
 * framed its own way. One pair of numbers therefore meant three different
 * places, with nothing mapping between them — which is why fixing the labels in
 * Review put them right on the theme that had NOT been rendered and wrong on
 * the one that had, and swapped over when the other theme was rendered first.
 *
 * `from` and `to` are content boxes: where the drawing sits inside each image.
 * With either missing there is nothing to map through, so the point is returned
 * untouched — a render must never lose its labels to a measurement that did not
 * happen.
 */
export function mapFrame(p, from, to) {
  if (!from?.w || !to?.w || !from.h || !to.h) return { x: p.x, y: p.y };
  return {
    x: to.x + ((p.x - from.x) / from.w) * to.w,
    y: to.y + ((p.y - from.y) / from.h) * to.h,
  };
}

export function typicalFitWidth(labels) {
  const w = (labels || []).map((l) => l.fitWidth).filter((v) => v > 0).sort((a, b) => a - b);
  return w.length ? w[w.length >> 1] : null;
}

/**
 * HOW EVERY LABEL ON ONE PLAN IS SET, decided in one place.
 *
 * Size and wrapping were worked out twice: here for the export, and again in
 * review.html for the editable chips. So the two disagreed — Review drew
 * LAUNDRY TUB on one line while the export broke it over two, and the note
 * above the chip code says in as many words that a chip promising a layout the
 * file does not deliver is the whole reason it shares this function. It was
 * sharing `wrapName` and deciding everything around it separately.
 *
 * The caller supplies only what is genuinely its own: how big a reference unit
 * is on ITS canvas, how wide the plan is there, its floors, and how to measure
 * text in its own context.
 *
 * @param {Array} labels
 * @param {object} o
 * @param {number} o.scale      canvas px per reference unit (LABEL_REF_WIDTH)
 * @param {number} o.planW      the plan's width on this canvas, in px
 * @param {number} [o.minPx]    smallest a room name may be drawn
 * @param {number} [o.equipMinPx] smallest an equipment code may be drawn
 * @param {string} [o.fontFamily]
 * @param {(text:string, size:number, weight:number)=>number} o.measure
 * @param {(label:object)=>string} [o.textOf]
 * @returns {Map<string, {size:number, lines:string[], budget:number|null, equipment:boolean}>}
 */
export function layoutLabels(labels, {
  scale, planW, minPx = 0, equipMinPx = 0, fontFamily = 'Inter', measure,
  textOf = (l) => (l.name || '').toUpperCase(),
}) {
  const typical = typicalFitWidth(labels);
  const shared = uniformLabelSize(labels, LABEL_REF_WIDTH, fontFamily, measure);
  const baseSize = Math.max(minPx, (shared ?? DEFAULT_LABEL_SIZE) * scale);
  const budgetOf = (l) => {
    const room = l.fitWidth || typical;
    return (l.size == null && room) ? room * planW * FIT_HEADROOM : null;
  };
  const linesOf = (l, size, weight) => {
    const text = textOf(l);
    if (!text) return [];
    // AN EQUIPMENT CALLOUT WITH A SPACE IN IT ALWAYS BREAKS.
    //
    // It is a compact block beside the thing it names, not a line of running
    // text, and every plan draws them that way. Measured against a budget it
    // never wrapped: LAUNDRY TUB at equipment size is about 48px against a
    // budget of 122, so it "fits" and lays itself across the utility room, the
    // stair and into the bedroom beyond. The budget is the wrong question for a
    // callout — the answer is the shape, and a two-word callout is two lines.
    //
    // A name with no space is untouched: wrapName returns W/D as it found it.
    const limit = isEquipment(l) ? 1 : budgetOf(l);
    return wrapName(text, measure(text, size, weight), planW, limit);
  };

  // One shrink for the plan, measured at full size. See sharedShrink.
  const shrink = sharedShrink((labels || []).map((l) => {
    if (!isPrintable(l) || isEquipment(l) || l.size != null) return {};
    const budget = budgetOf(l);
    if (!budget) return {};
    const lines = linesOf(l, baseSize, 600);
    if (!lines.length) return {};
    return { widest: Math.max(...lines.map((t) => measure(t, baseSize, 600))), budget };
  }));

  const out = new Map();
  for (const l of labels || []) {
    // A HIDDEN LABEL STILL GETS A SIZE. The export will not print it, and skips
    // it before it ever asks — but Review draws it faded, because it is a real
    // room that was counted, and it needs the size the room would have had.
    // Only the shrink above ignores it: a name that will not be printed must
    // not pull the whole plan's type down.
    if (!l.name && !l.dim) continue;
    const equipment = isEquipment(l);
    // EQUIPMENT SHRINKS WITH EVERYTHING ELSE. It did not, so on a plan whose
    // room names had to come down, H.W.T. and LAUNDRY TUB stayed at full size
    // and ended up LARGER than KITCHEN beside them — one fix pulling the other
    // out of true, which is what happens when two sizes are decided apart.
    const weight = equipment ? 500 : 600;
    // EQUIPMENT IS A RATIO OF THE ROOM NAMES, NOT A FIXED NUMBER.
    //
    // It was a constant 15 against a default 26, and it is meant to read as the
    // quieter of the two. But the room names are not always 26: one tight room
    // pulls the shared size down through uniformLabelSize, and on The Sky that
    // took them to a fraction of it while H.W.T. and LAUNDRY TUB stayed exactly
    // where they were — so the equipment ended up LARGER than KITCHEN beside
    // it. Holding the ratio keeps equipment quieter at every size.
    const equipBase = baseSize * (EQUIPMENT_SIZE / DEFAULT_LABEL_SIZE);
    const size = l.size != null
      ? Math.max(equipment ? equipMinPx : minPx, l.size * scale)
      : Math.max(equipment ? equipMinPx : minPx, (equipment ? equipBase : baseSize) * shrink);
    out.set(l.id, { size, lines: linesOf(l, size, weight), budget: budgetOf(l), equipment });
  }
  return out;
}

/**
 * Is this label's anchor outside the drawing itself?
 *
 * `content` is the ink's own box on the plan image, normalised. The margin is
 * generous — a name sits inside its room, so a label a whole 4% of the sheet
 * beyond the last ink is not a near miss.
 */
export function offDrawing(label, content, margin = 0.04) {
  if (!content) return false;
  const { x, y, w, h } = content;
  return label.x < x - margin || label.x > x + w + margin
    || label.y < y - margin || label.y > y + h + margin;
}

/**
 * The ink for one label, decided by the pixels it is about to cover.
 *
 * WHY NOT ONE INK FOR THE PAGE. The brand's `labelInk` is charcoal, which is
 * right on a light plan and invisible on a dark one — The Sky's top floor went
 * out with every room name charcoal on charcoal. The obvious fix is to flip the
 * ink when the plan is dark, and it is wrong: one drawing carries both tones.
 * That same floor has a pale hatched deck over a charcoal interior, and a
 * flipped page would have printed COVERED DECK white on white. Saman's
 * screenshot shows exactly that pair — one legible name and eight invisible
 * ones, all the same colour.
 *
 * So it is measured, per label, off the canvas the plan has already been drawn
 * onto. Nothing is assumed about looks, palettes or which kind the render was
 * stored under.
 *
 * THE BRAND'S INK IS KEPT WHEREVER IT WORKS. This only overrides where the
 * brand ink would be illegible, so a light plan is byte-identical to before and
 * the override is the exception it should be. The replacement is derived from
 * the surface rather than from a palette — the same rule `labelOn` uses for the
 * 3D labels: lift the measured tone most of the way to white.
 *
 * @param {CanvasRenderingContext2D} ctx  the canvas, with the plan already on it
 * @param {number} x @param {number} y    where the label will sit
 * @param {string} fallback               the brand's own label ink
 */
export function inkForLabel(ctx, x, y, fallback) {
  const tone = sampleTone(ctx, x, y);
  if (!tone) return fallback;
  const lumTone = (0.299 * tone[0] + 0.587 * tone[1] + 0.114 * tone[2]) / 255;
  const ink = hexToRgbSafe(fallback);
  if (!ink) return fallback;
  const lumInk = (0.299 * ink[0] + 0.587 * ink[1] + 0.114 * ink[2]) / 255;
  // 0.35 of the luminance range. Below it the two read as one colour: the
  // charcoal ink measures 0.17 against The Sky's 0.24 floor, a gap of 0.07.
  if (Math.abs(lumInk - lumTone) >= 0.35) return fallback;
  const lift = (v) => Math.round(v + (255 - v) * 0.88);
  return `rgb(${lift(tone[0])}, ${lift(tone[1])}, ${lift(tone[2])})`;
}

/** The average colour of a small patch, or null if the canvas cannot be read. */
function sampleTone(ctx, x, y, r = 12) {
  try {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const x0 = Math.max(0, Math.min(cw - 1, Math.round(x - r)));
    const y0 = Math.max(0, Math.min(ch - 1, Math.round(y - r)));
    const w = Math.max(1, Math.min(cw - x0, r * 2));
    const h = Math.max(1, Math.min(ch - y0, r * 2));
    const d = ctx.getImageData(x0, y0, w, h).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return n ? [R / n, G / n, B / n] : null;
  } catch {
    // A tainted or zero-sized canvas is not a reason to draw nothing.
    return null;
  }
}

function hexToRgbSafe(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(String(h || ''));
  if (rgb) {
    const p = rgb[1].split(',').map((v) => parseFloat(v));
    if (p.length >= 3 && p.every((v) => Number.isFinite(v))) return [p[0], p[1], p[2]];
  }
  return null;
}

export function drawLabels(ctx, labels, place, format, brand, rec, content = null) {
  const minPx = minLegiblePx(format);
  const font = `"${brand.font || 'Inter'}", sans-serif`;
  // Sized against the plan's DRAWN width, not its pixel count. Anchoring to
  // pixels made label size depend on the render's resolution: raising the model
  // output from 1K to 2K doubled the plan's pixel width, halved `place.scale`,
  // and shrank every label by half for no reason the user could see.
  const toCanvas = place.w / LABEL_REF_WIDTH;
  // ONE FUNCTION DECIDES THIS, and Review's chips call the same one.
  const measure = (text, size, weight) => {
    ctx.save();
    ctx.font = `${weight} ${size}px ${font}`;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  };
  const layout = layoutLabels(labels, {
    scale: toCanvas,
    planW: place.w,
    minPx,
    equipMinPx: minPx * EQUIPMENT_MIN_RATIO,
    fontFamily: brand.font,
    measure,
  });
  const boxes = [];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const label of labels) {
    // Nothing to say, or the house style says stay quiet (a closet, a hallway).
    // The entry still exists so the space keeps counting; it just does not print.
    if (!isPrintable(label)) continue;
    // AND NOTHING IS PRINTED OFF THE DRAWING.
    //
    // A builder's sheet prints things in its margins — The Sky carries
    // "PORCH 81.76 SQ.FT." below the building — and the extraction reads those
    // as spaces, so a second PORCH arrived with its anchor in the empty band
    // beside the plan. The band is scaled away when the drawing is fitted, so
    // the name landed on the canvas BELOW the plan, in the footer, where Review
    // never showed it because Review only draws the image.
    //
    // A label outside the ink is not in any room, so there is nothing it can
    // correctly name. It still counts as a space and still shows in Review; it
    // simply is not printed on a drawing it is not on.
    if (offDrawing(label, content)) continue;
    const cx = place.x + label.x * place.w;
    const cy = place.y + label.y * place.h;
    const text = (label.name || '').toUpperCase();

    // Equipment is a separate kind of text, so it gets its own rules rather
    // than being squeezed through the room-name path: a short code, no
    // dimension, quieter, and a lower size floor.
    // What layoutLabels settled on for this one: its size, and the lines its
    // name breaks into. The same call answers for Review's chips.
    const set = layout.get(label.id) || { size: minPx, lines: text ? [text] : [] };
    if (isEquipment(label)) {
      const { size, lines } = set;
      ctx.save();
      ctx.globalAlpha = EQUIPMENT_ALPHA;
      ctx.fillStyle = label.color || inkForLabel(ctx, cx, cy, brand.labelInk);
      ctx.font = `500 ${size}px ${font}`;
      const lineH = size * 0.95;
      const firstY = cy - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, i) => rec.text(ctx, line, cx, firstY + i * lineH));
      const widest = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
      const blockH = (lines.length - 1) * lineH + size;
      boxes.push(boxOf(label, cx, cy, widest, blockH, size));
      ctx.restore();
      continue;
    }

    // Every room name gets the SAME size, wrapped first and shrunk only if the
    // tightest of them still does not fit — all decided in layoutLabels, so the
    // chips in Review say the same thing this does.
    const { size: nameSize, lines } = set;
    ctx.font = `600 ${nameSize}px ${font}`;
    // A dimension riding under a name is secondary and reads at 70%. Standing
    // alone it is not secondary to anything — it IS the caption, exactly as the
    // source sheet prints it — so it takes the full size. Shrinking it would
    // typeset a whole plan's only text at footnote size.
    //
    // 70, RAISED FROM 55, AND NOT THE 83% THE 3D USES. The 3D was raised first,
    // because that is where the figures became unreadable — a label lying on
    // the floor is foreshortened, and digits have no word-shape to recognise
    // half-legibly. A flat sheet has neither problem, so it does not need as
    // much; but 55 was set when nobody had complained, and the complaint says
    // the house taste ran small on both.
    //
    // 70 IS ALSO THE CEILING HERE, and that is arithmetic rather than judgement:
    // the dimension is baselined at `nameSize * 0.85` below the name and
    // `blockH` reserves exactly that much for it, whatever the font size. Past
    // roughly 0.85 the glyphs fill the whole allowance, the collision box stops
    // describing what was drawn, and labels in small rooms begin to overlap.
    // Raising this further means changing that reservation too.
    const named = lines.length > 0;
    const dimSize = named ? Math.max(minPx * 0.85, nameSize * 0.70) : nameSize;
    ctx.fillStyle = label.color || inkForLabel(ctx, cx, cy, brand.labelInk);
    ctx.font = `600 ${nameSize}px ${font}`;
    const lineH = nameSize * 0.95;
    // Keep the whole block centred on the anchor. Stacking downward from the
    // anchor would push a two-line name plus its dimension out of the room's
    // clear area — trading a width problem for a height one.
    const firstY = cy - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => rec.text(ctx, line, cx, firstY + i * lineH));

    let blockH = (lines.length - 1) * lineH + nameSize;
    if (label.dim) {
      // Transcribed upstream, never computed here. `dimDisplay` is the same
      // value typeset to the kit's house style (straight marks, one separator,
      // optionally whole feet); `dim` stays the verbatim record either way, so
      // the verification report and this line can never drift apart in value.
      ctx.globalAlpha = 0.8;
      ctx.font = `400 ${dimSize}px ${font}`;
      const dimText = label.dimDisplay || label.dim;
      // With no name above it there is no stack to sit under: the dimension
      // centres on the anchor itself, where the name would have been.
      rec.text(ctx, dimText, cx,
        named ? firstY + (lines.length - 1) * lineH + nameSize * 0.85 : cy);
      ctx.globalAlpha = 1;
      if (named) blockH += nameSize * 0.85;
      else blockH = dimSize;
      ctx.font = `600 ${nameSize}px ${font}`;
    }
    // Measured off whatever actually got drawn, so a dim-only label still gets
    // a box the pointer can grab in Studio.
    const widest = named
      ? Math.max(...lines.map((t) => ctx.measureText(t).width))
      : (ctx.font = `400 ${dimSize}px ${font}`, ctx.measureText(label.dimDisplay || label.dim || '').width);
    boxes.push(boxOf(label, cx, cy, widest, blockH, nameSize));
  }
  ctx.restore();
  return boxes;
}

// A grabbable rectangle around a drawn label. Padded to a minimum so a small
// equipment code is still a target a pointer can hit.
function boxOf(label, cx, cy, width, height, size) {
  const w = Math.max(width + size * 0.5, size * 2.2);
  const h = Math.max(height + size * 0.5, size * 1.6);
  return { id: label.id, x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Export helpers: high-res PNG (print) + web-optimized JPG per handoff L4. */
export function toPngBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

export function toWebJpgBlob(canvas, maxW = 1600, quality = 0.85) {
  const scale = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}
