// Trace the plan again, keeping what the reviewer already fixed.
//
// WHY THIS IS THE ANSWER TO "SOMETHING IS MISSING".
//
// The eraser handles the common defect, which is always an ADDITION — a closet
// in a bedroom that has none, a wall stub read off a dimension bracket. It
// cannot help when the tracing DROPPED something, and asking the customer to
// draw the missing wall would make this an editor. They came here to brand a
// plan.
//
// So the answer is another roll. The tracing is not deterministic — the same
// plan through the same prompt measured wall thickness at 10px, then 7px, then
// 3px across three runs, with labels appearing and disappearing between them.
// A second attempt is a genuinely different drawing, not a retry of the same
// computation.
//
// FREE, because the defect is ours. A customer who is charged to fix our
// mistake learns to distrust the meter. The cap exists so "free" cannot mean
// unbounded, and is stated rather than silently enforced.
//
// The EXTRACTION IS NOT RE-RUN. Labels, dimensions, staircases and any
// corrections already made are the reviewer's work and survive: only the
// drawing is traced again. That also halves the cost of a retry.

import { postAI } from '../api.js';
import { nearestAspect, padToAspect } from '../aspect.js';

/** How many free attempts a floor gets, counting the first. */
export const MAX_ATTEMPTS = 3;

const loadImage = (src) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(new Error('image failed to load'));
  i.src = src;
});

/**
 * Re-run Prompt 1 on the same source.
 *
 * The source is framed exactly as the first pass framed it — nearest permitted
 * aspect, padded to it — because a differently framed input is a different
 * question, and the point of a second attempt is to vary only the model's own
 * roll.
 *
 * @param {Blob|File} sourceBlob  the customer's original, from the artifact store
 * @returns {{url:string, blob:Blob}}
 */
export async function retrace(sourceBlob) {
  const dataUrl = await new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.readAsDataURL(sourceBlob);
  });
  const img = await loadImage(dataUrl);
  const aspectRatio = nearestAspect(img.naturalWidth, img.naturalHeight);
  const framedUrl = aspectRatio ? padToAspect(img, aspectRatio).toDataURL('image/png') : dataUrl;
  const [, mimeType] = /^data:([^;]+);/.exec(framedUrl) || [, 'image/png'];

  const j = await postAI('/api/wireframe', JSON.stringify({
    imageBase64: framedUrl.split(',')[1],
    mimeType,
    aspectRatio,
  }));
  const b64 = j.imageBase64 || j.image || j.dataUrl;
  if (!b64) throw new Error('the tracing returned no image');
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: j.mimeType || 'image/png' });
  return { blob, url: URL.createObjectURL(blob) };
}

/**
 * The attempts a floor has, newest last.
 *
 * Kept rather than replaced, because a second attempt fixes one defect and may
 * introduce another — the customer has to be able to go back. Choosing between
 * two drawings is confirming; redrawing one is editing, and that is the line
 * this whole feature exists to stay on the right side of.
 */
export function addAttempt(list, attempt) {
  return [...list, attempt].slice(-MAX_ATTEMPTS);
}

/**
 * Score one attempt against what the SOURCE actually shows.
 *
 * The judge is not a pixel measurement — five of those were built and measured
 * out, all failing because nothing in a raster separates architecture from
 * annotation. It is the same narrow question put to both images: *which rooms
 * have a closet, and does the drawing SHOW it?* Reading is what these models
 * are good at; producing geometry is what they are bad at.
 *
 * OMISSIONS COST MORE THAN INVENTIONS, and that asymmetry is the point. An
 * invented closet is visible — the reviewer sees it and the eraser removes it
 * in a second. A missing one is invisible: nothing draws the eye to a space
 * where nothing was drawn, and every other check still passes. So a drawing
 * that quietly drops four real closets is a worse answer than one that adds a
 * spurious one, and the score has to say so.
 *
 * Measured on the case that prompted this: the same plan through the same
 * prompt returned five closets on one run and one on the next.
 *
 * @param {{room?:string}[]} source   enclosures listed from the customer's plan
 * @param {{room?:string}[]} attempt  the same question put to this tracing
 */
export function scoreAttempt(source, attempt, opts = {}) {
  const MISSING = opts.missingCost ?? 3;
  const INVENTED = opts.inventedCost ?? 1;
  const key = (e) => String(e?.room ?? '').trim().toLowerCase();

  // Multiset match by room: two closets off one bedroom are two matches.
  const pool = attempt.map(key);
  let matched = 0;
  for (const s of source.map(key)) {
    const i = pool.indexOf(s);
    if (i >= 0) { pool.splice(i, 1); matched++; }
  }
  const missing = source.length - matched;
  const invented = attempt.length - matched;
  return {
    matched, missing, invented,
    score: matched - missing * MISSING - invented * INVENTED,
  };
}

/**
 * Which attempt to recommend, and why — never which to impose.
 *
 * Returns the index and a sentence the reviewer can disagree with. The customer
 * still chooses: they know their own plan, and this judge is one more model
 * reading, not a measurement.
 */
export function bestAttempt(source, scored) {
  if (!scored.length) return null;
  let best = 0;
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].score > scored[best].score) best = i;
  }
  const s = scored[best];
  const bits = [];
  if (s.missing) bits.push(`${s.missing} the source shows but this does not`);
  if (s.invented) bits.push(`${s.invented} not on the source`);
  return {
    index: best,
    why: bits.length
      ? `Closest match: ${s.matched} of ${source.length} enclosures agree. ${bits.join(', ')}.`
      : `Every one of the ${source.length} enclosures on your plan appears here.`,
  };
}

/** What to tell the customer about how many goes are left. */
export function attemptsNote(count) {
  const left = MAX_ATTEMPTS - count;
  if (left > 0) {
    return `${left} more free attempt${left > 1 ? 's' : ''}. Re-tracing never costs a
      credit. A fault in the tracing is ours, not yours.`.replace(/\s+/g, ' ');
  }
  // Honest end of the road. A plan that is still wrong after three attempts is
  // outside what this can do, and saying so beats letting somebody fight the
  // tools for an hour.
  return 'No attempts left. If the tracing is still wrong, this plan is outside '
    + 'what the tracing can read. Tell us and the credit goes back.';
}
