// The fixture catalogue.
//
// WHY THE MODEL IS NOT ALLOWED TO DRAW THESE.
//
// Across two generated viewers the split was consistent: the model reproduced
// what was IN the picture accurately — every room label and dimension string,
// 16 out of 16 — and improvised everything it had to construct. The clearest
// case was the garage. Both viewers contained this:
//
//     carItem(gar.x0 + gw*0.25, carCz);
//     carItem(gar.x0 + gw*0.75, carCz);
//
// Two cars, unconditionally. Both plans happened to have two-car garages, so it
// looked right twice, which is exactly how this defect stays hidden. It is the
// same failure `src/garage.js` was written for after the 2D prompt drew two
// cars in a single-car garage — a defect Saman caught by imagining a plan we
// had not tested.
//
// So fixtures come from here, at real sizes, in the numbers our own code
// derives. `plannedCars()` already knows how many cars a garage may claim, and
// it is deliberately conservative: fewer than fit is never a false claim about
// a property, more than fit always is.
//
// THE HEIGHT PROBLEM, AND WHAT WAS WRONG WITH IT.
//
// A dollhouse view needs short walls or you cannot see in, and the generated
// code used 4ft. But it drew the fixtures at full size, so a 6ft fridge stood
// taller than the wall beside it and a car reached 94% of wall height. Nothing
// looked deliberate.
//
// The convention that fixes it is the one architects already use: this is a
// SECTION CUT. Walls and contents are sliced at the same height, everything
// below is true scale, and anything taller is simply cut off — which is what a
// section drawing does and reads as intentional. `SECTION_H` is that plane.
//
// Every dimension below is real, in feet, and can be checked against a tape
// measure. That is the point: it is the reason two exports of different plans
// come out looking like the same product.

import { carsFromLabel, UNNAMED_CAP } from '../garage.js';

/** The cut plane. Above this nothing is drawn.
 *  5ft clears a car's roof (4.75ft) — set lower and every garage loses the tops
 *  of its cars, which was the most visible fault in the generated output. */
export const SECTION_H = 5.0;

/**
 * @typedef {Object} Fixture
 * @property {string} id
 * @property {number} w   footprint across, feet
 * @property {number} d   footprint deep, feet
 * @property {number} h   TRUE height, feet — clipped to SECTION_H when drawn
 * @property {number} [clear]  walking room this wants in front, feet
 * @property {'wall'|'free'|'corner'} anchor  how it wants to sit in a room
 */

/** Real sizes. A sedan is 15.7ft because a Camry is 15.8ft, not because 15.7
 *  looked right next to a wall. */
export const CATALOG = {
  car:          { id: 'car',          w: 6.0,  d: 15.7, h: 4.75, anchor: 'free', clear: 2.5 },

  bedQueen:     { id: 'bedQueen',     w: 5.0,  d: 6.67, h: 2.1,  anchor: 'wall', clear: 2.0 },
  bedKing:      { id: 'bedKing',      w: 6.33, d: 6.67, h: 2.1,  anchor: 'wall', clear: 2.0 },
  nightstand:   { id: 'nightstand',   w: 1.67, d: 1.42, h: 2.0,  anchor: 'wall' },

  sofa3:        { id: 'sofa3',        w: 7.0,  d: 3.0,  h: 2.7,  anchor: 'wall', clear: 2.5 },
  sofa2:        { id: 'sofa2',        w: 5.0,  d: 3.0,  h: 2.7,  anchor: 'wall', clear: 2.5 },
  coffeeTable:  { id: 'coffeeTable',  w: 4.0,  d: 2.0,  h: 1.4,  anchor: 'free' },
  diningTable4: { id: 'diningTable4', w: 3.0,  d: 5.0,  h: 2.5,  anchor: 'free', clear: 3.0 },
  diningChair:  { id: 'diningChair',  w: 1.5,  d: 1.5,  h: 3.0,  anchor: 'free' },
  desk:         { id: 'desk',         w: 5.0,  d: 2.5,  h: 2.5,  anchor: 'wall', clear: 3.0 },

  counter:      { id: 'counter',      w: 2.0,  d: 2.0,  h: 3.0,  anchor: 'wall' },
  island:       { id: 'island',       w: 3.0,  d: 6.0,  h: 3.0,  anchor: 'free', clear: 3.0 },
  sinkDouble:   { id: 'sinkDouble',   w: 2.7,  d: 1.8,  h: 3.0,  anchor: 'wall' },
  range:        { id: 'range',        w: 2.5,  d: 2.0,  h: 3.0,  anchor: 'wall', clear: 3.0 },
  fridge:       { id: 'fridge',       w: 3.0,  d: 2.5,  h: 6.0,  anchor: 'wall', clear: 3.0 },

  toilet:       { id: 'toilet',       w: 1.67, d: 2.5,  h: 2.5,  anchor: 'wall', clear: 1.75 },
  vanity:       { id: 'vanity',       w: 2.0,  d: 1.8,  h: 2.83, anchor: 'wall', clear: 2.5 },
  tub:          { id: 'tub',          w: 5.0,  d: 2.5,  h: 1.9,  anchor: 'wall', clear: 2.0 },
  shower:       { id: 'shower',       w: 3.0,  d: 3.0,  h: 6.5,  anchor: 'corner', clear: 2.0 },

  // A flight, not a fixture the model may invent. Position and direction come
  // from the CONFIRMED record — Review already makes the customer sign off
  // "1 staircase: UP" — and only the size is standard: a 3ft-6 run with 7in
  // risers and 10in treads, which is what a residential stair is.
  stairRun:     { id: 'stairRun',     w: 3.5,  d: 11.0, h: 5.0,  anchor: 'free', clear: 3.0 },

  washer:       { id: 'washer',       w: 2.25, d: 2.5,  h: 3.0,  anchor: 'wall', clear: 3.0 },
  dryer:        { id: 'dryer',        w: 2.25, d: 2.5,  h: 3.0,  anchor: 'wall', clear: 3.0 },
  waterHeater:  { id: 'waterHeater',  w: 2.0,  d: 2.0,  h: 5.0,  anchor: 'corner' },
  furnace:      { id: 'furnace',      w: 2.0,  d: 2.5,  h: 4.5,  anchor: 'wall', clear: 2.5 },
};

/** Drawn height: true height, cut at the section plane. */
export const drawnHeight = (f) => Math.min(f.h, SECTION_H);

/**
 * How many of a fixture fit across a span, given the clearance it wants.
 *
 * Used for cars, and the rule that matters is asymmetric: drawing FEWER than
 * fit understates a property, which is safe; drawing MORE claims capacity the
 * building does not have, which is not. So this floors, and never rounds up.
 */
export function fitCount(span, fixture, gap = 1.0) {
  if (!(span > 0)) return 0;
  const each = fixture.w + gap;
  return Math.max(0, Math.floor((span + gap) / each));
}

/** Room to open a car door, and to walk between two of them. */
const CAR_GAP = 1.5;

// The four ways cars actually park, in the order a builder would expect to see
// them. Side by side first, because that is what a garage normally is; tandem
// only when the shape leaves no other option — a 12ft x 40ft garage holds two
// cars, one behind the other, and an earlier version of this returned one
// because it only ever considered a row.
//
// `along` is the axis the cars are spread down; `rot` is the car's heading.
const ARRANGEMENTS = [
  { id: 'row-x',    along: 'x', rot: 0,           span: 'w', run: 'd', unit: 'w', depth: 'd' },
  { id: 'row-z',    along: 'z', rot: Math.PI / 2, span: 'd', run: 'w', unit: 'w', depth: 'd' },
  { id: 'tandem-z', along: 'z', rot: 0,           span: 'd', run: 'w', unit: 'd', depth: 'w' },
  { id: 'tandem-x', along: 'x', rot: Math.PI / 2, span: 'w', run: 'd', unit: 'd', depth: 'w' },
];

function arrangementFits(a, rect, n, car) {
  const room = { w: rect.x1 - rect.x0, d: rect.z1 - rect.z0 };
  const need = n * car[a.unit] + (n - 1) * CAR_GAP;
  return need <= room[a.span] + 1e-9 && car[a.depth] <= room[a.run] + 1e-9;
}

/**
 * Cars for one garage.
 *
 * The count comes from `carsFromLabel`, exactly as the 2D render's does. The
 * geometry is a CAP and never a source: a plan calling itself a three-car
 * garage whose drawn bay cannot hold three gets two, because the drawing is the
 * thing being sold — but a bay nobody named never gains a car from its size.
 *
 * @param {{name?:string}} label  the confirmed room label, or null
 * @param {{x0,z0,x1,z1}} rect    the garage in MODEL units, which are feet only
 *   by assumption — the scale is a constant chosen by eye (view3d.html's
 *   DEFAULT_WIDTH_FT), so this may cap a count but must never produce one, and
 *   nothing derived from it may be shown to the customer as a measurement.
 * @returns {{count:number, why:string, planned:number, fits:number,
 *            spots:Array<{x:number,z:number,rot:number}>}}
 */
export function carsForGarage(label, rect) {
  const planned = carsFromLabel(label);
  // TWO, not three. Geometry alone will happily put three cars in a 20x22
  // garage — the arithmetic works — but a garage the plan did not bother to
  // name is realistically a single or a double, and three cars in an unlabelled
  // bay reads as the software showing off rather than the plan speaking. The
  // complaint that started this was one car where two obviously fit; the fix
  // must not overshoot into the opposite error.
  let fits = 0;
  // Probe from the cap downward, not from `planned`: an unnamed garage plans
  // one, so starting there could never discover that two fit — the very
  // question being asked.
  const probeFrom = Math.max(planned.cars, UNNAMED_CAP);
  for (let n = probeFrom; n >= 1; n--) {
    if (ARRANGEMENTS.some((a) => arrangementFits(a, rect, n, CATALOG.car))) { fits = n; break; }
  }
  // THE LABEL DECIDES. THE GEOMETRY MAY ONLY REDUCE.
  //
  // This briefly read "an unnamed garage takes what the confirmed walls hold",
  // on the reasoning that the extruded rectangle is a better witness than a
  // fallback of one. THAT REASONING WAS WRONG, and finding out why is worth
  // more than the rule itself.
  //
  // `rect` is not measured. It is the room's share of the image multiplied by
  // `DEFAULT_WIDTH_FT` in view3d.html, which is 40 and whose own comment says
  // "approved by eye". Every plan is assumed forty feet wide. So "19.0ft
  // across" was never a measurement of anybody's garage — it was a proportion
  // wearing a unit, and the note reported it to the customer as a fact.
  //
  // A number nobody measured must not decide what gets drawn, and must not be
  // shown. That is red line 2 with an extra step in front of it: not calculated
  // from the plan's own figures, but scaled off a constant chosen by eye.
  //
  // So an unnamed garage draws ONE — the same answer `carsVar` sends the 2D
  // render, which is the point. The two surfaces disagreeing is the defect this
  // whole thread started from, and they can only agree by reading one source.
  // The plan's own text is the only source with a real scale in it.
  //
  // The clamp stays, because it can only ever reduce: if the assumed scale is
  // too small `fits` under-reports and we draw fewer, and if it is too large
  // the clamp does not bind and the plan's own claim stands. Erring low is the
  // direction the whole file already errs in.
  const count = Math.min(planned.cars, fits);
  const why = fits < planned.cars
    ? `${planned.cars} claimed, but the drawn bay looks too small for that many.`
    : planned.why;
  return { count, why, planned: planned.cars, fits, spots: layoutCars(rect, count) };
}

/**
 * Where the cars go inside a garage rectangle.
 *
 * Evenly spaced with the leftover split between the walls, so a single car is
 * centred rather than shoved against a side.
 *
 * @returns {Array<{x:number, z:number, rot:number}>} centres in feet, rot in radians
 */
export function layoutCars(rect, count) {
  if (!(count > 0)) return [];
  const car = CATALOG.car;
  const pick = ARRANGEMENTS.find((a) => arrangementFits(a, rect, count, car));
  if (!pick) return [];
  const lo = pick.along === 'x' ? rect.x0 : rect.z0;
  const hi = pick.along === 'x' ? rect.x1 : rect.z1;
  const lane = (hi - lo) / count;
  const mid = pick.along === 'x' ? (rect.z0 + rect.z1) / 2 : (rect.x0 + rect.x1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const at = lo + (i + 0.5) * lane;
    return pick.along === 'x'
      ? { x: at, z: mid, rot: pick.rot }
      : { x: mid, z: at, rot: pick.rot };
  });
}

/** Treads and risers for a flight, from the run length. A residential stair is
 *  a 10in tread and a 7in riser, so the count follows from the length rather
 *  than being chosen to look right. */
export const TREAD = 10 / 12;
export const RISER = 7 / 12;
export const treadCount = (runFt = CATALOG.stairRun.d) => Math.max(2, Math.round(runFt / TREAD));

/**
 * A flight placed from a CONFIRMED staircase record.
 *
 * Review stores a normalized position, a heading and an up/down direction, and
 * the customer confirms them — the fourth item on the verification checklist is
 * the staircase. So none of that is asked of the image model, exactly as with
 * room names: the model supplies the shell, the record supplies the facts.
 *
 * @param {{x:number, y:number, heading?:string, direction?:string}} stair
 *   x/y normalized 0..1 across the building footprint
 * @param {{x0,z0,x1,z1}} extent
 * @returns {{x:number, z:number, rot:number, up:boolean, treads:number,
 *            w:number, d:number}}
 */
export function placeStair(stair, extent) {
  const w = extent.x1 - extent.x0, d = extent.z1 - extent.z0;
  const heading = String(stair.heading || (stair.direction === 'down' ? 'down' : 'up'));
  // Screen headings, matching Review's own vocabulary: `up` points north, which
  // is -z here. The flight runs along that axis.
  const rot = (heading === 'left' || heading === 'right') ? Math.PI / 2 : 0;
  return {
    x: extent.x0 + stair.x * w,
    z: extent.z0 + stair.y * d,
    rot,
    up: stair.direction !== 'down',
    treads: treadCount(),
    w: CATALOG.stairRun.w,
    d: CATALOG.stairRun.d,
  };
}

/**
 * Does a fixture physically fit in a room?
 *
 * Checked before anything is placed. The generated viewers put a 6.5ft sofa in
 * whatever room matched a name, which on a small plan means furniture standing
 * in the walls — and a builder reads that as the tool not understanding their
 * house.
 */
export function fitsIn(rect, fixture) {
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
  const need = fixture.clear || 0;
  return (fixture.w <= w && fixture.d + need <= d)
      || (fixture.d <= w && fixture.w + need <= d);
}
