// Red line 1 says the image AI never renders text. Until now that was enforced
// only by the prompt asking three times — nothing checked the output.
//
// It is not a hypothetical. The wireframe deliberately KEEPS room names (the
// styling model uses them to decide what furniture belongs in each space), and
// sometimes the model copies them straight through into the styled render. The
// compositor then draws the same names on top, so every room label appears
// twice, slightly offset — which is exactly what a customer would notice first.
// (The tell that it is the render and not a duplicated label: annotations we
// never composite — "TUB/SHOWER", "REF.", "LAUNDRY STACKER" — appear once,
// while room names appear twice.)
//
// Doubled labels are the most visible symptom, but not the only harm. The same
// renders carry annotations we never composite — and the model MISSPELLS them:
// a real render came back with "TUB/ SHONER" and "CICL.". Baked text is also in
// the wrong font, uneditable, and unverifiable. So the verdict is any word-like
// run anywhere, which is what red line 1 actually says.
//
// Naive glyph detection cannot do that: against five known-good renders,
// furniture detail produced up to five phantom "text lines". The separator is
// glyph-height consistency plus a minimum run length — with both, the same five
// renders come back completely clean while the wireframe's real text still
// yields eleven lines.

// Everything is measured on a 900px-wide sample, so the guard behaves the same
// at 1K or 2K output. Measured sensitivity floor: text is caught from about
// 1.3% of image width upward (≈11px on the sample) and missed at 1.0%. Room
// names run 2–3% and plan annotations 1.5–2%, so real cases sit above it.
import { inkMap as sharedInkMap } from './ink.js';

const SAMPLE_W = 900;
const INK_LUM = 128;          // dark-on-light
const INK_LUM_INVERTED = 150; // light-on-dark (Dark theme)
const MIN_GLYPHS = 4;         // shorter runs are furniture detail, not a word
const ANCHOR_R = 0.06;        // naming which label a copy landed on, for the message
// Letters in a word share a height; furniture detail does not. Measured on real
// data: the wireframe's own text has a height coefficient-of-variation of
// 0.175, while the car drawn in a garage — which produced a run of twelve
// glyph-sized shapes right on the GARAGE anchor and a false positive — sits at
// 0.426. Ink fill ratio, the obvious alternative, does NOT separate them
// (0.429 vs 0.417).
const MAX_HEIGHT_CV = 0.30;

/**
 * Does this styled render contain the room names baked into it?
 *
 * THIS IS A TRIGGER, NOT A VERDICT — and `runs` is what makes the difference.
 *
 * The detector under it has high recall and poor precision: it fires on
 * anything that looks like a row of similar-sized marks, which includes a car
 * in a garage (corpus case "Madison dark"), a sink, a toilet, and a closet rod
 * with hangers (Plan A, all three attempts). Two rounds of threshold tuning
 * each closed one case and left the class open, so a third is not the answer.
 *
 * Returning WHERE it fired lets a caller crop those places and get a second
 * opinion on a 200px square instead of on a whole floor plan. The thresholds
 * stay exactly where they are, so the false-negative side is unchanged by
 * construction; only the ability to overturn a refusal is new.
 *
 * @param {HTMLImageElement} styledImg
 * @param {Array<{name:string,x:number,y:number}>} labels confirmed labels
 * @returns {{ok:boolean, hits:string[], words:number, runs:Array<Object>}}
 */
export function detectBakedText(styledImg, labels = []) {
  const words = textLines(styledImg, undefined, false)
    .filter((t) => t.glyphs >= MIN_GLYPHS && t.heightCV <= MAX_HEIGHT_CV);

  // Which confirmed labels the render copied — used only to make the warning
  // concrete. The verdict does NOT depend on it: text anywhere is a red line 1
  // violation, not only text that happens to collide with a label.
  const hits = labels.filter((l) => l.name && words.some((t) =>
    Math.hypot(t.x - l.x, t.y - l.y) <= ANCHOR_R)).map((l) => l.name);

  return { ok: words.length === 0, hits, words: words.length, runs: words };
}

/** Glyph clusters grouped into horizontal runs, normalized 0..1. */
function textLines(img, sampleWidth, thinEscape = true, glyphsOnly = false) {
  const { ink, w, h } = inkMap(img, sampleWidth);
  const comps = components(ink, w, h);
  if (!comps.length) return [];
  comps.sort((a, b) => b.area - a.area);
  const walls = comps[0];
  // The size limits were written against the 900px sample, so they scale with
  // it — otherwise reading at native resolution simply moves the cutoff.
  const k = w / SAMPLE_W;
  // THE AREA TEST HAS AN ASPECT ESCAPE, for characters that are tall and thin.
  //
  // `area >= 8k²` is there to drop specks. A numeral 1, an apostrophe stem or an
  // inch mark is the right HEIGHT for the line it sits on and still misses that
  // area, so it never joined a run — and a dimension came out with its middle
  // covered and `1` and `"` still showing, which is what the download returned.
  //
  // Absorbing any small ink near a run was tried instead and is much worse: it
  // took n1's drawing loss from 5.3% to 11.7%, because on a dense sheet there is
  // always something small nearby. Loosening the test for genuinely letter-
  // shaped components is the narrow version of the same idea.
  //
  // THE ESCAPE IS FOR COVERING TEXT, NOT FOR FINDING IT — hence `thinEscape`.
  //
  // It was added for the wireframe download, so that the inch mark in 13'-6"
  // gets masked along with the digits. The GUARD does not need it: to know a
  // word is present it is enough to see the word's letters, which are blobs.
  // Sharing it cost three false positives elsewhere in the corpus, and nobody
  // saw them because the corpus summary renders after the last row.
  //
  // Measured over the corpus, words found with the escape then without:
  //
  //     geena light      1 -> 0     plan A refused 1   1 -> 0
  //     jordan dark      1 -> 0     plan A refused 2   1 -> 0
  //     madison (cars)   4 -> 3     plan A refused 3   3 -> 1
  //     geena dark       0 -> 0
  //
  // Six of seven false-positive runs are the escape's doing, including two of
  // Plan A's three attempts entirely. Recall is untouched: the wireframes, which
  // are real rendered text and the only positives this corpus has, still come
  // back at 14 and 15 words. A word made only of tall thin strokes is not a
  // word, so there is nothing for the guard to lose here.
  //
  // A near miss to not repeat: "reject runs that are ENTIRELY escape" was tried
  // first and matched only 1 of 6, because a run with two real letters and five
  // escapes exists only because the escapes glued it together and pushed it past
  // the four-glyph floor. `solidGlyphs` counts what survives, not what caused
  // the run.
  // The remaining false positive is not the escape's: Plan A's closet rod, a row
  // of hangers, at (0.257, 0.440) in all three attempts.
  const solidish = (c) => c.area >= 8 * k * k;
  const thinish = (c) => c.h >= 5 * k && c.h / Math.max(1, c.w) >= 2.5;
  const glyphish = (c) => solidish(c) || (thinEscape && thinish(c));
  const sized = comps.filter((c) =>
    c !== walls && c.h >= 5 * k && c.h <= 22 * k && c.w <= 40 * k && glyphish(c));
  // TWO PIECES OF INK IN THE SAME PLACE ARE ONE SYMBOL, NOT TWO LETTERS.
  //
  // Letters in a word sit beside each other; they never share a centre. A
  // cooktop burner does: it is drawn as a ring inside a ring, and both rings
  // are the right size and shape to pass every test above, so a row of burners
  // reads as a row of type and the hob goes white with it. Measured across
  // eleven wireframes, 0.46% of the glyphs inside certain words are nested this
  // way against 8 pieces of fixture that are.
  const glyphs = sized.filter((c) => !sized.some((o) => o !== c
    && o.w < c.w * 0.92 && o.h < c.h * 0.92
    && Math.abs((o.minX + o.maxX) - (c.minX + c.maxX)) <= c.w * 0.24
    && Math.abs((o.minY + o.maxY) - (c.minY + c.maxY)) <= c.h * 0.24));

  if (glyphsOnly) return { glyphs, w, h };

  glyphs.sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));
  const lines = [];
  for (const g of glyphs) {
    const midY = (g.minY + g.maxY) / 2;
    const line = lines.find((L) =>
      Math.abs((L.minY + L.maxY) / 2 - midY) < 9 * k &&
      g.minX - L.maxX < 26 * k && g.minX > L.minX - 60 * k);
    if (line) {
      line.minX = Math.min(line.minX, g.minX); line.maxX = Math.max(line.maxX, g.maxX);
      line.minY = Math.min(line.minY, g.minY); line.maxY = Math.max(line.maxY, g.maxY);
      line.n++;
      line.solid += solidish(g) ? 1 : 0;
      line.heights.push(g.h);
    } else {
      lines.push({ minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, n: 1,
        solid: solidish(g) ? 1 : 0, heights: [g.h] });
    }
  }
  return lines.map((L) => ({
    x: ((L.minX + L.maxX) / 2) / w,
    y: ((L.minY + L.maxY) / 2) / h,
    // The run's extent, not just its centre. The text guard only ever needed to
    // know THAT there was text; the wireframe download needs to cover it, and
    // covering needs a box.
    w: (L.maxX - L.minX + 1) / w,
    h: (L.maxY - L.minY + 1) / h,
    glyphs: L.n,
    // How many of them earned their place on area rather than on the tall-and-
    // thin escape. A word is mostly blobs; a row of identical strokes is not.
    solidGlyphs: L.solid,
    heightCV: cv(L.heights),
  }));
}

/**
 * Every run of baked text in a drawing, as boxes to paint over.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE MATCHER. The wireframe download used to
 * mask using each label's `fitBox`, the box the anchor matcher tied to that
 * label. Measured on The Avi Top, 7 of 11 of those boxes point at text
 * belonging to a different room: DINING's box sits 0.379 away from DINING, in
 * the middle of the plan. So the wrong text was covered and the right text was
 * left, which is a hole in the drawing and a doubled name at once.
 *
 * Masking does not need the association at all. It needs the SET of places the
 * tracing wrote something, and that is measurable from the image with no
 * matching step to get wrong.
 *
 * WHAT IT DOES NOT FIND YET, measured on The Avi Top's wireframe. The glyph
 * detector under this was tuned for the STYLED render, where the text guard
 * needs it, and a wireframe's lettering is thinner and smaller. ENSUITE comes
 * back as a clean 7-glyph run; DINING breaks into runs of 3 and 2, CLOSET into
 * 3, and W.I.C. into 2 — so those fall under MIN_GLYPHS and are left showing.
 *
 * Sideways names are missed too. Running the same grouping over a transposed
 * copy does find them, and it was tried: it also invented boxes over columns of
 * fixture linework, which would erase drawing. Reverted, because a mask that
 * lands on the plan is the one failure this whole approach exists to avoid.
 *
 * Both gaps leave a name visible, which the reviewer can see and Erase. Neither
 * puts a hole in anybody's plan.
 */
// COVERING TEXT AND DETECTING TEXT WANT DIFFERENT LIMITS.
//
// The guard's four-glyph floor exists so a stray fixture mark never gets called
// text and fails a paid render. Covering has the opposite cost: a missed run is
// a room name printed twice on the customer's drawing, while an over-eager box
// paints white between letters where there is nothing to lose.
//
// Measured across nine wireframes — the three New Test plans, Geena, Jordan,
// Another Map, and three Avi sheets — as the share of glyph ink that lands
// inside a mask:
//
//     min 4 (the guard's)   80.9%
//     min 3                 84.5%
//     min 2                 90.8%
//
// Two is what short names need: W.I.C. traces to two components, DN and 16R to
// three. The ink swallowed alongside rises from 289 pieces to 356 across all
// nine, and nearly all of it is punctuation inside the very text being covered
// — the marks in 13'-6" do not pass a glyph test either.
//
// The tall-and-thin escape is the same split in a second place: covering keeps
// it, because an inch mark left showing is a visible defect on the drawing; the
// guard drops it, because it never needed to see one. See `thinEscape`.
//
// AND THEN TWO WAS RAISED TO THREE, because a pair of blobs in a row is not a
// word — it is a fixture. The rotated pass below worked this out first and set
// its own floor at three; the row pass kept two, and went on erasing things.
//
// Every two-glyph run on Saman's own tracing of The Sky, looked at one by one:
//
//     the toilet and the cabinet beside it        not text
//     three runs of dashed cabinet line           not text
//     the vanity in the lower bath                not text
//     part of H.W.T.                              text
//     CL.                                         text
//
// Five fixtures for two words. The vanity is the one he reported as his sink
// being erased, and it is the fourth report of this kind after the toilet, the
// kitchen sink and the cooktop.
//
// What it costs: on all ten corpus wireframes plus his, the text GUARD's
// verdict on the covered drawing does not change — nothing newly refuses. And
// the second pass in style-client.js covers a label's name at its own recorded
// position when this pass misses it, which is exactly the case for a short name
// like CL.: it has a label. A fixture does not, so it stays safe.
//
// The cost rule this follows is the one written above and in stamp.js: a name
// left showing costs a refused render, which is free to retry, while a hole in
// the customer's plan is invisible to them and ships.
const MASK_MIN_GLYPHS = 3;

export function textBoxes(img, opts = {}) {
  const min = opts.minGlyphs ?? MASK_MIN_GLYPHS;
  const maxCV = opts.maxHeightCV ?? MAX_HEIGHT_CV;
  // AT THE DRAWING'S OWN RESOLUTION, not the guard's 900px sample.
  //
  // The sample exists so the text GUARD runs fast on a styled render, where it
  // only has to answer "is there any text". Reading a wireframe to cover its
  // text is a different job: a 2048px sheet squeezed to 900 turns a 20px letter
  // into 9px and thins its strokes until the component filter drops them.
  //
  // Measured on The Avi Top: CLOSET is 3 glyph components at 900 and 6 at
  // native; DINING is 5 and splits into two runs, against 6 in one run. That is
  // a resolution bottleneck, not a threshold to tune per plan.
  const wide = Math.min(2400, Math.max(900, img.naturalWidth || img.width || 900));
  const across = textLines(img, wide).filter((t) => t.glyphs >= min && t.heightCV <= maxCV);
  if (!opts.rotated) return across;

  // TEXT THAT RUNS UP THE PAGE.
  //
  // `textLines` groups glyphs that share a ROW, which is what a line of text is
  // — until the sheet turns it ninety degrees. Every architectural drawing does
  // this: the dimension strings along the left and right edges read bottom to
  // top. On Plan A that is 12'-1 4" and 17'-2" standing on the right margin,
  // and the cover walked straight past them and handed them to the model, which
  // is the same ink that got six renders refused.
  //
  // Turning the drawing and asking the same question is the whole fix. It reads
  // rotated text with the detector that already works rather than a second
  // detector that would have to be right about the same things all over again.
  //
  // OPT-IN, because the callers want different things. The cover must find every
  // letter or the model sees one. dim-source.js asks whether a room's size is
  // written under its name — an edge dimension is not, and feeding it vertical
  // runs would answer a question it did not ask.
  // A LONGER RUN THAN THE ROW PASS ASKS FOR.
  //
  // Turned on its side, a column of similar blobs reads like a line of type, and
  // a floor plan is full of them: measured across the six wireframes, every
  // two-glyph vertical run is either a duplicate of text the row pass already
  // covered or a fixture — Jordan's double sink and Madison's basin both came
  // back as "text" this way. Covering a sink is not a near miss. It is the
  // defect Saman reported as parts of the plan going missing, arriving by a new
  // route.
  //
  // Three is where the corpus separates cleanly: it drops every stray and keeps
  // the run this pass exists for, Plan A's 12'-1 4" standing on the right
  // margin at six glyphs.
  const turned = rotate90(img);
  const tall = Math.min(2400, Math.max(900, turned.width));
  const upMin = Math.max(min, 3);
  const up = textLines(turned, tall).filter((t) => t.glyphs >= upMin && t.heightCV <= maxCV);
  // Back to the drawing's own frame: the rotation sent (x, y) to (1 - y, x), so
  // it comes home as (y', 1 - x'), with width and height changing places.
  return across.concat(up.map((t) => ({
    ...t, x: t.y, y: 1 - t.x, w: t.h, h: t.w, vertical: true,
  })));
}

/**
 * Every letter-shaped piece of ink in the drawing, before anything groups them
 * into lines.
 *
 * WHY THE STAGE BEFORE A RUN IS WORTH HAVING. A run is glyphs that line up, and
 * a room name drawn across furniture does not line up — that is exactly why the
 * cover in style-client.js has a second pass that places a box at a label's own
 * anchor. That pass paints on trust, and on Plan A it painted white over the
 * master bath's toilet: the name it was covering was not there, and nothing
 * looked before the paint went down.
 *
 * So the second pass now asks this: is there anything HERE that could be a
 * letter? Same size window and the same escape as the run test uses, so a glyph
 * this accepts is a glyph that file would accept; only the lining-up is skipped.
 *
 * @returns {Array<{x,y,w,h}>} normalised boxes, centre-based like textBoxes
 */
export function glyphBoxes(img) {
  const wide = Math.min(2400, Math.max(900, img.naturalWidth || img.width || 900));
  const { glyphs, w, h } = textLines(img, wide, true, true);
  return glyphs.map((g) => ({
    x: ((g.minX + g.maxX) / 2) / w,
    y: ((g.minY + g.maxY) / 2) / h,
    w: g.w / w,
    h: g.h / h,
  }));
}

/** The drawing turned a quarter turn clockwise, on a canvas. */
function rotate90(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = h; c.height = w;
  const ctx = c.getContext('2d');
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  return c;
}


/** Coefficient of variation — how uneven this run's glyph heights are. */
function cv(values) {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return 1;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// Polarity-aware: a Dark-theme render is light-on-dark, and a fixed threshold
// would read its background as ink and its walls as background.
function inkMap(img, width = SAMPLE_W) {
  return sharedInkMap(img, { width, lum: INK_LUM, lumInverted: INK_LUM_INVERTED });
}

function components(ink, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const out = [];
  const stack = [];
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (let s = 0; s < w * h; s++) {
    if (!ink[s] || lab[s] !== -1) continue;
    const id = out.length;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    stack.push(s); lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      area++;
      const px = p % w, py = (p / w) | 0;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      for (const [dx, dy] of N) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q] && lab[q] === -1) { lab[q] = id; stack.push(q); }
      }
    }
    out.push({ area, minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return out;
}
