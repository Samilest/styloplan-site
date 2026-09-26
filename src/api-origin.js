// WHERE THE API IS. One answer, so a new call site cannot get it wrong.
//
// The pages and the endpoints used to be one Node process, so every call was a
// same-origin path and nobody had to think about it. They are now two hosts: the
// site is static files on GitHub Pages and the API is a Supabase Edge Function.
//
// GITHUB PAGES CANNOT PROXY. There are no rewrites, no _redirects, no way to
// make /api/style resolve to somewhere else — so the browser calls the function
// directly, cross-origin, which is what the CORS allowlist in
// supabase/functions/api exists for.
//
// SAME-ORIGIN IS STILL THE DEFAULT, and deliberately: `node server.js` serves
// the pages and answers /api/* itself, and that is how the app is worked on
// every day. An empty origin means "ask whoever served this page", which is
// correct there and correct on any host that can proxy. tools/build-site.mjs
// rewrites this one line when it builds for a host that cannot.
//
// test/api-origin.test.mjs holds the rule that matters: no browser file may
// fetch an /api/ path directly. The four call sites that existed when this was
// written all did, and a fifth added later would work perfectly in development
// and fail only once deployed — which is the kind of bug that ships.

/** Rewritten at build time. Empty means same-origin. */
export const API_ORIGIN = "https://sijpjnejuqxtmkmmklhm.supabase.co/functions/v1/api";

/**
 * The URL for an API path.
 * @param {string} path e.g. '/api/style'
 */
export const apiUrl = (path) => `${API_ORIGIN}${path}`;
