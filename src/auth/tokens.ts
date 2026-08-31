/**
 * Minting and refreshing Threads tokens.
 *
 * Three token states exist and they are easy to confuse:
 *
 *   short-lived   1 hour.  What the OAuth code exchange returns.
 *   long-lived    60 days. What you get by exchanging a short-lived token,
 *                 and the only kind worth storing.
 *   refreshed     60 days from the refresh. Allowed once the token is at
 *                 least 24 hours old, and impossible once it has expired.
 *
 * That last sentence is the entire reason this file exists. A token that is
 * never refreshed dies on day 60 and cannot be revived; the person has to walk
 * the whole OAuth flow again. A server that refreshes on a schedule turns a
 * recurring 60-day outage into something nobody has to think about.
 *
 * `maybeRefresh` is called before every request rather than on a timer, because
 * an MCP server is not a daemon. It runs when a client launches it and stops
 * when the client quits, and a timer that fires on day 59 fires in a process
 * that has not existed for weeks.
 */

import type { Account, Config } from "../config.js";
import { AuthenticationError, errorFor } from "../api/errors.js";

const DAY_MS = 86_400_000;

export type TokenResponse = {
  access_token: string;
  token_type?: string;
  /** Seconds until expiry. About 5,183,944 for a fresh long-lived token. */
  expires_in?: number;
};

async function tokenCall(url: string, endpoint: string, timeoutMs: number): Promise<TokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw errorFor(res.status, endpoint, text);
    const parsed = JSON.parse(text) as TokenResponse;
    if (!parsed.access_token) {
      throw new AuthenticationError(`${endpoint} returned no access_token.`, res.status, endpoint);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange the short-lived token from the OAuth code flow for a 60-day one.
 *
 * This needs the app secret, which is why `login` needs THREADS_APP_SECRET and
 * pasting a token from Meta's Graph API Explorer does not: that explorer hands
 * out short-lived tokens, and a short-lived token pasted into a config stops
 * working in an hour. `login` is the path that produces something durable.
 */
export async function exchangeForLongLived(
  shortLivedToken: string,
  appSecret: string,
  host: string,
  timeoutMs = 30_000,
): Promise<TokenResponse> {
  const url = new URL(`${host}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);
  return tokenCall(url.toString(), "/access_token", timeoutMs);
}

/** Extend a long-lived token by another 60 days. No app secret required. */
export async function refreshLongLived(
  token: string,
  host: string,
  timeoutMs = 30_000,
): Promise<TokenResponse> {
  const url = new URL(`${host}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", token);
  return tokenCall(url.toString(), "/refresh_access_token", timeoutMs);
}

/** Days until this token expires, or undefined when the expiry is unknown. */
export function daysRemaining(account: Account, now = Date.now()): number | undefined {
  if (!account.expiresAt) return undefined;
  return Math.floor((account.expiresAt - now) / DAY_MS);
}

/**
 * Whether this token should be refreshed now.
 *
 * Two conditions, both from Meta's rules. It has to be at least 24 hours old,
 * and it has to still be alive. An expiry we do not know about is left alone:
 * a token pasted in from the environment has no recorded expiry, and refreshing
 * something on a guess would burn a call and could not be written anywhere
 * useful anyway.
 */
export function shouldRefresh(account: Account, windowDays: number, now = Date.now()): boolean {
  const remaining = daysRemaining(account, now);
  if (remaining === undefined) return false;
  if (remaining <= 0) return false;
  if (account.expiresAt && now < account.expiresAt - 59 * DAY_MS) return false;
  return remaining <= windowDays;
}

/** Turn Meta's `expires_in` seconds into the absolute expiry we store. */
export function expiryFrom(response: TokenResponse, now = Date.now()): number | undefined {
  return typeof response.expires_in === "number" ? now + response.expires_in * 1000 : undefined;
}

export function refreshWindowOf(config: Config): number {
  return config.refreshWindowDays;
}
