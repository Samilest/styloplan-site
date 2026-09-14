// Where to LOOK — not what is wrong.
//
// THE REFRAME THIS MODULE EXISTS FOR.
//
// Six approaches to detecting invented architecture were built and measured
// out. Every one failed, and they failed for one reason: nothing in a raster
// separates architecture from annotation, so no pixel measurement can decide
// whether a line is a wall or a dimension bracket. The seventh — a narrow
// question put to both images — was then used as a JUDGE, ranking three
// tracings, and it picked the one carrying a known invention.
//
// The mistake was the job, not the tool. Two independent reviews said the same
// sentence and it took a measurement to hear it: there is a cheaper TRIGGER,
// but not a cheaper ORACLE. A trigger does not have to be right. It has to be
// better than a reviewer scanning a busy drawing with no idea where the problem
// is — and a false alarm costs a two-second glance.
//
// WHY THIS ONE CAN WORK WHERE THE JUDGE COULD NOT.
//
// The judge failed at MATCHING: the room the source calls HALLWAY came back as
// null, DEN and UTILITY across three tracings, so lists describing the same
// closet never lined up. Registration by position was then measured and is not
// accurate enough either — the same normalised box lands on the walk-in closet
// in the source and on the garage in the tracing.
//
// But the product already solved matching, with a human. By the time Review
// runs this, the reviewer has CONFIRMED the room labels. Both questions are
// asked against that one agreed list of names, so the two answers are
// comparable by construction. No model has to name a room and no pixel has to
// register.
//
// WHAT IT PROMISES. Nothing. It says "check these rooms". The reviewer decides,
// the eraser fixes an addition, a re-trace fixes an omission — both already
// built. Process claim, never an outcome claim.

/** Room names compare case- and space-insensitively, as everywhere else. */
const key = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * What the reviewer should look at, most worth looking at first.
 *
 * ADDITIONS RANK ABOVE OMISSIONS, and the asymmetry is measured rather than
 * assumed. An addition is visible the moment somebody looks at the named room,
 * and the eraser removes it in a second. An omission is invisible — nothing
 * draws the eye to a space where nothing was drawn.
 *
 * But omissions are also the WEAKER EVIDENCE, which is why they are worded as
 * a question rather than a finding: measured on three tracings of one plan, the
 * global question returned 1 enclosure on an image where crop-level questions
 * confirmed 4. A reader under-reads a clean wireframe. So "the tracing did not
 * show it" means the reader did not see it, which is not the same as it not
 * being there.
 *
 * @param {Array<{room:string, closets:number}>} source   the customer's plan, per confirmed room
 * @param {Array<{room:string, closets:number}>} tracing  the same question, same rooms
 * @returns {Array<{room:string, kind:'added'|'missing', delta:number, note:string}>}
 */
export function inventoryFlags(source, tracing, opts = {}) {
  // Rooms the two source readings could not settle are excluded from the
  // COMPARISON, not merely dropped from the source list. Dropping alone made it
  // worse: a disputed room vanished from the source and then appeared in the
  // tracing, which reads as "the tracing added one" — turning an unreliable
  // reading into a confident false accusation.
  const skip = new Set((opts.exclude || []).map(key));
  const count = (list) => {
    const m = new Map();
    for (const r of list || []) {
      const k = key(r.room);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + Math.max(0, Number(r.closets) || 0));
    }
    return m;
  };
  const src = count(source), wire = count(tracing);
  const names = new Map();
  for (const r of [...(source || []), ...(tracing || [])]) {
    if (key(r.room)) names.set(key(r.room), String(r.room).trim());
  }

  // THE NAME-MISMATCH SIGNATURE, and why omissions get suppressed on it.
  //
  // Measured on The Sky. The source answers cleanly against the confirmed room
  // names — six closets, every one of them really on the sheet. The tracings
  // answer against almost none of those names, because the tracing RE-TYPESETS
  // room names: the same room is BEDROOM-1 on the customer's plan and
  // BEDROOM-3, DEN or UTILITY on the redraw. The model is asked about a room
  // the image does not print, finds nothing, and every source closet turns into
  // a phantom "the tracing dropped this".
  //
  // That produced five identical false alarms on all three tracings. Five wrong
  // alarms is not a cheap glance, it is a reviewer learning to ignore the
  // panel — which costs more than never having built it.
  //
  // Additions do not have this failure: the tracing reporting a closet in a
  // room it DOES print is positive evidence, whatever that room is called. So
  // when the signature shows, additions are still reported and omissions are
  // withheld with the reason stated.
  // THE OTHER FAILURE, measured on Jordan. Its source came back with ZERO
  // enclosures across all six confirmed rooms — including a MASTER BEDROOM,
  // which almost every plan gives a closet. Jordan's sheet is 3253x4701 of
  // dense CAD, and the read simply failed. Every closet the tracing drew then
  // became an "addition", which is the same false alarm as the rename case,
  // pointing the other way.
  //
  // This one is NOT suppressed, because a plan that genuinely has no closets
  // and a tracing that invents one is precisely the defect this exists to
  // catch, and silence would lose it. It is QUALIFIED instead: the finding
  // stands and the reader is told the reading it rests on looks unreliable.
  const srcTotal = [...src.values()].reduce((n, v) => n + v, 0);
  const wireTotal = [...wire.values()].reduce((n, v) => n + v, 0);
  // No size condition: on Jordan the source call came back with no rows at all,
  // which is the same failed read wearing a different shape. A plan that
  // genuinely has no closets anywhere and a tracing that drew one will carry the
  // qualifier too — over-cautious, and the finding still stands, which is the
  // right way round.
  const sourceSilent = srcTotal === 0 && wireTotal > 0;

  const withClosets = [...src.entries()].filter(([, n]) => n > 0);
  const agreed = withClosets.filter(([k]) => (wire.get(k) || 0) > 0).length;
  const namesDiverged = withClosets.length >= 2 && agreed * 2 < withClosets.length;

  const flags = [];
  for (const [k, name] of names) {
    if (skip.has(k)) continue;
    const s = src.get(k) || 0, w = wire.get(k) || 0;
    if (s === w) continue;
    if (w < s && namesDiverged) continue;
    flags.push(w > s
      ? {
        room: name, kind: 'added', delta: w - s,
        note: `The tracing draws ${w === 1 ? 'a closet' : `${w} closets`} in ${name}, `
          + `and your plan shows ${s === 0 ? 'none' : s}. If it is not on your plan, erase it.`,
      }
      : {
        room: name, kind: 'missing', delta: s - w,
        note: `Your plan shows ${s === 1 ? 'a closet' : `${s} closets`} in ${name} `
          + `and the tracing may have dropped ${s - w === 1 ? 'one' : `${s - w}`}. `
          + 'Worth a look — this check reads a clean tracing less well than a builder\'s sheet.',
      });
  }
  // Additions first, then the biggest disagreement, then by name so the list is
  // stable between runs and does not reshuffle under the reviewer.
  const rank = (f) => (f.kind === 'added' ? 0 : 1);
  flags.sort((a, b) => rank(a) - rank(b) || b.delta - a.delta || a.room.localeCompare(b.room));
  // Non-enumerable, so the list still deep-equals a plain array of findings.
  // It is a property OF the reading, not one of the findings, and the note is
  // the only thing that reads it.
  Object.defineProperty(flags, 'namesDiverged', { value: namesDiverged });
  Object.defineProperty(flags, 'sourceSilent', { value: sourceSilent });
  return flags;
}

/**
 * Said whenever omissions were withheld, because silence would be the lie.
 * A reviewer who is shown fewer findings must be told why, or "fewer findings"
 * reads as "cleaner drawing".
 */
const silentNote = ' Your plan came back with no closets in any of these rooms, which is unusual. '
  + 'if that reading is wrong, the additions above are not real. Check the drawing before erasing '
  + 'anything.';

const renamedNote = ' The tracing renamed some rooms, so this can only report what it adds. '
  + 'anything it left out would not be findable by name. Fade to the wireframe and check for '
  + 'yourself.';

/**
 * The one line shown above the list.
 *
 * "verified, never guaranteed": this states what was done, not what is true.
 * Silence would be the dishonest option — a reviewer who is told nothing
 * assumes nothing was checked, or worse, that everything is right.
 */
export function inventoryNote(flags, checkedRooms) {
  const n = checkedRooms ?? 0;
  if (!n) return 'Confirm the room labels first, then this can compare your plan with the tracing.';
  if (!flags.length) {
    if (flags.namesDiverged) {
      return `Checked ${n} room${n > 1 ? 's' : ''} and found nothing the tracing adds.`
        + renamedNote;
    }
    return `Checked ${n} room${n > 1 ? 's' : ''} against your plan and found no disagreement. `
      + 'This is not a guarantee. It is one reading, and it only looks at built-in enclosures.';
  }
  const added = flags.filter((f) => f.kind === 'added').length;
  const missing = flags.length - added;
  const bits = [];
  if (added) bits.push(`${added} where the tracing draws more than your plan`);
  if (missing) bits.push(`${missing} where it may show less`);
  return `Checked ${n} room${n > 1 ? 's' : ''}: ${bits.join(', ')}. `
    + 'These are places to look, not faults. You decide.'
    + (flags.namesDiverged ? renamedNote : '')
    + (flags.sourceSilent ? silentNote : '');
}

/**
 * Split a big sheet into overlapping tiles.
 *
 * WHY. Measured on Jordan: asked about six confirmed rooms, its source came
 * back with no enclosures at all — including a MASTER BEDROOM, which nearly
 * every plan gives a closet. Jordan's sheet is 3253x4701 of dense CAD, and
 * whatever the model sees after the API's own downsampling is not enough ink to
 * read a bifold door from. Every closet the tracing drew then looked invented.
 *
 * Tiling is the direct fix for that, and only that: the same question, asked of
 * pieces small enough to survive being resized. Nothing here needs coordinates
 * from a model or registration between two images — the two things measured to
 * be unreliable on this pipeline.
 *
 * Tiles OVERLAP because a closet cut in half by a tile edge is a closet nobody
 * can answer for.
 *
 * @returns {Array<{x:number, y:number, w:number, h:number}>} pixels
 */
export function tileGrid(width, height, opts = {}) {
  const target = opts.target ?? 2000;
  const overlap = opts.overlap ?? 0.15;
  if (!(width > 0) || !(height > 0)) return [];
  const cols = Math.max(1, Math.ceil(width / target));
  const rows = Math.max(1, Math.ceil(height / target));
  if (cols === 1 && rows === 1) return [{ x: 0, y: 0, w: width, h: height }];
  const tw = width / cols, th = height / rows;
  const px = tw * overlap, py = th * overlap;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, Math.round(c * tw - px));
      const y = Math.max(0, Math.round(r * th - py));
      out.push({
        x, y,
        w: Math.min(width - x, Math.round(tw + 2 * px)),
        h: Math.min(height - y, Math.round(th + 2 * py)),
      });
    }
  }
  return out;
}

/** A sheet worth tiling. Below this one read is both cheaper and sufficient. */
export const worthTiling = (width, height, target = 2000) =>
  Math.max(width || 0, height || 0) > target * 1.25;

/**
 * Fold per-tile answers into one answer per room.
 *
 * MAX, NOT SUM, and the choice matters. Tiles overlap, so a closet visible in
 * two of them would be counted twice by a sum — and an inflated source count
 * hides a real addition, while an inflated tracing count invents one. Max
 * cannot double-count. It can under-count a room split across tiles with
 * different closets in each, which is the safer direction: this check exists to
 * find what the tracing ADDED, and under-counting the source is what produced
 * Jordan's false alarms in the first place.
 */
export function mergeInventories(results) {
  const best = new Map();
  for (const rows of results || []) {
    for (const r of rows || []) {
      const k = key(r.room);
      if (!k) continue;
      const n = Math.max(0, Number(r.closets) || 0);
      const prev = best.get(k);
      if (!prev || n > prev.closets) best.set(k, { room: String(r.room).trim(), closets: n, evidence: r.evidence });
      }
  }
  return [...best.values()];
}

/**
 * Fold two DIFFERENTLY-PHRASED readings of the source into what they agree on.
 *
 * WHY TWO, AND WHY DIFFERENT. Every guard in this module before now tested the
 * SHAPE of a failure already seen — renamed rooms, a silent source, an
 * oversized sheet. Each was added after one plan broke, and the first plan held
 * out from that tuning slipped past all of them and produced four false
 * additions on a sheet that prints CLOSET in large type. Sniffing for known
 * shapes cannot catch the shape you have not met.
 *
 * Agreement is different in kind: it measures whether the reading is RELIABLE,
 * which is the actual variable, and it does not care what went wrong. The
 * pipeline already trusts this pattern for dimensions — two independent
 * readings, and a number that does not survive both is not shown.
 *
 * The readings must be phrased differently. Measured: two identical requests
 * return an identical answer down to the output token count, so they agree for
 * free and prove nothing.
 *
 * A room the two readings disagree on is DROPPED, not averaged. The whole point
 * is to say nothing where the ground is soft.
 *
 * @returns {{rows:Array, disputed:string[]}}
 */
export function agreedSource(a, b) {
  const map = (list) => {
    const m = new Map();
    for (const r of list || []) {
      const k = key(r.room);
      if (k) m.set(k, { room: String(r.room).trim(), closets: Math.max(0, Number(r.closets) || 0), evidence: r.evidence });
    }
    return m;
  };
  const A = map(a), B = map(b);
  const rows = [], disputed = [];
  for (const [k, ra] of A) {
    const rb = B.get(k);
    if (!rb) { disputed.push(ra.room); continue; }
    if (rb.closets === ra.closets) rows.push(ra);
    else disputed.push(ra.room);
  }
  for (const [k, rb] of B) if (!A.has(k)) disputed.push(rb.room);
  return { rows, disputed };
}

/** What to say about the rooms the two readings could not settle. */
export function disputedNote(disputed) {
  const n = (disputed || []).length;
  if (!n) return '';
  return ` Two readings of your plan disagreed about ${n === 1 ? disputed[0]
    : `${n} rooms (${disputed.slice(0, 3).join(', ')}${n > 3 ? '…' : ''})`}, `
    + 'so nothing is claimed there. Check those yourself.';
}
