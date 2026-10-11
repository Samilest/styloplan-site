// L3 styling client: strip direction letters, render, and VERIFY the render
// before accepting it.
//
// Two live failures on real plans drive this:
//  1. Prompt 2 kept rendering the "UP"/"DN" letters next to staircases even
//     though it forbids text three times. The letters are deleted from the
//     wireframe first, so there is nothing to copy. The direction ARROW is a
//     graphic element and survives, which is what the prompt actually asks for.
//  2. The styling model is not reliably geometry-preserving: one run in three
//     came back as a completely different, landscape plan. Registration against
//     the wireframe catches that instantly (211% aspect deviation), so every
//     render is checked and a failed one is re-rolled rather than shipped.
//  3. It also sometimes copies the ROOM NAMES through, which the compositor
//     then draws over — every label doubled and offset. Red line 1 had no
//     verification at all until then; see review/text-guard.js.

import { stripDirectionLabels, detectLabelBlocks, nameLinesOn } from './review/anchors.js';
import { applyDabs } from './review/eraser.js';
import { detectBakedText, textBoxes, glyphBoxes } from './review/text-guard.js';
import { frameForModel } from './aspect.js';
import { register } from './review/registration.js';
import { postAI } from './api.js';
import { ATTEMPTS, newJobId } from './credit-jobs.js';

// One press of Render is one job, however many times we re-roll inside it. The
// limit lives with the billing rule (src/credit-jobs.js) so the two cannot
// drift: the free-retry budget is derived from this number.
const MAX_ATTEMPTS = ATTEMPTS['/api/style'];

/**
 * Did this page ask for the candidate prompt? `?candidate=1` on the Studio URL.
 *
 * Opt-in per render and per tab: nothing is stored, so a reload without the
 * parameter is back to the shipped prompt, and there is no setting anywhere
 * that could leave an account quietly rendering against an experiment.
 */
const candidatePrompt = () => {
  try {
    return new URLSearchParams(location.search).get('candidate') === '1';
  } catch { return false; }
};

const loadImage = (url) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('Could not decode the styled render'));
  img.src = url;
});

/**
 * Furniture is NOT placed here — it is delegated to the styling model, which
 * furnishes each room from its label. (Manual object baking was removed: the
 * model reinterprets a baked object anyway — a baked sofa came back as a table
 * — so it was fake control. The object code is archived under src/_archive for
 * the future programmatic renderer.)
 *
 * @param {HTMLImageElement} wireframeImg  confirmed wireframe
 * @param {Array} labels                   confirmed room labels (anchor the text cover)
 * @param {{theme:string, vars:Object}} style
 * @param {(stage:string, detail?:string)=>void} [onStage]
 * @returns {{image:HTMLImageElement, url:string, attempts:number, registration:Object, stripped:number}}
 */
/** At most this many places go to the text check; more is not furniture. */
const MAX_TEXT_CROPS = 8;

/**
 * Ask the text model about each place the text guard fired on, cropped with
 * room around it (the run's box, grown to show what the marks belong to).
 *
 * @returns {Promise<{clean: boolean, read: string[]}>}
 */
async function secondOpinion(image, runs) {
  if (!runs?.length || runs.length > MAX_TEXT_CROPS) return { clean: false, read: [] };
  const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
  const crops = runs.map((run) => {
    const bw = Math.max(run.w * W * 1.6, run.h * H * 6, 120), bh = Math.max(run.h * H * 4, 120);
    const x0 = Math.max(0, run.x * W - bw / 2), y0 = Math.max(0, run.y * H - bh / 2);
    const cw = Math.min(W - x0, bw), ch = Math.min(H - y0, bh);
    const sc = 384 / Math.max(cw, ch);
    const c = document.createElement('canvas');
    c.width = Math.round(cw * sc); c.height = Math.round(ch * sc);
    c.getContext('2d').drawImage(image, x0, y0, cw, ch, 0, 0, c.width, c.height);
    return { imageBase64: c.toDataURL('image/png').split(',')[1], mimeType: 'image/png' };
  });
  try {
    const j = await postAI('/api/text-check', { crops });
    const answers = crops.map((_, k) => (j?.crops || []).find((a) => a.i === k + 1));
    return { clean: answers.every((a) => a && a.text === false), read: answers.map((a) => a?.read || '') };
  } catch {
    return { clean: false, read: [] };
  }
}

export async function renderStyled(wireframeImg, labels, { theme, vars, erases }, onStage = () => {}) {
  const { canvas: clean, stripped } = stripDirectionLabels(wireframeImg);
  if (stripped) onStage('strip', `removed ${stripped} direction marker${stripped > 1 ? 's' : ''}`);

  // What the reviewer painted out, applied HERE — before the model sees the
  // drawing, so the styled image is made once from the corrected wireframe
  // rather than re-rendered to fix a defect the customer did not cause.
  //
  // Deliberately after stripDirectionLabels and on the same canvas: both are
  // the same act, us compositing on our own raster, which is the architecture
  // red line 1 already establishes for text and branding.
  if (erases?.length) {
    applyDabs(clean.getContext('2d'), clean.width, clean.height, erases);
    onStage('erase', `${erases.length} dab${erases.length > 1 ? 's' : ''} painted out`);
  }

  // THE MODEL IS NOT SHOWN ANY TEXT, because it copies what it is shown.
  //
  // The styling prompt says, three times, that the output must contain no text,
  // and treats the wireframe's room names as a FUNCTION GUIDE to read and not
  // draw. Measured on Plan A, twice: three attempts on gemini-3-pro-image-
  // preview and three more on the stable gemini-3-pro-image, six renders, every
  // one refused by the text guard for the same eight room names.
  //
  // And what it wrote back was not even a copy. KITCHEN came out "18' x 10"" —
  // eighteen feet by ten INCHES — and BEDROOM 3 as "12'-1" x", cut off
  // mid-string. Numbers the customer's plan does not contain, in an image that
  // would have carried our own confirmed dimensions on top of them. Red line 2
  // exists for exactly that, and the guard is what caught it.
  //
  // An instruction the model has ignored six times is not made truer by being
  // repeated a fourth time in the prompt. Removing the thing it copies is the
  // change that does not depend on the model obeying.
  //
  // MEASURED TEXT, NOT MATCHED TEXT. `textBoxes` finds runs of glyphs in the
  // image itself; a label's `fitBox` is where the matcher THINKS its name was
  // drawn. src/review/stamp.js already settled this argument for the wireframe
  // download, and its reasoning holds here: a wrong mask paints white over a
  // wall and that hole is invisible to the customer, while a missed one leaves
  // a room name for the guard to catch. It also covers text no label matched —
  // the dimension strings and the title block — which is most of what a matched
  // box would have left behind.
  // TWO PASSES, BECAUSE ONE IS NOT ENOUGH AND THE OTHER IS NOT SAFE ALONE.
  //
  // Measured first. Then, for any label whose name the measurement did not
  // reach, a box at that label's own ink position. Measured on Plan A: the
  // first pass covers 6 of 9 names and misses DINING, LIVING ROOM and FOYER —
  // all three drawn over furniture, where a run of letters is lost among the
  // blobs around it. Three names left is three names the model will copy.
  //
  // That second pass was a box of median size at each such label's saved
  // `ink`. Since 2026-10-06 it is the name's own marks, where the label reader
  // finds the name spelt out on this drawing: the saved `ink` of a label nothing
  // matched is the model's guess, and it put boxes on a cooktop and a sink
  // (bakedTextBoxes). Not at the label's position either, which the reviewer
  // drags: masking at the moved position paints white over clean linework and
  // leaves the original name showing — that defect is written up in stamp.js.
  const { runs, synthesised } = coverBakedText(clean, labels);
  if (runs) {
    onStage('strip', `covered ${runs} run${runs > 1 ? 's' : ''} of text`
      + (synthesised ? ` and ${synthesised} the measurement missed` : ''));
  }

  // Name the output frame, or the model picks one and redraws the plan to fill
  // it — and pad the input to that exact frame, or it stretches the plan to
  // close the remaining few percent. Both halves are needed; see src/aspect.js.
  // Framed to the DRAWING, not to the canvas — see frameForModel. A wireframe
  // that is mostly empty band gives the model somewhere to grow into, and it
  // takes it.
  const { canvas: framed, aspectRatio } = frameForModel(clean);
  return renderFramed(framed, aspectRatio, wireframeImg, labels,
    { theme, vars, stripped }, onStage);
}

/**
 * Paint out every run of baked text on a wireframe canvas, in place.
 *
 * EXPORTED BECAUSE THE PREVIEW HAS TO SHOW THE SAME DRAWING. Studio's unstyled
 * preview drew the raw tracing, so a room name the render would never carry sat
 * there in the preview — and Review hides those names under a white patch of its
 * own, per label, which meant three pages showed three different drawings and
 * the customer was told the eraser had failed. One function, three callers.
 *
 * @param {HTMLCanvasElement} clean  the wireframe, already erased and stripped
 * @param {Array} labels             confirmed labels, whose names are read off the drawing
 * @returns {{runs:number, synthesised:number}} what was covered
 */
export function bakedTextBoxes(clean, labels) {
  // TWO GLYPHS ARE A WORD WHERE A LABEL SAYS A NAME WAS WRITTEN.
  //
  // The row pass needs three glyphs, and that is right: checked one by one on
  // Saman's own tracing of The Sky, five of its seven two-glyph runs were the
  // toilet, the vanity and three lengths of dashed cabinet line. The other two
  // were H.W.T. and CL. — both real, and both carrying a label of their own.
  //
  // A NAME IS WHERE THE READER FINDS IT SPELT OUT (2026-10-06). Two passes used
  // to take a label's word for where its name was: a pair of marks near its
  // saved box, widened to twice its size, or near its saved `ink`, counted as a
  // word; and a name no run had reached got a box of median size at that `ink`.
  // For a label nothing ever matched, `ink` is the model's guess: on Plan B
  // 2-CAR GARAGE's guess sits on the kitchen cooktop, on The Star MASTER
  // BEDROOM's on the kitchen sink, and two burners and two basins went white as
  // two-letter words.
  //
  // So the label reader (review/anchors.js, the reading Review places labels
  // by) finds each name's lines on this drawing, and where those lines hold the
  // name's letters exactly -- one mark for each, leaving out any mark half as
  // tall again as the line's typical one -- those marks are the name's,
  // whether or not the rows below found them. CL. is two marks on one line and
  // is covered on that. A mark more or fewer and the lines are not taken on
  // trust: something else is on them. The Star's MASTER sits beside a basin
  // twice its height; the rows ran the basin into the line and the spread of
  // heights failed it, the reader counts six letters and a basin, and only
  // columns cut down through MASTER / BATH -- the ones that also took cooktops
  // as words -- had been covering it.
  //
  // Painting over drawn content is the worse of the two failures: a missed
  // name costs a refused render, which is free to retry, while a hole in the
  // customer's plan is invisible to them and ships. stamp.js reached the same
  // conclusion for the wireframe download.
  const mid = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : 0);
  const within = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const boxOf = (L) => ({ x: L.minX, y: L.minY, w: L.maxX - L.minX, h: L.maxY - L.minY });
  const glyphs = glyphBoxes(clean);
  const blocks = detectLabelBlocks(clean);
  const spelt = new Map();
  for (const n of nameLinesOn(labels || [], blocks)) {
    const marks = [];
    for (const L of n.lines) {
      const on = glyphs.filter((g) => within(g, boxOf(L)));
      const typical = mid(on.map((g) => g.h));
      marks.push(...on.filter((g) => g.h <= typical * 1.5));
    }
    if (marks.length === n.letters) spelt.set(n.block, { k: n.k, marks });
  }
  const runs = textBoxes(clean, { rotated: true });
  const cover = runs.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h }));
  const inRun = (g) => cover.some((c) => Math.abs(g.x - c.x) <= c.w / 2 && Math.abs(g.y - c.y) <= c.h / 2);
  let synthesised = 0;
  for (const { marks } of spelt.values()) if (marks.some((g) => !inRun(g))) synthesised++;
  // PAINT THE LETTERS, NOT THE BOX THEY SIT IN.
  //
  // A run's bounding box spans from the first letter to the last, and whatever
  // the drawing put between or behind them goes white with the word. Measured
  // across ten wireframes as the share of erased INK that is actually lettering:
  //
  //     avimain 97.8%   geena 95.3%   madison 93.9%   jordan 93.4%   sky 92.5%
  //     another 87.4%   plana 87.3%   avitop 84.3%    another2 86.5%
  //     run9 72.8%
  //
  // So between 2% and 27% of what the cover erased was the customer's drawing —
  // about 11,000 pixels of it on run9. That is the cabinet outline around
  // DISH WASHER on The Sky, and it is the same defect as the toilet and the
  // sink before it, arriving by the route that was never suspected because the
  // box was over real text every time.
  //
  // The glyphs are already known: they are what the runs were built out of. A
  // word covered letter by letter is just as unreadable to the model, and it
  // takes nothing else with it.
  //
  // AND EVERY LETTER ON A LINE OF A ROOM'S OWN TEXT (2026-10-05). A run is
  // only accepted if its letters share one height, which is what keeps a sink
  // and its taps from passing for a word; a dimension line never does. 144" x
  // 168" is digits 36px tall, an x of 26 and four quote strokes of 13, and every
  // size on Plan B's new top floor read 0.40-0.43 against the 0.30 cap -- so it
  // went to the model as drawn, and showed beside each chip in Review, along
  // with a lone 1 that had fallen into a run of its own.
  //
  // The label reader (review/anchors.js) reads the same drawing as stacks of
  // text lines: a name, which may wrap, and the size under it, never across a
  // wall and never marks stacked one above another. Where a stack holds a word
  // this pass has accepted on its own terms -- a room's name -- the lines BELOW
  // that word are its size, and their letter-shaped marks are covered.
  //
  // Only below, and only lines no taller than the word: the reader's stacks
  // and lines are not all text. On The Avi Top it stacked a toilet over
  // ENSUITE, on Jordan 4 it ran a bay window's arc into MASTER BEDROOM's line,
  // and on The Star a basin into MASTER BATH's; each went white when the whole
  // stack was trusted. A size is set at or under its name's letter height; a
  // toilet or a basin is drawn far taller. And within a line, not a mark half as
  // tall again as the line's own typical one.
  //
  // Read here, from the drawing, not from the labels' saved boxes: a box saved
  // by an earlier reader can reach across a wall onto a fixture -- The Star's
  // LAUNDRY box covers the cooktop -- and it would take what it reaches.
  //
  // AND UNDER A NAME THE READER FOUND SPELT OUT (2026-10-06), its marks taken
  // as they were counted at the top of this function.
  const words = runs.filter((t) => !t.vertical);
  const ofLines = new Set();
  for (const b of blocks) {
    let at, letter;
    const name = spelt.get(b.lines);
    if (name) {
      at = name.k - 1;
      for (const g of name.marks) ofLines.add(g);
      letter = mid(name.marks.map((g) => g.h));
    } else {
      at = b.lines.findIndex((L) => words.some((t) => within(t, boxOf(L))));
      if (at < 0) continue;
      const word = words.find((t) => within(t, boxOf(b.lines[at])));
      // A run is centred on (x, y); a line box starts at its corner.
      const wordBox = { x: word.x - word.w / 2, y: word.y - word.h / 2, w: word.w, h: word.h };
      letter = mid(glyphs.filter((g) => within(g, wordBox)).map((g) => g.h)) || word.h;
    }
    for (const L of b.lines.slice(at + 1)) {
      const on = glyphs.filter((g) => within(g, boxOf(L)));
      if (!on.length) continue;
      const typical = mid(on.map((g) => g.h));
      if (typical > letter * 1.25) continue;
      for (const g of on) if (g.h <= typical * 1.5) ofLines.add(g);
    }
  }
  const letters = glyphs.filter((g) => inRun(g) || ofLines.has(g));
  return { letters, runs: runs.length, synthesised };
}

/**
 * A hair beyond the ink: antialiased glyph edges fade over about a pixel, and
 * stopping on the box leaves a grey ghost the model can still read.
 */
export const COVER_BLEED = 2;

/** Paint a set of normalised letter boxes white onto a canvas. */
export function paintCover(canvas, letters, colour = '#ffffff') {
  if (!letters?.length) return;
  const cx = canvas.getContext('2d');
  cx.save();
  cx.fillStyle = colour;
  for (const t of letters) {
    cx.fillRect(t.x * canvas.width - (t.w * canvas.width) / 2 - COVER_BLEED,
      t.y * canvas.height - (t.h * canvas.height) / 2 - COVER_BLEED,
      t.w * canvas.width + COVER_BLEED * 2, t.h * canvas.height + COVER_BLEED * 2);
  }
  cx.restore();
}

/**
 * Paint out every run of baked text on a wireframe canvas, in place.
 *
 * ONE FUNCTION, AND NOW REVIEW USES IT TOO. Hiding the tracing's own wording
 * was written three times: here, in review/stamp.js for the download, and in
 * review.html, which painted a white rectangle over each label's `fitBox`. That
 * third one had both of the faults this file has spent the day removing — it
 * painted a BOX rather than the letters, and it took its position from the
 * MATCHER rather than from the image, which the notes above record as pointing
 * at the wrong room for 7 of 11 labels on The Avi Top. A box in the wrong place
 * is a white hole in the customer's drawing, and that is what Saman was looking
 * at when he said the sink had been erased again after it was fixed here.
 */
export function coverBakedText(clean, labels) {
  const { letters, runs, synthesised } = bakedTextBoxes(clean, labels);
  paintCover(clean, letters);
  return { runs, synthesised, letters: letters.length };
}

/** The paid half: hand the covered, framed drawing to the model and check it. */
async function renderFramed(framed, aspectRatio, wireframeImg, labels,
  { theme, vars, stripped }, onStage) {
  const imageBase64 = framed.toDataURL('image/png').split(',')[1];
  const source = await loadImage(framed.toDataURL('image/png'));

  // Minted once, OUTSIDE the loop: it is what tells the server these attempts
  // are one user action and must cost one credit. Minting it per attempt would
  // restore the bug it exists to fix.
  const jobId = newJobId();

  let last = null;
  // A REQUEST THAT NEVER COMES BACK IS ALSO A RENDER THAT PRODUCED NOTHING.
  //
  // The credit is taken server-side BEFORE the model is called, so anything that
  // kills the connection mid-render — dropped wifi, a laptop lid, a platform's
  // request timeout — left the customer charged with nothing to show and no way
  // to say so: the throw escaped this loop and skipped the refund claim below.
  //
  // THE CEILING IS NO LONGER HYPOTHETICAL, so here are the measured numbers
  // instead of the guess this comment used to carry ("20 to 40 seconds against
  // ceilings that are 100 seconds on some providers"). Supabase Edge Functions
  // cut a request at 90 seconds — measured 2026-09-04, a 90s request survives
  // intact. Our slowest call is the extraction at 52.9s. That is 37 seconds of
  // margin, not the comfortable double the old wording implied, and the margin
  // is the thing to watch when a plan is larger than the ones measured.
  //
  // A thrown attempt is retried like a rejected one, because the retry is free
  // and a transient failure often is transient. Only when none of them came back
  // does it fall through to the refund.
  let threw = null;
  // EVERY REFUSED ATTEMPT IS KEPT, not just the one that happened to be last.
  //
  // Plan A's three renders were paid for and discarded, so the only thing left
  // to reason from was the sentence "3.1% apart" with no image to hold against
  // the wireframe. What the model actually did — stretched it, cropped it,
  // redrew a wall — is visible in the picture and in nothing else.
  //
  // The caller decides whether to persist these; this only stops throwing them
  // away. `source` rides along because a refused render is meaningless without
  // the drawing it was supposed to match.
  const refused = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onStage('render', attempt > 1 ? `re-rolling (attempt ${attempt}, no extra credit)` : undefined);
    let j;
    try {
      j = await postAI('/api/style',
        // ASKING FOR THE CANDIDATE PROMPT, AND THAT IS ALL IT DOES. The server
        // reads its OWN src/ai/prompts-candidate.js and only when the operator
        // has set ALLOW_CANDIDATE_PROMPT — no prompt text travels in this
        // request and a caller cannot inject one. With the flag off, which is
        // how it ships, this field is ignored and the live prompt runs.
        //
        // It exists so a prompt change can be tried on a real render without
        // the shipped templates being edited first. Those are production
        // assets (red line 3) and a regression in one reaches every customer,
        // so the order is: try it here, then promote it.
        { imageBase64, mimeType: 'image/png', theme, vars, aspectRatio, jobId,
          candidate: candidatePrompt() });
    } catch (e) {
      threw = e;
      onStage('rejected', 'the render did not come back');
      continue;
    }

    const url = `data:${j.mimeType};base64,${j.imageBase64}`;
    const image = await loadImage(url);
    const registration = register(source, image);
    // Red line 1 is checked, not merely requested. The wireframe keeps its room
    // names on purpose (the model furnishes each space from them), and the model
    // sometimes copies them into the render — the compositor then draws the same
    // names on top and every label appears twice, offset.
    let text = detectBakedText(image, labels);
    // THE GUARD IS A TRIGGER; THE TEXT MODEL JUDGES WHAT IT FIRED ON. Each place
    // it fired is cropped and put to /api/text-check: a row of hangers, a
    // cooktop's burners, a washer and dryer are not writing, and refused for
    // them the customer waited for a re-render of a clean image. Only an
    // answer of "no writing" for EVERY place overturns the refusal; an error,
    // a missing answer or too many places keeps it -- red line 1 is not
    // loosened by an outage.
    if (registration.ok && !text.ok) {
      const judged = await secondOpinion(image, text.runs);
      if (judged.clean) {
        onStage('text-check', `${text.words} place${text.words > 1 ? 's' : ''} the guard flagged ${text.words > 1 ? 'are' : 'is'} not writing`);
        text = { ...text, ok: true, overruled: true };
      }
    }
    last = { image, url, attempts: attempt, registration, text, stripped, refused, source };
    if (!(registration.ok && text.ok)) {
      refused.push({
        attempt,
        url,
        aspectDev: registration.aspectDev,
        deviation: registration.deviation,
        reason: registration.ok ? `${text.words} piece(s) of text drawn in` : registration.reason,
      });
    }
    if (registration.ok && text.ok) {
      onStage('verified', `geometry matches the wireframe (${(registration.aspectDev * 100).toFixed(2)}% silhouette)`);
      return last;
    }
    onStage('rejected', registration.ok
      ? `the render has ${text.words} piece${text.words > 1 ? 's' : ''} of text drawn into it`
      : registration.reason);
  }
  // Out of attempts, and nothing here is usable. The customer paid a credit and
  // is getting nothing, so ask for it back before returning — only the browser
  // knows this happened, because the verdict needed a canvas.
  //
  // Deliberately not awaited into the result and deliberately swallowed: a
  // refund that fails must not turn "your render did not work" into an error
  // the customer cannot act on. The claim is bounded server-side; see
  // claimFailedRender.
  try {
    await postAI('/api/render-failed', { jobId });
    onStage('refunded', 'this render produced nothing, so the credit was returned');
  } catch { /* the balance is reconcilable from credit_events */ }
  // Nothing ever came back, so there is no render to hand up and the caller has
  // to hear about it. The refund is claimed first, above, which is the whole
  // point: the credit is returned before the error is raised.
  if (!last && threw) throw threw;
  return last;
}
