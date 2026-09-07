// Test fixture: a programmatically drawn stand-in for the AI-styled plan
// (Light theme look: cream paper, charcoal walls, greige floors, soft
// lower-left shadows). Contains ZERO text — exactly like real L3 output.
// This exists only so step 1 is testable before any AI integration.

const BG = '#EDEAE3';
const WALL = '#2B2B2B';
const FLOOR = '#D6D2CA';
const HALL = '#DDD9D1';
const LINE = '#4A453C';

// Room layout (normalized to the plan rect) — shared with the mock wireframe
// and mock extraction so all test fixtures agree on the same geometry.
export const MOCK_ROOMS = [
  { x: 0, y: 0, w: 0.42, h: 0.55, kind: 'room' },      // living
  { x: 0.42, y: 0, w: 0.28, h: 0.35, kind: 'room' },   // kitchen
  { x: 0.70, y: 0, w: 0.30, h: 0.55, kind: 'room' },   // primary bedroom
  { x: 0.42, y: 0.35, w: 0.28, h: 0.20, kind: 'hall' },// hallway (unlabeled)
  { x: 0, y: 0.55, w: 0.30, h: 0.45, kind: 'room' },   // bedroom 2
  { x: 0.30, y: 0.55, w: 0.22, h: 0.45, kind: 'room' },// bathroom
  { x: 0.52, y: 0.55, w: 0.18, h: 0.45, kind: 'hall' },// stairs/landing (unlabeled)
  { x: 0.70, y: 0.55, w: 0.30, h: 0.45, kind: 'room' },// dining
];

// The plan occupies 85% of the canvas, centered (matches the locked prompt spec).
export const MOCK_PLAN_INSET = 0.075;

export function makeMockPlan(w = 1600, h = 1200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // plan occupies ~85% of canvas, centered (matches the locked prompt's margin spec)
  const px = w * 0.075, py = h * 0.075;
  const pw = w * 0.85, ph = h * 0.85;

  // soft drop shadow toward lower-left
  ctx.save();
  ctx.shadowColor = 'rgba(74,69,60,0.30)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetX = -14;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = FLOOR;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  // interior room fills (shared normalized layout inside the plan rect)
  const rooms = MOCK_ROOMS.map((r) => ({ ...r, fill: r.kind === 'hall' ? HALL : FLOOR }));
  const R = (r) => [px + r.x * pw, py + r.y * ph, r.w * pw, r.h * ph];
  for (const r of rooms) { ctx.fillStyle = r.fill; ctx.fillRect(...R(r)); }

  // faint tile grid
  ctx.strokeStyle = 'rgba(74,69,60,0.06)';
  ctx.lineWidth = 1;
  for (let gx = px; gx <= px + pw; gx += pw / 20) {
    ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx, py + ph); ctx.stroke();
  }
  for (let gy = py; gy <= py + ph; gy += ph / 15) {
    ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + pw, gy); ctx.stroke();
  }

  // walls: exterior thick, interior thinner
  const extW = Math.max(8, w * 0.011);
  const intW = extW * 0.55;
  ctx.strokeStyle = WALL;
  ctx.lineWidth = extW;
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = intW;
  for (const r of rooms) ctx.strokeRect(...R(r));

  // a few furniture hints (thin linework, light fills) — no text anywhere
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  // sofa in living
  roundedRect(ctx, px + pw * 0.05, py + ph * 0.36, pw * 0.16, ph * 0.10, 8);
  // bed in primary
  roundedRect(ctx, px + pw * 0.76, py + ph * 0.08, pw * 0.18, ph * 0.30, 8);
  // kitchen island
  roundedRect(ctx, px + pw * 0.48, py + ph * 0.12, pw * 0.16, ph * 0.08, 4);
  // dining table
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.85, py + ph * 0.78, pw * 0.07, ph * 0.09, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // stair treads
  for (let i = 0; i < 8; i++) {
    const sy = py + ph * (0.58 + i * 0.05);
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.54, sy); ctx.lineTo(px + pw * 0.68, sy);
    ctx.stroke();
  }
  return c;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}

// Placeholder brand logo (simple geometric roofline mark, drawn — no external asset).
export function makeMockLogo(ink = '#2B2B2B') {
  const c = document.createElement('canvas');
  c.width = 240; c.height = 240;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = ink;
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(40, 200); ctx.lineTo(40, 110); ctx.lineTo(120, 40);
  ctx.lineTo(200, 110); ctx.lineTo(200, 200);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(95, 200); ctx.lineTo(95, 140); ctx.lineTo(145, 140); ctx.lineTo(145, 200);
  ctx.stroke();
  return c;
}
