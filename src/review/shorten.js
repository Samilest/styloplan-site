// Shorter forms for long room names, offered as a SUGGESTION in the Review
// Station and never applied automatically.
//
// Why it is only a suggestion: the composed image is what a builder hands to a
// buyer, and room names are referenced in listings and purchase agreements.
// Renaming a customer's room silently would contradict the product's whole
// position — "verified" means the user reviewed and confirmed it (red line 7).
//
// Why these forms and not initials: architectural plans shorten a name by
// dropping the generic noun and keeping the distinguishing word (MASTER
// BEDROOM -> MASTER), not by reducing words to letters. "M BEDROOM" is not a
// convention anyone reads fluently. Conventions here are North American
// residential.

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

// Explicit forms win over the generic rule below.
const MAP = new Map(Object.entries({
  'MASTER BEDROOM': 'MASTER',
  'MASTER BEDROOM SUITE': 'MASTER',
  'MASTER SUITE': 'MASTER',
  'PRIMARY BEDROOM': 'PRIMARY',
  'PRIMARY SUITE': 'PRIMARY',
  'MASTER ENSUITE': 'ENSUITE',
  'ENSUITE BATHROOM': 'ENSUITE',
  'WALK-IN CLOSET': 'W.I.C.',
  'WALK IN CLOSET': 'W.I.C.',
  'WALK-IN PANTRY': 'PANTRY',
  'MECHANICAL ROOM': 'MECH',
  'MECHANICAL': 'MECH',
  'RECREATION ROOM': 'REC ROOM',
  'BREAKFAST NOOK': 'NOOK',
  'ATTACHED GARAGE': 'GARAGE',
  'DOUBLE GARAGE': 'GARAGE',
  'DOUBLE CAR GARAGE': 'GARAGE',
  'BATHROOM': 'BATH',
  'POWDER ROOM': 'POWDER',
}));

// Names that are already the conventional plan form — shortening them further
// reads as a typo ("GREAT" alone is not a room).
const KEEP = new Set(['GREAT ROOM', 'MUD ROOM', 'MUDROOM', 'DEN', 'NOOK', 'FOYER', 'PANTRY']);

// Generic nouns that carry no information once a qualifier is present.
const GENERIC_TAIL = ['ROOM', 'BEDROOM', 'BATHROOM'];

const MIN_LENGTH = 10;   // shorter names are not worth touching
const MIN_SAVING = 3;    // a suggestion has to actually buy space

/**
 * A conventional shorter form for a room name, or null when the name should be
 * left alone. Never mutates; the caller decides whether to offer it.
 * @param {string} name
 * @returns {string|null}
 */
export function suggestShortName(name) {
  const n = norm(name);
  if (!n || KEEP.has(n)) return null;

  const mapped = MAP.get(n);
  if (mapped) return mapped === n ? null : mapped;

  if (n.length < MIN_LENGTH) return null;

  // Generic rule: "<qualifier...> ROOM" -> "<qualifier...>", as long as what
  // remains still names something. A trailing number ("BEDROOM 2") is a
  // qualifier, not a name, so those are left alone.
  for (const tail of GENERIC_TAIL) {
    if (!n.endsWith(` ${tail}`)) continue;
    const head = n.slice(0, -(tail.length + 1)).trim();
    if (head.length < 3 || /^\d+$/.test(head)) return null;
    if (KEEP.has(`${head} ${tail}`)) return null;
    return n.length - head.length >= MIN_SAVING ? head : null;
  }
  return null;
}
