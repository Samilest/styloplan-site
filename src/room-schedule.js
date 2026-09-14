// ROOM SCHEDULE: the rooms of one floor, their transcribed dimensions, and the
// area those dimensions come to.
//
// WHY IT EXISTS. A listing wants a room table, and today a builder reads the
// numbers off our picture and types them somewhere else. The data is already
// confirmed by them in Review, so the retyping is work the product was making
// them do for no reason. AGENT-HANDOFF names this as the honest version of
// "the tool understands my plan", and it is honest precisely because it derives
// nothing from the drawing.
//
// WHERE THE AREA COMES FROM, AND WHY THAT IS NOT RED LINE 2.
//
// Red line 2 is that dimensions are transcribed and never calculated: a number
// on a finished image was read off the customer's own plan, never measured off
// geometry. This multiplies two numbers the CUSTOMER CONFIRMED. It reads no
// pixels, measures no walls and invents no figure, and the transcribed string
// stays on the page beside the product so the source is never replaced by the
// derivation. That is the whole distinction, and the page states it in words.
//
// THE TOTAL IS THE TRAP. Summing the rooms does not give the floor area: walls,
// halls, stairs and every space with no printed dimension are missing from it.
// A page that prints a sum next to the words "total area" would be publishing a
// figure about somebody's property that is wrong. So the sum is labelled as
// what it is, and where the reviewer confirmed a real total it is printed
// separately and named as theirs.

const DESIGN_W = 2550, DESIGN_H = 3300; // US Letter @ 300dpi

/**
 * Parse a transcribed dimension into decimal feet.
 *
 * Imported rather than reimplemented: src/house-style.js already understands
 * the fractional inch field and the curly marks a source plan may carry, and
 * two parsers of the same string would eventually disagree.
 */
import { dimToFeet } from './house-style.js';

const round = (n) => Math.round(n);

/** Area in square feet, or null when the dimension is missing or unparsable. */
export function areaOf(dim) {
  const ft = dimToFeet(dim);
  return ft ? ft[0] * ft[1] : null;
}

/**
 * The rows of the schedule, in the order the reviewer sees them.
 *
 * EVERY SPACE APPEARS, including the ones with no dimension. Dropping them
 * would leave a table whose row count disagrees with the room count on the
 * verification report, and the missing rooms would be the unlabelled ones the
 * product works hardest to keep.
 *
 * Equipment markers are not rooms and are left out, matching the report's own
 * filter. A label the customer hid in Studio is still a room on the floor: it
 * was hidden from the PICTURE, which is a decision about the deliverable, not a
 * statement that the space does not exist.
 */
export function scheduleRows(verified) {
  const rooms = (verified?.labels || []).filter((l) => l.kind !== 'equipment');
  return rooms.map((l) => ({
    name: l.name || '',
    dim: l.dim || '',
    area: areaOf(l.dim),
  }));
}

/**
 * Total of the rows that HAVE an area, plus what was left out of it.
 *
 * THE ROUNDED FIGURES ARE SUMMED, not the exact ones, because the rounded
 * figures are what the page prints. A floor of 149.5 and 26.5 shows 150 and 27
 * and a reader adding the column gets 177; an exact sum would print 176 under
 * it. Being half a foot closer to the arithmetic is worth nothing against a
 * document that visibly does not add up in a buyer's hands.
 */
export function scheduleTotals(rows) {
  const withArea = rows.filter((r) => r.area !== null);
  return {
    sum: withArea.reduce((a, r) => a + round(r.area), 0),
    counted: withArea.length,
    missing: rows.length - withArea.length,
  };
}

/**
 * One page, in the same design space and at the same page size as the plan it
 * travels with, so the pack does not mix paper sizes.
 *
 * @param page {{width:number,height:number}=} the page this shares a PDF with.
 */
export function renderRoomSchedule({ kit, projectName, floorName, verified, page }) {
  const outW = Math.round(page?.width || DESIGN_W);
  const outH = Math.round(page?.height || DESIGN_H);
  const k = Math.min(outW / DESIGN_W, outH / DESIGN_H);
  const PAGE_W = Math.round(outW / k), PAGE_H = Math.round(outH / k);

  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  const font = kit?.font || 'Inter';
  const ink = '#2B2B2B';
  const sub = '#6b6459';
  // Same measure as the verification report, and widening for the same reason:
  // these two pages sit next to each other in one PDF and must not disagree
  // about where the text starts. See report.js.
  const M = Math.max(260, Math.round((PAGE_W - (DESIGN_W - 520)) / 2));
  let y = 340;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outW, outH);
  ctx.scale(k, k);

  // Header, matching the verification report so the two read as one document.
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.font = `700 64px "${font}", sans-serif`;
  ctx.fillText(String(kit?.companyName || '').toUpperCase(), M, y);
  ctx.font = `400 44px "${font}", sans-serif`;
  ctx.fillStyle = sub;
  ctx.fillText(kit?.tagline || '', M, y + 64);

  ctx.textAlign = 'right';
  ctx.fillStyle = ink;
  ctx.font = `600 52px "${font}", sans-serif`;
  ctx.fillText('ROOM SCHEDULE', PAGE_W - M, y);
  ctx.font = `400 40px "${font}", sans-serif`;
  ctx.fillStyle = sub;
  ctx.fillText(`${projectName} · ${floorName}`, PAGE_W - M, y + 64);
  ctx.textAlign = 'left';

  y += 150;
  hr(ctx, M, y, PAGE_W - M);
  y += 90;

  const rows = scheduleRows(verified);
  const totals = scheduleTotals(rows);

  // THE FOOTER'S SIZE IS DECIDED BEFORE THE TABLE IS DRAWN, because the table
  // has to know where to stop. Its length varies: a kit that rounds adds a
  // sentence, and a fixed reserve that suited the short version ran the long
  // one off the bottom of the page.
  //
  // WHEN THE KIT ROUNDS, THE TWO PAGES OF THIS PACK DISAGREE ON PURPOSE and the
  // page has to say so, here, where a reader already comes to find out which
  // number came from where. The plan image prints `dimDisplay`, whole feet
  // under that setting; this table prints the transcription, and the areas come
  // from the transcription because an area derived from a rounded figure is not
  // the room's area: 12'-8" x 11'-6" is 146 sq ft and 13' x 12' is 156, a 7%
  // overstatement about somebody's property from what is only a house style.
  const rounded = kit?.houseStyle?.roundDimensions
    ? ' Your brand kit rounds dimensions to whole feet on the plan image; this table shows '
      + 'your plan’s own figures, which is what the areas are calculated from.'
    : '';
  const note = 'Dimensions are transcribed from the plan you supplied and confirmed by you; they '
    + 'are not measured by us. Areas are calculated from those confirmed dimensions and are '
    + 'rounded to the nearest square foot.' + rounded
    + ' This schedule is marketing material and is not a survey or a construction document.';
  ctx.font = `400 36px "${font}", sans-serif`;
  const noteH = wrapText(ctx, note, 0, 0, PAGE_W - 2 * M, 46, true);
  const fy = PAGE_H - (70 + noteH + 130);

  // Column heads. The area column is named for what it is, once, at the top,
  // rather than repeating a qualifier on every line.
  // The dimension column starts far enough left that its heading clears the
  // right-aligned area heading. Both headings are long on purpose: they are
  // what tells a reader that one column was transcribed and the other derived.
  const colDim = PAGE_W - M - 900;
  const colArea = PAGE_W - M;
  ctx.font = `600 34px "${font}", sans-serif`;
  ctx.fillStyle = sub;
  ctx.fillText('SPACE', M, y);
  // "AS YOUR PLAN PRINTS IT", not "as printed": the plan image travelling with
  // this page may print a rounded form of the same figure, and a reader holding
  // both needs to know which document each column is quoting.
  ctx.fillText('AS YOUR PLAN PRINTS IT', colDim, y);
  ctx.textAlign = 'right';
  ctx.fillText('AREA, CALCULATED', colArea, y);
  ctx.textAlign = 'left';
  y += 30;
  hr(ctx, M, y, PAGE_W - M);
  y += 74;

  // The last row must leave the totals block and its caveat clear of the
  // footer rule, wherever the footer ended up.
  const lastRowY = fy - 420;
  let hidden = 0;
  for (const r of rows) {
    if (y > lastRowY) { hidden = rows.length - rows.indexOf(r); break; }
    ctx.font = `400 44px "${font}", sans-serif`;
    ctx.fillStyle = r.name ? ink : sub;
    // An unnamed space is still a space. It is named as one rather than left
    // blank, so a reader counting rows is not left wondering what the gap is.
    // A long name is shortened rather than allowed to run into the dimension
    // column: two overlapping strings are unreadable, a shortened one is not.
    ctx.fillText(fit(ctx, r.name || 'Unnamed space', colDim - M - 40), M, y);
    ctx.fillStyle = r.dim ? ink : sub;
    ctx.fillText(r.dim || 'no dimension printed', colDim, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = r.area === null ? sub : ink;
    ctx.fillText(r.area === null ? '—' : `${round(r.area).toLocaleString('en-US')} sq ft`, colArea, y);
    ctx.textAlign = 'left';
    y += 72;
  }

  if (hidden) {
    ctx.font = `400 36px "${font}", sans-serif`;
    ctx.fillStyle = sub;
    ctx.fillText(`and ${hidden} more space${hidden === 1 ? '' : 's'}`, M, y);
    y += 60;
  }

  y += 20;
  hr(ctx, M, y, PAGE_W - M);
  y += 80;

  // THE SUM, NAMED FOR WHAT IT IS. Never "total floor area".
  //
  // WHEN SOME SPACES HAVE NO DIMENSION, THE LABEL CARRIES THE COUNT. A plan
  // that prints one dimension among twelve rooms would otherwise put "279 sq
  // ft" under a twelve-row table, which reads at a glance as the size of the
  // home. Saying "the 1 space with a printed dimension" makes the number
  // unreadable as anything but what it is, before the caveat underneath is
  // reached.
  //
  // WHEN NONE HAS ONE, THERE IS NO SUM. "0 sq ft" on a document a buyer
  // receives is worse than silence, and it is not even true: the spaces exist,
  // their sizes were simply never printed. The verification report already
  // handles the same case in the same voice.
  if (totals.counted === 0) {
    ctx.font = `400 40px "${font}", sans-serif`;
    ctx.fillStyle = sub;
    y = wrapText(ctx,
      'This plan prints no dimensions, so no areas could be calculated. The spaces above are '
      + 'the ones you confirmed; their sizes are simply not stated on the drawing.',
      M, y, PAGE_W - 2 * M, 50);
  } else {
    ctx.font = `600 44px "${font}", sans-serif`;
    ctx.fillStyle = ink;
    ctx.fillText(totals.missing
      ? `Sum of the ${totals.counted} space${totals.counted === 1 ? '' : 's'} with a printed dimension`
      : 'Sum of the spaces listed above', M, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${round(totals.sum).toLocaleString('en-US')} sq ft`, colArea, y);
    ctx.textAlign = 'left';
    y += 64;

    ctx.font = `400 36px "${font}", sans-serif`;
    ctx.fillStyle = sub;
    y = wrapText(ctx,
      'This is not the floor area. It leaves out walls, hallways, stairs and '
      + (totals.missing
        ? `the ${totals.missing} space${totals.missing === 1 ? '' : 's'} above with no printed dimension.`
        : 'anything the plan does not print a dimension for.'),
      M, y, PAGE_W - 2 * M, 46);
  }

  // The reviewer's own total, where they gave one, kept visibly apart from ours.
  const sqft = verified?.specs?.sqft ?? verified?.specs?.totalSqft;
  if (Number.isFinite(Number(sqft)) && Number(sqft) > 0) {
    y += 40;
    ctx.font = `600 44px "${font}", sans-serif`;
    ctx.fillStyle = ink;
    ctx.fillText('Total floor area, as confirmed by you', M, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${Number(sqft).toLocaleString('en-US')} sq ft`, colArea, y);
    ctx.textAlign = 'left';
    y += 64;
  }

  // The footer says where each column came from, because the two columns have
  // different standing and a reader cannot tell by looking. Its position was
  // settled above, before the table was allowed to grow into it.
  hr(ctx, M, fy, PAGE_W - M);
  ctx.font = `400 36px "${font}", sans-serif`;
  ctx.fillStyle = sub;
  wrapText(ctx, note, M, fy + 70, PAGE_W - 2 * M, 46);

  return c;
}

function fit(ctx, text, maxW) {
  let s = String(text);
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function hr(ctx, x1, y, x2) {
  ctx.strokeStyle = '#DDD8CF';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}

/** Returns the y after the last line. `measure` runs the same pass without drawing. */
function wrapText(ctx, text, x, y, maxW, lineH, measure) {
  const words = String(text).split(/\s+/);
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      if (!measure) ctx.fillText(line, x, y);
      y += lineH;
      line = w;
    } else line = test;
  }
  if (line) { if (!measure) ctx.fillText(line, x, y); y += lineH; }
  return y;
}
