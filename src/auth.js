// Sign in, sign out, and who is signed in — the browser's half.
//
// The product works WITHOUT an account. Everything the compositor does is local
// and free: opening projects, moving labels, changing brand colours, exporting.
// An account is needed for exactly one thing, the calls that spend money on the
// image model, because those are billed to us. So this module never blocks a
// page; it reports a state and lets the page decide.
//
// The access token is read fresh from the session on every request rather than
// cached here. supabase-js refreshes it in the background, and a copy taken at
// page load is the thing that expires in the middle of a long review.

import { getSupabase } from './supabase-client.js';

const listeners = new Set();
// `sync` is null until a sync has been attempted, then { ok, message }.
let cached = { user: null, credits: null, ready: false, sync: null };

/** Current auth state, without a round trip. `ready` is false until first load. */
export const authState = () => cached;

/** Called on every change, and once as soon as the first state is known. */
export function onAuthChange(fn) {
  listeners.add(fn);
  if (cached.ready) fn(cached);
  return () => listeners.delete(fn);
}

function publish(next) {
  cached = { ...next, ready: true };
  for (const fn of listeners) { try { fn(cached); } catch (e) { console.error(e); } }
}

/**
 * The bearer token for an API call, or null when signed out.
 * Callers send it as `Authorization: Bearer <token>`; the server verifies it
 * against the auth server before spending anything.
 */
export async function accessToken() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * Record a balance the server just reported, without a round trip.
 *
 * Every paid endpoint returns `x-credits-left` in the same response as the
 * work, so the number on screen can be right the moment a render lands. It was
 * not: the header kept whatever it had read at page load, and after a styling
 * call it sat one credit high — the user is told what they have left by a
 * number that is quietly wrong exactly when they just spent something.
 */
export function noteCredits(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return;
  if (cached.credits === n) return;
  publish({ ...cached, credits: n });
}

/** Credits remaining, or null when signed out or unreachable. */
export async function fetchCredits() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('credit_balances').select('credits').single();
  return error ? null : data.credits;
}

async function refresh() {
  const sb = await getSupabase();
  if (!sb) return publish({ user: null, credits: null });
  // Look for a stored session BEFORE asking the server who we are. `getUser()`
  // with nothing stored still goes to the network and comes back 403, so every
  // page load by a signed-out visitor — which is most of them — logged failed
  // requests for a question already answered locally.
  const { data: s } = await sb.auth.getSession();
  if (!s?.session) return publish({ user: null, credits: null });

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    // A stored session whose user the server will not confirm: the account was
    // deleted, or the session was revoked. Left alone the dead token stays in
    // localStorage and is retried on every page load forever, so clear it.
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    return publish({ user: null, credits: null });
  }
  publish({ user: data.user, credits: await fetchCredits() });
  // Signing in is the moment the browser and the account can disagree, so it is
  // the moment to reconcile them. Awaited by nothing: a slow sync must not hold
  // up the header, and every page reads localStorage, which is already correct.
  runSync();
}

/**
 * Reconcile the browser and the account, and SAY SO IF IT DID NOT WORK.
 *
 * This used to be a `.catch(console.error)` and nothing else. A failed sync is
 * the one failure in this app the customer must not be left to discover: every
 * page reads localStorage, so their work is on screen and looks saved, while
 * nothing reached the account. The only trace was a line in a console they will
 * never open.
 *
 * IT IS NOT HYPOTHETICAL. `projects.id` is a primary key across all owners, so
 * restoring a backup into a different account — the same person with a second
 * account, most likely — leaves every project in it colliding with a row RLS
 * will not let the new owner write. Measured: the insert answers 23505, the
 * upsert 42501, the original owner's row is untouched, and the customer is told
 * nothing.
 *
 * `syncCloud()` returning null is a failure too. cloud-store.js returns it when
 * the read fails, and treating a null as "fine" is how a broken sync reports
 * success.
 */
async function runSync() {
  const s = await import('./store.js');
  try {
    const r = await s.syncCloud();
    if (r) {
      console.info(`sync: pushed ${r.pushed}, pulled ${r.pulled}`);
      // Records first, so the list can draw immediately; the pictures follow.
      publish({ ...cached, sync: { ok: true } });
      // THE PICTURES ARE PART OF "MY WORK IS BACK". Without this the projects
      // came back and every thumbnail said "no plan yet", because the records
      // and the images restore through different paths and only the records
      // were being restored on sign-in.
      //
      // Published a SECOND time, and that is the point: the list has already
      // drawn from records, and this is what tells it to draw again now that
      // the images are on disk. `restored` distinguishes the two publishes, so
      // a listener can redraw only when something actually arrived.
      const restored = await s.restoreArtifacts();
      if (restored) console.info(`sync: restored ${restored} images`);
      publish({ ...cached, sync: { ok: true, restored } });
      // AND THE OTHER DIRECTION, last, because it helps nobody on this screen.
      // Downloading is what the person is waiting for; uploading is what stops
      // them losing anything later, and every render made before the mirror
      // covered the per-theme kinds is still local-only until this runs.
      const backedUp = await s.backUpArtifacts();
      if (backedUp) console.info(`sync: backed up ${backedUp} images`);
    } else {
      console.error('sync failed: the account could not be read');
      publish({ ...cached, sync: { ok: false, message: 'Your account could not be reached.' } });
    }
  } catch (e) {
    console.error('sync failed:', e.message);
    publish({ ...cached, sync: { ok: false, message: e.message } });
  }
}

/** Try again, for the button that appears when it failed. */
export async function retrySync() {
  publish({ ...cached, sync: { ok: null } });   // "trying"
  await runSync();
  return cached.sync;
}

/** Start watching. Safe to call from every page; the work happens once. */
let started = null;
/**
 * A failed sign-in comes back in the URL, and nothing was reading it.
 *
 * `detectSessionInUrl` handles the SUCCESS half: the session arrives in the
 * fragment and supabase-js picks it up. The failure half arrives the same way —
 * `#error=...&error_description=...` — and nobody looked, so the customer landed
 * back on the page they started from with nothing changed and nothing said.
 *
 * MEASURED, not imagined: signing in with a Google account that had no StyloPlan
 * account, while sign-ups were closed, produced exactly that. "Nothing
 * happened." It is the same shape as the silent sync failure — the app knows
 * and the person it happened to does not.
 *
 * THE URL IS CLEANED EITHER WAY. An error left in the address bar survives a
 * reload, a bookmark and a shared link, and would re-announce a failure that is
 * over. Cleared with replaceState so there is no extra history entry to go back
 * through.
 */
function takeOAuthError() {
  const from = (s) => new URLSearchParams(s.replace(/^[#?]/, ''));
  for (const src of [location.hash, location.search]) {
    const p = from(src);
    const code = p.get('error') || p.get('error_code');
    if (!code) continue;
    const desc = p.get('error_description') || '';
    history.replaceState(null, '', location.pathname + location.search.replace(/[?&](error|error_code|error_description)=[^&]*/g, '').replace(/^&/, '?'));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return { code, message: friendlyOAuth(code, decodeURIComponent(desc.replace(/\+/g, ' '))) };
  }
  return null;
}

/**
 * The provider's words are for us; the customer needs a next step.
 *
 * Supabase says "Signups not allowed for this instance", which is true, is not
 * the customer's fault, and tells them nothing to do. Everything unrecognised
 * keeps the original text rather than being flattened into "something went
 * wrong" — a message we have not met is more useful raw than generic.
 */
function friendlyOAuth(code, desc) {
  const d = desc.toLowerCase();
  if (d.includes('signup') || d.includes('sign up') || d.includes('not allowed')) {
    return 'This app is not open for new accounts yet. If you already have one, '
      + 'sign in with the email address you used.';
  }
  if (code === 'access_denied') return 'That sign-in was cancelled.';
  return desc || 'That sign-in did not complete. Please try again.';
}

export function startAuth() {
  if (started) return started;
  started = (async () => {
    // Read BEFORE the client is created: supabase-js clears the fragment when
    // it looks for a session there, and a cleared fragment is an error nobody
    // can report.
    const oauthError = takeOAuthError();
    const sb = await getSupabase();
    if (!sb) return publish({ user: null, credits: null, oauthError });
    sb.auth.onAuthStateChange(() => { refresh(); });
    await refresh();
    if (oauthError) publish({ ...cached, oauthError });
  })();
  return started;
}

/** Dismiss the message once it has been shown, so it does not follow them. */
export function clearOAuthError() {
  if (cached.oauthError) publish({ ...cached, oauthError: null });
}

/**
 * A signed-in person's display name for the verification record.
 *
 * Their own name, then the name on the account, then the email — never the
 * brand kit's company name, which is what this used to be. A sign-off says a
 * PERSON reviewed and confirmed these dimensions (red line 7); a company name
 * cannot answer "which of you, and when".
 */
export async function signOffName() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  const u = data?.user;
  if (!u) return null;
  const { data: p } = await sb.from('profiles').select('full_name').eq('id', u.id).single();
  return p?.full_name || u.user_metadata?.full_name || u.email || null;
}

const friendly = (msg) => {
  const m = String(msg || '');
  if (/invalid login/i.test(m)) return 'That email and password do not match an account.';
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/password/i.test(m) && /least|short/i.test(m)) return 'Use a password of at least 6 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (signupsClosed(m)) return 'New accounts are closed for now. If you already have one, sign in.';
  return m || 'Something went wrong. Try again.';
};

/**
 * The operator has turned sign-ups off in Supabase.
 *
 * Not a fault, and not something the person in front of the screen can fix, so
 * it should not arrive dressed as one. Raw, it reads "Signups not allowed for
 * this instance" — an instance is our word, and "not allowed" sounds like a
 * judgement about them.
 *
 * Matched on the message because that is the only place the setting shows: it
 * is a GoTrue config, and an anonymous client has no way to ask about it before
 * trying. Which is also why the sign-up form cannot be hidden until someone has
 * tried once.
 */
const signupsClosed = (m) =>
  /signups?\s+(are\s+)?not\s+allowed|signup\s+is\s+disabled|signups?\s+disabled/i.test(String(m || ''));

export async function signIn(email, password) {
  const sb = await getSupabase();
  if (!sb) return { error: 'Accounts are not available here.' };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error.message) };
  await refresh();
  return {};
}

/**
 * Sign in with Google, which for a first-time visitor is also signing up.
 *
 * THIS FUNCTION LEAVES THE PAGE. It hands the browser to Google and the browser
 * comes back to `redirectTo` carrying the session in the URL, which supabase-js
 * picks up on load. So there is nothing to await and no state to return — the
 * caller's next line runs during a navigation that is already happening.
 *
 * BACK TO THE PAGE THEY LEFT, not to the home page. Someone who signs in from
 * Studio because a render asked them to should land in Studio with the floor
 * still open. `location.href` carries the floor id, which is the unit of work
 * and lives in the query string.
 *
 * The URL has to be on Supabase's redirect allowlist or the round trip lands on
 * the site root with an error in the fragment. Auth → URL Configuration.
 */
export async function signInWithGoogle() {
  const sb = await getSupabase();
  if (!sb) return { error: 'Accounts are not available here.' };
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.href,
      // Ask every time rather than silently reusing whichever Google account
      // the browser happens to be signed into. A builder with a work and a
      // personal account must not have one chosen for them — the credits and
      // the plans hang off whichever it is.
      queryParams: { prompt: 'select_account' },
    },
  });
  // Only reached when the redirect never started: the provider is not enabled
  // on the project, or the browser blocked the navigation.
  if (error) return { error: friendly(error.message) };
  return {};
}

export async function signUp(email, password, fullName) {
  const sb = await getSupabase();
  if (!sb) return { error: 'Accounts are not available here.' };
  const { data, error } = await sb.auth.signUp({
    email, password, options: { data: { full_name: fullName || '' } },
  });
  // `closed` is returned as a FACT rather than left for the caller to find by
  // re-matching the sentence we just wrote. The UI changes shape on it — the
  // way to a new account is taken off the dialog — and a screen that reshapes
  // itself by pattern-matching its own copy breaks the first time the copy is
  // reworded.
  if (error) return { error: friendly(error.message), closed: signupsClosed(error.message) };
  // With email confirmation on, signUp succeeds but there is no session yet.
  // Saying so is the difference between "nothing happened" and "check your
  // inbox", and the setting is the operator's, not something to guess at.
  if (!data.session) return { confirmEmail: true };
  await refresh();
  return {};
}

export async function signOut() {
  const sb = await getSupabase();
  if (sb) await sb.auth.signOut();
  await refresh();
}
