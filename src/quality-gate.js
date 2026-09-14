// File quality gate (handoff L1): a lightweight LOCAL check on upload, before
// any API spend. Hard-rejects files that would produce garbage, with a
// friendly, specific message. The is-it-a-floor-plan check is a heuristic and
// therefore overridable by the user.

const MIN_SHORT_SIDE = 800;   // below this, linework and text degrade badly
const MAX_ASPECT = 5;         // sanity: beyond 5:1 it's a banner, not a plan

export async function runQualityGate(file) {
  const result = { ok: true, hard: [], soft: [], image: null, width: 0, height: 0 };

  // A PDF SHOULD NEVER REACH HERE. extract.html rasterises the chosen page
  // before it calls this gate, so the gate only ever sees an image. The text
  // this branch used to carry -- "PDF is not supported yet. Export the page as
  // a PNG or JPG" -- was true when PDFs were withheld and became false the day
  // the page chooser shipped. Left unreached it was merely stale; reached, it
  // would have turned away a format the product accepts and told the user so.
  // Kept as a guard for a future caller that forgets to rasterise, worded for
  // what would actually have gone wrong.
  if (file.type === 'application/pdf') {
    result.ok = false;
    result.hard.push('That PDF was not read as a page image. Open it again and pick a page, or export the plan page as a PNG.');
    return result;
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    result.ok = false;
    result.hard.push(`That file type is not supported (${file.type || 'unknown'}). Upload a PDF, PNG, JPG or WebP.`);
    return result;
  }

  const image = await loadImage(file);
  result.image = image;
  result.width = image.naturalWidth;
  result.height = image.naturalHeight;

  const short = Math.min(image.naturalWidth, image.naturalHeight);
  if (short < MIN_SHORT_SIDE) {
    result.ok = false;
    result.hard.push(`This image is too small (${image.naturalWidth}×${image.naturalHeight}). Upload the original export, or a scan at least ${MIN_SHORT_SIDE}px on its short side.`);
  }

  const aspect = image.naturalWidth / image.naturalHeight;
  if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) {
    result.ok = false;
    result.hard.push(`This is much wider than it is tall (${aspect.toFixed(2)}:1), so it may not be a single plan page. Crop to one plan and upload again.`);
  }

  // Heuristic floor-plan classification. Calibrated against real plans:
  //   Jordan (colored presentation plan): light .65 / ink .08 / sat .00
  //   Madison (construction drawing):     light .85 / ink .05 / sat .00
  //   colour photo (negative control):    light .03 / ink .53 / sat .97
  // Plans are mostly light, carry a thin minority of ink, and stay nearly
  // monochrome even when tinted. Photos fail all three.
  if (result.ok) {
    const { lightFrac, inkFrac, satFrac } = sampleHistogram(image);
    const looksLikePlan = lightFrac > 0.35 && inkFrac > 0.005 && inkFrac < 0.40 && satFrac < 0.5;
    if (!looksLikePlan) {
      result.soft.push('This does not look like a floor plan. You can carry on, but the result may be poor.');
    }
  }
  return result;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image file.')); };
    img.src = url;
  });
}

// Sampled at 1024px, NOT 256px: at 256 the thin linework of a real plan
// averages into the white background and reads as zero ink, which made every
// real plan fail the check.
function sampleHistogram(image) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  c.width = Math.max(1, Math.round(image.naturalWidth * s));
  c.height = Math.max(1, Math.round(image.naturalHeight * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let light = 0, ink = 0, sat = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 200) light++;
    if (lum < 140) ink++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 0 && (mx - mn) / mx > 0.35) sat++;
  }
  return { lightFrac: light / n, inkFrac: ink / n, satFrac: sat / n };
}
