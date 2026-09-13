// Is this label a ROOM, or a builder's note the extraction mistook for one?
//
// Why this exists. On a real sheet the extraction returned 34 spaces, and one
// of them was `SPACE FOR GUN SAFE` — a leader note pointing at a corner of the
// garage. Prompt 1 stripped it from the wireframe correctly, so the two passes
// looked at the same drawing and disagreed; the redraw knew it was a note and
// the reading did not.
//
// Left alone it costs twice. The space count is inflated, which is the number
// the reviewer is asked to confirm against their own plan. And the string is a
// label, so it would be typeset onto the finished marketing image — a sentence
// addressed to a builder, printed on something shown to a buyer.
//
// What this does NOT do is delete anything. Names come from the plan and are
// the user's to keep or drop (red line 2), so this only asks the question. It
// also cannot know whether a name is TRUE; it judges the SHAPE of the string,
// which is a question about the string alone.
//
// Deliberately conservative. A room name wrongly flagged costs one glance; a
// note that slips through gets printed. But over-flagging trains people to
// dismiss the whole checklist, so every pattern below was written against a
// string actually seen on a plan, and the real room names collected alongside
// them are in the test as the thing that must NOT fire.

// Instructions to a builder. These are verbs and directives that appear in
// notes and never in the name of a room.
const DIRECTIVE = /\b(ensure|verify|provide|install|slope|confirm|see |refer|typ\.?|r\.?o\.?|min\.?|max\.?|field)\b/i;

// "SPACE FOR GUN SAFE", "SPACE FOR FUTURE …" — the giveaway opening.
const SPACE_FOR = /^\s*(space|area|room)\s+for\b/i;

// A note usually points somewhere: at a thing, or at another storey.
const POINTS_AT = /\b(access|above|below|beyond|behind|pass-?through)\b/i;

// A note relates one thing to another — "CONCRETE RECESSED AT DOOR OPENING",
// "ENSURE FROST WALL BETWEEN GARAGE AND LIVING QUARTERS". Room names name one
// thing and stop, so a connecting preposition is a strong signal. The list is
// short on purpose: "under" and "over" were left out because UNDER STAIR
// STORAGE is a real space, and every word here was checked against the room
// names collected in the test.
const RELATES = /\b(at|between|w\/|per)\b/i;

// …except these, which are real labels that happen to contain such a word. A
// double-height void really is called OPEN TO BELOW, and the wireframe prompt
// has a rule for drawing it.
const REAL_DESPITE = /^(open to (below|above)|attic|crawl ?space|storage above)$/i;

// Equipment call-outs like "STACKED WASHER / DRYER" are notes about appliances,
// not rooms — but the product HAS an equipment label kind, so they are handled
// there and are not this module's business.

const words = (s) => s.trim().split(/\s+/).filter(Boolean);

/**
 * @param {string|null} name
 * @returns {{ok:boolean, kind:string, reason:string}}
 *   kind: 'none' | 'room' | 'directive' | 'space-for' | 'pointer' | 'sentence'
 *   ok=false means ASK THE USER — never means "discard".
 */
export function classifyName(name) {
  if (name == null || String(name).trim() === '') {
    // An unlabelled space is normal and is already handled elsewhere.
    return { ok: true, kind: 'none', reason: '' };
  }
  const s = String(name).trim();

  if (REAL_DESPITE.test(s)) return { ok: true, kind: 'room', reason: '' };

  if (SPACE_FOR.test(s)) {
    return {
      ok: false,
      kind: 'space-for',
      reason: 'This reads as a note about what goes in a spot, not the name of a room.',
    };
  }
  if (DIRECTIVE.test(s)) {
    return {
      ok: false,
      kind: 'directive',
      reason: 'This reads as an instruction to a builder, not a room name.',
    };
  }
  if (POINTS_AT.test(s) || RELATES.test(s)) {
    return {
      ok: false,
      kind: 'pointer',
      reason: 'This points at something rather than naming a room.',
    };
  }
  // Length is the weakest signal, so it is last and set well clear of the
  // longest real name collected: "BEDROOM 5 / GAME ROOM" is five words.
  if (words(s).length > 5) {
    return {
      ok: false,
      kind: 'sentence',
      reason: `${words(s).length} words. Room names are short; notes are sentences.`,
    };
  }
  return { ok: true, kind: 'room', reason: '' };
}

/**
 * Every label whose NAME does not look like a room.
 * @param {Array} labels  {id, name}
 * @returns {Array} [{ id, name, kind, reason }]
 */
export function suspectNames(labels) {
  return (labels || []).flatMap((l) => {
    // Equipment is a different kind of label with its own rules.
    if (l.kind === 'equipment') return [];
    const v = classifyName(l.name);
    return v.ok ? [] : [{ id: l.id, name: l.name, kind: v.kind, reason: v.reason }];
  });
}
