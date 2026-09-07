// Canvas format definitions — three formats, one per handoff Section 5/L4.
// Re-layout only: the plan image is always placed whole (contain-fit), never cropped.

export const FORMATS = {
  square: {
    id: 'square',
    width: 2048,
    height: 2048,
    footerHeight: 0.14, // fraction of canvas height reserved for the footer band
  },
  landscape: {
    id: 'landscape',
    width: 2732,
    height: 2048,
    footerHeight: 0.12,
  },
  portrait: {
    id: 'portrait',
    width: 2048,
    height: 2732,
    footerHeight: 0.16,
  },
};

/**
 * A FOURTH FORMAT THAT IS NOT A FORMAT: the plan's own shape.
 *
 * The three canvases above exist to re-lay-out a plan for a channel — square
 * for a feed, landscape for a header, portrait for a sheet — and the empty band
 * left beside a plan that does not share the canvas's proportions is the price
 * of that. It buys nothing on the MLS-safe export. That file exists to be
 * dropped into somebody else's layout, so every pixel of background we add is
 * one they have to crop back off, and three copies of the same drawing at three
 * aspect ratios is three files to choose between for no gain.
 *
 * So this format takes its proportions from the DRAWING — the content box, not
 * the frame the image model returned, which carries a band of its own
 * background. planPlacement then contain-fits the drawing into a canvas that is
 * already exactly its shape, which lands scale-to-fill at x=0, y=0: the plan
 * edge to edge, no margin, nothing added.
 *
 * Upscaled so the long edge is at least LONG_EDGE. A content box is often
 * smaller than the frame it came out of, and an MLS image at 900px would be the
 * one export that arrived at half the resolution of the others.
 */
const FIT_LONG_EDGE = 2048;
export function fitFormat(planW, planH, content) {
  const w = Math.max(1, Math.round((content ? content.w : 1) * planW));
  const h = Math.max(1, Math.round((content ? content.h : 1) * planH));
  // Never DOWN-scale: a plan that already exceeds the target keeps its pixels.
  const k = Math.max(1, FIT_LONG_EDGE / Math.max(w, h));
  return {
    id: 'fit',
    width: Math.round(w * k),
    height: Math.round(h * k),
    footerHeight: 0,
    bare: true,
  };
}

// All three canvases, ordered so the one that carries this plan best comes
// first — the Studio opens on it and it leads the download pack.
//
// Ordering, not filtering. Dropping the weakest shape was tried and reverted:
// producing it costs nothing (same AI render, one more local composite) while
// withholding it strands a customer whose channel needs that shape, which is
// the "no tickets, no extra work" promise broken over a cosmetic preference.
// A sparse-but-clean canvas is theirs to use or ignore.
//
// Fit is measured by how much of the canvas WIDTH the plan occupies, not by
// orientation. Leftover vertical space is absorbed by the title above and the
// footer below, so a wide plan sits happily on a tall canvas (93% of the width
// used); leftover horizontal space has nothing to fill it. Measured:
//   wide plan  → portrait 93% · square 93% · landscape 75%
//   tall plans → portrait 68-71% · square 51-53% · landscape 39-41%
export function formatsByFit(planW, planH) {
  return Object.keys(FORMATS)
    .map((id) => {
      const f = FORMATS[id];
      const pl = planPlacement(planW, planH, f, true);
      return { id, widthUse: pl.w / f.width, areaUse: (pl.w * pl.h) / (f.width * f.height) };
    })
    // width usage decides what "fits"; area breaks ties between equals
    .sort((a, b) => (b.widthUse - a.widthUse) || (b.areaUse - a.areaUse))
    .map((s) => s.id);
}

// Smart typography scaling (handoff L4): all composite-layer type scales with
// the canvas, with a guaranteed minimum print-legible size. Wall line weights
// live inside the AI render and are intentionally NOT touched here.
export function typoScale(format) {
  return Math.min(format.width, format.height) / 2048;
}

export function minLegiblePx(format) {
  // ~0.9% of the short canvas side, floor of 14px at 2048 — safe for print at 300dpi.
  return Math.max(14, Math.round(Math.min(format.width, format.height) * 0.009));
}

// Compute where the whole plan image sits on the canvas for a given format.
// Returns {x, y, w, h, scale} — the transform used to map normalized label
// coordinates (relative to the plan image) into canvas pixels.
export function planPlacement(planW, planH, format, titleBand) {
  const footerH = Math.round(format.height * format.footerHeight);
  const topPad = titleBand ? Math.round(format.height * 0.055) : 0;
  // THE MLS-SAFE EXPORT HAS NO MARGIN. Everywhere else the 3.5% breathing room
  // is what stops a branded image looking crammed against its own edge — but
  // that export exists to be dropped into someone else's layout, and a margin
  // we added is a margin they cannot remove. `contain` still applies, so the
  // plan is never cropped; it just fills what it is given.
  const margin = format.bare ? 0
    : Math.round(Math.min(format.width, format.height) * 0.035);

  const areaX = margin;
  const areaY = topPad + margin;
  const areaW = format.width - margin * 2;
  const areaH = format.height - footerH - areaY - margin;

  const scale = Math.min(areaW / planW, areaH / planH); // contain-fit: never crop
  const w = planW * scale;
  const h = planH * scale;
  return {
    x: areaX + (areaW - w) / 2,
    y: areaY + (areaH - h) / 2,
    w, h, scale,
    footerRect: { x: 0, y: format.height - footerH, w: format.width, h: footerH },
  };
}
