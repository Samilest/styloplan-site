// The browser's Supabase client — the ONLY module that touches the vendored
// library or knows how the project is addressed.
//
// The browser talks to Supabase directly rather than proxying through our
// server. That is the intended design: the anon key carries no privileges of
// its own, and row-level security decides what the signed-in user may read or
// write. Proxying would mean reimplementing auth, sessions and token refresh
// ourselves, which is exactly the code worth not writing.
//
// Config comes from `/api/config` at runtime instead of being written into a
// served file, so the same build runs against a different project by changing
// the environment. It is fetched once and reused.
//
// Nothing here throws on a missing config. The product has to keep working with
// no Supabase at all — that is how it works today, and how it must keep working
// while the migration is only partly done. `getSupabase()` returns null and
// callers fall back to local storage.

import { apiUrl } from './api-origin.js';

const VENDOR_URL = './src/vendor/supabase.js';

let clientPromise = null;

/** Load the UMD bundle once. It attaches itself to `window.supabase`. */
function loadLibrary() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  return new Promise((resolve, reject) => {
    // A second call while the first is still loading must not add a second tag.
    const existing = document.querySelector(`script[data-supabase]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.supabase));
      existing.addEventListener('error', () => reject(new Error('supabase-js failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = new URL(VENDOR_URL, document.baseURI).href;
    s.dataset.supabase = '1';
    s.onload = () => (globalThis.supabase?.createClient
      ? resolve(globalThis.supabase)
      : reject(new Error('supabase-js loaded but exposed nothing')));
    s.onerror = () => reject(new Error('supabase-js failed to load'));
    document.head.append(s);
  });
}

/**
 * The shared client, or null when this deployment has no Supabase configured.
 * Safe to call from anywhere and as often as you like.
 * @returns {Promise<object|null>}
 */
export function getSupabase() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let cfg;
    try {
      const r = await fetch(apiUrl('/api/config'));
      if (!r.ok) return null;
      cfg = await r.json();
    } catch {
      return null;                  // offline, or a server that has no config
    }
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    const lib = await loadLibrary();
    return lib.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        // The session belongs to this browser and must survive a reload: Studio
        // and Review are separate pages, so a session held only in memory would
        // be gone the moment the user moved between them.
        persistSession: true,
        autoRefreshToken: true,
        // The sign-in link lands back on the app with its tokens in the URL.
        detectSessionInUrl: true,
      },
    });
  })();
  return clientPromise;
}

/** True when this deployment can reach Supabase at all. */
export async function isCloudReady() {
  return Boolean(await getSupabase());
}

/**
 * The signed-in user, or null.
 *
 * `getUser()` and not `getSession()`: a session is whatever is cached in this
 * browser, while `getUser()` is checked against the server. A sign-off is a
 * named claim about who confirmed a set of dimensions (red line 7), so the name
 * on it has to come from something an expired or edited local session cannot
 * fake.
 */
export async function currentUser() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  return error ? null : (data?.user ?? null);
}
