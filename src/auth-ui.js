// The account control in the header, and the sign-in dialog behind it.
//
// Deliberately small and never in the way. The product works signed out — every
// local, free thing keeps working — so this is a status light with a door
// behind it, not a gate across the app. The one place it becomes a gate is the
// render button, and that gate belongs to Studio, not here.
//
// A native <dialog>: it brings focus trapping, Escape, and the backdrop with it,
// none of which are worth reimplementing.

import {
  startAuth, onAuthChange, authState, signIn, signUp, signOut, retrySync, signInWithGoogle,
  clearOAuthError, parkTermsAcceptance, setSignOffName,
} from './auth.js';
import { isCloudReady } from './supabase-client.js';
import * as store from './store.js';
import { forgetScope } from './artifacts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let dialog = null;

// THE FOOTER FOLLOWS THE SAME SHAPE AS EVERY OTHER DIALOG HERE: the aside on
// the left, then the way out, then the confirm on the right — the order the
// project-settings dialog already uses, with its Delete as the aside.
//
// It used to open with the primary button and separate the two halves with a
// span carrying the class "grow", which NO stylesheet defines. So the spacer
// was zero wide, justify-content: flex-end packed all three against the right
// edge, and the primary action sat where a cancel belongs. The mechanism
// ui.css actually provides is .act-aside, and it is what is used now.
function buildDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'auth-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="auth-form" novalidate>
      <h3 id="authTitle">Sign in</h3>
      <p class="subtle" id="authWhy">An account is needed to render. Everything else works without one.</p>
      <!-- FIRST, because it is the shorter road and for most people the only
           one they will take: no password to invent, and the same button signs
           in and signs up. The email form stays underneath rather than behind a
           disclosure — someone who does not want Google linked to their work
           should not have to go looking. -->
      <button type="button" id="authGoogle" class="btn btn--secondary auth-google">
        <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
          <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
        </svg>
        <span>Continue with Google</span>
      </button>
      <p class="auth-or"><span>or use an email address</span></p>
      <!-- THE LABEL SITS IN THE FIELD until there is something to say. Three
           stacked label-above-input pairs is six rows of chrome for three
           answers, and this dialog is already carrying a Google button and a
           divider above them.
           IT IS A LABEL, NOT A PLACEHOLDER. A placeholder is gone the moment
           anyone types, so a half-filled form stops saying which box is which
           and a screen reader gets nothing. This one moves up and stays.
           The single-space placeholder is the mechanism: it makes
           :placeholder-shown mean "empty", which is the only way CSS can ask
           that question. Do not remove it, and do not write it in backticks --
           this whole block lives inside a template literal, and a backtick here
           closes the string. It did, once. -->
      <div class="fld-float" id="authNameRow" hidden>
        <input type="text" id="authName" autocomplete="name" placeholder=" ">
        <label for="authName">Your name</label>
      </div>
      <div class="fld-float">
        <input type="email" id="authEmail" autocomplete="email" placeholder=" " required>
        <label for="authEmail">Email</label>
      </div>
      <div class="fld-float">
        <input type="password" id="authPass" autocomplete="current-password" placeholder=" " required minlength="6">
        <label for="authPass">Password</label>
      </div>
      <p class="auth-msg" id="authMsg" role="alert" hidden></p>
      <!-- CONSENT SITS WHERE THE ACCOUNT IS MADE, not in a line of small print
           under a button. Shown only when creating one: an existing customer
           agreed when they joined, and asking again every time they sign in
           trains people to tick without reading.
           The link opens in a new tab so a half-filled form is not thrown away
           by going to read what is being agreed to. -->
      <label class="check" id="authTermsRow" hidden style="align-items:flex-start">
        <input type="checkbox" id="authTerms">
        <span>I have read and accept the
          <a href="legal.html#terms" target="_blank" rel="noopener">terms of service</a>
          and the <a href="legal.html#privacy" target="_blank" rel="noopener">privacy policy</a>.</span>
      </label>
      <div class="row auth-actions">
        <button type="button" id="authCancel" class="btn btn--quiet">Cancel</button>
        <button type="submit" id="authGo" class="btn btn--primary">Sign in</button>
      </div>
      <!-- OUT OF THE BUTTON ROW ON PURPOSE. In the row it was the smallest text
           on the dialog and quieter than Cancel, which is the wrong order: for
           somebody who has never been here, this is the control they need.
           The question in front of it is what makes it findable to a person
           scanning the dialog rather than reading it. -->
      <p class="auth-alt" id="authAltRow">
        <span id="authAltAsk">New to StyloPlan?</span>
        <button type="button" id="authSwap" class="link">Create an account</button>
      </p>
    </form>`;
  document.body.append(dialog);

  const $ = (id) => dialog.querySelector('#' + id);
  let mode = 'in';
  // Not stored anywhere. The setting is the operator's, and a remembered
  // "closed" would still be turning people away a week after it reopened.
  let signupsOff = false;

  const setMode = (m) => {
    mode = m;
    const up = m === 'up';
    $('authTitle').textContent = up ? 'Create an account' : 'Sign in';
    $('authGo').textContent = up ? 'Create account' : 'Sign in';
    $('authSwap').textContent = up ? 'Sign in' : 'Create an account';
    $('authAltAsk').textContent = up ? 'Already have an account?' : 'New to StyloPlan?';
    // One element to hide now: the wrapper carries the label with it.
    $('authNameRow').hidden = !up;
    $('authPass').autocomplete = up ? 'new-password' : 'current-password';
    $('authMsg').hidden = true;
    // The consent row belongs to creating an account, and it starts clear every
    // time the dialog changes shape: a tick left over from a previous visit is
    // not a decision anybody made now.
    $('authTermsRow').hidden = !up;
    $('authTerms').checked = false;
    // ONE PLACE DECIDES THE SHAPE. Once the server has said sign-ups are shut,
    // the way to a new account goes and the reason takes the subtitle's place —
    // and it has to be decided HERE, because closing the dialog runs setMode
    // again. Setting it at the call site instead left the offer hidden and the
    // explanation gone the next time the dialog opened.
    // The whole row, not just the button: a question with nothing after it is
    // worse than no question.
    $('authAltRow').hidden = signupsOff;
    // WHAT SIGNING IN GIVES THEM, not what they could have skipped.
    //
    // This said "An account is needed to render. Everything else works without
    // one." Both halves are true and the second one is a real strength of the
    // product — but not HERE. Someone reading it has already pressed Sign in;
    // telling them at that moment that they did not have to is a sentence that
    // argues with the button they just chose, and it reads as apology.
    //
    // The place for "works without an account" is before the decision — on the
    // empty state, where somebody is deciding whether to start at all. In the
    // dialog, the useful sentence is the one that says what is on the other
    // side of it.
    $('authWhy').textContent = signupsOff
      ? 'This app is not open for new accounts yet.'
      : up
        // ONE, NOT FIVE. supabase/free-tier.sql sets credit_balances.credits
        // to default 1; this line still promised 5, which is what it was
        // before the free tier was closed. It is shown at the moment somebody
        // decides whether to sign up, so it was the worst place on the site to
        // be four credits generous.
        ? 'New accounts start with one render credit.'
        : 'Your projects, brand kits and credits live on your account.';
  };

  const say = (text, kind = 'bad') => {
    const el = $('authMsg');
    el.textContent = text;
    el.className = `auth-msg ${kind}`;
    el.hidden = false;
  };

  $('authSwap').onclick = () => setMode(mode === 'in' ? 'up' : 'in');
  $('authCancel').onclick = () => dialog.close();

  // THE BUTTON STAYS BUSY UNTIL THE PAGE GOES. signInWithGoogle starts a
  // navigation and does not come back; there is no success to render. What
  // there is, is a second or two of nothing while the redirect is prepared, and
  // an unchanged button in that gap invites a second press.
  $('authGoogle').onclick = async () => {
    // GOOGLE MAKES AN ACCOUNT TOO. It is one button for both roads, so in
    // sign-up mode it needs the same tick the email form needs; skipping it
    // here would leave the shorter road as the one with no agreement on it.
    if (mode === 'up' && !$('authTerms').checked) {
      return say('Please accept the terms of service and the privacy policy to create an account.');
    }
    // Parked here, before the page is handed to Google, and written when the
    // session comes back. See parkTermsAcceptance in auth.js.
    if (mode === 'up') parkTermsAcceptance();
    const btn = $('authGoogle');
    btn.disabled = true;
    const was = btn.querySelector('span').textContent;
    btn.querySelector('span').textContent = 'Taking you to Google…';
    const r = await signInWithGoogle();
    if (r.error) {
      btn.disabled = false;
      btn.querySelector('span').textContent = was;
      // The likeliest cause by far is that the provider is not switched on for
      // the project yet, and the customer can do nothing about that — so the
      // sentence points at the other door rather than at them.
      say(`${r.error} Use an email address below instead.`);
    }
  };

  dialog.querySelector('form').addEventListener('submit', async (e) => {
    // Always handled here: letting the form close the dialog on submit would
    // dismiss it before the request came back, so a wrong password would look
    // like a successful sign-in.
    e.preventDefault();
    const email = $('authEmail').value.trim();
    const pass = $('authPass').value;
    if (!email || pass.length < 6) return say('Enter an email and a password of at least 6 characters.');
    // Creating the account is the moment the terms are agreed to, so it is the
    // moment the tick is required. Signing in is not: that agreement was made
    // when the account was made.
    if (mode === 'up' && !$('authTerms').checked) {
      return say('Please accept the terms of service and the privacy policy to create an account.');
    }
    $('authGo').disabled = true;
    const was = $('authGo').textContent;
    $('authGo').textContent = 'Working…';
    const r = mode === 'up'
      ? await signUp(email, pass, $('authName').value.trim())
      : await signIn(email, pass);
    $('authGo').disabled = false;
    $('authGo').textContent = was;
    // SIGN-UPS ARE CLOSED: take the offer away rather than leave it there to be
    // refused again. Supabase gives an anonymous client no way to ask in
    // advance, so the first attempt is the earliest anyone can know.
    if (r.closed) {
      signupsOff = true;
      setMode('in');
      return say(r.error);
    }
    if (r.error) return say(r.error);
    if (r.confirmEmail) return say('Check your inbox to confirm the address, then sign in.', 'ok');
    dialog.close();
  });

  dialog.addEventListener('close', () => { setMode('in'); dialog.querySelector('form').reset(); });
  setMode('in');
  return dialog;
}

/**
 * Signing out asked with the app's own dialog, not the browser's.
 *
 * It was a native `confirm()`, which is the one piece of UI a page cannot
 * style: a grey system slab with OS buttons, pinned to the top of the window,
 * two steps from the control that opened it. Every other decision in this
 * product is asked in a bordered card on a dimmed backdrop, and this one looked
 * like a different application interrupting.
 *
 * Same `.auth-dialog` and `.auth-form` as signing in, so it is the same object
 * the user has already met, and it inherits the footer shape rather than
 * describing one of its own.
 *
 * It also gets to say what signing out actually does. `confirm()` had room for
 * a question and nothing else, and "Sign out of Sam?" answers none of what
 * someone hesitating would want to know.
 */
/**
 * Take the page with the data, because signing out has already deleted it.
 *
 * THE BUG THIS CLOSES. Signing out clears the local store and every artifact
 * scope, but nothing told the PAGE. Only the account chip and Studio's credit
 * buttons listen for the auth change, so in Studio or the 3D view the plan, the
 * render and the customer's labels stayed on screen — fully readable — until
 * the person happened to navigate. Saman found it by signing out and having to
 * walk to another stage before he could tell it had worked.
 *
 * It is not only confusing. The sign-out dialog promises in as many words that
 * the work is "removed from this computer, so nothing of yours is left on
 * screen", and the images are the most identifying thing in the store. Leaving
 * them up on a shared machine is the appearance of privacy rather than privacy.
 *
 * A FLOOR PAGE IS ONE THAT NAMES A FLOOR, and that is why the test is the query
 * string rather than a list of filenames. The four floor-scoped pages
 * (extract / review / studio / view3d) are exactly the pages that arrive with
 * `?p=&f=`, so this cannot drift when a page is added or renamed. Their floor no
 * longer exists, so reloading would land the person on "this floor is not being
 * shared" — a message about sharing, in answer to signing out. They go home.
 *
 * Everywhere else reloads, so anything built from the account — the project
 * list, the credit count, the brand kits — is rebuilt from the empty store
 * instead of lingering as whatever was on screen a moment ago.
 *
 * `location.replace` rather than `href`: Back must not return to a page that is
 * showing someone else's plan.
 */
export function signOutDestination(search) {
  const q = new URLSearchParams(search || '');
  return (q.get('p') && q.get('f')) ? 'projects.html' : null;
}

function leaveAfterSignOut() {
  const to = signOutDestination(location.search);
  if (to) location.replace(to);
  else location.reload();
}

/**
 * The account dialog: change the name that signs your reports, or sign out.
 *
 * THE NAME LIVES HERE BECAUSE IT HAD NOWHERE ELSE. It is written once, at
 * sign-up, in a field nothing validates, and the verification report falls back
 * to the EMAIL when it is empty — so a builder could hand a buyer a document
 * signed by a personal address with no way to correct it. This is the only
 * screen in the app that is about the account rather than about a plan.
 *
 * The sign-out path below is untouched: same copy, same save-before-clear, same
 * resolve. Only pressing Sign out resolves true, so saving a name and closing
 * the dialog leaves the person signed in.
 */
function accountDialog(name, email) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'auth-dialog';
    // `name` falls back to the email, so an unset name shows the address here
    // too — which is exactly what the person needs to see to understand why
    // their report is signed the way it is.
    const unset = name === email;
    d.innerHTML = `
      <form method="dialog" class="auth-form">
        <h3>Your account</h3>
        <p class="subtle">Signed in as ${esc(email)}.</p>

        <div class="fld-float" style="margin-top:16px">
          <input type="text" id="acctName" autocomplete="name" placeholder=" "
                 value="${unset ? '' : esc(name)}" maxlength="80">
          <label for="acctName">Name on your verification reports</label>
        </div>
        <p class="subtle" style="margin-top:6px">${unset
          ? 'Your reports are signed with your email address because no name is set. '
            + 'A report says a named person checked the dimensions.'
          : 'This is the name printed under “Reviewed and confirmed by”.'}</p>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn--secondary btn--sm" data-act="save">Save name</button>
        </div>

        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0 16px">
        <p class="subtle">Your projects are saved to your
        account and then removed from this computer, so nothing of yours is left on
        screen. Signing in again brings all of it back.</p>
        <p class="auth-msg" data-msg role="alert" hidden></p>
        <div class="row auth-actions">
          <button type="button" class="btn btn--quiet" data-act="no">Close</button>
          <button type="button" class="btn btn--primary" data-act="yes">Sign out</button>
        </div>
      </form>`;
    document.body.append(d);

    const save = d.querySelector('[data-act="save"]');
    save.onclick = async () => {
      const field = d.querySelector('#acctName');
      const m = d.querySelector('[data-msg]');
      save.disabled = true;
      const was = save.textContent;
      save.textContent = 'Saving…';
      const r = await setSignOffName(field.value);
      save.disabled = false;
      save.textContent = was;
      m.hidden = false;
      if (r.error) { m.className = 'auth-msg'; m.textContent = r.error; return; }
      // Says which documents it applies to, because it does not reach the
      // reports already downloaded: those were rendered with the old name.
      m.className = 'auth-msg ok';
      m.textContent = `Reports will be signed “${r.name}” from now on. `
        + 'Anything already downloaded keeps the name it was made with.';
    };
    // One place decides the answer, so Escape and the backdrop mean Cancel
    // without a second code path saying so.
    let answer = false;
    const go = d.querySelector('[data-act="yes"]');
    const msg = d.querySelector('[data-msg]');
    d.querySelector('[data-act="no"]').onclick = () => d.close();
    go.onclick = async () => {
      // SAVE FIRST, AND ONLY THEN CLEAR. The promise in the sentence above is
      // that nothing is lost, so the push has to have happened before anything
      // local is removed. A failed sync — offline, or the server unreachable —
      // means the cloud copy may be behind, and clearing then would destroy
      // work. So it stops, says why, and leaves the user signed in with their
      // projects where they are.
      go.disabled = true;
      go.textContent = 'Saving to your account…';
      msg.hidden = true;
      let out = null;
      try { out = await store.syncCloud(); } catch { out = null; }
      // THREE WAYS IT CAN FAIL AND ONLY ONE OF THEM THROWS. syncCloud returns
      // null when it could not read the account at all, and reports `errors`
      // for a push that did not land — which used to be logged and otherwise
      // look exactly like success. All three mean the same thing here.
      if (!out || out.errors.length) {
        go.disabled = false;
        go.textContent = 'Sign out';
        msg.hidden = false;
        msg.textContent = 'Your projects could not be saved to your account, so nothing '
          + 'was removed and you are still signed in. Check your connection and try again.';
        return;
      }
      answer = true;
      d.close();
    };
    d.addEventListener('close', () => { d.remove(); resolve(answer); });
    d.showModal();
    d.querySelector('[data-act="no"]').focus();
  });
}

/**
 * @param {'in'|'up'} [mode]
 * @param {string} [message] shown in the dialog's own message line — used when
 *   the dialog is being opened BECAUSE something failed, so the reason arrives
 *   with the door rather than somewhere else on the page.
 */
export function openSignIn(mode = 'in', message = null, kind = 'bad') {
  const d = buildDialog();
  if (mode === 'up') d.querySelector('#authSwap').click();
  // AFTER the mode is set. setMode hides this line, so writing the message
  // first would put it on screen and then take it straight off again.
  if (message) {
    const el = d.querySelector('#authMsg');
    el.textContent = message;
    // `bad` by default, because the caller that came first is a failed OAuth
    // return. A gate that is simply the rule passes 'info': telling someone to
    // sign in before starting a project is not an error they made.
    el.className = `auth-msg ${kind}`;
    el.hidden = false;
  }
  d.showModal();
  d.querySelector('#authEmail').focus();
}

/** Render the header's account area into `slot`. */
export async function mountAccount(slot) {
  if (!await isCloudReady()) { slot.hidden = true; return; }
  slot.hidden = false;
  startAuth();

  // A SIGN-IN THAT FAILED REOPENS THE DOOR IT FAILED AT.
  //
  // They pressed a button, left for Google, and came back to a page that looked
  // exactly as they left it. Putting the message in the header would be quieter
  // than the thing it describes; the dialog is where they were and where the
  // other way in is, so it opens with the reason showing.
  //
  // Once only. The state is cleared as it is shown, or every later render of
  // the header would reopen a dialog about something already over.
  let shownError = false;
  const showOAuthError = (oauthError) => {
    if (!oauthError || shownError) return;
    shownError = true;
    clearOAuthError();
    openSignIn('in', oauthError.message);
  };

  const draw = ({ user, credits, ready, sync, oauthError }) => {
    if (!ready) { slot.innerHTML = ''; return; }
    showOAuthError(oauthError);
    if (!user) {
      slot.innerHTML = `<button class="btn btn--secondary btn--sm" id="acctIn">Sign in</button>`;
      slot.querySelector('#acctIn').onclick = () => openSignIn();
      return;
    }
    const name = user.user_metadata?.full_name || user.email;
    // The credit count sits next to the name because it is the thing that
    // decides whether the next render happens, and finding that out from a
    // failed render is the wrong moment.
    const n = credits ?? '–';
    const low = typeof credits === 'number' && credits <= 1;
    // A FAILED SYNC IS SAID OUT LOUD, next to the account it failed to reach.
    //
    // Their work is on screen and looks saved, because every page reads
    // localStorage and that copy is correct. What is not true is that it reached
    // the account, and the only trace used to be a console line. This is the one
    // failure in the app the customer must not be left to discover — the thing
    // at stake is their work.
    //
    // It says what IS still true first. "Saved on this device" is the fact that
    // stops the sentence being frightening, and it is what makes the retry a
    // choice rather than an emergency.
    const syncWarn = sync && sync.ok === false
      ? `<button class="btn btn--secondary btn--sm acct-sync-warn" id="acctSync"`
        + ` title="${esc(sync.message || '')} Your work is safe on this device. Press to try again.">`
        + `Not in your account &middot; Retry</button>`
      : sync && sync.ok === null
        ? `<span class="acct-sync-warn" id="acctSyncing">Syncing…</span>` : '';

    // THE NAME IS MISSING EXACTLY WHEN THE HEADER FALLS BACK TO THE EMAIL, and
    // that is the same moment the verification report does. Sign-up does not
    // require the field, so a new account arrives here every time; without a
    // mark the person has no reason to open a menu whose only subject used to
    // be signing out, and the first they would know of it is their own address
    // printed on a document their buyer receives.
    //
    // The dot is not the whole signal — a mark that only some people can see is
    // not a message. The button's accessible name and its tooltip say it, and
    // the button is already showing an email where a name belongs.
    const needsName = name === user.email;
    const label = needsName
      ? `${name} — add the name that signs your reports`
      : name;
    slot.innerHTML = syncWarn
      + `<span class="acct-credits${low ? ' low' : ''}" title="Render credits remaining">${n}</span>` +
      `<button class="btn btn--secondary btn--sm acct-name${needsName ? ' needs-name' : ''}"`
      + ` id="acctMenu" title="${esc(label)}" aria-label="${esc(label)}">${esc(name)}</button>`;
    const retry = slot.querySelector('#acctSync');
    if (retry) retry.onclick = () => { retry.disabled = true; retrySync(); };
    slot.querySelector('#acctMenu').onclick = async () => {
      if (!await accountDialog(name, user.email)) return;
      // The sync already happened inside the dialog, which is what makes this
      // safe: every record is in the account before any of it leaves the
      // machine. Images go too — a floor's plan is the most identifying thing
      // in the store, and leaving the pictures behind while removing the names
      // would be the appearance of privacy rather than privacy.
      // FORGET, NOT DELETE. `deleteScope` also removes the bytes from the
      // account, which is right when a floor is deleted and catastrophic here:
      // it destroyed every render the person had paid for. See forgetScope.
      const scopes = store.clearLocalWork();
      for (const scope of scopes) await forgetScope(scope);
      await signOut();
      leaveAfterSignOut();
    };
  };

  onAuthChange(draw);
  draw(authState());
}
