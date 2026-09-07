// What travels when a builder publishes a home.
//
// The 3D embed reads the plan out of the browser it is displayed in —
// localStorage for the record, IndexedDB for the render — so on a seller's
// website it shows "No floor was named" and always has. A buyer has never
// opened StyloPlan; their browser holds nothing. See
// docs/design-brief-embed-publishing.md.
//
// This is the first step of the answer and it deliberately touches no network:
// one function that turns a floor into the object that will be stored, so the
// SHAPE is settled and tested before anything is sent anywhere.
//
// PUBLISHING IS DELIBERATE. Nothing here runs on its own; it is called when the
// builder says to publish, and what it returns is the whole of what leaves
// their machine.

import { isPrintable } from './compositor.js';
import { planTitleOf } from './floor-context.js';

/**
 * ONLY WHAT THE BUYER'S PAGE DRAWS.
 *
 * A label carries a good deal that is ours rather than theirs: `fitBox` and
 * `ink` are where the matcher found the tracing's own wording, `anchor0` is
 * where it started so Studio can offer to put it back, `checkedFor` records
 * which render it was checked against. None of that is read by the 3D view,
 * which uses the name, the dimension and the position and nothing else.
 *
 * Publishing them would put our working notes on a stranger's website for no
 * reader. A field that turns out to be needed is easy to add; data already sent
 * cannot be recalled.
 */
const forEmbed = (l) => ({
  id: l.id,
  name: l.name,
  // Transcribed upstream and never computed — red line 2. It travels verbatim
  // or not at all.
  ...(l.dim ? { dim: l.dim } : {}),
  x: l.x,
  y: l.y,
});

/**
 * One floor, as it will be stored and read back by a buyer's browser.
 *
 * @param {object} project the home this floor belongs to
 * @param {object} floor   the floor, carrying its `verified` sign-off
 * @param {'light'|'dark'} look which render is being published
 * @returns {object|null} null when there is nothing to publish
 */
export function floorPayload(project, floor, look) {
  // A FLOOR THAT WAS NEVER CONFIRMED HAS NOTHING TO PUBLISH. `verified` is the
  // reviewer's sign-off, and it is what every printed number on the model comes
  // from. Without it there is no record, and inventing one here would put
  // unreviewed labels on a listing.
  const v = floor?.verified;
  if (!project?.id || !floor?.id || !v) return null;
  if (look !== 'light' && look !== 'dark') return null;

  const labels = (v.labels || []).filter(isPrintable).map(forEmbed);

  return {
    floorId: floor.id,
    projectId: project.id,
    look,
    // The builder's own order, so the switcher on a buyer's page reads Main
    // Floor then Basement rather than whatever the database returns first.
    sortOrder: (project.floors || []).findIndex((f) => f.id === floor.id),
    floorName: floor.name || 'Floor',
    // One rule for the title, shared with every other page rather than
    // restated: floor-context owns it.
    planTitle: planTitleOf(project, floor),
    payload: { labels },
  };
}

/**
 * Every floor of a home that can be published in one look.
 *
 * THE LOOK IS THE HOME'S, NOT THE FLOOR'S. A visitor stepping from the main
 * floor to the basement and finding the plan has gone light to dark reads it as
 * a broken page, which is why the all-floors embed already refuses a mixed set.
 * This returns what CAN go, and the caller checks against what the builder
 * asked for: a home with a floor missing from this list is not ready to be
 * published whole.
 *
 * @param {object} project
 * @param {'light'|'dark'} look
 * @param {(floorId:string)=>boolean} hasRender  does this floor hold a render
 *   in that look? Passed in because the answer lives in the artifact store,
 *   which is the caller's business and not this module's.
 * @returns {{ready: Array, missing: Array}} payloads, and the floors that have
 *   no render in this look — named, so the builder is told which.
 */
export function homePayload(project, look, hasRender) {
  const ready = [];
  const missing = [];
  for (const floor of project?.floors || []) {
    const row = floorPayload(project, floor, look);
    // A floor still in Review is not "missing a render" — it has not reached
    // the point of having one, and saying so would send the builder to the
    // wrong screen.
    if (!row) continue;
    if (hasRender(floor.id)) ready.push(row);
    else missing.push({ id: floor.id, name: floor.name || 'Floor' });
  }
  return { ready, missing };
}

/** The Storage bucket published renders live in — never `plans`, which is private. */
export const PUBLISHED_BUCKET = 'published';

/**
 * The path a published render is read from, WITHIN that bucket.
 *
 * Addressed by floor and look rather than by user, because the reader has no
 * session and no idea whose account it came from. The bucket name is not part
 * of it: an earlier draft repeated it here and every object landed at
 * `published/published/<floor>/…`, which the storage policy then had to count
 * folders around.
 */
/**
 * Where a published render lives in the bucket.
 *
 * THE EXTENSION IS PART OF THE KEY, so it has to be a parameter rather than a
 * constant: floors published before this was measured are PNG objects at
 * `<floor>/<look>.png`, and nothing migrates them. Publishing writes .webp;
 * reading asks for .webp and falls back to .png, so an old link keeps working
 * and re-publishing a floor moves it over.
 *
 * WHY WEBP AT ALL. `style-client.js` stores the model's bytes unchanged and
 * this uploaded them unchanged, which meant a viewer downloaded the raw PNG the
 * model returned. Measured on four real renders: 3452, 3482, 2872 and 5446 KB
 * of PNG become 94, 88, 96 and 197 KB of WebP at q92 — 28x to 40x — because the
 * model's output carries a fine dither that PNG cannot compress and WebP simply
 * does not keep. At q92 the largest single-pixel difference across a full
 * 2048x2048 comparison was 12 of 255, and the share of pixels differing by more
 * than 8 was zero. Checked by eye at 1:1 on stair treads, a door swing and
 * fixture outlines: no visible change.
 */
export const renderPath = (floorId, look, ext = 'webp') => `${floorId}/${look}.${ext}`;

/**
 * What the Embed panel's switch and status line should say.
 *
 * SEPARATED FROM THE DRAWING SO IT CAN BE CHECKED. The panel only renders for a
 * signed-in builder with a real project, which is exactly the situation a demo
 * fixture cannot reach — so the branch that matters most in this app was the
 * one branch nothing could exercise. The DOM code is now dumb and this is a
 * function with an answer.
 *
 * THE WORDS NAME THE OUTCOME, NOT THE MECHANISM. "Publish", "Withdraw" and
 * "Publish again" were three labels for one decision — is this plan on my
 * website or not — expressed in our vocabulary rather than the builder's.
 *
 * @param {object} o
 * @param {boolean} o.signedIn
 * @param {boolean} o.readable  did the check of what is already published work
 * @param {number} o.total      floors in scope
 * @param {number} o.live       of those, how many are on the web in this look
 * @param {number} o.behind     of the live ones, how many have changed since
 * @returns {{mode: string, on: boolean, text: string, tone: 'subtle'|'warn',
 *   showSwitch: boolean, showUpdate: boolean, codeWorks: boolean}}
 */
export function publishState({ signedIn, readable, total, live, behind }) {
  const say = (mode, text, extra = {}) => ({
    mode, text, tone: 'subtle', on: false,
    showSwitch: false, showUpdate: false, codeWorks: false, ...extra,
  });

  if (!signedIn) {
    return say('noAccount', 'Publishing needs an account — it is what lets a '
      + 'visitor’s browser read this home. Everything else on this page works without one.');
  }
  if (!readable) {
    return say('unknown', 'Could not check whether this home is on your website. '
      + 'Reload the page, or try again in a moment.', { tone: 'warn' });
  }
  if (!total) return say('nothing', 'Nothing to put on your website in this look yet.');

  const on = live === total;
  if (!on) {
    return say('off', live
      // PARTLY ON IS ITS OWN STATE and must not read as "off": some of these
      // floors are on somebody's website right now, and a switch that says
      // "off" over them would be a lie about what strangers can see.
      ? `${live} of ${total} floors are on your website. Turn this on to add the rest.`
      : 'Off — the code below shows nothing until you turn this on.',
    { showSwitch: true });
  }
  return say('on', behind
    // NOT "a newer render": the signature covers the labels too, so this fires
    // for a room renamed in Review as well as for a re-render, and naming the
    // wrong cause would send them to Studio to redo finished work.
    ? 'Your website still shows an older version.'
    : `Live — anyone with your link can see ${total > 1 ? 'these floors' : 'this plan'}.`,
  { on: true, showSwitch: true, codeWorks: true, showUpdate: true, tone: behind ? 'warn' : 'subtle' });
}
