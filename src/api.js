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
    return ['not_signed_in', 'no_credits', 'daily_cap'].includes(this.code);
  }
}

/**
 * POST to a paid endpoint with the current session's bearer token.
 * @param {string} path e.g. '/api/style'
 * @param {object} body
 * @returns {Promise<object>} the parsed response
 */
export async function postAI(path, body) {
  const token = await accessToken();
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  let j = {};
  try { j = await res.json(); } catch { /* a proxy or crash can return no JSON */ }

  if (!res.ok) {
    // 401 and 402 are the gate, not a failure of the work. They carry a code so
    // the caller can offer the fix — a sign-in dialog — instead of showing an
    // error about a render that never started.
    if (res.status === 401 || res.status === 402) {
      throw new ApiError(j.code || 'refused', j.error || 'Sign in to render.');
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
