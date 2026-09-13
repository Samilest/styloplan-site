// Mock L1 provider — the "bundled sample plan" path (handoff UX principle 7:
// the no-signup demo runs only on our own file). No API key, no network.
// Produces: (a) a B/W wireframe drawn to Prompt-1 spec (linework + re-typeset
// labels), and (b) the extraction JSON that a real vision pass would return.

import { MOCK_ROOMS, MOCK_PLAN_INSET } from './mock-plan.js';
import { sampleLabels } from './sample-project.js';

export function makeMockWireframe(w = 1600, h = 1200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const px = w * MOCK_PLAN_INSET, py = h * MOCK_PLAN_INSET;
  const pw = w * (1 - 2 * MOCK_PLAN_INSET), ph = h * (1 - 2 * MOCK_PLAN_INSET);
  const R = (r) => [px + r.x * pw, py + r.y * ph, r.w * pw, r.h * ph];

  // walls: exterior thick band, interior thinner — pure black on white
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(10, w * 0.012);
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = Math.max(4, w * 0.005);
  for (const r of MOCK_ROOMS) ctx.strokeRect(...R(r));

  // stair treads + direction arrow (graphic element)
  ctx.lineWidth = 2;
  const sx = px + pw * 0.54, sw = pw * 0.14;
  for (let i = 0; i < 8; i++) {
    const sy = py + ph * (0.58 + i * 0.05);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy); ctx.stroke();
  }
  const ax = sx + sw / 2;
  ctx.beginPath();
  ctx.moveTo(ax, py + ph * 0.95); ctx.lineTo(ax, py + ph * 0.60);
  ctx.moveTo(ax - 8, py + ph * 0.66); ctx.lineTo(ax, py + ph * 0.60); ctx.lineTo(ax + 8, py + ph * 0.66);
  ctx.stroke();

  // a few fixture outlines (kitchen island, tub) — minimal line symbols
  ctx.lineWidth = 2.5;
  ctx.strokeRect(px + pw * 0.48, py + ph * 0.12, pw * 0.16, ph * 0.08); // island
  ctx.strokeRect(px + pw * 0.325, py + ph * 0.60, pw * 0.06, ph * 0.28); // tub
  ctx.beginPath(); // toilet
  ctx.ellipse(px + pw * 0.46, py + ph * 0.90, pw * 0.022, ph * 0.035, 0, 0, Math.PI * 2);
  ctx.stroke();

  // re-typeset labels: UPPERCASE name, dimension below at ~half size (Prompt 1 spec)
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  const base = Math.round(w * 0.017);
  for (const l of sampleLabels) {
    const cx = l.x * w, cy = l.y * h;
    ctx.font = `500 ${base}px Roboto, sans-serif`;
    ctx.fillText(l.name.toUpperCase(), cx, cy);
    ctx.font = `400 ${Math.round(base * 0.55)}px Roboto, sans-serif`;
    ctx.fillText(l.dim, cx, cy + base * 0.9);
  }
  return c;
}

export function mockExtraction() {
  const spaces = sampleLabels.map((l) => ({
    name: l.name.toUpperCase(),
    dim: l.dim,
    anchor: { x: l.x, y: l.y },
  }));
  // the two UNLABELED enclosed spaces — counted, never merged (red-line #1 failure mode)
  spaces.push(
    { name: null, dim: null, anchor: { x: 0.55, y: 0.44 } },  // hallway
    { name: null, dim: null, anchor: { x: 0.60, y: 0.75 } },  // stair landing
  );
  return {
    planAspectRatio: 1600 / 1200,
    spaceCount: spaces.length,
    spaces,
    doorCount: 8,
    windowCount: 6,
    staircases: [
      { flights: 1, divider: false, direction: 'up', position: { x: 0.61, y: 0.75 } },
    ],
    notes: 'Two enclosed spaces are unlabeled (hallway and stair landing) — confirm they are real spaces.',
  };
}
