// The room guide the model can no longer read off the drawing.
//
// The styling prompt says room labels in the wireframe are a FUNCTION GUIDE:
// read them to know what each space is, and never draw them. That was true
// when it was written. It is not true now — every run of text is painted white
// before the image is sent, because the model kept copying the names into the
// render and six paid attempts were refused for it.
//
// So the model has been furnishing blind. It sees a large open rectangle at the
// bottom right of a house plan, which on most plans is a garage, and it drew
// two cars in Saman's master bedroom. The count we sent was `none` and the
// prompt says in as many words to draw no cars anywhere when it is — the
// instruction was there and the information was not.
//
// This is the same answer this project reached for the text itself: an
// instruction the model has ignored is not made truer by repeating it. Take
// away what it is guessing from. The guide moves out of the picture and into
// the prompt, where it costs nothing to send and cannot be copied into the
// image.
//
// FACTS, NOT JUDGEMENT. The prompt currently asks the model to "FIRST decide
// whether this plan HAS a garage". We know the answer — the owner confirmed
// every space on this floor by name — so it is stated rather than asked for.

import { isGarage } from './garage.js';

/** A space the guide should name: it has a name, hidden or not. */
const named = (l) => Boolean(l?.name && String(l.name).trim());

/**
 * Every space on this floor, in the words the owner confirmed.
 *
 * IN THE DRAWING'S OWN ORDER, not sorted: a reader following the list against
 * the plan is helped by it running the way the extraction found them, and
 * sorting would only invent an order nobody chose.
 *
 * A HIDDEN LABEL IS STILL A ROOM. The house style hides some names from the
 * printed image — a closet, a hallway — but the space is there and the model
 * has to know what it is in order to furnish it. Hiding is a decision about
 * the caption, never about the building.
 *
 * @param {Array} labels confirmed labels
 * @returns {string} for the prompt's {{ROOMS}} placeholder
 */
export function roomsVar(labels) {
  const names = [];
  const seen = new Set();
  for (const l of labels || []) {
    if (!named(l)) continue;
    const name = String(l.name).trim().toUpperCase();
    // Repeats are real — a plan has two closets — but the guide is a list of
    // what KINDS of space are here, and naming CLOSET twice adds nothing.
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (!names.length) return '';
  const garage = (labels || []).some(isGarage);
  return names.join(', ')
    + (garage ? '.' : '. There is no garage on this floor.');
}
