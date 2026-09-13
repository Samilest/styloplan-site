// Which floor am I working on?
//
// This used to be ambient: projects.html wrote `activeFloor` into
// sessionStorage and review.html read it. Nothing else knew about it and
// nothing ever cleared it, which produced two real failures:
//   * Upload never knew which floor it was for, so a plan uploaded after
//     visiting a different floor landed on THAT floor, silently.
//   * Review with no upload fell back to the bundled sample and wrote it into
//     a real floor's scope, presenting a demo plan as the customer's.
//
// The floor now travels in the URL instead: /review.html?p=<project>&f=<floor>.
// That makes it survive refresh and back, makes a link shareable, and — most
// importantly — makes "no floor" an explicit state a page can refuse to run in
// rather than a stale pointer it silently inherits.

import { getFloor } from './store.js';
import { scopeFor, hasArtifact } from './artifacts.js';

/** Append the floor to a page URL. The one place this format is written. */
export function floorHref(page, projectId, floorId) {
  return `${page}?p=${encodeURIComponent(projectId)}&f=${encodeURIComponent(floorId)}`;
}

/**
 * THE ONE PLACE THE PLAN TITLE IS DECIDED.
 *
 * The title is the customer's, typed in Studio and stored on the floor. Until
 * they type one it is built from what they already gave us at upload: the
 * project name and the floor name, as "The Avi - Main".
 *
 * Both halves are the customer's own words. An older note here warned against
 * ever putting a plan or builder name in this field, on the grounds that
 * guessing one prints somebody else's branding on their sheet. That warning was
 * about GUESSING. Reading back the project name they typed themselves is the
 * opposite, and it is why this is a default rather than a fixed value.
 *
 * Studio and the 3D view both call this, so the name on the sheet and the name
 * over the model cannot drift apart.
 */
export function planTitleOf(project, floor) {
  const saved = (floor?.planTitle || '').trim();
  if (saved) return saved;
  return [project?.name, floor?.name].map((s) => (s || '').trim()).filter(Boolean).join(' - ');
}

/**
 * The floor named by the current URL, or null when the page was opened without
 * one (direct visit, bundled-sample mode).
 * @returns {{project, floor, scope:string}|null}
 */
export function readFloorContext() {
  const q = new URLSearchParams(location.search);
  const p = q.get('p'), f = q.get('f');
  if (!p || !f) return null;
  const { project, floor } = getFloor(p, f);
  if (!project || !floor) return null;
  return { project, floor, scope: scopeFor(p, f) };
}

/**
 * How far this floor has actually got, derived from what exists rather than
 * from a status field that can drift out of step with the artifacts.
 * @returns {'empty'|'uploaded'|'confirmed'|'styled'}
 */
export async function floorStage(projectId, floorId) {
  const { floor } = getFloor(projectId, floorId);
  const scope = scopeFor(projectId, floorId);
  if (floor?.verified) {
    // ALL THREE SLOTS, because a render is stored per theme now. Checking only
    // the legacy `styled` key reported `confirmed` for a floor that had a
    // finished dark render sitting in `styled-dark` — which in turn hid the 3D
    // step from a floor that was ready for it. Any one render is enough: the
    // 3D view already falls back across themes when it loads its floor image.
    const styled = await Promise.all(
      ['styled-light', 'styled-dark', 'styled'].map((k) => hasArtifact(scope, k)));
    return styled.some(Boolean) ? 'styled' : 'confirmed';
  }
  return (await hasArtifact(scope, 'source')) ? 'uploaded' : 'empty';
}

// Which pipeline steps a floor at each stage may enter. A step you have not
// reached yet is not a link — that is what stops Review from being opened with
// nothing to review.
// 3D appears only at `styled`, and that is not a policy choice — the 3D view
// literally builds its walls out of the styled render and stands the model on
// it as a floor texture. Offered at `confirmed` it would open onto an error,
// which is the thing this table exists to prevent.
const REACHABLE = {
  empty:     ['upload'],
  uploaded:  ['upload', 'review'],
  confirmed: ['upload', 'review', 'studio'],
  styled:    ['upload', 'review', 'studio', 'view3d'],
};
export const reachableSteps = (stage) => REACHABLE[stage] || REACHABLE.empty;
