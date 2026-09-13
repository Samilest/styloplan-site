// Mock L3 styled renderer — palette-parameterized stand-in for the AI styling
// call, for both themes. Zero text (NO TEXT rule), same geometry as the mock
// wireframe, 85% centered plan per the locked prompt's margin spec.

import { MOCK_ROOMS, MOCK_PLAN_INSET } from './mock-plan.js';
import { blend, derived } from './palettes.js';

export function makeStyledMock(palette, w = 1600, h = 1200) {
  const light = palette.theme === 'light';
  const d = derived(palette);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // background (+ radial vignette on dark)
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, w, h);
  if (!light) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    g.addColorStop(0, blend(palette.background, '#ffffff', 0.05));
    g.addColorStop(1, blend(palette.background, '#000000', 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const px = w * MOCK_PLAN_INSET, py = h * MOCK_PLAN_INSET;
  const pw = w * (1 - 2 * MOCK_PLAN_INSET), ph = h * (1 - 2 * MOCK_PLAN_INSET);
  const R = (r) => [px + r.x * pw, py + r.y * ph, r.w * pw, r.h * ph];

  // wall drop shadow toward lower-left, then floor plate
  ctx.save();
  ctx.shadowColor = light ? hexA(d.shadow, 0.30) : 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetX = -14;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = palette.floors;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  // room fills (hallways tinted)
  for (const r of MOCK_ROOMS) {
    ctx.fillStyle = r.kind === 'hall'
      ? (light ? blend(palette.floors, palette.background, 0.45) : blend(palette.floors, palette.walls, 0.06))
      : palette.floors;
    ctx.fillRect(...R(r));
  }

  // faint tile grid
  ctx.strokeStyle = hexA(light ? '#000000' : '#ffffff', 0.05);
  ctx.lineWidth = 1;
  for (let gx = px; gx <= px + pw; gx += pw / 20) {
    ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx, py + ph); ctx.stroke();
  }
  for (let gy = py; gy <= py + ph; gy += ph / 15) {
    ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + pw, gy); ctx.stroke();
  }

  // walls
  const extW = Math.max(8, w * 0.011);
  ctx.strokeStyle = palette.walls;
  ctx.lineWidth = extW;
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = extW * 0.55;
  for (const r of MOCK_ROOMS) ctx.strokeRect(...R(r));

  // minimal furniture in derived line color, light fills
  ctx.strokeStyle = d.line;
  ctx.lineWidth = 2;
  ctx.fillStyle = light ? 'rgba(255,255,255,0.35)' : hexA(palette.floors, 0.9);
  rr(ctx, px + pw * 0.05, py + ph * 0.36, pw * 0.16, ph * 0.10, 8);  // sofa
  rr(ctx, px + pw * 0.76, py + ph * 0.08, pw * 0.18, ph * 0.30, 8);  // bed
  rr(ctx, px + pw * 0.48, py + ph * 0.12, pw * 0.16, ph * 0.08, 4);  // island
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.85, py + ph * 0.78, pw * 0.07, ph * 0.09, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();                                          // dining table
  for (let i = 0; i < 8; i++) {                                      // stair treads
    const sy = py + ph * (0.58 + i * 0.05);
    ctx.beginPath(); ctx.moveTo(px + pw * 0.54, sy); ctx.lineTo(px + pw * 0.68, sy); ctx.stroke();
  }
  return c;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
