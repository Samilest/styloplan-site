// One question, asked in the app's own voice.
//
// Six places called the browser's `confirm()`, which paints a chrome-coloured
// box with the hostname at the top of it — "samilest.github.io says" above
// a plain-text paragraph, over a product built to look like a drafting tool.
// Saman's word for it was unprofessional, and he is right: it is the one moment
// the app hands the user off to something that plainly is not the app, and it
// is a moment where the answer is destructive.
//
// It also cannot say anything. A native confirm takes one string with newlines
// in it: no emphasis on the thing being deleted, no distinction between the
// question and its consequences, and a plain OK button whatever the stakes.
//
// This is deliberately the SAME dialog for all six, built here rather than
// written into each page's markup. A confirmation copied into five HTML files
// is five things to keep in step, which is the shape of most of what has gone
// wrong in this app.

/**
 * Ask the user to confirm something, in a dialog that belongs to the app.
 *
 * @param {object} o
 * @param {string} o.title      the question, short — "Delete The Avi?"
 * @param {string|string[]} [o.body]  what will happen, one line per paragraph
 * @param {string} [o.confirm]  the affirmative button's words. Say the ACTION
 *                              ("Delete project"), never "OK": a button that
 *                              names what it does can be read on its own, and
 *                              this one cannot be undone.
 * @param {string} [o.cancel]
 * @param {boolean} [o.danger]  paint the affirmative button as destructive
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, body = [], confirm = 'Confirm', cancel = 'Cancel',
  danger = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'ask';

  const h = document.createElement('h3');
  h.style.margin = '0 0 8px';
  h.textContent = title || 'Are you sure?';
  dlg.append(h);

  for (const line of [].concat(body).filter(Boolean)) {
    const p = document.createElement('p');
    p.className = 'subtle';
    p.style.margin = '0 0 12px';
    p.textContent = line;
    dlg.append(p);
  }

  const row = document.createElement('div');
  row.className = 'row';
  row.style.cssText = 'margin-top:16px; justify-content:flex-end';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn--quiet';
  no.textContent = cancel;
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = `btn ${danger ? 'btn--destructive' : 'btn--primary'}`;
  yes.textContent = confirm;
  row.append(no, yes);
  dlg.append(row);

  document.body.append(dlg);

  return new Promise((resolve) => {
    let answer = false;
    const done = (v) => { answer = v; dlg.close(); };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    // Escape closes a <dialog> on its own and must mean no — the same as
    // clicking away from a question you did not mean to open.
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    // Clicking the backdrop is the other way people dismiss one of these. The
    // dialog fills its own box, so a click landing on the element itself is a
    // click outside the card.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(false); });
    dlg.showModal();
    // CANCEL TAKES THE FOCUS, not the destructive button. A confirmation that
    // opens with Delete focused turns a stray Return — the same key that may
    // have opened it — into the deletion itself.
    (danger ? no : yes).focus({ preventScroll: true });
  });
}
