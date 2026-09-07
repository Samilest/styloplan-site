// Review Station state — the project JSON is the SINGLE SOURCE OF TRUTH for
// labels and layout metadata (handoff L2). Every user correction goes through
// these actions; nothing edits the canvas directly.

import { suspectDims } from './dim-shape.js';

let project = null;
const listeners = new Set();

// Just inside the edge, so a clamped element is visible and grabbable rather
// than half off the canvas.
const onPlan = (v) => (Number.isFinite(v) ? Math.min(0.98, Math.max(0.02, v)) : 0.5);

export function createProject(l1) {
  project = {
    sourceUrl: l1.sourceUrl,
    wireframeUrl: l1.wireframeUrl,
    extraction: l1.extraction, // raw L1 output, kept for the verification report
    labels: l1.extraction.spaces.map((s, i) => ({
      id: `s${i}`,
      name: s.name,          // null = unlabeled space (still counted)
      dim: s.dim,            // verbatim transcription — edit replaces, never computes
      // ON THE PLAN, ALWAYS. The anchor arrives from the model and was used
      // raw, so a space whose anchor came back outside 0..1 drew its chip off
      // the canvas: the reviewer could name it, the count would drop by one,
      // and nothing would appear. Saman hit exactly that — "the system thinks
      // the label is placed but no label came onto the plan".
      //
      // Unnamed spaces are the ones this bites, because they are never snapped
      // to the wireframe's pixels and their anchor is the model's rough guess.
      // A guess that lands off the page is the one kind we cannot let through:
      // an element nobody can see is also an element nobody can drag back.
      //
      // Clamped a little inside the edge rather than exactly on it, so the chip
      // sits ON the plan instead of half over the border. It is still the wrong
      // place, and it is meant to be obvious that it needs moving; what it can
      // no longer be is invisible. `dragged` elsewhere already carries the same
      // rule for positions the reviewer sets.
      x: onPlan(s.anchor.x),
      y: onPlan(s.anchor.y),
      // WHERE THE INK IS, which is not where the label is once it is dragged.
      //
      // `x`/`y` are the label's position and the reviewer moves them; this is
      // the spot the extraction read the name AT, and it never moves. The
      // wireframe download needs it to cover the tracing's own text: masking at
      // the label's current position painted white over clean linework and left
      // the original name showing, so a moved label came out doubled with a
      // hole beside it.
      ink: { x: s.anchor.x, y: s.anchor.y },
      // How wide the wireframe drew this name — a width the room demonstrably
      // holds. The compositor shrinks long names to it so they stop running
      // over walls. Undefined when the label could not be matched back.
      fitWidth: s.anchor.fitWidth,
      // The box of ink the wireframe drew here, which Review's chip masks.
      // Unlike fitWidth this describes the IMAGE, not the label's text, so it
      // outlives every edit to the name.
      fitBox: s.anchor.fitBox,
      size: s.size,            // user override from the Review size control
    })),
    objects: [],             // {id, type, x, y, scale, rot}
    // Dabs the reviewer painted out — see src/review/eraser.js. Normalised to
    // the wireframe, so they survive a re-render at another size. Stored rather
    // than applied destructively: the original wireframe stays intact, and a
    // reviewer who erases the wrong thing can undo it after the fact.
    erases: [],              // {x, y, r} in 0..1
    // A plan usually has SEVERAL staircases (one UP, one DN, ...), so this is
    // a list. Each entry is independently editable in the Review Station.
    staircases: normalizeStaircases(l1.extraction),
    // `nothingAdded` is the fifth check, and the only one about what should NOT
    // be in the drawing. The other four ask whether what IS there is right; a
    // wall, door or closet that was never on the plan passes all of them — the
    // count still matches, the dimensions still transcribe, the stairs and the
    // silhouette are still correct. Two plans grew an invented closet and every
    // automatic check said fine.
    checklist: { spaces: false, stairs: false, dims: false, nothingAdded: false },
    // Measured, not confirmed: set from register() once the images are loaded.
    // `acknowledged` records that a reviewer chose to proceed past a failure.
    geometry: null,   // {ok, aspectDev, deviation, acknowledged, acknowledgedAt}
    specs: { beds: null, baths: null, sqft: null, confirmed: false },
    confirmedAt: null,
  };
  emit();
  return project;
}

// Accepts the current `staircases` array and also the older single `stairs`
// object, so projects captured before the schema change still open.
// Three presets rather than a free slider: the marker only has to say WHERE
// the stair is and WHICH WAY it runs, and a continuous control invites
// fiddling with something that is not part of the deliverable.
export const STAIR_LENGTHS = ['short', 'medium', 'long'];

// Which way the marker points ON THE PLAN. This is NOT the same fact as
// `direction`: "UP" means the flight climbs to the next storey, while the arrow
// runs along the flight, and a stair laid out east-west climbs just as often as
// one laid out north-south. The two were conflated, so every marker was drawn
// vertically and a horizontal staircase got an arrow across the room next door.
export const STAIR_HEADINGS = ['up', 'right', 'down', 'left'];

// A SPIRAL IS NOT A SHORT STRAIGHT ONE.
//
// Every other field here describes a straight run: flights, a divider between
// them, a length along an axis, and one heading. A spiral or circular stair has
// none of those. It turns through a full circle, so there is no direction the
// flight "runs", and the marker a drawing uses for it is a curved arrow around
// its centre, not a straight arrow across it.
//
// This matters because the marker is COMPOSITED ONTO THE DELIVERABLE. Before
// this existed, a plan with a spiral stair got a straight arrow drawn through
// it, which describes circulation the building does not have — the same class
// of error as drawing two cars in a one-car garage, and on the same artefact
// whose selling point is that its contents were verified.
//
// `straight` is the default, so nothing about an existing project changes.
export const STAIR_KINDS = ['straight', 'spiral'];
const HEADING_VECTOR = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
export const headingVector = (h) => HEADING_VECTOR[h] || HEADING_VECTOR.up;

function normalizeStaircases(extraction) {
  const list = Array.isArray(extraction?.staircases)
    ? extraction.staircases
    : (extraction?.stairs?.present ? [extraction.stairs] : []);
  return list.map((s, i) => ({
    id: `st${i}`,
    // Read from whatever word the model used. Nothing asks for it yet, so in
    // practice this is `straight` until the reviewer says otherwise — which is
    // the safe direction: a spiral marked straight is the status quo, while a
    // straight one marked spiral would invent a curve.
    kind: STAIR_KINDS.includes(s.kind) ? s.kind
      : (/spiral|circular|helical|winder/i.test(String(s.type || s.shape || '')) ? 'spiral' : 'straight'),
    // NOT PRINTED UNTIL SOMEONE ASKS, because the plan usually draws its own.
    //
    // Prompt 1 keeps the source's direction ARROW as a graphic and only the
    // UP/DN letters are stripped (red line 1). Measured on Geena: the break
    // line and its X survive into both the light and the dark render, so an
    // arrow, being the same kind of mark, survives too. Drawing ours on top of
    // it gives the buyer two arrows unless they land exactly on each other,
    // which is the doubled-room-name bug in a different costume.
    //
    // The reverse case is real as well and is why this is a choice rather than
    // a deletion: Geena's own plan has NO arrow, only the word DN, and we
    // remove that word because we must. Its render therefore carries no
    // direction at all, and our marker is the only thing that restores it.
    //
    // So the reviewer decides, looking at the render, the same way they settle
    // the garage car count. Default off, because an extra arrow is spotted at a
    // glance and a missing one is not: whoever is looking must be told the
    // lettering is gone, not left to notice an absence.
    //
    // `undefined` counts as printed at draw time so that projects saved before
    // this field existed keep exactly the image they were signed off on.
    printed: false,
    flights: s.flights ?? 1,
    divider: Boolean(s.divider),
    direction: normalizeDirection(s.direction),
    // Marker length in the Review canvas. One fixed length made a short flight
    // in a landing carry the same arrow as a full run, which is exactly the
    // comparison the stair check asks the reviewer to make.
    length: STAIR_LENGTHS.includes(s.length) ? s.length : 'medium',
    // Default preserves the old behaviour exactly: an UP stair pointed up the
    // screen, anything else pointed down. The reviewer re-aims the ones the
    // plan actually lays out sideways.
    heading: STAIR_HEADINGS.includes(s.heading)
      ? s.heading
      : (normalizeDirection(s.direction) === 'up' ? 'up' : 'down'),
    position: { x: s.position?.x ?? 0.5, y: s.position?.y ?? 0.5 },
  }));
}

// The model echoes the plan's own wording — "UP", "DN", "DOWN" — so map it
// onto the two values the UI actually draws with.
function normalizeDirection(raw) {
  const d = String(raw || '').trim().toLowerCase();
  if (d === 'up' || d === 'u') return 'up';
  if (d === 'dn' || d === 'down' || d === 'd') return 'down';
  return 'unknown';
}

export const getProject = () => project;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => fn(project));

let nextId = 100;

/**
 * Re-seed the label set from a floor's confirmed `verified.labels`.
 *
 * Without this, re-opening Review rebuilds every label from the extraction and
 * re-runs snapLabelsToWireframe — which silently overwrites positions the user
 * set in Studio on the real render, and drops equipment callouts they added.
 * The confirmed set IS the transcription of record, so it wins over a fresh
 * snap. Ids are preserved so Studio's write-back keeps matching.
 */
export function restoreLabels(labels) {
  if (!project || !labels?.length) return;
  // Same rule on the way back in: a floor confirmed before this fix can still
  // be carrying an off-canvas position, and re-opening Review should not
  // reproduce an invisible label.
  project.labels = labels.map((l) => ({ ...l, x: onPlan(l.x), y: onPlan(l.y) }));
  for (const l of labels) {
    const n = Number(String(l.id).replace(/^\D+/, ''));
    if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
  }
  emit();
}

// Normalized positions must stay on the plan — an element that lands outside
// 0..1 would silently disappear from the composed output.
//
// ONE RULE, and it is `onPlan` above. This used to clamp to exactly 0..1 while
// creation clamped a little inside, which is two rules for one fact and it
// showed: an element pushed to the corner sat at exactly 1.0 with half its chip
// past the edge, 513 pixels of it visible out of the usual 1300. Just inside
// the border keeps the whole thing on the plan and grabbable.
function clampXY(patch) {
  if (patch.x !== undefined) patch.x = onPlan(patch.x);
  if (patch.y !== undefined) patch.y = onPlan(patch.y);
  if (patch.position) {
    patch.position = { x: onPlan(patch.position.x), y: onPlan(patch.position.y) };
  }
  return patch;
}

// ---- labels
export function updateLabel(id, patch) {
  const l = project.labels.find((x) => x.id === id);
  if (!l) return;
  // `fitWidth` is the width the wireframe drew THIS name at, and auto-fit uses
  // it as a width budget. Renaming the room makes it a budget for a different
  // string: renaming a 4-letter room to a 14-letter one crushed the new name to
  // the 9px floor to keep it inside the old name's width. A renamed label has
  // no measurement any more, so it falls back to the default size.
  //
  // `fitBox` is deliberately NOT dropped alongside it. That box is where the
  // wireframe's own ink sits, which a rename does not move — and the chip is
  // painted over it to hide the old wording. Dropping both together shrank the
  // mask at the exact moment it mattered, so renaming PRIMARY BEDROOM to DEN
  // left "PRIMARY BEDROOM" showing on either side of the new chip.
  if ('name' in patch && patch.name !== l.name) delete l.fitWidth;
  Object.assign(l, clampXY(patch));
  emit();
}
/**
 * @param {string} [kind] 'room' (default) or 'equipment'. Equipment annotations
 *   are a different class of text: a short code beside a fixture, never a
 *   dimension pair, and allowed to be smaller than a room name because the gap
 *   between a fridge and a wall is not the middle of a room.
 */
export function addLabel(x, y, { name, kind = 'room' } = {}) {
  const l = {
    id: `s${nextId++}`,
    name: name ?? (kind === 'equipment' ? 'REF.' : 'NEW SPACE'),
    dim: null, kind,
    x: onPlan(x), y: onPlan(y),
  };
  project.labels.push(l); emit();
  return l;
}
export function deleteLabel(id) {
  project.labels = project.labels.filter((x) => x.id !== id); emit();
}

/**
 * Paint out something the wireframe invented.
 *
 * Every geometry defect seen so far is an ADDITION — a closet in a bedroom that
 * has none, a wall stub read off a dimension bracket. That is how a generative
 * model fails: it completes a stereotype. Removing is local and certain;
 * drawing a missing wall would be authoring, and is not the reviewer's job.
 *
 * Dabs accumulate as a list rather than being burned into the image, so the
 * wireframe the customer confirmed stays untouched and an erase can be undone
 * after the fact.
 */
export function addErase(dabs) {
  if (!dabs?.length) return;
  (project.erases ||= []).push(...dabs);
  emit();
}
/** Undo one stroke's worth. Strokes are tagged so a drag undoes as one act. */
export function undoErase() {
  const e = project.erases || [];
  if (!e.length) return;
  const last = e[e.length - 1].s;
  project.erases = e.filter((d) => d.s !== last);
  emit();
}
/**
 * Patch the most recent mark, as one act.
 *
 * For corrections whose shape is settled but whose ORIENTATION is not — a door
 * knows its opening the moment it is dragged, but not which end hinges. Turning
 * it by undoing and re-adding would make "the other way round" cost the
 * reviewer their undo, and would put four marks in the history where they made
 * one.
 */
export function updateLastErase(patch) {
  const e = project.erases || [];
  if (!e.length) return;
  const last = e[e.length - 1].s;
  project.erases = e.map((d) => (d.s === last ? { ...d, ...patch } : d));
  emit();
}
export function clearErases() {
  project.erases = []; emit();
}
/** Bring a confirmed floor's erases back, and keep stroke ids unique after it. */
export function restoreErases(erases) {
  if (!project || !erases?.length) return;
  project.erases = erases.map((d) => ({ ...d }));
  emit();
}

/**
 * THE OTHER HALF OF WHAT A CONFIRMED FLOOR REMEMBERS.
 *
 * A confirm writes four things — labels, staircases, specs, erases — and
 * stepping back into Review restored two of them. The staircase's direction,
 * length and printed flag, and the beds/baths/sqft the reviewer typed and
 * signed off, were rebuilt from the extraction as though the floor had never
 * been looked at. So were the checklist ticks. Saman confirmed a floor, went
 * to Studio, came back, and was asked to do the whole review again.
 *
 * The checklist comes back ticked because it is not a preference: a floor that
 * carries a `verified` record IS one a human passed the gate on. Anything that
 * changes the drawing afterwards clears it again on its own — that is what
 * retracing and re-erasing already do.
 */
export function restoreConfirmed({ staircases, specs } = {}) {
  if (!project) return;
  if (staircases?.length) project.staircases = staircases.map((s) => ({ ...s }));
  if (specs) project.specs = { ...project.specs, ...specs };
  project.checklist = { spaces: true, stairs: true, dims: true, nothingAdded: true };
  emit();
}

// An equipment callout is an annotation, not an enclosed space. Every count
// that means "spaces" must go through this, or dropping a fridge marker onto
// the plan would raise the space count — the number four-point check #1 is
// about, and the number the verification report prints to the buyer.
export const isRoom = (l) => l?.kind !== 'equipment';
export const roomLabels = () => project.labels.filter(isRoom);

// Manual furniture objects were removed — furniture is delegated to the styling
// model (steered by room labels). The `objects` array stays as an empty field
// for backward-compat with saved projects; the palette code is in src/_archive
// for the future programmatic renderer.

// ---- staircases (flip direction, 1/2 flights, reposition) — each independently
export function updateStaircase(id, patch) {
  const st = project.staircases.find((s) => s.id === id);
  if (st) { Object.assign(st, clampXY(patch)); emit(); }
}
export function addStaircase(x, y) {
  // Placed BY HAND, so it prints. Putting a marker on the plan yourself is the
  // opt-in; see `printed` in normalizeStaircases for why a found one does not.
  const st = { id: `st${nextId++}`, kind: 'straight', printed: true,
               flights: 1, divider: false, direction: 'up',
               length: 'medium', heading: 'up',
               position: { x: onPlan(x), y: onPlan(y) } };
  project.staircases.push(st); emit();
  return st;
}
export function deleteStaircase(id) {
  project.staircases = project.staircases.filter((s) => s.id !== id); emit();
}

// ---- checklist + listing specs
export function confirmItem(key) { project.checklist[key] = true; emit(); }
export function unconfirmItem(key) { project.checklist[key] = false; emit(); }

// Auto-counted SUGGESTIONS only — never rendered directly (red line 5).
// "What counts as a bedroom" is an MLS/builder convention; the sum of nominal
// room areas is never the official total. The user must confirm.
export function suggestSpecs() {
  const beds = project.labels.filter((l) => /\bbed/i.test(l.name || '')).length;
  const baths = project.labels.filter((l) => /\bbath|ensuite|powder/i.test(l.name || '')).length;
  let sqft = 0;
  for (const l of project.labels) {
    const m = /(\d+)'(?:-(\d+)")?\s*[x×]\s*(\d+)'(?:-(\d+)")?/i.exec(l.dim || '');
    if (m) sqft += (Number(m[1]) + Number(m[2] || 0) / 12) * (Number(m[3]) + Number(m[4] || 0) / 12);
  }
  // sqft is NOT suggested. It is the only figure the product could compute
  // rather than transcribe, and it is the one figure that is regulated: in
  // Alberta the Residential Measurement Standard requires stated sizes within
  // 2%, and ANSI Z765 governs how US single-family area is measured. A sum of
  // room rectangles is neither — it leaves out walls, stairs and circulation,
  // so it systematically UNDER-states the home and would be wrong by far more
  // than 2%. Pre-filling it also anchors the reviewer: a number already in the
  // box gets confirmed. The sum is returned only as `roomSum`, shown as
  // context beside an empty field, never as the value.
  return { beds, baths, sqft: null, roomSum: Math.round(sqft) };
}
export function setSpecs(patch) { Object.assign(project.specs, patch); emit(); }
export function confirmSpecs(values) {
  Object.assign(project.specs, values, { confirmed: true }); emit();
}

export function allConfirmed() {
  return remainingToConfirm().length === 0;
}

/**
 * What is still standing between the reviewer and styling, in the order the
 * page lists it. The button used to sit there greyed out with no explanation,
 * so the one goal of the page was the one thing it would not tell you about.
 * @returns {string[]} human-readable names of the unconfirmed items
 */
/**
 * How many items the gate has. A passing geometry check is not something the
 * reviewer confirms, so it is not counted; a failing one is, so it is.
 */
/**
 * Every row the gate weighs, as [done, name].
 *
 * ONE list, so the total and the remainder can never disagree. The count used
 * to be the literal 4; adding a fifth check made the page announce "-1 of 4
 * confirmed", which reads as a rendering glitch rather than as a broken gate
 * and so would not have been reported as one.
 */
function gateRows() {
  const c = project.checklist;
  const g = project.geometry;
  const rows = [
    [c.spaces, 'spaces'],
    [c.stairs, 'staircases'],
    // A dimension that does not look like a room size cannot be confirmed.
    //
    // Showing it as a warning was not enough: the tick sat beside the warning
    // and nothing stopped the reviewer setting it. What this guards against is
    // not a visibly broken number but a plausible one — on a construction sheet
    // that prints no room sizes at all, the extraction lifted three figures off
    // the dimension chains. A lone measurement is not a room size, and on such
    // a sheet the honest answer is NO dimension, so it must be retyped from the
    // plan or cleared before this row can pass.
    [c.dims && suspectDims(project.labels).length === 0, 'dimensions'],
    // Answered against the X-Ray, which already lays the wireframe over the
    // customer's own plan. The view existed; nobody was asked the question, so
    // nobody looked for the one defect it is good at showing.
    [c.nothingAdded, 'nothing added'],
    [project.specs.confirmed, 'listing specs'],
  ];
  // A measured geometry failure is not advisory. It used to sit outside the gate
  // entirely: a wireframe of a DIFFERENT BUILDING reported "the overall shape is
  // wrong", and the page still said "all four checks confirmed" with the button
  // live. Passing geometry needs no acknowledgement; failing geometry needs an
  // explicit one, and it is recorded.
  // "the outline mismatch" named only one of the two checks this covers, so a
  // linework failure asked the user to fix an outline that was fine.
  //
  // ONLY WHEN THERE IS SOMETHING TO ACKNOWLEDGE. The row was always present and
  // always counted, so a floor whose geometry passed announced "0 of 6
  // confirmed" and then listed five things, and the sixth was one the reviewer
  // is never asked about. The paragraph above this list has said "a passing
  // geometry check is not something the reviewer confirms, so it is not counted"
  // since it was written; the code counted it anyway.
  if (g && !g.ok) rows.push([Boolean(g.acknowledged), 'the geometry check']);
  return rows;
}
export function gateItemCount() { return gateRows().length; }

export function remainingToConfirm() {
  return gateRows().filter(([done]) => !done).map(([, name]) => name);
}
/** Record what register() measured. Called once, after the images load. */
export function setGeometry({ ok, aspectDev, deviation }) {
  project.geometry = { ok, aspectDev, deviation, acknowledged: false, acknowledgedAt: null };
  emit();
}
/** The reviewer has seen the mismatch and chosen to go on anyway. */
export function acknowledgeGeometry() {
  if (!project.geometry) return;
  project.geometry.acknowledged = true;
  project.geometry.acknowledgedAt = new Date().toISOString();
  emit();
}
export function unacknowledgeGeometry() {
  if (!project.geometry) return;
  project.geometry.acknowledged = false;
  project.geometry.acknowledgedAt = null;
  emit();
}

export function confirmAndStyle(userName = 'you') {
  if (!allConfirmed()) throw new Error('checklist incomplete');
  project.confirmedAt = new Date().toISOString();
  project.confirmedBy = userName;
  emit();
  return project;
}
