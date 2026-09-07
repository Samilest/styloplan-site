// Label anchors, measured from the wireframe instead of trusted from the model.
//
// The extraction's own anchor coordinates proved unusable on real plans: on
// The Jordan they drifted progressively downward (y reported as 0.20/0.40/0.59
// for rooms actually at 0.13/0.28/0.43), putting 4 of 6 labels outside their
// room and one outside the building entirely. The values looked like a guessed
// grid, not a measurement.
//
// The wireframe, however, already draws each room's name INSIDE that room, in
// the clear area. So we read the text back out of the pixels: find glyph-sized
// ink blobs, group them into lines, pair each name line with the dimension line
// beneath it, and use the name line's centre as the anchor. Identity comes from
// glyph count, which matches the label's letter count exactly, with the model's
// coarse position used only to break ties.

import { inkMap as sharedInkMap } from './ink.js';

const INK_LUM = 128;
const SAMPLE_W = 900;

/**
 * Detect drawn label blocks in a wireframe.
 * @returns {{x:number,y:number,glyphs:number,width:number}[]} name-line centres,
 *          normalized 0..1, ordered top-to-bottom.
 */
export function detectLabelBlocks(wireframeImg) {
  const { ink, w, h } = inkMap(wireframeImg);
  const comps = components(ink, w, h);
  if (!comps.length) return [];

  // The wall network is one huge connected component; glyphs are small and short.
  comps.sort((a, b) => b.area - a.area);
  const walls = comps[0];
  const glyphs = comps.filter((c) =>
    c !== walls && c.h >= 5 && c.h <= 22 && c.w <= 40 && c.area >= 8);

  // Group glyphs into text lines (same row, horizontally adjacent).
  glyphs.sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));
  const lines = [];
  for (const g of glyphs) {
    const gMidY = (g.minY + g.maxY) / 2;
    const line = lines.find((L) =>
      Math.abs((L.minY + L.maxY) / 2 - gMidY) < 9 &&
      g.minX - L.maxX < 26 && g.minX > L.minX - 60);
    if (line) {
      line.minX = Math.min(line.minX, g.minX); line.maxX = Math.max(line.maxX, g.maxX);
      line.minY = Math.min(line.minY, g.minY); line.maxY = Math.max(line.maxY, g.maxY);
      line.n++;
    } else {
      lines.push({ minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, n: 1 });
    }
  }

  // A label block is a name line, optionally with a dimension line just below.
  // Keep the name line: it is what the composite draws first.
  const text = lines
    .filter((L) => L.n >= 2 && (L.maxX - L.minX) >= 14)
    .sort((a, b) => a.minY - b.minY);
  const used = new Set();
  const blocks = [];
  for (let i = 0; i < text.length; i++) {
    if (used.has(i)) continue;
    const L = text[i];
    const lcx = (L.minX + L.maxX) / 2;
    // The extent of the whole block, name and dimension together. It starts as
    // the name line and grows to swallow the dimension beneath it.
    const ext = { minX: L.minX, maxX: L.maxX, minY: L.minY, maxY: L.maxY };
    for (let j = i + 1; j < text.length; j++) {
      if (used.has(j)) continue;
      const M = text[j];
      const mcx = (M.minX + M.maxX) / 2;
      // a dimension line sits directly under its name, roughly centred on it
      if (M.minY - L.maxY >= -2 && M.minY - L.maxY < 14 && Math.abs(mcx - lcx) < 40) {
        used.add(j);
        ext.minX = Math.min(ext.minX, M.minX); ext.maxX = Math.max(ext.maxX, M.maxX);
        ext.minY = Math.min(ext.minY, M.minY); ext.maxY = Math.max(ext.maxY, M.maxY);
        break;
      }
    }
    // `x`, `y`, `glyphs` and `width` all describe the NAME LINE, because that
    // is what the anchor points at and what auto-fit budgets against. `box`
    // describes the whole block, because its consumers erase or cover ink and
    // half a cover is worse than none — it was the name line alone, and Review's
    // masking chip left three visible rows of the dimension string showing
    // underneath it on every label.
    blocks.push({
      x: lcx / w,
      y: ((L.minY + L.maxY) / 2) / h,
      glyphs: L.n,
      width: (L.maxX - L.minX) / w,
      box: {
        x: ext.minX / w, y: ext.minY / h,
        w: (ext.maxX - ext.minX) / w, h: (ext.maxY - ext.minY) / h,
      },
    });
  }
  return blocks;
}

// Direction letters ("UP", "DN") next to a staircase are the one piece of text
// Prompt 2 keeps reproducing despite forbidding it three times. They carry no
// information the styling needs — the prompt takes stair direction from the
// ARROW, which is a graphic element and survives — so we delete the letters
// from the wireframe before styling and remove the temptation entirely.
// Room names are deliberately left alone: the prompt uses them to decide what
// furniture belongs in each space.
const MAX_DIRECTION_GLYPHS = 3;

/**
 * @returns {{canvas:HTMLCanvasElement, stripped:number}} a styling-ready copy
 *          of the wireframe with direction letters painted out.
 */
export function stripDirectionLabels(wireframeImg, roomLabels = []) {
  const blocks = detectLabelBlocks(wireframeImg);
  const claimed = new Set();
  // Re-run the label match so a genuine room name is never mistaken for a
  // direction marker.
  if (roomLabels.length) {
    const { assignedBlocks } = matchLabelsToBlocks(roomLabels.filter((l) => l.name), blocks);
    for (const bi of assignedBlocks) claimed.add(bi);
  }

  const canvas = document.createElement('canvas');
  canvas.width = wireframeImg.naturalWidth;
  canvas.height = wireframeImg.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(wireframeImg, 0, 0);

  // Prompt 1 mandates a plain white background, so that is what we paint back.
  ctx.fillStyle = '#ffffff';
  let stripped = 0;
  blocks.forEach((b, i) => {
    if (claimed.has(i) || b.glyphs > MAX_DIRECTION_GLYPHS) return;
    const pad = 0.004;
    ctx.fillRect(
      (b.box.x - pad) * canvas.width, (b.box.y - pad) * canvas.height,
      (b.box.w + pad * 2) * canvas.width, (b.box.h + pad * 2) * canvas.height);
    stripped++;
  });
  return { canvas, stripped };
}

/**
 * Replace each label's anchor with the position the wireframe actually drew it.
 * Labels that cannot be matched keep their original anchor and are reported.
 * @returns {{labels:Array, matched:number, unmatched:string[]}}
 */
export function snapLabelsToWireframe(labels, wireframeImg) {
  const blocks = detectLabelBlocks(wireframeImg);
  const named = labels.filter((l) => l.name);
  // `named` may be empty and there is still work to do — the second pass places
  // labels that have no name at all, which is the whole reason it exists.
  if (!blocks.length || !labels.length) {
    return { labels, matched: 0, unmatched: named.map((l) => l.name) };
  }
  const { assignment, assignedBlocks } = matchLabelsToBlocks(named, blocks);
  placeLeftovers(labels, blocks, assignment, assignedBlocks);

  const unmatched = [];
  const out = labels.map((l) => {
    const b = assignment.get(l);
    if (!b) { if (l.name) unmatched.push(l.name); return l; }
    // `fitWidth` is how wide the wireframe drew this name — i.e. a width the
    // image model already judged to fit inside that room. The compositor uses
    // it to stop long names overflowing small rooms. It is a property of the
    // TEXT, so it is dropped when the text is edited (see review/state.js).
    //
    // `fitBox` is a different fact with a different lifetime: the full bounding
    // box of the ink the wireframe actually laid down here, name and dimension
    // together. Review's editable chip is painted opaque over it to mask it,
    // and that mask must survive a rename — renaming is exactly when the old
    // baked text most needs covering. Measured before it existed: three pixel
    // rows of the wireframe's own dimension string protruded below every chip,
    // reading as blurred, doubled text on the one page whose entire job is
    // letting someone read a value clearly.
    //
    // AN ORDER MATCH CARRIES NEITHER OF THEM, only the position.
    //
    // Both of these say "this is the ink THIS label's text came from", and the
    // second pass does not establish that — it pairs by rank, not by evidence
    // about the string. Handing them over anyway would have Review paint its
    // opaque chip over whatever ink the guessed block sits on, which is drawing
    // on the customer's plan to hide something that was never doubled. That
    // exact failure has been paid for once already: masking from the matcher's
    // association put 7 of 11 boxes on another room's text on The Avi Top, and
    // left a hole in the drawing beside a doubled name.
    //
    // A label placed by order therefore gets moved onto real ink and nothing
    // more. It is no worse masked than it was before the second pass existed,
    // when it was not placed at all.
    const out = l._viaOrder
      ? { ...l, x: b.x, y: b.y, anchorSource: 'wireframe-order' }
      : { ...l, x: b.x, y: b.y, fitWidth: b.width, fitBox: b.box, anchorSource: 'wireframe' };
    delete out._viaOrder;
    return out;
  });
  return { labels: out, matched: assignment.size, unmatched };
}

/**
 * Whatever the first pass could not place, paired to whatever blocks it did not
 * use, IN TOP-TO-BOTTOM ORDER.
 *
 * WHY THIS EXISTS. The first pass scores on glyph count, so it can only consider
 * labels that HAVE a name — `named` above. A space the extraction could not name
 * was therefore never a candidate at all, and kept the model's raw anchor. That
 * is not cosmetic: a label with no name still prints when it has a dimension
 * (`isPrintable` in compositor.js), so an unplaced anchor prints a transcribed
 * dimension somewhere it does not belong. Measured over seven wireframes, every
 * single unnamed label went unplaced — 60 of 170.
 *
 * WHY ORDER AND NOT POSITION. The model's absolute anchors are not a
 * measurement: on Plan A its fifteen anchors took three x values and three y
 * values between them, and on The Jordan they drifted progressively downward.
 * Its top-to-bottom ORDER, though, has never been wrong, and ordering survives
 * both of those failures. Measured over seven wireframes and both failure modes,
 * as labels landing on their own block out of 170:
 *
 *     before, named only        103   (60 never placed at all)
 *     nearest-position pairing  143
 *     order pairing             157
 *
 * Nearest position is the obvious idea and it is the worse one, because it trusts
 * the coordinate that is known to be wrong. See test/anchor-match.html.
 *
 * The pairing is deliberately unconditional rather than distance-capped. The
 * alternative to a wrong block is not a right one, it is the model's own anchor,
 * which is what put labels outside the building in the first place. A label on
 * the wrong room's ink is inside the house and reads as obviously misplaced;
 * both are for the reviewer to drag, and only one is visible on the plan.
 *
 * `anchorSource` records which pass placed it, because a name-matched anchor and
 * an order-guessed one are not the same claim.
 */
function placeLeftovers(labels, blocks, assignment, assignedBlocks) {
  const leftLabels = labels.filter((l) => !assignment.has(l));
  const leftBlocks = blocks.filter((_, i) => !assignedBlocks.has(i));
  if (!leftLabels.length || !leftBlocks.length) return;

  const byY = (a, b) => a.y - b.y;
  const ls = [...leftLabels].sort(byY);
  const bs = [...leftBlocks].sort(byY);
  for (let i = 0; i < Math.min(ls.length, bs.length); i++) {
    assignment.set(ls[i], bs[i]);
    ls[i]._viaOrder = true;
  }
}

// Greedy assignment of extracted labels to drawn text blocks. Glyph count is
// the dominant signal — it matched each label's letter count exactly on real
// plans — and the model's coarse anchor only separates same-length names.
// @returns {{assignment:Map, assignedBlocks:Set<number>}}
function matchLabelsToBlocks(named, blocks) {
  const letterCount = (l) => String(l.name).replace(/[^A-Za-z0-9]/g, '').length;
  const pairs = [];
  named.forEach((label, li) => {
    const letters = letterCount(label);
    blocks.forEach((b, bi) => {
      pairs.push({
        li, bi,
        cost: Math.abs(b.glyphs - letters) * 0.5 + Math.hypot(b.x - label.x, b.y - label.y),
      });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost);

  const takenLabel = new Set(), assignedBlocks = new Set();
  const assignment = new Map();
  const picks = [];
  for (const p of pairs) {
    if (takenLabel.has(p.li) || assignedBlocks.has(p.bi)) continue;
    // a wildly disagreeing glyph count means this is not the same string
    const letters = letterCount(named[p.li]);
    if (Math.abs(blocks[p.bi].glyphs - letters) > Math.max(2, letters * 0.4)) continue;
    takenLabel.add(p.li); assignedBlocks.add(p.bi);
    picks.push({ label: named[p.li], block: blocks[p.bi] });
  }

  // Uncross: the model gets absolute positions wrong but has never got the
  // top-to-bottom ORDER wrong, so when two assignments cross vertically
  // (label A sits above label B in the extraction while A's block sits below
  // B's) the blocks are swapped. Same-length names (ENSUITE / LAUNDRY, both 7
  // letters) otherwise trade places on nothing more than anchor noise.
  //
  // The swap must be glyph-NEUTRAL. Glyph count is measured from the wireframe
  // and is exact; the model's y is an estimate. Allowing a merely "legal" swap
  // let noisy anchors overrule an exact match and put GARAGE (6 letters) on the
  // 8-glyph block while FLEX ROOM (8) took the 6-glyph one — the two rooms
  // traded places on a real customer plan. Only ever swap when doing so costs
  // the glyph match nothing.
  const glyphErr = (label, block) => Math.abs(block.glyphs - letterCount(label));
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const a = picks[i], b = picks[j];
        const crossed = Math.sign(a.label.y - b.label.y) * Math.sign(a.block.y - b.block.y) < 0;
        if (!crossed) continue;
        const before = glyphErr(a.label, a.block) + glyphErr(b.label, b.block);
        const after = glyphErr(a.label, b.block) + glyphErr(b.label, a.block);
        if (after > before) continue;
        [a.block, b.block] = [b.block, a.block];
        swapped = true;
      }
    }
  }
  for (const p of picks) assignment.set(p.label, p.block);
  return { assignment, assignedBlocks };
}

function inkMap(img) {
  const w = SAMPLE_W;
  const h = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth)));
  // detectPolarity is OFF on purpose: this only ever reads a Prompt 1 wireframe,
  // which is black-on-white by mandate. Turning it on would be a behaviour
  // change, not a cleanup — it belongs in the threshold reconciliation, which
  // the fixture corpus exists to make safe.
  return sharedInkMap(img, { width: w, lum: INK_LUM, detectPolarity: false });
}

// 8-connected components of the ink mask.
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
