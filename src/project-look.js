// WHICH LOOK A PROJECT IS IN, and whether its floors agree.
//
// One project is one home model, and its floors are shown together. A visitor
// stepping from the main floor to the basement and finding the plan has gone
// from light to dark reads it as a broken page, and the person who could fix it
// is not the one looking at it — so the all-floors embed refuses to hand over a
// mixed set at all.
//
// That refusal is right and it stays. What was wrong is WHEN it arrived: the
// builder learned about it on the 3D page, at the embed, after paying for
// renders in two looks. The decision that breaks the rule is made much earlier,
// one floor at a time, in Studio, with nothing on screen to suggest the other
// floors care.
//
// So the look becomes a fact about the PROJECT that Studio can show before the
// money is spent — DERIVED, never stored. A stored field would need a column,
// a migration and a rule for every project saved before it existed, and it
// could drift from the renders it claims to describe. Read off the artifacts,
// it is always exactly true.

import { scopeFor, hasArtifact, styledKind, getArtifactUrl } from './artifacts.js';

export const LOOKS = ['light', 'dark'];
export const lookName = (look) => (look === 'dark' ? 'Dark' : 'Light');

/**
 * What each floor of a project has been rendered in.
 *
 * @param {object} project
 * @param {(scope:string)=>Promise<'light'|'dark'|null>} readLegacyLook
 *   how to read the look of a render saved before the looks were separate
 *   kinds. Passed in because it needs to decode an image, which is the caller's
 *   business and not this module's.
 * @param {(projectId:string, floorId:string)=>Promise<string>} [stageOf]
 * @returns {Promise<Array<{id, name, stage, light, dark}>>}
 */
export async function surveyLooks(project, readLegacyLook, stageOf = null) {
  const out = [];
  for (const f of project?.floors || []) {
    const fScope = scopeFor(project.id, f.id);
    const row = {
      id: f.id,
      name: f.name || 'Floor',
      stage: stageOf ? await stageOf(project.id, f.id) : null,
      light: await hasArtifact(fScope, styledKind('light')),
      dark: await hasArtifact(fScope, styledKind('dark')),
    };
    // A floor rendered before the looks were separate kinds has neither, and
    // counting it as unrendered told its owner to render something they had
    // already paid for. Only measured where the label is missing.
    if (!row.light && !row.dark && await hasArtifact(fScope, 'styled')) {
      const look = await readLegacyLook(fScope);
      if (look) row[look] = true;
    }
    out.push(row);
  }
  return out;
}

/** A floor counts as rendered in a look if it holds a render in that look. */
const has = (row, look) => Boolean(row?.[look]);

/**
 * The project's own look, and whether its floors disagree.
 *
 * WITH THE FLOORS SPLIT, NOTHING IS CHOSEN. Picking the majority, or the first,
 * would put a confident sentence on screen over a state the builder has to
 * resolve either way — and the resolution costs a credit, so guessing at it is
 * not a kindness. `split` is true and both lists are named, which is the honest
 * shape of the thing.
 *
 * @returns {{look: 'light'|'dark'|null, split: boolean,
 *            rendered: object, unrendered: Array}}
 */
export function projectLook(survey) {
  const rows = survey || [];
  const rendered = {
    light: rows.filter((r) => has(r, 'light')),
    dark: rows.filter((r) => has(r, 'dark')),
  };
  const unrendered = rows.filter((r) => !has(r, 'light') && !has(r, 'dark'));
  const inUse = LOOKS.filter((l) => rendered[l].length > 0);
  // WHICH FLOORS A LOOK IS STILL SHORT OF, which is the question the embed
  // actually asks. `rendered` answers "who has this look" and that is not the
  // same thing: a floor rendered in BOTH is in both lists, so a sentence built
  // from them names the same floor twice and reads as a contradiction.
  const missing = Object.fromEntries(
    LOOKS.map((l) => [l, rows.filter((r) => !has(r, l))]),
  );
  return {
    look: inUse.length === 1 ? inUse[0] : null,
    split: inUse.length > 1,
    rendered,
    unrendered,
    missing,
    // A look that covers every floor is one an all-floors embed can be built
    // in. There can be two of them, and there is no reason to warn about a
    // project that has both.
    complete: LOOKS.filter((l) => rows.length > 0 && missing[l].length === 0),
  };
}

/**
 * One line for the builder, said before the credit is spent rather than after.
 *
 * `picked` is what the Light/Dark switch is on right now, which may not be what
 * the project is in — that is the whole case this exists for.
 *
 * @returns {{text: string, tone: 'ok'|'warn'|''}}
 */
export function lookNote(state, picked, floorCount) {
  if (floorCount < 2) return { text: '', tone: '' };
  const { look, split, rendered, unrendered, complete, missing } = state;

  if (split) {
    if (complete.length > 1) {
      return {
        text: 'Every floor is rendered in both looks, so the 3D embed on your '
          + 'website can show all of them, in either look.',
        tone: 'ok',
      };
    }
    if (complete.length) {
      const done = lookName(complete[0]);
      const alone = picked !== complete[0]
        ? ` Rendering this one ${lookName(picked)} would leave it out.` : '';
      return {
        text: `All your floors are ${done}, so the 3D embed on your website can `
          + `show all of them.${alone}`,
        tone: 'ok',
      };
    }
    // Nothing yet covers every floor. Name the look that is nearest and the
    // floors it still needs, so the line is a next step and not a diagnosis.
    const nearest = LOOKS.slice().sort((a, b) => missing[a].length - missing[b].length)[0];
    return {
      text: 'Your floors are in different looks, so the 3D embed on your website '
        + `can only show one floor at a time. Render ${names(missing[nearest])} in `
        + `${lookName(nearest)} and it can show all of them.`,
      tone: 'warn',
    };
  }

  if (!look) return { text: 'No floor has been rendered yet, so this sets the project’s look.', tone: '' };

  const rest = unrendered.length
    ? ` ${names(unrendered)} ${is(unrendered)} not rendered yet.` : '';
  if (picked === look) {
    return { text: `This project is ${lookName(look)}.${rest}`, tone: 'ok' };
  }
  return {
    text: `This project is ${lookName(look)}. Render this floor `
      + `${lookName(picked)} and it will not match ${names(rendered[look])}, `
      + 'so the 3D embed could only show one floor at a time.',
    tone: 'warn',
  };
}

const is = (list) => (list.length > 1 ? 'are' : 'is');
function names(list) {
  const n = (list || []).map((f) => f.name);
  if (n.length <= 1) return n[0] || '';
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
