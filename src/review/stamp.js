// Put the reviewer's confirmed labels onto a wireframe canvas.
//
// ONE implementation, used by the Studio's wireframe download and by the check
// page that verifies it. Written as one function because the first version was
// two — the download had a copy and `test/wire-download.html` had another — and
// two paths for one job is exactly how the eraser came to reach the styled
// render and not the wireframe. A check page that can drift from the thing it
// checks is not a check.
//
// The wireframe carries the image model's own typeset room names, in whatever
// font that run chose. Review masks them with DOM chips, which is why the page
// looks right and the downloaded file did not. This is where that overlay gets
// painted in.

/** A hair beyond the measured box. */
const PAD = 0.010;

const median = (xs) => {
  const v = xs.filter((n) => n > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

/**
 * fitBox covers NAME AND DIMENSION together, so a box belonging to a label that
 * prints two lines is about twice the height of one. Missing this made an
 * earlier fix look like it did nothing at all.
 */
const DIM_LINES = 2.2;

/**
 * How far a label's own size may stray from the plan's median.
 *
 * MEASURED across five plans, and both naive answers fail. One shared size
 * overflows: eight of ten names on New Test (2) came out wider than the text
 * they replace. Each label's own size, unclamped, propagates the matcher's
 * errors straight into the drawing — New Test (1)'s implied sizes span 14.5x,
 * from 6.4px to 92.7px on one sheet, and five labels land under 11px, which is
 * not small but unreadable.
 *
 * That spread is matcher noise rather than a drafting decision: on New Test (3)
 * and Madison the tracing uses ONE size and the spread is 1.05x.
 *
 * This band gave zero overflow AND zero unreadable labels on four of the five
 * plans; neither pure answer managed that on any.
 */
const BAND_LO = 0.75, BAND_HI = 1.35;

/**
 * Grow a mask until it stops cutting through ink.
 *
 * THE BOX CANNOT BE TRUSTED TO BE THE WHOLE WORD. Measured on The Avi: the
 * matcher returned a 0.027-wide box for `W.I.C.` and 0.032 for `BATH` — the
 * six-character name got a NARROWER box than the four-character one. Masking to
 * that box covers most of the baked text and leaves a sliver, and a sliver
 * beside our own label reads as the name printed twice. That is exactly what
 * Saman saw, and it is why widening PAD alone never fixed it: the shortfall is
 * per-label, not uniform.
 *
 * So the mask is grown OUTWARD while the pixels at its edge are still dark,
 * which is the ink's own answer to "where does this word end". Bounded, because
 * a name that touches a wall would otherwise eat the wall: the cap is one box
 * width each way, enough for a badly clipped match and far short of a room.
 */
function grownToInk(cx, r, place, opts = {}) {
  const cap = opts.cap ?? r.w;
  const STEP = Math.max(2, Math.round(r.h / 6));
  // TEXT AND A WALL BOTH LOOK LIKE "ink at the edge" — the difference is HOW
  // MUCH. A letter touches a fraction of the strip's height; a wall crossing it
  // fills nearly all of it. Growing on any ink at all ate the walls beside
  // W.I.C. on the first attempt, which was worse than the sliver it fixed.
  //
  // So: keep going while the strip is PARTLY inked, stop the moment it reads as
  // solid. Between 2% (noise) and 55% (a wall) is a glyph.
  const INK_MIN = 0.02, INK_MAX = 0.55;
  const inkFraction = (x, y, w, h) => {
    if (w < 1 || h < 1) return 0;
    const px = cx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)),
      Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if ((px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 < 170) n++;
    }
    return n / (px.length / 4);
  };
  const isGlyph = (x, y, w, h) => {
    const f = inkFraction(x, y, w, h);
    return f > INK_MIN && f < INK_MAX;
  };
  const out = { ...r };
  // Only sideways: a room name is a horizontal run, and growing vertically is
  // how a mask starts swallowing the wall above or the dimension below.
  for (let d = 0; d < cap && isGlyph(out.x - STEP, out.y, STEP, out.h); d += STEP) {
    out.x -= STEP; out.w += STEP;
  }
  for (let d = 0; d < cap && isGlyph(out.x + out.w, out.y, STEP, out.h); d += STEP) {
    out.w += STEP;
  }
  return out;
}

/** Labels the matcher tied to real text in the drawing. */
export const positioned = (labels) => (labels || [])
  .filter((l) => l && l.fitBox && l.fitBox.w > 0 && l.fitBox.h > 0);

/**
 * Where the WHOLE image sits on a canvas showing only the trimmed part of it.
 *
 * Label coordinates are normalised to the full image, so the margins the trim
 * removed have to stay in the frame of reference or every label shifts.
 */
export const placeFor = (box, width, height) => ({
  x: -(box.x / box.w) * width, y: -(box.y / box.h) * height,
  w: width / box.w, h: height / box.h,
});

/**
 * Give each label the size the tracing drew it at, clamped to the band.
 *
 * MEASURE THE LINE, DO NOT COUNT IT FROM OUR LABEL.
 *
 * `fitBox` is the block of ink the matcher tied to this name, and a block can
 * be one line, two, or three. This divided it by 2.2 when OUR label carried a
 * dimension and by nothing otherwise — an assumption about the customer's sheet
 * taken from our own record of it, and the two disagree constantly:
 *
 *   * The tracing draws MASTER BATH and WALK-IN CLOSET on two lines. No dim, no
 *     divisor, so the font came out about twice the drawn size.
 *   * The tracing prints 13' x 10' under BEDROOM 2 while our label has no dim,
 *     because the extraction never confirmed one. Same doubling.
 *
 * Both are the same mistake, and Saman's download showed it as two groups of
 * labels about 1.8x apart — the band's full width, reached for no reason a
 * reader can see.
 *
 * `inkBoxes` are runs found in this drawing, and `textLines` groups a run by
 * ROW: one run is one line of type, measured. The nearest one to a label is
 * that room's own lettering, which is also what a draughtsman varies when they
 * vary anything. No line counting, no assumption about what our label holds.
 *
 * @param {Array} placed  labels with a fitBox
 * @param {{w,h}} place   the trim mapping
 * @param {Array} [inkBoxes]  measured text runs, normalised, centre-based
 */
export function sizeLabels(placed, place, inkBoxes = null) {
  const lineOf = (l) => {
    // Without a measurement there is nothing better than the old guess.
    if (!inkBoxes?.length) return (l.fitBox.h * place.h) / (l.dim ? DIM_LINES : 1);
    const at = l.ink
      || { x: l.fitBox.x + l.fitBox.w / 2, y: l.fitBox.y + l.fitBox.h / 2 };
    let best = null, near = Infinity;
    for (const t of inkBoxes) {
      const d = Math.hypot(t.x - at.x, t.y - at.y);
      if (d < near) { near = d; best = t; }
    }
    return best.h * place.h;
  };
  const implied = placed.map(lineOf);
  if (!implied.length) return;
  const med = [...implied].sort((a, b) => a - b)[Math.floor(implied.length / 2)];
  // drawLabels multiplies `size` by place.w / 900, so invert that here.
  const toSize = 1 / (place.w / 900);
  placed.forEach((l, i) => {
    if (l.size != null) return;
    l.size = Math.min(med * BAND_HI, Math.max(med * BAND_LO, implied[i])) * toSize;
  });
}

/**
 * Mask the model's baked text and draw the confirmed labels over it.
 *
 * ONLY LABELS WITH A VERIFIED POSITION are touched. One that the matcher could
 * not tie to text in the drawing has no position on the wireframe — only the
 * extraction's guess — and drawing it anyway put COVERED DECK inside The Sky's
 * kitchen, stacked ENSUITE and MASTER BEDROOM in one room, and pushed M.BATH
 * outside the building. It also contradicted what the reviewer is told, which
 * is that an unmatched room keeps the tracing's own name. It now does, because
 * this neither covers it nor draws over it.
 *
 * @param {CanvasRenderingContext2D} cx  a canvas already carrying the trimmed plan
 * @param {{x,y,w,h}} box  the trim box, normalised to the source image
 * @param {Array} labels   the project's labels
 * @param {object} brand   only `font` and `labelInk` are read
 * @param {Function} drawLabels  the compositor's, passed in so this file stays
 *   free of the branded-format machinery
 * @param {object} rec  a text recorder
 * @returns {{printed:number, keptFromTracing:number}}
 */
export function stampLabels(cx, box, labels, brand, drawLabels, rec, isPrintable, inkBoxes,
  maskBoxes = null) {
  const { width, height } = cx.canvas;
  const place = placeFor(box, width, height);
  // MASKED and DRAWN are different sets, and conflating them lost a label the
  // reviewer could plainly see.
  //
  // `positioned` are the labels whose baked text the matcher located — those
  // are the ones with something to cover. Everything printable gets DRAWN,
  // matched or not: BONUS ROOM has no matched box on The Avi, so under the old
  // rule it appeared in Review, could be dragged in Review, and then was simply
  // absent from the file. A download that silently omits what the page shows is
  // worse than one that places a name imperfectly — the reviewer can see and
  // fix the second, and cannot even know about the first.
  //
  // The risk this reintroduces is the one from The Sky: an unmatched label sits
  // where the extraction guessed, which can be the wrong room. That is now
  // deliberately the reviewer's to catch, because Review draws those same chips
  // in those same places — it is visible work, not a hidden failure.
  const placed = positioned(labels);
  const drawn = (labels || []).filter((l) => isPrintable(l));
  sizeLabels(placed, place, inkBoxes);
  // Unmatched labels have no box to size from, so they take the plan's median.
  const sized = placed.map((l) => l.size).filter((v) => v > 0).sort((a, b) => a - b);
  const fallback = sized.length ? sized[Math.floor(sized.length / 2)] : null;
  for (const l of drawn) if (l.size == null && fallback) l.size = fallback;

  // A BOX FOR THE ONES THAT NEVER GOT ONE.
  //
  // On The Avi the matcher located only 3 of 11 names, so eight rooms printed
  // OUR label with the tracing's own still underneath — the doubling Saman
  // reported. Refusing to mask them was honest but useless: the reviewer sees a
  // name twice and can do nothing about it but erase by hand.
  //
  // A box is synthesised at the median size of the ones that DID match, and
  // then grown to the ink like any other. It is a guess about extent, not about
  // position: on a white drawing a slightly generous white rectangle costs
  // nothing, while a doubled room name costs the whole file.
  //
  // CENTRED ON THE INK, NOT ON THE LABEL, and that distinction is the whole fix.
  // This used `l.x`/`l.y`, on the reasoning that "an unmatched label still sits
  // where the extraction anchored it". True until the reviewer drags it, which
  // is what Review is for. Every moved label then took its mask with it: white
  // painted over clean linework at the new spot, and the tracing's own name
  // left uncovered at the old one. Reported as labels doubled up and lines
  // erased by themselves.
  //
  // `ink` is recorded at extraction and never moves (src/review/state.js).
  //
  // RESOLVING INK BY LABEL INDEX WAS TRIED AND IS WRONG. `s${i}` is assigned
  // from the extraction's own array at creation, so `spaces[i].anchor` looks
  // like the matching spot — and on a floor that has since been re-traced, or
  // whose labels were edited, it is not. Measured on The Avi Top: the index put
  // COVERED DECK's ink at 0.750,0.180 when the room sits at 0.305,0.171, and
  // BEDROOM-1's at the opposite corner from the bedroom. Masks then landed on
  // clean drawing and erased it, which is the defect this was meant to fix.
  //
  // So there is no fallback. A label either carries `ink`, recorded beside its
  // own name and never moved, or it gets no synthesised mask at all. The
  // tracing's text then shows through and the note points at Erase, which is a
  // visible imperfection rather than an invisible hole in someone's plan.
  const boxes = placed.map((l) => l.fitBox);
  const midW = median(boxes.map((b) => b.w)), midH = median(boxes.map((b) => b.h));
  const maskBox = (l) => {
    if (l.fitBox && l.fitBox.w > 0) return l.fitBox;
    const at = l.ink;
    if (!midW || !at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
    return { x: at.x - midW / 2, y: at.y - midH / 2, w: midW, h: midH };
  };

  // MEASURED TEXT WINS OVER MATCHED TEXT, when the caller has measured any.
  //
  // A `fitBox` is where the anchor matcher THINKS this label's name was drawn,
  // and it can be wrong. `inkBoxes` are runs of text found in the image itself,
  // with no matching step to get wrong.
  //
  // THE ASYMMETRY IS THE WHOLE ARGUMENT, not the hit rate. Measured on The Avi
  // Main, 9 of 10 matched boxes do land on text, so the matcher is not badly
  // broken. But when one misses, it paints white over whatever happens to be
  // there — a wall, a fixture, a dimension line — and a hole in someone's plan
  // is invisible to them and unrecoverable. A measured box can only ever be
  // text, so its worst case is a room name left showing, which the reviewer can
  // see and Erase.
  //
  // A wrong mask costs the drawing; a missing mask costs a glance.
  // TWO SETS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. Sizing a label needs the
  // RUN — the whole word, whose height is the type size the tracing used.
  // Masking needs the LETTERS, because a run's box spans from the first letter
  // to the last and takes the drawing between them with it: measured across ten
  // wireframes, between 2% and 27% of the ink a run-box mask erased was the
  // drawing rather than the lettering. See coverBakedText in src/style-client.js,
  // which is where these letters come from.
  const masks = maskBoxes?.length ? maskBoxes : inkBoxes;
  const measured = Boolean(masks && masks.length);
  const boxesToMask = measured
    ? masks.map((t) => ({ x: t.x - t.w / 2, y: t.y - t.h / 2, w: t.w, h: t.h }))
    : drawn.map(maskBox).filter(Boolean);

  // A MEASURED BOX IS ALREADY THE RIGHT SIZE, so it is neither padded by a
  // percentage of the sheet nor grown outward.
  //
  // Both of those exist for the matcher's boxes, which were narrow and could
  // not be trusted to be the whole word — `PAD` is 1% of the drawing's width,
  // about 20px on a 2048px sheet, against a name box some 80px wide, and
  // `grownToInk` then walks further while the strip at the edge is partly
  // inked. A wall crossing that strip fills less than the 55% cutoff and reads
  // as a letter, so the mask keeps going and takes the wall with it.
  //
  // Measured over seven wireframes, growth alone swallowed 69 more pieces of
  // non-text ink (320 to 389) for about 5px of extra width per box. A run
  // measured from the ink needs neither: a couple of pixels covers the
  // antialiased edge of the glyphs and nothing else.
  const EDGE = 2;
  cx.save();
  cx.fillStyle = '#ffffff';
  for (const fb of boxesToMask) {
    const px = {
      x: place.x + fb.x * place.w, y: place.y + fb.y * place.h,
      w: fb.w * place.w, h: fb.h * place.h,
    };
    if (measured) {
      cx.fillRect(px.x - EDGE, px.y - EDGE, px.w + EDGE * 2, px.h + EDGE * 2);
      continue;
    }
    const r = grownToInk(cx, {
      x: place.x + (fb.x - PAD) * place.w, y: place.y + (fb.y - PAD) * place.h,
      w: (fb.w + PAD * 2) * place.w, h: (fb.h + PAD * 2) * place.h,
    }, place);
    cx.fillRect(r.x, r.y, r.w, r.h);
  }
  cx.restore();

  drawLabels(cx, drawn, place, { width, height }, brand, rec);
  return {
    printed: drawn.length,
    // Rooms covered by a synthesised box rather than a located one. Still worth
    // saying — the extent is a guess, so a long name may peek out — but it is
    // no longer the "your name is printed twice" case it used to describe.
    keptFromTracing: drawn.filter((l) => !(l.fitBox && l.fitBox.w > 0)).length,
  };
}

/**
 * What the reviewer is told, under the download button.
 *
 * States what happened, never that the result is correct, and names what it
 * could not do — a partly relabelled drawing that reads as finished is worse
 * than one that admits the gap. The eraser taught this: a guard that worked but
 * said nothing read as broken.
 */
export function stampNote(printed, keptFromTracing) {
  const base = 'A record of the plan exactly as you confirmed it.';
  if (!printed && !keptFromTracing) return base;
  let msg = printed
    ? `Your ${printed} confirmed label${printed > 1 ? 's are' : ' is'} printed on it, in your brand font.`
    : 'None of your labels could be matched to the text in the drawing.';
  if (keptFromTracing) {
    // Not "keeps the tracing's name" any more — ours IS printed there. What
    // survives is the tracing's version UNDERNEATH, because its box could not
    // be located to cover it. Saying it plainly is what points at Erase.
    msg += ` On ${keptFromTracing}, the old text was covered by estimate, so a long `
      + 'name may still show through. Erase in Review clears anything left.';
  }
  return msg;
}
