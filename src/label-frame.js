// A confirmed label position, moved onto the picture it is about to be drawn on.
//
// A label's x/y are a fraction of an IMAGE, and one plan has several images of
// itself: the wireframe Review edits against, the light render and the dark
// render. The wireframe is padded to the model's aspect before it is sent and
// each render comes back framed its own way, so one pair of numbers means three
// different places on three pictures.
//
// Studio learned this the hard way and fixed it for the 2D export — the note
// above `toShown` in studio.html has the measurement: on one plan the
// wireframe's drawing sits at x 0.107 w 0.794, so a label at 0.85 of the image
// is at 93.6% of the drawing there and 87.2% of it on a full-framed render.
// Six percent of the plan's width, plainly visible.
//
// THE 3D VIEW NEVER APPLIED THAT FIX. It mapped stored positions straight onto
// the render's wall bounds, which is the same mistake in a different frame, and
// Saman's report was exactly the symptom the 2D path used to have: "the
// placements still do not match the 2D render, they are a little off."
//
// So the rule lives here, once, and both callers use it: the 3D view maps as it
// builds, and publishing maps before it sends — because a visitor's browser has
// no wireframe to map from and never will.

import { planContentBox } from './plan-trim.js';
import { mapFrame } from './compositor.js';

/**
 * Move label positions from the frame they are STORED in onto a render.
 *
 * @param {Array} labels  confirmed labels, x/y a fraction of the wireframe
 * @param {HTMLImageElement|HTMLCanvasElement|null} wireframe the picture Review
 *   edited against. Without it nothing is mapped — see below.
 * @param {HTMLImageElement|HTMLCanvasElement|null} render the picture they are
 *   about to be drawn on.
 * @returns {Array} labels with x/y in the render's frame; the same objects'
 *   other fields untouched.
 */
export function labelsOnRender(labels, wireframe, render) {
  const list = labels || [];
  // NO WIREFRAME MEANS NO MAPPING, NOT A GUESS. A floor whose wireframe has
  // been cleared, or a published copy that never carried one, is left exactly
  // as it is: stored coordinates are still a reasonable reading of the render,
  // and inventing a transform from one of the two pictures would move every
  // label by an amount nobody measured. Studio guards the same way.
  if (!wireframe || !render) return list;

  const from = planContentBox(wireframe);
  const to = planContentBox(render);
  // `null` from either side means "this picture is already tight", which is
  // mapFrame's pass-through case anyway.
  if (!from?.w || !to?.w) return list;

  return list.map((l) => ({ ...l, ...mapFrame({ x: l.x, y: l.y }, from, to) }));
}
