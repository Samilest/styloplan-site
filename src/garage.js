// How many cars belong in this garage?
//
// The styling prompt draws TWO, unconditionally, in every garage. On a
// single-car garage that publishes a false claim about the property, inside the
// one artefact whose selling point is that its contents were checked. Seen
// live: a sheet whose own label reads `3-CAR GARAGE` came back with two cars
// and a visibly empty third bay.
//
// THE ASYMMETRY THAT SHAPES EVERYTHING HERE. Drawing fewer cars than fit is not
// a lie — the empty floor is visible and the viewer draws their own conclusion.
// Drawing more is. So every uncertain case rounds DOWN, and the default is one.
//
// WHAT THIS IS FOR. A suggestion, not an answer. Eight real garages were read
// off plans (the table is in AGENT-HANDOFF) and no single signal is usually
// present: the name says it twice, the doors say it twice, a drawn car says it
// twice, and twice there is nothing but a width. The user settles it by looking
// at the render, which is a judgement anyone can make from a picture — unlike
// "how many cars fit", which the product's own owner could not answer about his
// own test plan.
//
// AND WHAT WE CANNOT SEE. Of those four signals only two survive extraction: a
// space carries `name`, `dim` and `anchor`, so door widths and drawn cars are
// invisible to us. Adding them means changing PROMPT_EXTRACT.
//
// THREE NUMBERS, ON PURPOSE, and only one of them is rendered.
//
// - `plannedCars` reads the NAME alone. It can never overstate a garage: an
//   unnamed one plans a single, whatever the width says.
// - `widthHint` reads the DIMENSION and is offered to the user, uncapped. It
//   may be wrong in either direction, so it asks rather than tells.
// - `carsFromLabel` is what actually gets rendered, and it is the ONLY thing
//   that decides. A named count wins; otherwise the confirmed dimension does,
//   capped at two.
//
// The separation exists because correcting the count costs a credit — the cars
// are inside the AI image, not composited on top like the text and the colour —
// so a guess presented as a finding is a guess the customer pays to undo.
//
// WHY THE DIMENSION IS NOW RENDERED, having been hint-only before. It was held
// back on the grounds that a dimension string does not say which wall the doors
// are on, so `24-2 × 34-0` and its mirror would be read differently. Two things
// changed. The count is taken from the NARROWER figure (`spanFeet`), which is
// the parking span whichever order it was typed in, so the mirror pair now
// answers the same. And it is capped at two, which retires the failure the
// caution was really about: drawing three where two belong.
//
// The cost of NOT rendering it was concrete. `carsVar` fed the prompt a count
// from the name alone while the 3D model measured the room, so The Avi's
// `18'-8" X 21'-7"` garage came out with one car in the image and two in the
// model — the same fact stored twice and drifting, which is the shape of every
// drift bug in this project.

const GARAGE = /\bgarage\b/i;
// A carport has no vehicle door and often no walls, which is exactly how the
// styling prompt defines a garage — and it is frequently marked optional. Every
// numeric rule calls `OPTIONAL CARPORT 21-2 × 21-0` a two-car garage; the right
// answer is no cars at all.
const CARPORT = /\bcar\s?port\b/i;
// "2-CAR GARAGE", "3 CAR GARAGE" — the plan simply saying it.
const NAMED_COUNT = /(\d+)\s*[-\s]?\s*car\b/i;

// Feet from the first figure of a dimension string, whatever the notation:
// 17'-4", 17' 4", 17-4, 17'4", 3,70 (metric, comma decimal).
function firstFeet(dim) {
  const s = String(dim || '').trim();
  if (!s) return null;
  const metric = /^\s*(\d+)[,.](\d+)\s*[xX×]/.exec(s);
  if (metric) return (Number(metric[1]) + Number(metric[2]) / 100) * 3.28084;
  const m = /^\s*(\d+)\s*(?:'|’)?\s*[-\s]?\s*(\d{1,2})?\s*(?:"|”)?/.exec(s);
  if (!m) return null;
  const feet = Number(m[1]);
  if (!Number.isFinite(feet) || feet <= 0) return null;
  const inches = m[2] ? Number(m[2]) : 0;
  return feet + (inches < 12 ? inches / 12 : 0);
}

/**
 * The NARROWER of the two dimensions, which is the span cars park across.
 *
 * `firstFeet` reads whichever figure the draughtsman wrote first, and plans do
 * not agree on an order. That did not matter while the width was only a HINT
 * for a human to check, but it decides the count now, and the mirror pair is a
 * real defect: a single-car `12'-4" X 19'-8"` reads as one, while the same
 * garage written `19'-8" X 12'-4"` reads as two.
 *
 * Taking the minimum removes the ambiguity instead of guessing at it. A garage
 * is deeper than it is wide in essentially every plan here — a single runs
 * about 12x20, a double about 20x22 — so the short side is the parking span
 * whichever way round it was typed.
 */
function spanFeet(dim) {
  const s = String(dim || '');
  // METRIC IS READ WHOLE, never off a split half. `firstFeet` needs the `x` to
  // tell a comma decimal from a thousands separator, so handing it `7,50` on
  // its own gets 7 FEET back for 7.5 metres — a two-car garage read as one.
  const metric = /^\s*(\d+)[,.](\d+)\s*[xX×]\s*(\d+)[,.](\d+)/.exec(s);
  if (metric) {
    const m = (a, b) => (Number(a) + Number(b) / 100) * 3.28084;
    return Math.min(m(metric[1], metric[2]), m(metric[3], metric[4]));
  }
  const parts = s.split(/[xX×]/);
  if (parts.length < 2) return firstFeet(s);
  const a = firstFeet(parts[0]), b = firstFeet(parts[1]);
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

// Bands, not a per-car divisor. Measured across the eight: a single-car garage
// runs 12'4"–17'4" wide and a two-car starts around 23'6", so the gap sits
// between them rather than at any tidy multiple. Drawn generously so a wide
// single-car garage still reads as one.
const BANDS = [[18, 1], [29, 2]];
const fromWidth = (ft) => {
  if (ft == null) return null;
  for (const [under, cars] of BANDS) if (ft < under) return cars;
  return 3;
};

// Named with the word "garage" and yet OUTSIDE the building: an apron is the
// paving in front of the door and is one of the seven outdoor regions the hatch
// rule lists. A car drawn there is a car sitting on the driveway, which the
// styling prompt itself calls a worse error than an empty garage.
const OUTSIDE = /\b(apron|driveway|slab|pad|parking)\b/i;

export const isGarage = (l) =>
  Boolean(l?.name && !OUTSIDE.test(l.name) && (GARAGE.test(l.name) || CARPORT.test(l.name)));

/**
 * What we actually RENDER. Only the two signals that cannot overstate a garage:
 * a carport draws none, a plan that names its own count is believed, and
 * everything else gets one.
 *
 * The width band is deliberately NOT used here. It happens to be right on five
 * of the eight, but it reads the FIRST figure of the dimension string and
 * nothing in that string says which wall the doors are on — `24-2 × 34-0` parks
 * three behind doors on its 34ft wall. The mirror of that case, `34-0 × 24-2`
 * with doors on the short wall, would have us draw three where two belong. It
 * did not happen on these eight; that is luck, not design, and the one error
 * this module exists to prevent is exactly that one.
 *
 * @param {{name?:string, dim?:string}} label
 * @returns {{cars:number, from:string, why:string}}  from: 'carport'|'name'|'default'
 */
export function plannedCars(label) {
  const name = String(label?.name || '');

  if (CARPORT.test(name)) {
    return { cars: 0, from: 'carport', why: 'A carport is open and has no vehicle door, so no cars are drawn.' };
  }
  const named = NAMED_COUNT.exec(name);
  if (named) {
    const n = Math.max(0, Math.min(4, Number(named[1])));
    return { cars: n, from: 'name', why: `The plan labels this a ${n}-car garage.` };
  }
  return {
    cars: 1,
    from: 'default',
    why: 'One car, because the plan does not say. Fewer than fit is never a false claim about the property.',
  };
}

/**
 * What we OFFER the user, when the width disagrees with what we planned.
 *
 * Shown, never rendered. Correcting the count means paying for another render —
 * the cars live inside the AI image, unlike colour — so the offer has to carry
 * its own uncertainty rather than presenting a guess as a finding.
 *
 * @returns {{cars:number, why:string}|null} null when there is nothing to add
 */
export function widthHint(label) {
  const planned = plannedCars(label);
  if (planned.from !== 'default') return null;   // the plan already told us
  const ft = firstFeet(label?.dim);
  const byWidth = fromWidth(ft);
  if (byWidth == null || byWidth <= planned.cars) return null;
  return {
    cars: byWidth,
    why: `The ${ft.toFixed(0)} ft dimension could hold ${byWidth}. Check your plan. `
      + 'a wide garage with one door still holds one car.',
  };
}

/**
 * How many cars a garage gets, from the plan alone. THE ONE PLACE THAT DECIDES.
 *
 * The count used to be worked out twice: `carsVar` for the 2D render read only
 * the label's name, while `carsForGarage` for the 3D model read the name AND
 * the geometry. So the same garage came out with one car in the image and two
 * in the model. Two sources of truth for one number is the shape of every drift
 * bug in this project.
 *
 * A NAMED count is the plan speaking and wins outright. Otherwise the CONFIRMED
 * dimension decides — `18'-8" X 21'-7"` is a transcription the customer signed
 * off, not a measurement we derived, so using it does not cross red line 2.
 * Capped at two, because a garage nobody bothered to name is realistically a
 * single or a double, and three cars in an unlabelled bay reads as the software
 * showing off.
 *
 * Falls back to one when there is no usable dimension: fewer than fit is a
 * small error, more than fit states something false about the property.
 */
export const UNNAMED_CAP = 2;

export function carsFromLabel(label) {
  const planned = plannedCars(label);
  if (planned.from !== 'default') return planned;
  const ft = spanFeet(label?.dim);
  const byWidth = fromWidth(ft);
  if (byWidth == null) return planned;
  const cars = Math.max(1, Math.min(byWidth, UNNAMED_CAP));
  return {
    cars,
    from: 'width',
    why: `The plan does not say, and its own ${ft.toFixed(0)} ft dimension holds ${cars}.`,
  };
}

// The prompt reads better with a word than a digit, and "none" states the empty
// case in language rather than asking the model to interpret a zero.
const WORDS = ['none', 'one', 'two', 'three', 'four'];

/**
 * The value for the prompt's `{{CARS}}` placeholder, for a whole floor.
 *
 * ONE number for the image, because the prompt addresses "the garage" and a
 * plan with two separate garages is rare enough not to complicate the template
 * over. The lowest count wins for the same reason everything else here rounds
 * down: it is the only direction that cannot overstate the property.
 *
 * NO GARAGE NAMED MEANS 'none', NOT SILENCE. This returned null, and the caller
 * then sent no variable at all — on the belief that the prompt's own "no garage
 * → no cars" rule would run untouched. It does not: the placeholder is
 * `{{CARS | one}}`, so omitting the value fills in ONE and the sheet goes out
 * instructing the model to draw a car. That is how The Avi's main floor, whose
 * confirmed labels name no garage, came back with a single car in a space
 * nobody had called a garage — the count Saman reported, asserted by us.
 *
 * An unnamed space is the customer declining to say what it is. A car is a
 * claim that it is a garage, and it is not ours to make on their behalf. So the
 * floor says 'none' and an empty bay goes out instead: the same asymmetry the
 * whole file turns on — an empty garage is visible and the viewer judges it,
 * while a car in a room that is not a garage states something false.
 *
 * @returns {string} always a word, never null. 'none' when nothing on the floor
 *   is named as a garage.
 */
export function carsVar(labels) {
  const g = (labels || []).filter(isGarage);
  if (!g.length) return WORDS[0];
  const n = Math.min(...g.map((l) => carsFromLabel(l).cars));
  return WORDS[Math.max(0, Math.min(WORDS.length - 1, n))];
}

/** Every garage on a floor, with what we will draw and what we might offer. */
export function garageSuggestions(labels) {
  return (labels || []).filter(isGarage).map((l) => ({
    id: l.id, name: l.name, ...plannedCars(l), hint: widthHint(l),
  }));
}
