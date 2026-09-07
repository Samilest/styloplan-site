// Was this dimension written UNDER ITS ROOM'S NAME on the customer's plan?
//
// WHY THIS EXISTS, and why dim-shape.js was not enough. Plan A prints no size
// under KITCHEN or BEDROOM 2. The extraction returned "18' x 10"" and
// "13' x 10"" for them anyway, lifted off the dimension chain that runs across
// the top of the sheet — the row reading 10'-0" | 21'-0" | 10'-0" carries those
// two strings a few inches above those rooms.
//
// Every guard we had let it through, and each for its own reason:
//
//   * The cross-check compares the extraction against a read-back of the
//     wireframe. The wireframe had made the SAME promotion, so the two agreed,
//     and agreement was reported as confirmation.
//   * dim-shape.js asks whether a string is SHAPED like a room size. "18' x 10""
//     is a pair. It is the right shape and the wrong number.
//
// So this asks the one question neither of them can: on the customer's own
// sheet, is there a line of text directly beneath this room's name? That is
// what a nominal size IS — PROMPT_EXTRACT says so in the same words — and a
// figure that has no such line behind it came from somewhere else.
//
// IT DECIDES NOTHING ABOUT TRUTH. Red line 2 says numbers come from the plan
// and from the user, never from us. This does not delete, correct or estimate
// anything; it says "this one did not come from under the room name" and puts
// it in front of the reviewer, who has the plan.
//
// UNKNOWN IS NOT WRONG. No registration, no text found where the room should
// be, nothing to compare — all return silence rather than a warning. A guard
// that fires when it cannot see is a guard people learn to dismiss.

/**
 * Does a run of text sit directly below another, close enough to be its second
 * line?
 *
 * The two tests are separate because they fail separately: a size is centred
 * under the name so it OVERLAPS horizontally, and it is the next line down so
 * the gap is about one line. A chain segment fails the second even when it
 * happens to pass the first.
 */
function isSecondLine(name, below, opts = {}) {
  const gapLines = opts.gapLines ?? 1.9;
  if (below.y <= name.y) return false;                       // not below at all
  const gap = (below.y - below.h / 2) - (name.y + name.h / 2);
  if (gap > name.h * gapLines) return false;                 // too far down
  const overlap = Math.min(name.x + name.w / 2, below.x + below.w / 2)
    - Math.max(name.x - name.w / 2, below.x - below.w / 2);
  return overlap > 0;
}

/** Every run whose centre is within `within` of a point. */
function runsNear(runs, at, within) {
  return runs.filter((r) => Math.hypot(r.x - at.x, r.y - at.y) <= within);
}

/**
 * Do any two of these runs read as a name with its size beneath it?
 *
 * ASKED OF THE GROUP, NOT OF THE NEAREST ONE. The first version took the run
 * closest to the anchor, called it the name, and looked for a line under it.
 * Measured on Geena, whose sheet prints a size under every room: MASTER BDRM
 * and BEDROOM 2 came back flagged, because the anchor sits between the two
 * lines and the nearest run was the SIZE — so the search was for a third line
 * that was never going to be there. Which line is nearest is an accident of
 * where the anchor landed; whether a pair EXISTS is the actual question.
 */
function hasStackedPair(near, all, opts) {
  // The FIRST line has to be near the room; the second only has to be under the
  // first. Requiring both to be near the anchor lost Geena's DECK, whose size
  // sits 0.079 from the anchor against a 0.06 radius — the pair was there and
  // the search was looking through too small a window.
  for (const a of near) {
    for (const b of all) {
      if (a !== b && isSecondLine(a, b, opts)) return true;
    }
  }
  return false;
}

/**
 * Or one run that is TALL ENOUGH TO BE TWO LINES.
 *
 * The detector groups glyphs into runs and sometimes takes a name and the size
 * beneath it as a single run — measured on Geena's sheet, MASTER BDRM comes
 * back as one run of nine glyphs standing 2.11% of the sheet high, where a
 * single line of that plan runs 0.8 to 1.3%. Asking only for two runs called
 * that plan's best-labelled rooms unlabelled.
 *
 * COMPARED AGAINST THE SHEET'S OWN MEDIAN, never against a fixed height. Line
 * weight and lettering size are properties of the drawing, and this file has
 * been burned before by constants tuned to one sample: `medianWallThickness`
 * read 3 on the plan whose walls are 5. A ratio survives a plan drawn at
 * another scale; a number does not.
 */
function looksLikeTwoLines(near, median, opts = {}) {
  const ratio = opts.twoLineRatio ?? 1.5;
  return near.some((r) => r.h >= median * ratio);
}

const medianOf = (xs) => (xs.length
  ? xs.slice().sort((a, b) => a - b)[xs.length >> 1]
  : 0);

/**
 * Which labels carry a dimension that is not written under their name.
 *
 * @param {Array} labels  {id, name, dim, ink|x,y} in WIREFRAME coordinates
 * @param {Array} runs    text runs measured on the SOURCE, normalised
 *                        {x, y, w, h} with x/y at the centre
 * @param {Object|null} transform  reg.transform — wireframe → source
 * @param {Object} [opts] { within } how far from the mapped point to look
 * @returns {Array} [{ id, name, dim, reason }]
 */
export function dimsNotUnderName(labels, runs, transform, opts = {}) {
  if (!transform || !runs?.length) return [];                // cannot see: say nothing
  const within = opts.within ?? 0.06;
  const median = medianOf(runs.map((r) => r.h));
  const out = [];
  for (const l of labels || []) {
    if (!l?.dim) continue;
    const at = l.ink || { x: l.x, y: l.y };
    if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) continue;
    const p = {
      x: transform.dx + at.x * transform.sx,
      y: transform.dy + at.y * transform.sy,
    };
    const near = runsNear(runs, p, within);
    // No text at all where the room should be. That is a registration or a
    // legibility problem, not evidence about the dimension.
    if (!near.length) continue;
    if (hasStackedPair(near, runs, opts)) continue;
    if (looksLikeTwoLines(near, median, opts)) continue;
    out.push({
      id: l.id,
      name: l.name,
      dim: l.dim,
      reason: 'Your plan prints no size under this room name, '
        + 'so this figure came from a dimension line elsewhere on the sheet.',
    });
  }
  return out;
}
