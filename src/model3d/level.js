// Which side of the ground a floor is on.
//
// A basement window sits high in its wall because the wall below it is earth,
// so the market's small light with a sill at half the section is right for it.
// Above grade there is no earth, and Saman's rule (2026-09-12) is a bigger
// light: the sill drops to a quarter of the section, the pane half again as
// tall. See `marketSill` in geometry.js for the numbers; this file decides
// only the question they turn on.
//
// THE REVIEWER'S ANSWER COMES FIRST. Review asks "Floor level: above or below
// ground" beside the listing specs and stores it in the confirmed record
// (`verified.specs.below`), which is where every other fact a human signed off
// lives, and which syncs and publishes with the floor. Saman's question that
// made it exist: a customer who types "Floor 2" for a basement, instead of
// tapping "Basement", would otherwise get a main floor's windows.
//
// THE WORDS ARE THE FALLBACK, for floors confirmed before the question was
// asked and for the demo fixtures. Nothing in the drawing says which side of
// the ground it is on; the only words we have are the customer's own: the
// floor's name typed at upload, the plan title typed in Studio, and the room
// names they confirmed in Review. A whole-word match on any of them is the
// decision. No match means above grade, which is what most floors are and
// what a wrongly guessed basement would have cost the most on: a main floor
// with letterbox windows is the picture a buyer sees first.

/**
 * Words that name a below-grade floor, as the customer would type them.
 * "Lower Level" is a basement in every builder set seen; "Lower Floor" is not
 * here because townhome and two-storey sets use it for the ground floor, and a
 * ground floor with basement windows is the wrong way to be wrong.
 */
const FLOOR_WORDS = /\b(basement|bsmt|cellar|lower\s*level|walk-?out|garden\s*level|terrace\s*level|below\s*grade)\b/i;

/**
 * Room names that occur ONLY below grade, matched whole. Not the loose list
 * above: "DN TO BASEMENT" beside a main-floor stair and "UNFINISHED" over a
 * garage are both real labels on floors that are not basements.
 */
const ROOM_WORDS = /^\s*((un)?finished\s+)?(basement|cellar)\s*$|^\s*unexcavated\s*$|^\s*crawl\s*space\s*$/i;

/**
 * True when the floor is below grade.
 * @param {{confirmed?: boolean|null, names?: Array<string|null|undefined>,
 *          labels?: Array<{name?: string}>}} floor
 *   `confirmed`: the reviewer's answer, when there is one -- a boolean decides
 *   on its own; null or undefined means the question was never asked;
 *   `names`: the floor's name and plan title, in any order, any of them blank;
 *   `labels`: the confirmed labels, read by their `name`.
 */
export function belowGrade({ confirmed = null, names = [], labels = [] } = {}) {
  if (typeof confirmed === 'boolean') return confirmed;
  if (names.some((s) => typeof s === 'string' && FLOOR_WORDS.test(s))) return true;
  return labels.some((l) => typeof l?.name === 'string' && ROOM_WORDS.test(l.name));
}
