// A confirmed label position, moved onto the picture it is about to be drawn on.
//
// A label's x/y are a fraction of an IMAGE, and one plan has several images of
// itself: the wireframe Review edits against, the light render and the dark
// render. The wireframe is padded to the model's aspect before it is sent and
// each render comes back framed its own way, so one pair of numbers means three
// different places on three pictures.
//
// Studio learned this the hard way and fixed it for the 2D export — the note
// above `toShown` in studio.html has the measurement: on one plan the
// wireframe's drawing sits at x 0.107 w 0.794, so a label at 0.85 of the image
// is at 93.6% of the drawing there and 87.2% of it on a full-framed render.
// Six percent of the plan's width, plainly visible.
//
// THE 3D VIEW NEVER APPLIED THAT FIX. It mapped stored positions straight onto
// the render's wall bounds, which is the same mistake in a different frame, and
// Saman's report was exactly the symptom the 2D path used to have: "the
// placements still do not match the 2D render, they are a little off."
//
// So the rule lives here, once, and every caller uses it: Studio's preview and
// exports, the 3D view as it builds, publishing before it sends (a visitor's
// browser has no wireframe to map from and never will), and the project pack.
//
// THE MAPPING IS MEASURED, NOT ASSUMED (2026-10-05). It used to be the two
// pictures' content boxes: the extent of each one's ink, stretched onto the
// other. That is right only when both boxes describe the same thing, and on a
// tracing that keeps its dimension chains they do not -- the drawing's box is
// the dimension lines, the render's is the building. Saman saw the result from
// both ends: a label set inside its room in Studio stood on a wall in Review,
// and one set in Review landed off its room in Studio. Measured on his Star:
// 1.8% to 6.5% of the plan's width per label; on the Sky's dark render 11%.
// The fit Studio's before/after already trusts (src/sweep-fit.js: the walls
// registered, used only when it beats the boxes by a clear margin) is the one
// used here, so on every plan where the boxes are right nothing changes at all.
//
// POSITIONS A BUILDER APPROVED UNDER THE OLD MAPPING KEEP THEIR PLACE. A label
// ticked on a render (`checkedFor`) was judged where the BOXES put it, so until
// it is carried over (`adopt`, which Studio does with the render it was
// checked on) it is still drawn by the boxes, everywhere. `frame` records
// which mapping a stored position belongs to; see `boxPlaced`.
//
// A STAIR MARKER CARRIES NO TICK, so nothing says whether it was set on the
// wireframe in Review or dragged on a render in Studio -- and both happen: The
// Sky's record has its L-stair marker on a bathroom door of the tracing and on
// the stair of the render, which only the boxes explain. So a marker not
// marked `frame: 'fit'` is where it always was, drawn by the boxes, until it
// is moved (Review) or carried over (Studio); a new one is born measured.

import { planContentBox } from './plan-trim.js';
import { sweepFit, registeredFit } from './sweep-fit.js';

/** A position stored for the measured mapping. */
export const FIT_FRAME = 'fit';
/** A position stored for the content boxes, kept as such after its tick was retired (Review). */
export const BOX_FRAME = 'box';

/**
 * Was this label placed through the content boxes? True for one marked so, and
 * for one ticked on a render before `frame` existed (a tick then meant the
 * builder looked at it where the boxes drew it). An unticked label was placed
 * on the wireframe -- by the anchors or in Review -- and is in no render's frame.
 */
export const boxPlaced = (l) => l?.frame === BOX_FRAME || (!l?.frame && Boolean(l?.checkedFor));

/** A stair marker still placed by the content boxes: any not marked otherwise. */
export const stairBoxPlaced = (st) => st?.frame !== FIT_FRAME;

/** The look a box-placed label was checked on, or null when nothing says. */
export const lookOfCheck = (l) => (l?.checkedFor ? String(l.checkedFor).split('|')[0] || null : null);

/** p mapped by a wire -> render transform (renderNorm = d + wireNorm * s). */
export const applyT = (p, T) => ({ x: T.dx + p.x * T.sx, y: T.dy + p.y * T.sy });
/** And back. */
export const invertT = (p, T) => ({ x: (p.x - T.dx) / T.sx, y: (p.y - T.dy) / T.sy });

const IDENTITY = { sx: 1, sy: 1, dx: 0, dy: 0 };

/**
 * The content boxes' mapping exactly as positions were placed with it (the old
 * mapFrame): a picture whose box cannot be read passes positions through.
 */
function oldBoxes(wire, render) {
  const f = planContentBox(wire), t = planContentBox(render);
  if (!f?.w || !f.h || !t?.w || !t.h) return IDENTITY;
  const sx = t.w / f.w, sy = t.h / f.h;
  return { sx, sy, dx: t.x - f.x * sx, dy: t.y - f.y * sy };
}

// Memos keyed by the pictures themselves, so a picture let go is a memo let go.
const fits = new WeakMap();
const regs = new WeakMap();
const ids = new WeakMap();
let nextId = 1;
const idOf = (o) => { if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o); };
const memo = (map, a, b, make) => {
  let inner = map.get(a);
  if (!inner) map.set(a, (inner = new WeakMap()));
  if (!inner.has(b)) inner.set(b, make());
  return inner.get(b);
};

/** The drawing registered onto one render, when it trusts itself (memoised). */
export const registeredOn = (wire, render) => memo(regs, wire, render, () => registeredFit(wire, render));

/**
 * How one render lies over the wireframe, for label positions: `T` the
 * measured mapping, `box` the old one (for positions still placed by it), `by`
 * which fit `T` is. Measured once per set of pictures -- about half a second
 * on a 2400px plan -- and kept for as long as they are.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} wire the RAW wireframe, the frame positions are stored in
 * @param {HTMLImageElement|HTMLCanvasElement} render
 * @param {Array<HTMLImageElement|HTMLCanvasElement>} [others] the floor's other
 *   renders (the other look): their registrations are candidates here too, so
 *   one drawing gets one fit whichever look it is seen in (sweep-fit.js)
 * @returns {{T:{sx,sy,dx,dy}, box:{sx,sy,dx,dy}, by:'box'|'registered'} | null}
 */
export function frameFit(wire, render, others = []) {
  if (!wire || !render) return null;
  const sibs = (others || []).filter((o) => o && o !== render);
  const key = sibs.map(idOf).join(',');
  const byKey = memo(fits, wire, render, () => new Map());
  if (!byKey.has(key)) {
    const s = sweepFit(wire, render, { also: sibs.map((o) => registeredOn(wire, o)) });
    byKey.set(key, { T: s.T, box: oldBoxes(wire, render), by: s.by });
  }
  return byKey.get(key);
}

/** Where a label (or any {x, y} with its frame) sits on the render `fit` describes. */
export const placeOn = (l, fit) => applyT(l, boxPlaced(l) ? fit.box : fit.T);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Carry a box-placed label into the measured frame, keeping exactly where it
 * sits on the render `fit` describes -- which must be the render it was judged
 * on. Returns whether anything changed. The tick stays: the builder's picture
 * is unchanged.
 */
export function adopt(l, fit) {
  if (!boxPlaced(l) || !fit) return false;
  const w = invertT(applyT(l, fit.box), fit.T);
  l.x = clamp01(w.x);
  l.y = clamp01(w.y);
  l.frame = FIT_FRAME;
  return true;
}

/** The same for a stair marker, whose position is `position`. Changed in place. */
export function adoptStair(st, fit) {
  if (!st?.position || !stairBoxPlaced(st) || !fit) return false;
  const w = invertT(applyT(st.position, fit.box), fit.T);
  st.position.x = clamp01(w.x);
  st.position.y = clamp01(w.y);
  st.frame = FIT_FRAME;
  return true;
}

/**
 * Move label positions from the frame they are STORED in onto a render.
 *
 * @param {Array} labels  confirmed labels, x/y a fraction of the wireframe
 * @param {HTMLImageElement|HTMLCanvasElement|null} wireframe the picture Review
 *   edited against. Without it nothing is mapped — see below.
 * @param {HTMLImageElement|HTMLCanvasElement|null} render the picture they are
 *   about to be drawn on.
 * @param {Array} [others] the floor's other renders, see frameFit
 * @returns {Array} labels with x/y in the render's frame; the same objects'
 *   other fields untouched.
 */
export function labelsOnRender(labels, wireframe, render, others = []) {
  const list = labels || [];
  // NO WIREFRAME MEANS NO MAPPING, NOT A GUESS. A floor whose wireframe has
  // been cleared, or a published copy that never carried one, is left exactly
  // as it is: stored coordinates are still a reasonable reading of the render,
  // and inventing a transform from one of the two pictures would move every
  // label by an amount nobody measured. Studio guards the same way.
  const fit = frameFit(wireframe, render, others);
  if (!fit) return list;
  return list.map((l) => ({ ...l, ...placeOn(l, fit) }));
}

/**
 * The confirmed stair markers, moved onto a render the same way. A marker's
 * `position` is a fraction of the wireframe like a label's x/y, and the 3D
 * reads the render around it (src/model3d/stairs.js): off by the framing,
 * it reads the wrong window. Which mapping: `stairBoxPlaced`.
 */
export function stairsOnRender(stairs, wireframe, render, others = []) {
  const list = stairs || [];
  const fit = frameFit(wireframe, render, others);
  if (!fit) return list;
  return list.map((st) => {
    const p = st?.position || (typeof st?.x === 'number' ? { x: st.x, y: st.y } : null);
    if (!p) return st;
    return { ...st, position: applyT(p, stairBoxPlaced(st) ? fit.box : fit.T) };
  });
}
