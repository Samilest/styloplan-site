// Listing spec strip: bed count · bath count · total sqft.
// LIABILITY RULE (handoff L2/L3, CLAUDE.md red line 5): values rendered here
// come ONLY from user-confirmed numbers, never from raw auto-counts. The
// caller must pass specs.confirmed === true or nothing is drawn.

function iconBed(ctx, s) {
  // headboard + mattress + legs, drawn in a 0..1 box scaled by s
  ctx.beginPath();
  ctx.moveTo(0.05 * s, 0.25 * s); ctx.lineTo(0.05 * s, 0.72 * s);
  ctx.lineTo(0.95 * s, 0.72 * s); ctx.lineTo(0.95 * s, 0.45 * s);
  ctx.lineTo(0.28 * s, 0.45 * s);
  ctx.stroke();
  ctx.beginPath(); // pillow
  ctx.arc(0.165 * s, 0.38 * s, 0.085 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath(); // legs
  ctx.moveTo(0.08 * s, 0.72 * s); ctx.lineTo(0.08 * s, 0.85 * s);
  ctx.moveTo(0.92 * s, 0.72 * s); ctx.lineTo(0.92 * s, 0.85 * s);
  ctx.stroke();
}

function iconBath(ctx, s) {
  ctx.beginPath(); // tub body
  ctx.moveTo(0.08 * s, 0.5 * s); ctx.lineTo(0.92 * s, 0.5 * s);
  ctx.moveTo(0.12 * s, 0.5 * s);
  ctx.lineTo(0.14 * s, 0.68 * s);
  ctx.quadraticCurveTo(0.16 * s, 0.78 * s, 0.28 * s, 0.78 * s);
  ctx.lineTo(0.72 * s, 0.78 * s);
  ctx.quadraticCurveTo(0.84 * s, 0.78 * s, 0.86 * s, 0.68 * s);
  ctx.lineTo(0.88 * s, 0.5 * s);
  ctx.stroke();
  ctx.beginPath(); // faucet
  ctx.moveTo(0.2 * s, 0.5 * s); ctx.lineTo(0.2 * s, 0.24 * s);
  ctx.quadraticCurveTo(0.2 * s, 0.16 * s, 0.3 * s, 0.16 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.24 * s, 0.78 * s); ctx.lineTo(0.22 * s, 0.87 * s);
  ctx.moveTo(0.76 * s, 0.78 * s); ctx.lineTo(0.78 * s, 0.87 * s);
  ctx.stroke();
}

function iconSqft(ctx, s) {
  ctx.beginPath(); // square outline with dimension arrows
  ctx.rect(0.18 * s, 0.18 * s, 0.64 * s, 0.64 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.28 * s, 0.72 * s); ctx.lineTo(0.72 * s, 0.28 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.28 * s, 0.72 * s); ctx.lineTo(0.28 * s, 0.6 * s);
  ctx.moveTo(0.28 * s, 0.72 * s); ctx.lineTo(0.4 * s, 0.72 * s);
  ctx.moveTo(0.72 * s, 0.28 * s); ctx.lineTo(0.72 * s, 0.4 * s);
  ctx.moveTo(0.72 * s, 0.28 * s); ctx.lineTo(0.6 * s, 0.28 * s);
  ctx.stroke();
}

const ICONS = [
  { draw: iconBed, key: 'beds', suffix: 'BED' },
  { draw: iconBath, key: 'baths', suffix: 'BATH' },
  { draw: iconSqft, key: 'sqft', suffix: 'SQFT' },
];

// Measure the strip width without drawing (for right-aligned layouts).
export function measureSpecStrip(ctx, specs, h, font) {
  if (!specs || !specs.confirmed) return 0;
  const gap = h * 0.55;
  let w = 0;
  ctx.save();
  ctx.font = `600 ${h * 0.52}px ${font}`;
  for (const it of ICONS) {
    const v = specs[it.key];
    if (v == null) continue;
    const label = `${formatValue(it.key, v)} ${it.suffix}`;
    w += h + h * 0.15 + ctx.measureText(label).width + gap;
  }
  ctx.restore();
  return Math.max(0, w - gap);
}

function formatValue(key, v) {
  return key === 'sqft' ? Number(v).toLocaleString('en-US') : String(v);
}

// Draw the strip with its LEFT edge at x, vertically centered on cy.
// `rec` is the text recorder (src/text-runs.js) so the numbers travel into the
// SVG as live text. The ICONS stay drawn — they are canvas paths, and tracing
// them into SVG geometry is a second renderer to keep in sync for no gain.
export function drawSpecStrip(ctx, specs, x, cy, h, color, font, rec) {
  if (!specs || !specs.confirmed) return; // never render unconfirmed values
  const gap = h * 0.55;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, h * 0.055);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = `600 ${h * 0.52}px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let cx = x;
  for (const it of ICONS) {
    const v = specs[it.key];
    if (v == null) continue;
    ctx.save();
    ctx.translate(cx, cy - h / 2);
    it.draw(ctx, h);
    ctx.restore();
    cx += h + h * 0.15;
    const label = `${formatValue(it.key, v)} ${it.suffix}`;
    if (rec) rec.text(ctx, label, cx, cy + h * 0.02);
    else ctx.fillText(label, cx, cy + h * 0.02);
    cx += ctx.measureText(label).width + gap;
  }
  ctx.restore();
}
