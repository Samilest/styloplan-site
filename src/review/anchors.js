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
// ink blobs, group them into lines, stack the centred lines of one label (the
// name, which may wrap, then its dimension), and use the name's centre as the
// anchor. Identity comes from glyph count, which matches the label's letter
// count exactly, with the model's coarse position used only to break ties.

import { inkMap as sharedInkMap } from './ink.js';
import { directionWords } from './direction-letters.js';

const INK_LUM = 128;
// THE TOLERANCES BELOW ARE IN PIXELS OF A 900-WIDE READING, where they were
// set and measured, and are scaled to whatever width the drawing is read at.
//
// IT IS READ AT ITS OWN SIZE (2026-10-05). It used to be shrunk to 900 wide
// first, which is a third of The Star's 2400: its bold names ran together
// (BREAKFAST read as 8 marks, MASTER / BATH as 5 + 3) and the thin dimension
// lines under them broke into specks. Glyph count is how a label finds its
// own name, so counts off by one to three put most of its nineteen labels on
// other rooms' words while the model's own guesses were mostly right. Read at
// full size the letters stand apart; the rules are the same, scaled.
const REF_W = 900;

/**
 * Detect drawn label blocks in a wireframe, read at its own size.
 * @returns {{x:number,y:number,glyphs:number,width:number}[]} name-line centres,
 *          normalized 0..1, ordered top-to-bottom.
 */
export function detectLabelBlocks(wireframeImg) {
  const { ink, w, h } = inkMap(wireframeImg);
  const comps = components(ink, w, h);
  if (!comps.length) return [];
  const s = w / REF_W;

  // The wall network is one huge connected component; glyphs are small and short.
  comps.sort((a, b) => b.area - a.area);
  const walls = comps[0];
  // The smallest glyph is one stroke: an I, as tall as the shortest letter and
  // a pixel wide. So the floor on area grows with the reading's size once,
  // through the height, not twice: scaled as an area it dropped every I on Plan
  // A 2 read at full size, and LIVING came out as four marks.
  const glyphs = comps.filter((c) =>
    c !== walls && c.h >= 5 * s && c.h <= 22 * s && c.w <= 40 * s && c.area >= 8 * s);

  // Group glyphs into text lines (same row, horizontally adjacent).
  //
  // BY PAIRS, NOT BY ARRIVAL (2026-10-05). Lines were grown greedily in
  // top-to-bottom order, so whichever glyph reached the sort first started a
  // line and the others had to fit ITS extent. A quote mark sits higher than
  // the digits beside it and arrives first, and on Plan B's top floor
  // `144" x 168"` came out as two lines: the second, two glyphs long, was a
  // "block" of its own that a label was then placed on. Two glyphs on one row
  // close together are joined whatever order they come in.
  const lines = linesOf(glyphs, s, ink, w);

  // A LABEL BLOCK IS A STACK OF CENTRED LINES: the name, which may wrap, then
  // the dimension under it. It used to be one name line and at most one line
  // below, so a name the tracing wrapped (MASTER / BEDROOM / 96" x 120') read
  // as a six-glyph MASTER with BEDROOM for a dimension, and its real dimension
  // became a block of its own: on Plan B's top floor MASTER BATH matched that
  // dimension line, three rooms away from its own name.
  const text = lines
    .filter((L) => L.n >= 2 && (L.maxX - L.minX) >= 14 * s)
    .sort((a, b) => a.minY - b.minY);
  const used = new Set();
  const blocks = [];
  for (let i = 0; i < text.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const stack = [text[i]];
    const lcx = (text[i].minX + text[i].maxX) / 2;
    for (;;) {
      const last = stack[stack.length - 1];
      // the next line sits directly under the last, roughly centred on the stack.
      // Not a line of two marks: under another line that is a pattern of
      // symbols far more often than a word -- a cooktop's burners, two by
      // three, stacked into one "name" of six on The Sky and took DINING.
      let next = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (used.has(j)) continue;
        const M = text[j];
        if (M.n < 3) continue;
        const gap = M.minY - last.maxY;
        if (gap >= -2 * s && gap < 14 * s && Math.abs((M.minX + M.maxX) / 2 - lcx) < 40 * s) { next = j; break; }
      }
      if (next < 0) break;
      used.add(next);
      stack.push(text[next]);
    }
    const L = stack[0];
    const ext = {
      minX: Math.min(...stack.map((s) => s.minX)), maxX: Math.max(...stack.map((s) => s.maxX)),
      minY: L.minY, maxY: stack[stack.length - 1].maxY,
    };
    // Drawing on all four sides of it: text inside the plan, not a dimension
    // chain or a note in the margin (placeLeftovers).
    const cy = Math.round((ext.minY + ext.maxY) / 2), cx = Math.round((ext.minX + ext.maxX) / 2);
    const inkFrom = (x, y, dx, dy) => {
      for (; x >= 0 && y >= 0 && x < w && y < h; x += dx, y += dy) if (ink[y * w + x]) return true;
      return false;
    };
    const enclosed = inkFrom(ext.minX - 1, cy, -1, 0) && inkFrom(ext.maxX + 1, cy, 1, 0)
      && inkFrom(cx, ext.minY - 1, 0, -1) && inkFrom(cx, ext.maxY + 1, 0, 1);
    // `x`, `y`, `glyphs` and `width` describe the FIRST LINE, as they always
    // have, for the readers that look no further (the direction letters, the
    // second pass). `lines` is the whole stack, which the matcher reads to find
    // how many of them a name takes. `box` describes the whole block, because
    // its consumers erase or cover ink and half a cover is worse than none — it
    // was the name line alone, and Review's masking chip left three visible
    // rows of the dimension string showing underneath it on every label.
    blocks.push({
      x: lcx / w,
      y: ((L.minY + L.maxY) / 2) / h,
      glyphs: L.n,
      width: (L.maxX - L.minX) / w,
      lines: stack.map((s) => ({
        glyphs: s.n,
        minX: s.minX / w, maxX: s.maxX / w, minY: s.minY / h, maxY: s.maxY / h,
      })),
      box: {
        x: ext.minX / w, y: ext.minY / h,
        w: (ext.maxX - ext.minX) / w, h: (ext.maxY - ext.minY) / h,
      },
      enclosed,
    });
  }
  return blocks;
}

/**
 * Glyphs into text lines: two glyphs are on one line when their middles are
 * within 9px of each other and the gap between them is under 26px (on a
 * 900-wide reading; `s` scales them to the one in hand), joined transitively.
 * The same two tolerances the greedy grouping used, without its dependence on
 * which glyph came first.
 *
 * A LINE OF TEXT NEVER CROSSES A WALL. Two rooms' names written close either
 * side of one (The Star's PANTRY | LAUNDRY) read as one line of thirteen, and
 * neither label could find its name. Given the ink (`ink`, `w`), a column in
 * the gap inked through the full height the two glyphs share keeps them apart;
 * a hyphen, a quote mark or a period between two letters never fills it.
 */
export function linesOf(glyphs, s = 1, ink = null, w = 0) {
  const n = glyphs.length;
  const parent = glyphs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const byX = glyphs.map((g, i) => i).sort((a, b) => glyphs[a].minX - glyphs[b].minX);
  // A wall, not a hairline: two pixels of a 900-wide reading across, inked
  // through. A stair's tread line runs between the D and the N of a DN and is
  // one pixel; The Star's pantry wall is four.
  const thick = Math.max(2, Math.round(2 * s));
  const walled = (A, B) => {
    if (!ink) return false;
    const y0 = Math.max(A.minY, B.minY), y1 = Math.min(A.maxY, B.maxY);
    if (y1 < y0) return false;
    let run = 0;
    for (let x = A.maxX + 1; x < B.minX; x++) {
      let y = y0;
      while (y <= y1 && ink[y * w + x]) y++;
      run = y > y1 ? run + 1 : 0;
      if (run >= thick) return true;
    }
    return false;
  };
  for (let a = 0; a < n; a++) {
    const A = glyphs[byX[a]];
    const aMid = (A.minY + A.maxY) / 2;
    for (let b = a + 1; b < n; b++) {
      const B = glyphs[byX[b]];
      if (B.minX - A.maxX >= 26 * s) {
        // Sorted by left edge, so nothing further right can be closer -- unless
        // A is wider than the glyphs after it, which a 40px cap bounds.
        if (B.minX - A.minX > (26 + 40) * s) break;
        continue;
      }
      if (Math.abs((B.minY + B.maxY) / 2 - aMid) >= 9 * s) continue;
      // Side by side, not stacked: letters on one line share at least half the
      // height of the shorter. Joined by their middles alone, the dashes of a
      // dashed line climbed into PANTRY's line on The Star, one above another.
      const shared = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY) + 1;
      if (shared * 2 < Math.min(A.maxY - A.minY, B.maxY - B.minY) + 1) continue;
      if (walled(A, B)) continue;
      parent[find(byX[a])] = find(byX[b]);
    }
  }
  const groups = new Map();
  glyphs.forEach((g, i) => {
    const r = find(i);
    const L = groups.get(r);
    if (L) {
      L.minX = Math.min(L.minX, g.minX); L.maxX = Math.max(L.maxX, g.maxX);
      L.minY = Math.min(L.minY, g.minY); L.maxY = Math.max(L.maxY, g.maxY);
      L.n++;
    } else groups.set(r, { minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, n: 1 });
  });
  return [...groups.values()];
}

// Direction letters ("UP", "DN") next to a staircase are the one piece of text
// Prompt 2 keeps reproducing despite forbidding it three times. They carry no
// information the styling needs — the prompt takes stair direction from the
// ARROW, which is a graphic element and survives — so we delete the letters
// from the wireframe before styling and remove the temptation entirely.
// Room names are deliberately left alone: the prompt uses them to decide what
// furniture belongs in each space.
//
// THE LETTERS ARE READ AS LETTERS (direction-letters.js, 2026-10-06). This used
// to paint out every block of three marks or fewer that no room name claimed,
// and about half of what it painted on the fixtures was drawing: cooktops,
// toilets, basins, door leaves. Only the letters' own ink is painted now, not
// a box, because DN is often written across the treads.

/**
 * @returns {{canvas:HTMLCanvasElement, stripped:number}} a styling-ready copy
 *          of the wireframe with direction letters painted out.
 */
export function stripDirectionLabels(wireframeImg) {
  const W = wireframeImg.naturalWidth, H = wireframeImg.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(wireframeImg, 0, 0);
  const words = directionWords(
    (lum) => sharedInkMap(wireframeImg, { width: W, lum, detectPolarity: false }), INK_LUM);
  if (!words.length) return { canvas, stripped: 0 };

  // Each letter's ink, and the soft edge around it: whatever is too light to be
  // read as ink, within a pixel of the reading's scale. A line the letter
  // touches is ink, and stays.
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const r = Math.max(1, Math.round(W / REF_W));
  for (const { pixels } of words) {
    for (const p of pixels) {
      const x = p % W, y = (p - x) / W;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const i = (ny * W + nx) * 4;
          const edge = dx || dy;
          if (edge && 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < INK_LUM) continue;
          // Prompt 1 mandates a plain white background, so that is what we paint back.
          px[i] = px[i + 1] = px[i + 2] = 255;
        }
      }
    }
    // And any crumb of the letters that was not joined to them: whatever is
    // left inside the word's box and does not run out of it. A line through
    // the word runs out of it, and stays.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const p of pixels) {
      const x = p % W, y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    clearEnclosed(px, W, Math.max(0, x0 - r), Math.max(0, y0 - r), Math.min(W - 1, x1 + r), Math.min(H - 1, y1 + r));
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, stripped: words.length };
}

/**
 * Paint white every mark inside the box (x0..x1, y0..y1) that does not touch
 * its edge, a mark being anything visibly darker than the paper.
 */
function clearEnclosed(px, W, x0, y0, x1, y1) {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const faint = (INK_LUM + 255) / 2;
  const marked = (bx, by) => {
    const i = ((y0 + by) * W + x0 + bx) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < faint;
  };
  const seen = new Uint8Array(bw * bh);
  for (let start = 0; start < bw * bh; start++) {
    if (seen[start] || !marked(start % bw, (start / bw) | 0)) continue;
    const stack = [start], mark = [];
    let edge = false;
    seen[start] = 1;
    while (stack.length) {
      const q = stack.pop();
      mark.push(q);
      const bx = q % bw, by = (q - bx) / bw;
      if (bx === 0 || by === 0 || bx === bw - 1 || by === bh - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx, ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const n = ny * bw + nx;
          if (!seen[n] && marked(nx, ny)) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    if (edge) continue;
    for (const q of mark) {
      const i = ((y0 + ((q / bw) | 0)) * W + x0 + (q % bw)) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
  }
}

/**
 * Replace each label's anchor with the position the wireframe actually drew it.
 * Labels that cannot be matched keep their original anchor and are reported.
 * @returns {{labels:Array, matched:number, unmatched:string[]}}
 */
export function snapLabelsToWireframe(labels, wireframeImg) {
  return placeOnBlocks(labels, detectLabelBlocks(wireframeImg));
}

/** The same, on blocks already read (detectLabelBlocks). Pure, so it is tested without a browser. */
export function placeOnBlocks(labels, blocks) {
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
 * Where each label's NAME is written on this drawing: the lines it takes in the
 * block the matcher read it from, matched on the name and nothing else (not the
 * second, by-order pass, which pairs by rank and says nothing about the
 * string). Normalised 0..1, like the blocks.
 *
 * FOR THE COVER (style-client.js), which hides the tracing's own text before
 * the styling model sees it, and which used to take a label's saved position
 * as proof that a name was written there. A saved position is only as good as
 * the reading that saved it: for a label nothing matched it is the model's
 * guess, and on Plan B 2-CAR GARAGE's guess lies on the kitchen cooktop, on
 * The Star MASTER BEDROOM's on the kitchen sink -- and both went white as
 * words.
 *
 * @returns {{label: Object, block: Object[], k: number, letters: number,
 *   lines: {minX,maxX,minY,maxY,glyphs}[]}[]}
 */
export function nameLinesOn(labels, blocks) {
  const named = labels.filter((l) => l.name);
  if (!named.length || !blocks.length) return [];
  const { assignment } = matchLabelsToBlocks(named, blocks);
  return [...assignment].map(([label, b]) => {
    const { k } = nameIn(label, b);
    return {
      label,
      // the block's own lines, by which a caller finds the block again
      block: b.lines,
      k,
      // how many marks the name draws as (letterCount)
      letters: letterCount(label),
      lines: b.lines?.length ? b.lines.slice(0, k)
        : [{ glyphs: b.glyphs, minX: b.box.x, maxX: b.box.x + b.box.w, minY: b.box.y, maxY: b.box.y + b.box.h }],
    };
  });
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
 * THAT HOLDS ONLY FOR TEXT INSIDE THE PLAN, so only that is offered (2026-10-05).
 * The Star's POWDER ROOM is lettered too small to read, and the leftover it was
 * handed was the 78'-0" over the whole plan: a room name put in the margin, on
 * the overall dimension, where the model's own guess had it in the right
 * corner of the house. Text with no drawing on one of its four sides is a
 * dimension chain or a note, not a room's name; with none inside left, the
 * label keeps the model's anchor.
 *
 * `anchorSource` records which pass placed it, because a name-matched anchor and
 * an order-guessed one are not the same claim.
 */
function placeLeftovers(labels, blocks, assignment, assignedBlocks) {
  const leftLabels = labels.filter((l) => !assignment.has(l) && !l.name);
  const leftBlocks = blocks.filter((b, i) => !assignedBlocks.has(i) && b.enclosed !== false);
  if (!leftLabels.length || !leftBlocks.length) return;

  const byY = (a, b) => a.y - b.y;
  const ls = [...leftLabels].sort(byY);
  const bs = [...leftBlocks].sort(byY);
  for (let i = 0; i < Math.min(ls.length, bs.length); i++) {
    assignment.set(ls[i], bs[i]);
    ls[i]._viaOrder = true;
  }
}

// WHAT A NAME DRAWS AS: one mark per character that stands the full height of
// the line. A hyphen, a period, an apostrophe or a quote mark is too short to
// be read as a glyph; a # or an & is not, and BEDROOM #3 is nine marks, not
// eight, once the drawing is read at its own size.
const letterCount = (l) => String(l.name).replace(/[\s\-.,'"`:;_~]/g, '').length;

/**
 * How a label's name sits in a block: it takes the block's first `k` lines,
 * for the `k` whose glyphs come nearest its letter count, and `err` is how near.
 * A wrapped name (MASTER / BATH) is two lines; a name with its dimension under
 * it is one; a block made without `lines` is one line.
 */
function nameIn(label, block) {
  const letters = letterCount(label);
  const lines = block.lines?.length ? block.lines : [{ glyphs: block.glyphs }];
  // A NAME NEVER TAKES ITS DIMENSION'S LINE. A room with a dimension is printed
  // as its name and then that line, so the last line of its stack is not name.
  // Counted as name, it let a long name match a short one plus its figures:
  // MASTER BEDROOM (13) took GARAGE / 24'-0" x 22'-0" (6 + 7) on The Jordan.
  const most = label.dim && lines.length > 1 ? lines.length - 1 : lines.length;
  let sum = 0, best = { k: 1, err: Infinity };
  for (let i = 0; i < most; i++) {
    sum += lines[i].glyphs;
    const err = Math.abs(sum - letters);
    if (err < best.err) best = { k: i + 1, err };
  }
  return best;
}

/** Where a name of `k` lines sits in a block: their centre, and the widest of them. */
function nameSpot(block, k) {
  if (!block.lines?.length || k <= 1) return { x: block.x, y: block.y, width: block.width };
  const L = block.lines.slice(0, k);
  const minX = Math.min(...L.map((l) => l.minX)), maxX = Math.max(...L.map((l) => l.maxX));
  return { x: (minX + maxX) / 2, y: (L[0].minY + L[L.length - 1].maxY) / 2, width: Math.max(...L.map((l) => l.maxX - l.minX)) };
}

// Greedy assignment of extracted labels to drawn text blocks. Glyph count is
// the dominant signal — it matched each label's letter count exactly on real
// plans — and the model's coarse anchor only separates same-length names.
// @returns {{assignment:Map, assignedBlocks:Set<number>}}
function matchLabelsToBlocks(named, blocks) {
  const pairs = [];
  named.forEach((label, li) => {
    blocks.forEach((b, bi) => {
      const { k, err } = nameIn(label, b);
      const at = nameSpot(b, k);
      pairs.push({ li, bi, err, cost: err * 0.5 + Math.hypot(at.x - label.x, at.y - label.y) });
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
    if (p.err > Math.max(2, letters * 0.4)) continue;
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
  const glyphErr = (label, block) => nameIn(label, block).err;
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
  // Placed on its NAME: a wrapped name's anchor is the middle of its lines and
  // its fit width the widest of them, the box still the whole block.
  for (const p of picks) assignment.set(p.label, { ...p.block, ...nameSpot(p.block, nameIn(p.label, p.block).k) });
  return { assignment, assignedBlocks };
}

function inkMap(img, width) {
  const w = width || img.naturalWidth || img.width;
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
