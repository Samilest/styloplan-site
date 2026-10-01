// Every call that spends a credit goes through here.
//
// One place attaches the token and one place turns the server's refusals into
// something a person can act on. Both clients used to build their own fetch, so
// a new endpoint could quietly ship without an Authorization header — and the
// only symptom would be that it worked fine on a machine that happened to be
// signed in.

import { accessToken, noteCredits } from './auth.js';
import { apiUrl } from './api-origin.js';

/** Thrown when the server refused for a reason the user can do something about. */
export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
  /** True when signing in or topping up would fix it — not a fault to report. */
  get actionable() {
    return ['not_signed_in', 'no_credits', 'daily_cap', 'free_budget'].includes(this.code);
  }
}

/**
 * A 503 THAT WE DID NOT WRITE is the host turning the request away before our
 * code sees it.
 *
 * Measured on a real upload (2026-09-26): the extraction, sent with the same
 * image at the same moment, succeeded, while the wireframe came back "HTTP 503"
 * with no model call logged, no job recorded and the free-image counter (the
 * first thing the handler moves after checking the sign-in) unmoved. The
 * function's own log had no line from that request at all, and every worker in
 * it booted cleanly, so it was not the BOOT_ERROR Supabase documents for 503;
 * the gateway's reason is not in the function log. Either way nothing ran and
 * nothing was charged, and a job is charged once per job and endpoint anyway,
 * so asking again is safe. Our own failures always carry `error` (api-handler
 * answers 502 with a sentence), so they are never retried here. A 546, the
 * host stopping a worker that was already running, is not retried either.
 */
export const isHostBootFailure = (status, j) => status === 503 && !(j && j.error);
/** How long to wait before each retry. Two, because a third start that fails is not bad luck. */
export const BOOT_RETRY_MS = [1500, 4000];

/**
 * POST to a paid endpoint with the current session's bearer token.
 * @param {string} path e.g. '/api/style'
 * @param {object} body
 * @returns {Promise<object>} the parsed response
 */
export async function postAI(path, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  let res, j;
  for (let attempt = 0; ; attempt++) {
    // Read per attempt: supabase-js may have refreshed it during the wait.
    const token = await accessToken();
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
    });

    j = {};
    try { j = await res.json(); } catch { /* a proxy or crash can return no JSON */ }
    if (!isHostBootFailure(res.status, j) || attempt >= BOOT_RETRY_MS.length) break;
    await new Promise((r) => setTimeout(r, BOOT_RETRY_MS[attempt]));
  }

  if (!res.ok) {
    // 401 and 402 are the gate, not a failure of the work. They carry a code so
    // the caller can offer the fix — a sign-in dialog — instead of showing an
    // error about a render that never started.
    if (res.status === 401 || res.status === 402) {
      throw new ApiError(j.code || 'refused', j.error || 'Sign in to render.');
    }
    // Said in words, and says the part a customer worries about first.
    if (isHostBootFailure(res.status, j)) {
      throw new ApiError('upstream', 'The server could not start just now. Nothing was charged. Try again in a minute.');
    }
    throw new ApiError('upstream', j.error || `HTTP ${res.status}`);
  }

  // The server reports what is left after each spend. Published here rather
  // than returned for the caller to remember, because every caller would have
  // to remember and one already forgot: the value was attached to the response
  // and nothing read it, so the header stayed a credit high after every render.
  const left = res.headers.get('x-credits-left');
  if (left !== null) {
    j.creditsLeft = Number(left);
    noteCredits(j.creditsLeft);
  }
  return j;
}
