// Constrained customization (handoff principle 5): 6 curated presets, the two
// shipped defaults first. Raw per-element control is never exposed.
//
// A preset carries four colours but only TWO are editable, and the distinction
// matters. `background` and `walls` reach a real export — as the canvas around
// the plan and the ink of every label the compositor draws. `floors` and
// `accent` feed `derived()` values (hallway, line, shadow) that only
// src/mock-style.js consumes, so on a genuine styled render they change
// nothing. They stay in the data because the mock needs them; they are not
// offered as controls, because a control that does nothing teaches the user
// that the product ignores them.
//
// The plan's own colours are not here at all. Light and Dark are finished looks
// baked into the styling prompts, and the one adjustment on top is the monotone
// tint in src/recolour.js, driven by a single brand colour on the kit.
//
// Note: no green anywhere (styling restraint rule).

export const PRESETS = [
  { id: 'editorial-light', name: 'Editorial Light', theme: 'light',
    background: '#EDEAE3', walls: '#2B2B2B', floors: '#D6D2CA', accent: '#4A453C' },
  { id: 'gallery-dark', name: 'Gallery Dark', theme: 'dark',
    background: '#3A3D40', walls: '#F2F1EE', floors: '#46494C', accent: '#B49A6C' },
  { id: 'warm-sand', name: 'Warm Sand', theme: 'light',
    background: '#F0E8DB', walls: '#3B342C', floors: '#E0D6C4', accent: '#A67C52' },
  { id: 'porcelain', name: 'Porcelain', theme: 'light',
    background: '#EFF1F2', walls: '#2E3A45', floors: '#DCE1E5', accent: '#5B7A99' },
  { id: 'graphite-bronze', name: 'Graphite Bronze', theme: 'dark',
    background: '#33363A', walls: '#EFECE5', floors: '#43474C', accent: '#B49A6C' },
  { id: 'ink-navy', name: 'Ink Navy', theme: 'dark',
    background: '#2B3038', walls: '#EEF1F4', floors: '#3A4250', accent: '#7E97B8' },
];

// ---- color helpers
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
export function blend(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
}
export function luminance(h) {
  const [r, g, b] = hexToRgb(h);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// THE PALETTE DOES NOT REACH THE IMAGE MODEL, AND THE ATTEMPT IS CLOSED.
//
// `promptVars(p)` used to live here and returned BG_LIGHT / WALL_LIGHT /
// FLOOR_DARK and so on, for `{{BG_LIGHT | #EDEAE3}}`-style placeholders in the
// styling prompts. It was deleted 2026-08-17 because it had not done anything
// for weeks: the placeholders were replaced by their literal defaults on
// 2026-07-31 (`src/ai/prompts.js.bak-20260731-2128` still has them), so the
// object was assembled on every render and matched nothing. The current
// templates contain exactly one placeholder, `{{CARS | one}}`.
//
// WHY IT WAS ABANDONED — TWO LIVE TESTS, BOTH NEGATIVE, TWO CREDITS SPENT.
// The image model will not take a colour instruction. It was asked once with a
// hex code substituted into the template, and once with the hex AND the words
// (`deep navy blue-black`). Measured against the untouched Gallery Dark
// baseline, all three renders came back the same neutral dark grey — sampled
// wall and background within a couple of steps of each other. The table is in
// AGENT-HANDOFF; the placeholders were reverted and prompts.js restored to its
// promoted V3 byte-for-byte.
//
// This is not a prompt-wording problem, and a third phrasing is not the missing
// piece. The style prompt's own language holds the palette and nothing passed
// in overrides it.
//
// Worth knowing before reviving it: the failure was found TWICE. First the
// palette silently did nothing because V3 had zero `{{...}}` slots at all —
// `promptVars` built correct hex values and posted them into a template with
// nowhere to put them, so six presets produced exactly two prompts. Adding the
// slots fixed the plumbing and proved the model ignores the values anyway.
// Plumbing that works is not evidence the instruction lands.
//
// SO DO NOT EDIT A STYLING PROMPT TO CHANGE COLOUR. Those three prompts are
// production assets under red line 3, and colour is not what they control.
// Colour is applied afterwards by `recolourPlan` (src/recolour.js) as a display
// transform over the finished render — which is also why a rebrand costs zero
// API calls, and why `paletteKey` is only `theme|engineKey`.
//
// Only ONE thing about a palette reaches the model: `theme`, and it does so by
// selecting the light or dark template, never as a variable.
//
// If a future model does accept colour, this is a real change and not a
// restoration: it would put a customer's brand colour inside the billed render,
// so a re-brand would start costing a re-render. Measure that trade before
// reviving anything here.

// Derived values used by the compositing layer and the mock renderer.
export function derived(p) {
  const light = p.theme === 'light';
  return {
    hallway: blend(p.floors, p.background, light ? 0.45 : -0), // light: lighter tint; dark handled below
    hallwayDark: blend(p.floors, p.walls, 0.06),
    labelInk: light ? p.walls : blend(p.walls, '#ffffff', 0.15),
    footerInk: light ? p.walls : blend(p.walls, '#ffffff', 0.15),
    line: light ? p.accent : blend(p.walls, p.background, 0.18),
    shadow: light ? p.accent : '#000000',
  };
}
