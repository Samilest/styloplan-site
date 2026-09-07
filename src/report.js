// Verification report (handoff L4, MVP deliverable): a one-page PDF
// summarizing the accuracy chain, rendered from the project JSON alone.
// The user's sign-off is the HEADLINE, not a footnote — it is what correctly
// places final responsibility with the human who verified.
// Language rule: "verified", never "guaranteed" (red line 7).

const DESIGN_W = 2550, DESIGN_H = 3300; // US Letter @ 300dpi

/**
 * @param page {{width:number,height:number}=} the page this report shares a PDF
 *   with. Omit it and the report is its own Letter document.
 *
 * IN THE PACK, THE REPORT IS THE SAME PAGE SIZE AS THE PLAN. It was always
 * Letter while the plan page is 2048×2732 or 2732×2048, so a two-page floor came
 * out of the PDF as two different pieces of paper — the report visibly wider
 * than the drawing it certifies. The layout below is unchanged: it is written in
 * a 2550-wide design space and scaled to whatever page it is handed, so the two
 * pages line up edge to edge.
 *
 * The scale is width-bound wherever the page is tall enough to take the design's
 * proportions, which is the portrait plan page floor plans almost always fit
 * best. On a square or landscape page there is not the height for it, so the
 * scale becomes height-bound and the report is centred: narrower than the plan,
 * but whole. Clipping a verification document to make it flush would be the
 * wrong trade.
 */
/**
 * The listing figures, with anything the reviewer left blank left out.
 *
 * @param {{beds?:number, baths?:number, sqft?:number}} specs
 * @returns {string} "3 bed · 2 bath · 1,850 sqft", or "none stated"
 */
/**
 * How the staircases run, in words a reader can check against the drawing.
 *
 * @param {Array<{direction?:string}>} stairs
 */
export function stairDirections(stairs) {
  const word = (d) => (d === 'up' ? 'going up' : d === 'down' ? 'going down' : null);
  const said = stairs.map((s) => word(s.direction)).filter(Boolean);
  if (!said.length) return 'direction reviewed against the source';
  if (said.length === 1) return said[0];
  const same = said.every((w) => w === said[0]);
  if (same) return said.length === 2 ? `both ${said[0]}` : `all ${said[0]}`;
  const counts = new Map();
  for (const w of said) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts].map(([w, n]) => `${n} ${w}`).join(' and ');
}

export function listingFigures(specs) {
  const s = specs || {};
  const parts = [];
  if (s.beds != null && s.beds !== '') parts.push(`${s.beds} bed`);
  if (s.baths != null && s.baths !== '') parts.push(`${s.baths} bath`);
  if (s.sqft != null && s.sqft !== '') parts.push(`${Number(s.sqft).toLocaleString('en-US')} sqft`);
  return parts.length ? parts.join(' · ') : 'none stated';
}

export function renderVerificationReport({ kit, projectName, floorName, verified, page }) {
  const outW = Math.round(page?.width || DESIGN_W);
  const outH = Math.round(page?.height || DESIGN_H);
  const k = Math.min(outW / DESIGN_W, outH / DESIGN_H);
  // The design-space size of the real page. Width stays 2550 when the fit is
  // width-bound; height grows or shrinks so the footer pins to the true bottom.
  const PAGE_W = Math.round(outW / k), PAGE_H = Math.round(outH / k);
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  const font = kit.font || 'Inter';
  const ink = '#2B2B2B';
  const sub = '#6b6459';
  const M = 260; // margin
  let y = 340;

  // Paint the page at device scale, then work in design units for everything.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outW, outH);
  ctx.scale(k, k);

  // header: company + report title
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.font = `700 64px "${font}", sans-serif`;
  // The company name is optional — a builder whose logo carries their wordmark
  // may leave it empty — so this must not assume a string. `.toUpperCase()` on
  // undefined throws, and it would take the whole verification report with it.
  ctx.fillText(String(kit.companyName || '').toUpperCase(), M, y);
  ctx.font = `400 44px "${font}", sans-serif`;
  ctx.fillStyle = sub;
  ctx.fillText(kit.tagline || '', M, y + 64);
  ctx.textAlign = 'right';
  ctx.fillStyle = ink;
  ctx.font = `600 52px "${font}", sans-serif`;
  ctx.fillText('VERIFICATION REPORT', PAGE_W - M, y);
  ctx.fillStyle = sub;
  ctx.font = `400 40px "${font}", sans-serif`;
  ctx.fillText(`${projectName} · ${floorName}`, PAGE_W - M, y + 64);
  ctx.textAlign = 'left';

  y += 170;
  hr(ctx, M, y, PAGE_W - M);

  // HEADLINE: the sign-off box
  y += 120;
  const boxH = 360;
  ctx.fillStyle = '#F4F2EE';
  ctx.beginPath(); ctx.roundRect(M, y, PAGE_W - 2 * M, boxH, 24); ctx.fill();
  ctx.fillStyle = sub;
  ctx.font = `600 40px "${font}", sans-serif`;
  ctx.fillText('REVIEWED AND CONFIRMED BY', M + 90, y + 110);
  ctx.fillStyle = ink;
  ctx.font = `700 96px "${font}", sans-serif`;
  ctx.fillText(verified.confirmedBy || 'the user', M + 90, y + 230);
  ctx.fillStyle = sub;
  ctx.font = `400 44px "${font}", sans-serif`;
  const when = new Date(verified.confirmedAt);
  ctx.fillText(`on ${when.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })} at ${when.toLocaleTimeString()}`, M + 90, y + 300);
  y += boxH + 140;

  // accuracy chain
  ctx.fillStyle = ink;
  ctx.font = `600 46px "${font}", sans-serif`;
  ctx.fillText('ACCURACY CHAIN', M, y);
  y += 40;

  // Equipment callouts are annotations, not enclosed spaces — counting them
  // here would overstate the room count on the document the buyer receives.
  const rooms = verified.labels.filter((l) => l.kind !== 'equipment');
  const named = rooms.filter((l) => l.name);
  const unnamed = rooms.length - named.length;
  const dims = rooms.filter((l) => l.dim).length;
  // accepts the current list and the older single-staircase shape
  const stairs = verified.staircases
    || (verified.stairs?.present ? [verified.stairs] : []);
  const reg = verified.registration;
  const rows = [
    [`${rooms.length} enclosed spaces identified and confirmed`,
     named.map((l) => l.name).join(' · ') + (unnamed ? `  (+ ${unnamed} unlabeled space${unnamed > 1 ? 's' : ''} confirmed)` : '')],
    // "0 dimension strings transcribed verbatim" beside a green tick is a pass
    // with nothing behind it, and it reads as a failure the reader is being
    // asked to ignore. A plan that prints no dimensions is an ordinary plan —
    // The Sky prints one figure on the whole sheet — so the row says that, and
    // the tick then means what it says: there was nothing to get wrong.
    dims === 0
      ? ['No dimensions are printed on this plan, so none were transcribed',
         'Where a plan does print them, they are transcribed and user-editable. '
         + 'They are never calculated or inferred.']
      : [`${dims} dimension string${dims === 1 ? '' : 's'} transcribed verbatim from the source plan`,
         'Numbers are transcribed and user-editable. They are never calculated or inferred.'],
    // Recorded because it is the only check about what should NOT be present,
    // and the only one no measurement in this system can make. Stated as what
    // the reviewer did, never as a guarantee (red line 7).
    ['Drawing compared against the source for anything added',
     'The reviewer confirmed that no wall, door or closet appears in the tracing '
     + 'that is not on their own plan.'],
    // This row printed a green ✓ and the words "silhouette aspect within 2.2%"
    // even when 2.2% was a FAILURE against a 2% limit — the document endorsed
    // exactly what the system had flagged. State the verdict, and say plainly
    // when the reviewer chose to proceed past a mismatch.
    // "Geometry did NOT match" asserted a defect the measurement cannot
    // establish — the check failed to CONFIRM, which is not the same thing. On
    // a CAD framing sheet whose dimensions came back 7/7 character-perfect it
    // read 3.3% against a 2% limit, and this document would have told that
    // builder's customer the layout may be wrong. Still flagged as a caveat
    // (status stays 'fail'), because an unconfirmed outline is worth recording
    // — but stated as what happened, and the reason is named only when it
    // applies (red line 7: process claims, never outcome claims).
    reg && reg.ok === false
      ? ['Outline not auto-confirmed. Reviewer compared and approved',
         `The automatic check measured the wireframe and the source `
         + `${(reg.aspectDev * 100).toFixed(1)}% apart (limit 2%). The reviewer was shown the `
         + 'comparison and confirmed the drawing themselves. '
         + (reg.sourceIsAnnotated
           ? 'This check commonly does not confirm on construction drawings, where dimension '
             + 'lines and the title block are measured along with the building.'
           : 'The layout on this sheet may not match the source plan.'),
         'fail']
      // AND THE PASSING BRANCH IS WORDED THE SAME WAY, for the same reason.
      //
      // It read 'Geometry registration verified' while its own failing branch
      // beside it said 'Reviewer compared and approved' — one line asserting a
      // property of the drawing, the next attributing a decision to a person,
      // in the same ternary. The unattributed one is the one this document
      // cannot stand behind: what the check establishes is that two rasters
      // registered within a tolerance, not that the plan is correct.
      //
      // Measured the same day this was written: a plan whose own dimension
      // chains contradicted each other by a factor of three passed this check
      // comfortably. 'Verified' would have been false on that sheet and the
      // report would have carried it to a builder's customer.
      : ['Geometry registration confirmed by the reviewer',
         reg ? `Wireframe auto-registered over the source; outline within ${(reg.aspectDev * 100).toFixed(1)}% of the plan (limit 2%), structure deviation ${(reg.deviation * 100).toFixed(1)}%.`
             : 'Wireframe visually compared against the source plan during review.'],
    // NO INTERNAL NUMBERING ON A CUSTOMER'S DOCUMENT. This read "#1 UP" and
    // "#1 DN; #2 DN" — the index is ours, it names nothing the reader can see
    // on the drawing, and "DN" is a drafting abbreviation rather than English.
    // What the reviewer actually confirmed is how many and which way.
    [stairs.length ? `${stairs.length} staircase${stairs.length > 1 ? 's' : ''} confirmed, ${stairDirections(stairs)}`
      : 'No staircase on this floor',
     'Each staircase’s position and direction reviewed against the source.'],
    // NOT STATED IS NOT ZERO, AND IT IS CERTAINLY NOT "null".
    //
    // `sqft` was guarded and `beds`/`baths` were not, so a floor whose listing
    // figures the reviewer left blank printed "null bed · null bath" on the one
    // page a builder forwards to a client. It reached Saman on The Sky.
    //
    // A blank figure and a figure of zero are different claims — "the reviewer
    // did not state this" against "the reviewer states there are none" — so the
    // blank ones are dropped from the line rather than defaulted, and a line
    // with nothing left says that plainly instead of listing three absences.
    [`Listing figures confirmed by the reviewer: ${listingFigures(verified.specs)}`,
     'Auto-counted values are only suggestions; the figures shown on outputs are exclusively the reviewer-confirmed numbers.'],
    // A reused plan carries someone else's review. The sign-off box above names
    // whoever issued THIS sheet, which is correct — but on its own it would read
    // as though they had examined the drawing today. Both statements belong on
    // the page: who checked the plan, and who put it out again.
    ...(verified.reusedFrom?.confirmedAt
      ? [[`Verified plan reused from an earlier project`,
          `The spaces, dimensions and figures on this sheet were reviewed and confirmed by `
          + `${verified.reusedFrom.confirmedBy || 'the account holder'} on `
          + `${new Date(verified.reusedFrom.confirmedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}, `
          + `and reissued here without a further review. The drawing and its figures are unchanged.`]]
      : []),
    // The image can be edited after rendering — stray marks the styling model
    // invented can be erased. A report that describes the accuracy chain has to
    // say so, or it describes a picture that no longer exists.
    ...(verified.patches?.length
      ? [[`${verified.patches.length} area${verified.patches.length > 1 ? 's' : ''} erased from the styled image by the reviewer`,
          'Removal only: erased areas are filled with the surrounding floor. Walls are protected and cannot be erased, and nothing can be added to the image.']]
      : []),
  ];
  for (const [title, detail, status] of rows) {
    y += 110;
    const failed = status === 'fail';
    ctx.fillStyle = failed ? '#9C3221' : '#3f9d4c';
    ctx.font = '600 52px Inter';
    ctx.fillText(failed ? '✗' : '✓', M, y);
    ctx.fillStyle = ink;
    ctx.font = `600 44px "${font}", sans-serif`;
    ctx.fillText(title, M + 90, y);
    ctx.fillStyle = sub;
    ctx.font = `400 36px "${font}", sans-serif`;
    y += 58;
    y = wrapText(ctx, detail, M + 90, y, PAGE_W - 2 * M - 90, 48);
  }

  // footer: process language
  const fy = PAGE_H - 300;
  hr(ctx, M, fy, PAGE_W - M);
  ctx.fillStyle = sub;
  ctx.font = `400 34px "${font}", sans-serif`;
  // The report and the image must say the SAME thing. The footer used to print
  // "dimensions are approximate" while this page described a named person
  // confirming every figure — two accounts of the same work, and a reader who
  // saw both would trust the weaker one. Both now describe the process.
  wrapText(ctx,
    'This report documents the verification process for the styled floor plan package: every space, dimension and listing figure above was reviewed and confirmed by the named reviewer before export. ' +
    'The figures were transcribed from the supplied plan, not independently measured. ' +
    'The graphic is a marketing illustration and is not a construction document.',
    M, fy + 70, PAGE_W - 2 * M, 46);

  return c;
}

function hr(ctx, x1, y, x2) {
  ctx.strokeStyle = '#DDD8CF';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/);
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = w;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}
