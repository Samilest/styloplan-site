// The 3D scene's colours, derived from the palette chosen in the Studio.
//
// WHY DERIVED AND NEVER RE-ASKED. The 3D view is a second look at ONE plan, not
// a second product. Giving it its own colour controls would put two places in
// charge of one decision, and the two would drift — which is exactly how the
// eraser came to reach the styled render and not the wireframe, and how the
// label font came to differ between the Studio and the wireframe download.
// Colour is decided once, in the Studio; everything downstream reads it.
//
// This file deliberately does NOT import three. It is colour arithmetic, and
// keeping it separate is what lets it be tested in node rather than by eye.

import { derived, blend, luminance, PRESETS } from '../palettes.js';

/** Two looks, and they are the SAME two the 2D render offers. A third would
 *  mean a plan whose 3D cannot match its own printed image.
 *
 *  DEFINED BELOW from the Studio's own default palettes rather than written by
 *  hand — see FALLBACK_PALETTE. Hand-picked values were the reason the light
 *  mode looked nothing like the Studio's light branding: a neutral white-grey
 *  invented here, against the Studio's warm Editorial Light. A fallback that
 *  disagrees with the product's own default is not a fallback, it is a second
 *  opinion. */
export let THEMES;

/**
 * The wall solid: the ground colour, one clean step of value away.
 *
 * MIXING THE INK IN IS WHAT MADE IT DIRTY. Blending the warm cream ground with
 * the charcoal wall ink gave a muddy grey-beige — two colours from opposite
 * ends of the wheel average into mud, every time. The ink is for DRAWING walls
 * on paper; it has no business colouring a solid.
 *
 * Stepping the ground toward black (light palette) or white (dark one) keeps
 * the hue and changes only the value, which is what a white architectural
 * model does: one material, form read entirely from light. The lighting does
 * the rest — with a real key light the faces spread far more than any hand
 * -picked triple of tones ever did.
 */
// Two steps, because the two polarities do NOT have the same problem.
//
// On a light palette the walls only have to clear the ground, and 0.22 does it.
// On a dark one they also have to clear the FLOOR — the plan image, which is
// itself a dark surface — and at 0.22 the walls landed at 0.37 luminance
// against a 0.26 floor. Eleven points is not a separation; the volumes read as
// part of the drawing.
const WALL_STEP_LIGHT = 0.22;
const WALL_STEP_DARK = 0.34;
const wallSolid = (p) => (luminance(p.background) > 0.5
  ? blend(p.background, '#000000', WALL_STEP_LIGHT)
  : blend(p.background, '#ffffff', WALL_STEP_DARK));

const hex = (h) => {
  const n = Number.parseInt(String(h).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A Studio palette → the scene's colours.
 *
 * The mapping is deliberately literal: what is a wall in the print is a wall
 * here. `line` comes from `derived()` so the model's edges match the 2D
 * render's line treatment instead of being picked again by eye.
 *
 * A palette missing any of its three surface colours falls back to the fixed
 * theme rather than half-applying — a scene with the customer's floor and a
 * stock wall is worse than one that is honestly stock.
 *
 * @param {object} palette  background, walls, floors, accent, theme
 */
export function themeFromPalette(palette) {
  const mode = palette && palette.theme === 'light' ? 'light' : 'dark';
  if (!palette || !palette.background || !palette.walls || !palette.floors) return THEMES[mode];
  const d = derived(palette);
  return {
    // The viewport ground, held just off pure white on a light palette.
    //
    // It is NOT the printed canvas. The 2D export's background is a paper
    // colour and stays exactly as branded; this is the empty space a model
    // floats in, and at the printed cream (0.92) the pale wall solids sat too
    // close to it. Lifting only the light case keeps the brand relationship
    // while giving the silhouette room. A dark palette is left alone — there
    // is nothing to lift it toward.
    // The ground: lifted toward white on a light palette, pushed DOWN on a dark
    // one. Swapping the two was tried and looked worse — the darker solid on a
    // lighter field flattened the model. Walls stay lighter than the ground;
    // the ground just gets out of their way.
    bg: hex(luminance(palette.background) > 0.5
      ? blend(palette.background, '#ffffff', 0.6)
      : blend(palette.background, '#000000', 0.38)),
    line: hex(d.line),
    // A WALL SOLID IS NOT THE WALL INK.
    //
    // `palette.walls` is the colour the 2D render DRAWS walls with — dark ink
    // on a light sheet. Using it for the 3D solid put the volumes at almost the
    // same luminance as the plan image lying under them, and the whole model
    // read as one dark mass with no depth.
    //
    // The solid instead sits BETWEEN the floor and the background: clearly
    // lighter than the drawing it stands on, and held well short of the ground
    // it stands against, so the silhouette never dissolves into the canvas.
    // `wallLift` is the fraction of the way; the clamp is what stops a pale
    // palette pushing the walls into the background.
    wall: hex(wallSolid(palette)),
    // A door leaf reads as a lighter piece of the wall it hangs in, so it is
    // mixed from wall and floor rather than given a colour of its own.
    leaf: hex(blend(palette.walls, palette.floors, 0.5)),
    floor: hex(palette.floors),
    // The slab under the plan sits BEHIND the floor, pushed toward the
    // background — that is what stops the model reading as a floating sheet.
    base: hex(blend(palette.floors, palette.background, 0.55)),
    glass: hex(d.line),
    // THREE TONES, AND THEIR ORDER IS THE WHOLE POINT.
    //
    //   body   the wall's own colour, flattest
    //   edge   a small step of contrast — enough to read the form
    //   top    the biggest step — the only light cue in a scene of unlit
    //          materials, and what says "you are looking at the top of a
    //          solid" rather than "a hole in the floor"
    //
    // The step is taken AWAY FROM THE WALL'S OWN LUMINANCE, not toward the
    // background. Blending toward the background inverts between palettes: in
    // Editorial Light the wall is dark on a light ground, so "toward the
    // background" is lighter, and the edge overtook the top. Judging by the
    // wall itself keeps body < edge < top in every palette.
    ...(() => {
      // Stepped from the SOLID, not from the ink — the solid is what the viewer
      // actually sees, and stepping from the ink left the edge and top in a
      // different family of tones from the body they belong to.
      const solid = wallSolid(palette);
      const towards = luminance(solid) < 0.5 ? '#ffffff' : '#000000';
      return {
        wallEdge: hex(blend(solid, towards, 0.20)),
        wallTop: hex(blend(solid, towards, 0.38)),
        // INTERIOR PARTITIONS SIT A SHADE BACK FROM THE ENVELOPE.
        //
        // With one tone for every wall the building reads as a single mass and
        // the eye cannot tell the shell from the partitions inside it. A small
        // step — smaller than the one between the body and its own edge, so it
        // never competes with the form cues — separates them the way a drafter
        // separates them with line weight.
        wallInner: hex(blend(solid, towards, 0.12)),
      };
    })(),
    // ROOM NAMES ARE LIT, NOT INKED — AND THEY SIT ON THE FLOOR.
    //
    // `d.labelInk` is the colour the 2D render PRINTS names in: dark on paper.
    // Here they float over the plan IMAGE, so the surface that matters is the
    // floor, not the palette's paper. Deriving from `background` made the dark
    // theme's names a mid grey that had no contrast against anything.
    //
    // Taken from the FLOOR and carried almost all the way to white, so the
    // names are bright in both themes and keep a trace of the floor's own hue
    // rather than reading as a foreign white.
    //
    // ONE DIRECTION, WHITE, IN BOTH LOOKS — see labelHalo below, which is what
    // pays for it. This flipped by floor luminance for a while, after white on
    // the light render's greige floor turned out to be a smudge; that was
    // legible and it was two designs, and the halo is the answer that keeps one.
    label: blend(palette.floors, '#ffffff', 0.88),
    // THE HALO IS WHAT MAKES ONE LABEL COLOUR POSSIBLE.
    //
    // The rule above used to flip: white names on a dark floor, near-black on a
    // pale one. It is legible and it is two designs — the same plan reads as
    // two different products depending on the look chosen, and Saman asked for
    // white in both.
    //
    // White in both needs the answer cartography settled on a century ago and
    // every map still uses — a HALO, not a drop shadow and not a plate. Esri,
    // Mapbox and Apple Maps all draw label text with a stroke of the ground
    // colour laid under the glyphs, because a map label crosses land, water and
    // imagery in one word and no single background exists to sit it on. A
    // styled floor plan is the same problem: one name crosses a pale floor, a
    // dark counter and a rug.
    //
    // Taken from the FLOOR and carried nearly to black, the same way the label
    // is carried nearly to white, so both keep a trace of the drawing's own hue
    // and neither reads as pasted on.
    labelHalo: blend(palette.floors, '#000000', 0.82),
  };
}

/**
 * The palette used when a floor has not been styled yet.
 *
 * The Studio's own defaults, by id, so the untouched 3D view and the untouched
 * 2D render are the same design decision rather than two.
 */
const FALLBACK_PALETTE = {
  light: PRESETS.find((p) => p.id === 'editorial-light'),
  // ink-navy, not gallery-dark. Gallery Dark is a NEUTRAL grey, and the model
  // came out the colour of concrete; the blue-slate the Studio's dark mode is
  // known by is this one. It also matches the hand-picked theme this file
  // replaced (#11151c ground, #171c25 walls), which was the look Saman had
  // approved all along.
  dark: PRESETS.find((p) => p.id === 'ink-navy'),
};

THEMES = {
  light: themeFromPalette(FALLBACK_PALETTE.light),
  dark: themeFromPalette(FALLBACK_PALETTE.dark),
};

/**
 * The colour a room name takes on a floor of a GIVEN measured tone.
 *
 * `themeFromPalette` asks the same question of `palette.floors`, and that is
 * right for a scene built to the palette. It is wrong the moment the floor on
 * screen is not the floor the palette describes — which happens whenever a look
 * has no render of its own and borrows the other one's. A light palette over a
 * borrowed dark render put near-black names on a charcoal floor.
 *
 * Same rule, applied to whichever floor is actually there: carry the floor's
 * own colour most of the way toward white if it is dark, toward near-black if
 * it is pale. Keeping a trace of the floor rather than going to pure white is
 * what stops the names looking pasted on.
 *
 * @param {[number,number,number]} tone the floor's measured colour
 */
export function labelOn(tone) {
  const mix = (v) => Math.round(v + (255 - v) * 0.88);
  return `rgb(${mix(tone[0])}, ${mix(tone[1])}, ${mix(tone[2])})`;
}

/**
 * The halo drawn under a name measured against its floor.
 *
 * Pairs with `labelOn` — see the note on `labelHalo` in themeFromPalette for
 * why one light label plus a halo beats two label colours.
 *
 * @param {[number,number,number]} tone the floor's measured colour
 */
export function haloOn(tone) {
  const mix = (v) => Math.round(v * (1 - 0.82));
  return `rgb(${mix(tone[0])}, ${mix(tone[1])}, ${mix(tone[2])})`;
}

/**
 * WHICH LOOK A RENDER IS, READ FROM THE RENDER.
 *
 * Every styled image is stored under a kind that names its look, so normally
 * nobody has to ask. Floors rendered before the two looks were separate kinds
 * are stored under a plain `styled`, and for those the label is simply missing:
 * the 3D page then reported "this floor has no dark render" while standing on
 * a dark render, and offered to render both looks the customer already had one
 * of. Two false statements from one missing label.
 *
 * The look is not a lost fact, it is a visible property of the image. The floor
 * of a dark render is dark. So it is measured rather than guessed, from the
 * same tone the labels are already coloured against.
 *
 * @param {[number,number,number]} tone the floor's measured colour
 * @returns {'light'|'dark'}
 */
export function lookOfTone(tone) {
  const lum = 0.2126 * tone[0] + 0.7152 * tone[1] + 0.0722 * tone[2];
  return lum < 128 ? 'dark' : 'light';
}

/**
 * The look of a render, from the image itself.
 *
 * A whole-image average rather than a sampled floor tone: this only has to
 * separate light from dark, which an average does at 24x24 for almost nothing.
 * A dark render averages around 40, a light one past 200.
 *
 * Lives here beside lookOfTone because two pages need it for the same reason:
 * a render stored under the untagged `styled` kind carries no label, and both
 * the 3D view and the delivery pack were treating "unlabelled" as "matches
 * whatever we asked for".
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @returns {'light'|'dark'|null} null when the image cannot be read
 */
export function lookOfImage(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return lookOfTone([r / n, gr / n, b / n]);
  } catch {
    return null;
  }
}
