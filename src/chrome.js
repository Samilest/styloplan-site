// The app header, rendered from one place instead of copy-pasted into every
// page (it was duplicated five times and had already drifted).
//
// The 01/02/03 row is a PROGRESS INDICATOR for one floor, not a menu. That is
// the whole point: as a menu it invited you into Review and Studio with no
// plan loaded, and those pages answered by quietly substituting the bundled
// sample. A step you have not reached is rendered as plain text, not a link,
// so the invalid state is unreachable rather than merely discouraged.
//
// With no floor in the URL there is no pipeline at all — the header is just
// the mark plus the two library links.

import { readFloorContext, floorHref, floorStage, reachableSteps } from './floor-context.js';
import { ensureSeed } from './store.js';
import { mountAccount } from './auth-ui.js';
import { apiUrl } from './api-origin.js';

// A LOCKED STEP SAYS WHAT OPENS IT.
//
// It used to be grey text and nothing else: no tooltip, no reason, `cursor:
// default`. A greyed control that will not say why is the one thing both Apple
// and Google are explicit about — when the system refuses, it explains. Here the
// answer is short and always true, so it can simply be written down.
//
// AND IT SAYS SO WHEN TAPPED, not only on hover. A `title` is a pointer's
// affordance; a phone has none, and the greyed step was the one place the
// order of the pipeline was never explained to a thumb. Tapping a locked step
// shows the same sentence under it for a few seconds (aria-live, so it is read
// out as well). The 3D step's sentence carries the WHY: the 3D stands on the
// render, which is the thing a person has not yet understood when they look
// for a 3D before rendering.
// STEP 01 IS THE HOME'S PLANS, NOT AN UPLOAD FORM. It was "Upload", pointing
// at extract.html, and on a floor that already had a plan that page could
// only offer to replace it: a builder who opened step 01 to add the next
// floor found no way to (Saman, 2026-09-21). Floors are added and their
// plans uploaded on the Projects page, so that is where 01 goes -- to THIS
// home's card, open, with this floor marked (projects.html reads p and f).
// extract.html is still the upload flow, reached from a floor's row.
// Uploading is part of Plans, not a place of its own, and since 2026-09-26 the
// upload page SAYS so: 01 Plans is lit there. With no step lit it was the one
// page in the pipeline that did not say where you were.
const STEPS = [
  { id: 'plans', n: '01', label: 'Plans', page: 'projects.html' },
  { id: 'review', n: '02', label: 'Review', page: 'review.html', needs: 'Opens once a plan is uploaded.' },
  { id: 'studio', n: '03', label: 'Studio', page: 'studio.html', needs: 'Opens once this floor is confirmed in Review.' },
  // 3D stands ON the 2D render — it takes the styled image as its floor and
  // extrudes the walls out of it. So it is a step after Studio rather than a
  // module inside it, and `reachableSteps` only offers it once a render exists.
  { id: 'view3d', n: '04', label: '3D', page: 'view3d.html', needs: 'Opens once this floor is rendered in Studio: the 3D is built from that render, at no extra credit.' },
];

const PAGE_STEP = {
  'extract.html': 'plans',
  'review.html': 'review',
  'studio.html': 'studio',
  'view3d.html': 'view3d',
};

/** A padlock, drawn in the step's own colour. The step's words are its name; this only marks it shut. */
const LOCK = '<svg class="lock" viewBox="0 0 12 12" aria-hidden="true">'
  + '<rect x="2.5" y="5.5" width="7" height="5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/></svg>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Render the header into <header class="app-header"> (created if absent).
 * @returns {{ctx:Object|null, stage:string|null}} the floor context the header
 *          was drawn for, so the page can reuse it without re-parsing.
 */
export async function renderChrome() {
  // Every page calls this first, so it is the natural place to guarantee the
  // store exists — a floor URL opened in a fresh browser would otherwise
  // resolve to "no such floor" and silently fall back to the sample.
  ensureSeed();
  // THE PAGE'S OWN NAME, NOT ITS PATH. A GitHub Pages project site serves this
  // app from a subdirectory, so location.pathname reads styloplan-site/studio.html
  // and no comparison against a fixed path can ever match. That is why the
  // stepper marked no current step and the library nav marked no current page
  // on the live site — silently, and only there, because both are correct
  // locally. Same root cause as the 404: an absolute path assumes a root.
  //
  // A bare slash and index.html are both the projects page: index.html is a
  // copy of it, because Pages will not serve a directory that has none.
  // (Written without quoting the path, because the build's guard reads bytes
  // and cannot tell a comment from a link — which is the right trade.)
  const file = location.pathname.split('/').pop();
  const here = (!file || file === 'index.html') ? 'projects.html' : file;
  const currentStep = PAGE_STEP[here] || null;
  const ctx = readFloorContext();
  const stage = ctx ? await floorStage(ctx.project.id, ctx.floor.id) : null;

  let pipeline = '';
  if (ctx) {
    const allowed = new Set(reachableSteps(stage));
    const items = STEPS.map((s) => {
      const inner = `<span class="n">${s.n}</span>${s.label}`;
      if (s.id === currentStep) return `<a aria-current="page">${inner}</a>`;
      if (!allowed.has(s.id)) {
        // `title` for the pointer, `aria-label` for a screen reader: the label
        // alone would announce "Studio, dimmed" and leave the reason unsaid.
        // A button, so a tap can ask; `data-needs` is what the tap shows.
        const why = s.needs ? ` title="${esc(s.needs)}" aria-label="${esc(`${s.label}: ${s.needs}`)}" data-needs="${esc(s.needs)}"` : '';
        return `<button type="button" class="step-locked" aria-disabled="true"${why}>${LOCK}${inner}</button>`;
      }
      return `<a href="${floorHref(s.page, ctx.project.id, ctx.floor.id)}">${inner}</a>`;
    }).join('');
    // A breadcrumb, not one link wearing two styles. The whole thing used to be
    // a single <a> to Projects, so the bold floor name — which reads as "you are
    // here" — navigated away when clicked, and with no separator "New Model Main
    // Floor" ran together as one name. Now the part that looks like a link IS a
    // link, and the part that names where you are is plain text.
    // The project NAME is the way back, not a second "Projects" — the library
    // nav on the right already says that word, and a named target beats a
    // generic one.
    pipeline =
      `<nav class="crumbs" aria-label="Breadcrumb">` +
        `<a class="proj" href="projects.html">${esc(ctx.project.name)}</a>` +
        `<span class="sep" aria-hidden="true">›</span>` +
        `<b aria-current="page">${esc(ctx.floor.name)}</b>` +
      `</nav>` +
      `<nav class="pipeline" aria-label="Plan progress">${items}</nav>`;
  }

  // `data-dup` marks the link the PR mark already is. Both go to
  // /projects.html, and on a phone that duplicate is the difference between a
  // header that fits on two rows and one that needs three. CSS hides it there;
  // nothing is lost, because the mark beside it is the same destination.
  const lib = [['projects.html', 'Projects'], ['brandkits.html', 'Brand kits']]
    .map(([href, label]) =>
      `<a href="${href}"${here === href ? ' aria-current="page"' : ''}`
      + `${href === 'projects.html' ? ' data-dup="brand"' : ''}>${label}</a>`).join('');

  let el = document.querySelector('header.app-header');
  if (!el) {
    el = document.createElement('header');
    el.className = 'app-header';
    document.body.prepend(el);
  }
  el.innerHTML =
    `<a class="brand" href="projects.html" aria-label="StyloPlan projects">SP</a>` +
    pipeline +
    `<span class="spacer"></span>` +
    `<nav class="libnav">${lib}</nav>` +
    `<button class="btn btn--secondary btn--icon themebtn" id="themeBtn"></button>` +
    `<div class="acct" hidden></div>`;

  mountTheme(el.querySelector('#themeBtn'));
  explainLockedSteps(el);

  // Not awaited: the account area needs the network, and the header must not
  // wait on it. It fills in when it can, and stays hidden entirely where there
  // is no Supabase configured — the product runs without one.
  mountAccount(el.querySelector('.acct')).catch(() => {});
  watchForNewBuild();

  return { ctx, stage };
}

/**
 * TELL THE USER WHEN THEIR TAB IS OUT OF DATE, rather than letting them find
 * out from a picture.
 *
 * A page runs the JavaScript it loaded for as long as it stays open. Deploy
 * while somebody has Studio open and they keep running the old code — Saman hit
 * this mid-render, and the only remedy anyone knew was to hard-refresh and see
 * whether the image changed. On a page where the next button spends a credit,
 * "press ctrl-F5 and compare" is not a thing to ask of a customer.
 *
 * CHECKED WHEN THE TAB COMES BACK, not on a timer. A deploy happens while
 * someone is elsewhere, and coming back to the tab is exactly the moment the
 * question matters. A poll would ask a hundred times for one answer.
 *
 * It offers, and never acts: a reload in the middle of a review would throw
 * away work that has not been confirmed yet.
 */
let knownBuild = null;
function watchForNewBuild() {
  const read = async () => {
    try {
      const r = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
      if (!r.ok) return null;
      return (await r.json()).build || null;
    } catch { return null; }        // offline is not a new version
  };
  read().then((b) => { knownBuild = b; });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !knownBuild) return;
    const now = await read();
    if (!now || now === knownBuild || document.getElementById('newBuildBar')) return;
    const bar = document.createElement('div');
    bar.id = 'newBuildBar';
    bar.className = 'buildbar';
    bar.innerHTML = '<span>A newer version of StyloPlan is ready. '
      + 'This page is still running the old one.</span>'
      + '<button class="btn btn--secondary btn--sm" type="button">Reload</button>';
    bar.querySelector('button').onclick = () => location.reload();
    document.body.prepend(bar);
  });
}


/**
 * THE THEME CONTROL.
 *
 * DARK UNLESS TOLD OTHERWISE (Saman, 2026-09-21). The stored value is 'light'
 * or 'dark'; absent means dark, not "follow the system": the app is a dark
 * room around a plan, and a builder opening it for the first time should see
 * it as designed, then press the sun if they want it light. The anti-flash
 * script at the top of every app page applies that rule before paint, so
 * this module never sees an unset attribute; the system fallback below stays
 * only for a page that somehow lost the script.
 *
 * It names where you are GOING, not where you are. A control labelled with the
 * state you can already see reads as a status line and gets ignored; this is the
 * same call the 3D view's look button makes, and the two now agree.
 *
 * The icon follows that same rule: a sun means "press for light", a moon means
 * "press for dark". It is the destination, not the current state — which is why
 * the accessible name says "Switch to …" out loud, since a bare pictogram has no
 * way of carrying that distinction on its own.
 *
 * The stored value is applied by an inline script in each page's head, not
 * here. This module is deferred, so applying it here would repaint a page that
 * is already on screen: a white flash on every navigation for a dark-mode user.
 * By the time this runs the attribute is already set, and this only has to
 * label the button and handle the press.
 */
// Old-name prefix, kept on purpose — a rename would silently drop everyone's
// theme choice, and the key is also hard-coded in the anti-flash script at the
// top of all eight pages, so a partial rename means a page that flashes the
// wrong theme. See store.js and artifacts.js.
const THEME_KEY = 'pr-theme';

function systemDark() {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** What the page is actually showing, whoever decided it. */
function shownTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  return systemDark() ? 'dark' : 'light';
}

// Drawn rather than typed: the emoji ☀/🌙 render as a different glyph on every
// platform and some of them arrive in colour, which puts an uncontrolled hue in
// a header that has exactly one accent.
const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"'
  + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
  + '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6'
  + 'M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"'
  + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.8 6.8 0 0 0 11.1 11.1z"/></svg>';

export function mountTheme(btn) {
  if (!btn) return;
  const paint = () => {
    const next = shownTheme() === 'dark' ? 'light' : 'dark';
    btn.innerHTML = next === 'dark' ? MOON : SUN;
    // An icon button has no text, so the name has to be given explicitly or the
    // control announces itself as "button".
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
    btn.title = `Switch to ${next} mode`;
  };
  btn.onclick = () => {
    const next = shownTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    paint();
  };
  // Someone who has never chosen follows the system, so the label has to follow
  // it too when it changes under them.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) paint();
  });
  paint();
}

/**
 * A locked step, tapped, says what opens it: its sentence in a small bubble
 * under the pipeline for a few seconds, read out by assistive tech. One
 * bubble per header; a second tap moves and refreshes it.
 */
function explainLockedSteps(header) {
  const locked = header.querySelectorAll('.step-locked[data-needs]');
  if (!locked.length) return;
  // On the body, not in the header: the header clips what pops out of it
  // (overflow-x: auto, see ui.css), and this bubble is the one thing that does.
  let bubble = document.querySelector('.step-why');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'step-why tooltip';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.hidden = true;
    document.body.append(bubble);
  }
  let timer = 0;
  for (const b of locked) {
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      bubble.textContent = b.dataset.needs;
      bubble.style.top = `${Math.round(r.bottom + 6)}px`;
      bubble.style.left = `${Math.max(8, Math.min(Math.round(r.left), innerWidth - 8 - Math.min(340, innerWidth - 16)))}px`;
      bubble.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { bubble.hidden = true; }, 4500);
    });
  }
}
