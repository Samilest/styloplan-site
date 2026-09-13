// Is this dimension string SHAPED like a room's nominal size?
//
// Why this exists. On a construction sheet that prints no room sizes at all,
// the extraction still returned dimensions — harvested from the dimension
// chains and the door schedule that surround every room:
//
//   BEDROOM-2    "12'-8\""                  ← a chain segment below the room
//   LIVING ROOM  "23'-4\""                  ← a chain segment
//   CLOSET       "2'-6\"x6'8\"x2'-6\"x6'8\"" ← two DOOR sizes, concatenated
//
// The correct answer for every one of those was null. PROMPT_EXTRACT already
// says so ("If a room has no dimension text, use null — do not estimate one")
// and it was violated at both resolutions tested, so this is not something a
// reread or a better image fixes.
//
// What this module does NOT do is decide whether a number is TRUE — nothing
// here can know that, and red line 2 says numbers come from the plan and the
// user, never from us. It decides whether a string has the SHAPE of a room's
// nominal size, which is a question about the string alone. Every observed
// failure above is malformed; a room's nominal size is a PAIR.
//
// The gap this closes is specific. The cross-check already catches the case
// where the two readings disagree. It cannot catch the case where BOTH
// readings picked up the same stray number — that reports as "confirmed by two
// independent readings", which is a false assurance and exactly the kind of
// outcome claim red line 7 exists to prevent.

/** A part is a measurement if it carries a digit. Deliberately loose: the
 *  question here is structure, not notation — plans use ', ", mm, m and cm. */
const hasNumber = (s) => /\d/.test(s);

// An area callout is a legitimate single value: "202.00 SQ.FT. [18.77m²]" is
// printed under COVERED DECK on the sheet, and is not a pair.
const AREA = /(sq\.?\s*ft|sq\.?\s*m|ft²|m²|sqft|sqm)/i;

/**
 * @param {string|null} dim
 * @returns {{ok:boolean, kind:string, reason:string}}
 *   kind: 'none' | 'pair' | 'area' | 'single' | 'multi' | 'empty'
 *   ok=false means SHOW THE USER — never means "discard".
 */
export function classifyDim(dim) {
  if (dim == null) return { ok: true, kind: 'none', reason: '' };
  const s = String(dim).trim();
  if (!s) return { ok: false, kind: 'empty', reason: 'The dimension is blank.' };

  if (AREA.test(s)) return { ok: true, kind: 'area', reason: '' };

  // × and X are the same separator as x. Split on it and count real parts.
  const parts = s.split(/\s*[x×X]\s*/).filter((p) => p.trim() !== '');
  const measured = parts.filter(hasNumber);

  if (measured.length === 2) return { ok: true, kind: 'pair', reason: '' };

  if (measured.length === 1) {
    return {
      ok: false,
      kind: 'single',
      reason: 'A room size is a pair, like 13\'-0" x 11\'-6". '
        + 'A single figure usually comes from a dimension line.',
    };
  }
  if (measured.length > 2) {
    return {
      ok: false,
      kind: 'multi',
      reason: `${measured.length} measurements where a room size has two. `
        + 'Door and window schedules look like this.',
    };
  }
  return { ok: false, kind: 'empty', reason: 'No measurement found in this dimension.' };
}

/**
 * Every label whose dimension does not look like a room size.
 * @param {Array} labels  {id, name, dim}
 * @returns {Array} [{ id, name, dim, kind, reason }]
 */
export function suspectDims(labels) {
  return (labels || []).flatMap((l) => {
    const v = classifyDim(l.dim);
    return v.ok ? [] : [{ id: l.id, name: l.name, dim: l.dim, kind: v.kind, reason: v.reason }];
  });
}
