// HELP, INSIDE THE APP (Saman, 2026-10-10).
//
// Help used to open the marketing site's questions in a new tab: someone stuck
// in Review left the app for a page written to sell it. This is a side sheet on
// the page itself, so the floor being worked on stays where it is. Loaded only
// when Help is pressed (chrome.js imports it on the click), so no page pays for
// it until it is wanted.
//
// What it holds, and nothing more: what the page you are on is for, in the
// words its own controls use; the same short answers the site gives; and a
// search over both. A search that finds nothing is recorded (events.js, our own
// database, the words only) so we learn what people ask that this does not
// answer -- that, not a guess, decides whether Help ever needs more than this.
//
// Every sentence here is a rule the app enforces or a line legal.html carries,
// as the site's questions are. Dimensions are "copied" and "confirmed", never
// guaranteed; nothing here promises an outcome.

import { track } from './events.js';

/** What each page is for, in the words its controls use. Keyed by file name. */
export const PAGE_HELP = {
  projects: {
    title: 'Projects',
    tips: [
      'A project is one home model. Its floors share one brand kit.',
      'New project starts one; then upload a plan for each floor. PDF, PNG, JPG and WebP all work.',
      'Each floor goes the same way: traced, checked by you in Review, rendered in Studio, then shown in 3D.',
      'The card says how many floors are rendered and what each one needs next.',
    ],
  },
  extract: {
    title: 'Uploading a plan',
    tips: [
      'Use the plan itself: the PDF or export from your architect, not a photo or a scan.',
      'Images need a short side of 800px or more.',
      'Tracing takes about a minute. Nothing is spent on it.',
    ],
  },
  review: {
    title: 'Review & verify',
    tips: [
      'Five checks, in order: room count, no extra walls or doors, staircases, dimensions, and beds, baths and size.',
      'Drag the handle to compare your plan with our drawing. Click a teal label to fix its name or dimension.',
      'Fix the drawing removes what the tracing added, or adds what it missed.',
      'Dimensions are copied from your drawing, never measured. You confirm each one.',
      'Confirm & style opens Studio. Nothing here costs a credit.',
    ],
  },
  studio: {
    title: 'Style & brand',
    tips: [
      'Choose Light or Dark. Rendering a floor costs one credit; a render our checks reject is redone at no charge.',
      'Colours, labels, the title and the footer change instantly, with no new render.',
      'Square, Landscape and Portrait are the same render laid out again. The plan is never cropped.',
      'Export the branded image as JPG, PNG or PDF, or the MLS-safe PNG: the plan alone, with no logo or name.',
    ],
  },
  view3d: {
    title: 'The 3D view',
    tips: [
      'Built from your render, so it costs no extra credit.',
      'Walls, windows, doors and stairs are read from the symbols on your drawing. Check them under Windows and doors, then confirm.',
      'Share this plan gives a link to send and a code to embed on your website.',
      'Save image keeps the view as it is on screen.',
    ],
  },
  brandkits: {
    title: 'Brand kits',
    tips: [
      'One kit per client: its company name, tagline, website, logo, label font and colours go on every image.',
      'New projects start with the kit marked New projects. A project can change its kit in its settings.',
      'House style renames, merges or hides room names on every plan that uses the kit.',
    ],
  },
};

/** The site's questions (index.html #a09), word for word. */
export const QUESTIONS = [
  ['How accurate are the dimensions?',
    'They are copied from your drawing, never measured or calculated. You check and confirm each one before anything renders, and the image says so in its footer.'],
  ['What if the tracing gets something wrong?',
    'You fix it on the review screen, for free. Rename a room, correct a dimension, remove anything the tracing added, or trace the plan again. Nothing is spent until you render.'],
  ['What kind of plan works best?',
    'The plan itself: the PDF or export from your architect, not a photo or a scan. PDF, PNG, JPG and WebP all work. Images need a short side of 800px or more.'],
  ['Can I use the images for a permit or for construction?',
    'No. They are presentation material for marketing, and every image says so in its footer. Use your architect’s drawings for anything built or approved.'],
  ['What does the 3D view show, and what does it cost?',
    'Walls, windows, doors and stairs, read from the symbols on your drawing. You confirm the windows and doors. It is built from your render, so it costs no extra credit.'],
  ['What if I do not like the render?',
    'A render our checks reject is redone at no charge. Colours, type and logo change instantly, with no new render. A render you ask for again costs a credit.'],
  ['Who owns the images, and who sees my plans?',
    'The images are yours to use commercially. We do not train on your plans, publish them or show them to other customers. Who sees your plans lists exactly where they go.',
    { href: 'legal.html#processors', text: 'Who sees your plans' }],
  ['Is there a subscription?',
    'No. Credits are bought once and never expire. Stop whenever you like and keep everything you made.'],
];

const pageKey = () => (location.pathname.split('/').pop() || 'projects.html').replace(/\.html$/, '');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Words of three letters or more, lower case. */
const words = (s) => String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || [];

/**
 * Every tip and answer that has all the query's words in it (a word matches
 * the start of a word, so "dimension" finds "dimensions").
 */
export function searchHelp(query) {
  const want = words(query);
  if (!want.length) return null;
  const hit = (text) => { const have = words(text); return want.every((w) => have.some((h) => h.startsWith(w))); };
  const out = [];
  for (const [key, page] of Object.entries(PAGE_HELP)) {
    for (const tip of page.tips) if (hit(`${page.title} ${tip}`)) out.push({ kind: 'tip', page: key, title: page.title, text: tip });
  }
  for (const [q, a] of QUESTIONS) if (hit(`${q} ${a}`)) out.push({ kind: 'question', title: q, text: a });
  return out;
}

const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function answerHtml([, a, link]) {
  if (!link) return `<p>${esc(a)}</p>`;
  const [before, after] = a.split(link.text);
  return `<p>${esc(before)}<a href="${esc(link.href)}">${esc(link.text)}</a>${esc(after ?? '')}</p>`;
}

function build() {
  const here = PAGE_HELP[pageKey()];
  const dlg = document.createElement('dialog');
  dlg.id = 'helpPanel';
  dlg.className = 'help-sheet';
  dlg.setAttribute('aria-labelledby', 'helpTitle');
  dlg.innerHTML = `
    <div class="help-head">
      <h2 id="helpTitle">Help</h2>
      <button type="button" class="btn btn--icon btn--quiet help-close" aria-label="Close help">${CLOSE}</button>
    </div>
    <div class="help-search">
      <input type="search" id="helpQuery" placeholder="Search help" aria-label="Search help" autocomplete="off" spellcheck="false">
    </div>
    <div class="help-body">
      <div id="helpResults" hidden aria-live="polite"></div>
      <div id="helpBrowse">
        ${here ? `<section class="help-page" aria-labelledby="helpHere">
          <h3 id="helpHere">On this page</h3>
          <p class="help-where">${esc(here.title)}</p>
          <ul>${here.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </section>` : ''}
        <section class="help-questions" aria-labelledby="helpQs">
          <h3 id="helpQs">Questions</h3>
          ${QUESTIONS.map((qa) => `<details><summary>${esc(qa[0])}</summary>${answerHtml(qa)}</details>`).join('')}
        </section>
      </div>
    </div>`;
  document.body.append(dlg);

  const input = dlg.querySelector('#helpQuery');
  const results = dlg.querySelector('#helpResults');
  const browse = dlg.querySelector('#helpBrowse');
  const reported = new Set();
  let missTimer = 0;
  const render = () => {
    const q = input.value.trim();
    const found = searchHelp(q);
    clearTimeout(missTimer);
    if (!found) { results.hidden = true; browse.hidden = false; return; }
    browse.hidden = true;
    results.hidden = false;
    if (!found.length) {
      results.innerHTML = `<p class="help-none">Nothing in Help matches “${esc(q)}”. Try other words, or clear the search to see every question.</p>`;
      // Once a search has settled, and once per search: what people ask that
      // Help does not answer. The words only, cut to 80 characters.
      missTimer = setTimeout(() => {
        const key = q.toLowerCase();
        if (key.length >= 3 && !reported.has(key)) { reported.add(key); track('help_search_miss', { query: q.slice(0, 80) }); }
      }, 1500);
      return;
    }
    results.innerHTML = `<p class="help-count">${found.length} ${found.length === 1 ? 'answer' : 'answers'}</p>`
      + found.map((r) => (r.kind === 'question'
        ? `<article class="help-hit"><h3>${esc(r.title)}</h3>${answerHtml(QUESTIONS.find((qa) => qa[0] === r.title))}</article>`
        : `<article class="help-hit"><h3>${esc(r.title)}</h3><p>${esc(r.text)}</p></article>`)).join('');
  };
  input.addEventListener('input', render);

  const close = () => dlg.close();
  dlg.querySelector('.help-close').addEventListener('click', close);
  // A press on the backdrop (the dialog element itself, outside the sheet's
  // content box) closes it, as a sheet that slid in should.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  return dlg;
}

let sheet = null;

/** Opens the sheet from the header's Help button, and gives focus back to it on close. */
export function openHelp(opener) {
  if (!sheet) sheet = build();
  if (sheet.open) return;
  opener?.setAttribute('aria-expanded', 'true');
  sheet.addEventListener('close', () => { opener?.setAttribute('aria-expanded', 'false'); opener?.focus(); }, { once: true });
  sheet.showModal();
  track('help_opened', {});
}
