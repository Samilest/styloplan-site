// House style — a builder's own labelling standard, stored on the brand kit and
// applied to every plan they process.
//
// Why this exists: a builder's punch list against a set of delivered plans is
// mostly the same three complaints repeated. "BEDROOM 1", "BEDROOM - 2" and
// "BEDROOM A" should all read BEDROOM. CLOSET and HALLWAY should not be
// labelled at all. Three separate SUITE labels should be one. Fixing that by
// hand on every plan is the labour the product exists to remove; fixing it once
// per customer is a setting.
//
// TWO HARD RULES LIVE HERE:
//
// 1. Nothing in this module derives a number from geometry (red line 2). The
//    verbatim transcription is never overwritten — `formatDim` returns a
//    DISPLAY string and the stored `dim` keeps whatever the plan said, so the
//    verification report can always show the source value and rounding can be
//    switched off with nothing lost.
//
// 2. Rules start EMPTY. A kit with no house style changes nothing, so a plan is
//    never silently reworded for a customer who never asked. Configuring the
//    rules is the act of consent; after that they apply automatically.

/** A kit with no house style behaves exactly as the product did before. */
export const EMPTY_HOUSE_STYLE = {
  // A rule is plain data: { any: ['MASTER BEDROOM', 'M BEDROOM'], to: 'M.BEDROOM' }.
  // `match` (a raw regex string) is still honoured for anything the plain form
  // cannot express, but nothing in the UI produces one — a builder should never
  // be asked to write a pattern.
  renames: [],
  hide: [],           // names that should carry no label at all
  merges: [],         // many labels collapse to one
  roundDimensions: false,
  separator: ' X ',   // between the two figures
};

/**
 * A starting point offered in the UI, NOT applied on its own. These are the
 * variants that recur across builders, not any one customer's list.
 */
export const SUGGESTED_HOUSE_STYLE = {
  renames: [
    { any: ['MASTER BEDROOM', 'M BEDROOM', 'M.BEDROOM', 'PRIMARY BEDROOM'], to: 'M.BEDROOM' },
    { any: ['BEDROOM', 'BED ROOM'], to: 'BEDROOM' },
    { any: ['BATH', 'BATHROOM', 'M BATH', 'M.BATH', 'POWDER', 'POWDER ROOM'], to: 'BATH' },
    { any: ['ENSUIT', 'ENSUITE'], to: 'ENSUITE' },
    { any: ['MECH', 'MECHANICAL', 'MECHANICAL ROOM', 'UTILITY'], to: 'MECH' },
    { any: ['W.I.C', 'W.I.C.', 'WIC'], to: 'W.I.C' },
    { any: ['MUD ROOM LAUNDRY', 'MUDROOM LAUNDRY'], to: 'MUD ROOM/LAUNDRY' },
  ],
  hide: ['CLOSET', 'CL.', 'CL', 'HALLWAY', 'HALL', 'ENTRY', 'FOYER'],
  merges: [
    { any: ['SUITE LIVING', 'SUITE LIVING ROOM', 'SUITE KITCHEN', 'SUITE DINING',
            'SUITE KITCHEN DINING'], to: 'SUITE' },
  ],
  roundDimensions: false,
  separator: ' X ',
};

const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A plain list of names becomes an anchored pattern that also tolerates the
 * trailing number or letter a plan uses to tell two of the same room apart:
 * "BEDROOM" covers BEDROOM 2, BEDROOM-B and BEDROOM A, but never BEDROOM SUITE.
 *
 * Anchoring this way also removes an ordering hazard the earlier regex form
 * had — MASTER BEDROOM cannot be swallowed by the BEDROOM rule, whichever
 * order the two are listed in.
 */
const fromAny = (names) =>
  `^(?:${names.filter(Boolean).map((n) => escapeRe(norm(n))).join('|')})(?:\\s*[-–]?\\s*[0-9A-Z]{1,2})?$`;

const compile = (rules) => (rules || []).map((r) => {
  const source = r.any?.length ? fromAny(r.any) : r.match;
  if (!source) return null;
  try { return { re: new RegExp(source, 'i'), to: r.to }; }
  // A malformed pattern must not take the page down; it simply matches nothing
  // until it is corrected.
  catch { return null; }
}).filter(Boolean);

/**
 * Canonical name for a label under a house style.
 * @returns {{name: string|null, changed: boolean, reason: string|null}}
 *   name === null means the style says this space carries no label.
 */
export function canonicalName(raw, style = EMPTY_HOUSE_STYLE) {
  const name = norm(raw);
  if (!name) return { name: raw ?? null, changed: false, reason: null };

  if ((style.hide || []).some((h) => norm(h) === name)) {
    return { name: null, changed: true, reason: 'hidden' };
  }
  // A rule that matches a name already in its canonical form is not a change,
  // and must not be reported as one — the count shown to the user is meant to
  // say how much the style actually rewrote.
  for (const r of compile(style.merges)) {
    if (r.re.test(name)) {
      const changed = r.to !== name;
      return { name: r.to, changed, reason: changed ? 'merged' : null };
    }
  }
  for (const r of compile(style.renames)) {
    if (r.re.test(name)) {
      const changed = r.to !== name;
      return { name: r.to, changed, reason: changed ? 'renamed' : null };
    }
  }
  return { name: raw, changed: false, reason: null };
}

// --- dimensions

const FEET_INCHES = /(\d+)\s*'\s*(?:[-\s]\s*(\d+(?:\s+\d+\/\d+)?)\s*")?/g;

/** Inches → the nearest whole foot, ties up. Never used unless a kit asks. */
function roundFeet(feet, inches) {
  return inches >= 6 ? feet + 1 : feet;
}

/**
 * A transcribed dimension string as a pair of decimal feet.
 *
 * Lives here, beside `formatDim`, so there is ONE definition of what a
 * dimension string looks like. A second regex somewhere else would drift, and
 * the two would disagree about an edge case on a number a customer signed off.
 *
 * This is a READING of the transcription, never a replacement for it. The
 * string stays the record (red line 2); these numbers exist so geometry can be
 * fitted to it, and nothing produced from them is ever shown as a dimension.
 *
 * @param {string} dim e.g. `14'-8" X 12'-5"`, `10' X 8'`, `9'-6 1/2" x 7'`
 * @returns {[number, number]|null} null when the string is not a foot-inch pair
 */
export function dimToFeet(dim) {
  if (!dim) return null;
  const straight = String(dim).replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"');
  const parts = [...straight.matchAll(FEET_INCHES)];
  if (parts.length !== 2) return null;
  const value = (m) => {
    const feet = Number(m[1]);
    if (!Number.isFinite(feet)) return null;
    const text = m[2];
    if (!text) return feet;
    // `6 1/2` — the inch field may carry a fraction, which formatDim preserves
    // verbatim, so parsing has to understand it rather than truncate it.
    const [whole, frac] = String(text).trim().split(/\s+/);
    let inches = Number(whole);
    if (frac) {
      const [n, d] = frac.split('/').map(Number);
      if (d) inches += n / d;
    }
    return Number.isFinite(inches) ? feet + inches / 12 : null;
  };
  const a = value(parts[0]), b = value(parts[1]);
  return a === null || b === null ? null : [a, b];
}

/**
 * Display form of a transcribed dimension string.
 *
 * Normalisation (always): curly marks become straight, the separator between
 * the two figures becomes the kit's, spacing is regularised. The NUMBERS are
 * untouched — this is the same value, typeset consistently.
 *
 * Rounding (only when the kit asks): 12'-8" reads 13'. Off by default, and the
 * caller keeps the original string regardless.
 *
 * @returns {string} display text; the input is returned unchanged if it cannot
 *   be parsed, because a string we do not understand is not a string we edit.
 */
export function formatDim(dim, style = EMPTY_HOUSE_STYLE) {
  if (!dim) return dim;
  // Curly marks in, straight marks out. Prompt 1 forbids them, but a hand
  // correction typed in Review can still introduce them.
  const straight = String(dim).replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"');
  const sep = style.separator || ' X ';

  const parts = [...straight.matchAll(FEET_INCHES)];
  if (parts.length !== 2) {
    // Not a foot-inch pair (an area like "90 SQ FT", or something unparsed).
    // Normalise the separator only if one is unambiguously present.
    return straight.replace(/\s*[xX×]\s*/, sep);
  }

  const figures = parts.map((m) => {
    const feet = Number(m[1]);
    const inchText = m[2] || '';
    const inches = inchText ? Number(String(inchText).split(' ')[0]) : 0;
    if (style.roundDimensions) return `${roundFeet(feet, inches)}'`;
    return inchText ? `${feet}'-${inchText}"` : `${feet}'`;
  });
  return figures.join(sep);
}

/**
 * Apply a house style across a label set.
 * Names are rewritten; `dim` is left alone and `dimDisplay` is added beside it,
 * so the transcription of record survives (red line 2) and the change is
 * reversible by clearing the style.
 *
 * A hidden label is FLAGGED, never removed. "Do not label the closets" is a
 * statement about the printed image, not about how many rooms the home has —
 * dropping the entry would quietly lower the space count that four-point check
 * #1 and the spec strip depend on. The compositor skips `hidden`; every count
 * still sees it.
 * @returns {{labels: Array, renamed: number, hidden: number, merged: number}}
 */
export function applyHouseStyle(labels, style = EMPTY_HOUSE_STYLE) {
  let renamed = 0, hidden = 0, merged = 0;
  const out = [];
  for (const l of labels) {
    const c = canonicalName(l.name, style);
    // Only a rule can hide. A space that never had a name is an unlabeled space
    // — the extraction's own finding, not something the style did — and
    // counting it here reported "2 unlabelled" on a kit with no rules at all.
    if (c.reason === 'hidden') {
      hidden++;
      out.push({ ...l, hidden: true, sourceName: l.sourceName ?? l.name,
                 dimDisplay: formatDim(l.dim, style) });
      continue;
    }
    if (c.changed) (c.reason === 'merged' ? merged++ : renamed++);
    out.push({
      ...l,
      hidden: false,
      name: c.name,
      // Keep what the plan actually said, so a rename is always traceable and
      // undoable, and the verification report can show the source wording.
      sourceName: l.sourceName ?? l.name,
      dimDisplay: formatDim(l.dim, style),
    });
  }
  return { labels: out, renamed, hidden, merged };
}

/**
 * Collapse labels that a merge rule sent to the same name down to ONE, placed
 * at the centroid of the group. A suite's living, kitchen and dining zone is
 * one open area with three labels on it; the style asks for a single SUITE.
 * Equipment callouts are never merged.
 */
export function collapseMerges(labels, style = EMPTY_HOUSE_STYLE) {
  const targets = new Set((style.merges || []).map((m) => m.to));
  if (!targets.size) return { labels, collapsed: 0 };
  const groups = new Map();
  const out = [];
  for (const l of labels) {
    if (l.kind === 'equipment' || l.hidden || !targets.has(l.name)) { out.push(l); continue; }
    if (!groups.has(l.name)) groups.set(l.name, []);
    groups.get(l.name).push(l);
  }
  let collapsed = 0;
  for (const [name, group] of groups) {
    collapsed += group.length - 1;
    // Each label came from one extracted enclosed space, so the ones that lose
    // their label are hidden, not deleted — otherwise a suite would shrink the
    // home's space count by two every time it was tidied up.
    // They carry their own original wording again, so Review can show the user
    // which spaces were absorbed rather than three identical greyed "SUITE"s.
    for (const extra of group.slice(1)) {
      out.push({ ...extra, hidden: true, name: extra.sourceName ?? extra.name });
    }
    out.push({
      ...group[0],
      hidden: false,
      name,
      x: group.reduce((s, l) => s + l.x, 0) / group.length,
      y: group.reduce((s, l) => s + l.y, 0) / group.length,
      // The merged zone's dimensions are NOT the sum or the bounding box of the
      // parts — that would be a calculated number. It is left empty for the
      // user to transcribe from the plan.
      dim: null,
      dimDisplay: null,
      mergedFrom: group.map((l) => l.sourceName ?? l.name),
    });
  }
  return { labels: out, collapsed };
}
