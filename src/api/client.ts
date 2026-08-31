/**
 * The Threads Graph client.
 *
 * Four things it does that a thin fetch wrapper does not.
 *
 * **It resolves the profile id.** Nearly every Threads endpoint is keyed by a
 * numeric profile id, and Meta does not put it in the token. Requiring a person
 * to go and find theirs before anything works is a setup step with no reason to
 * exist, so `GET /me` supplies it on first use and it is cached for the life of
 * the process.
 *
 * **It refreshes tokens.** A long-lived token lasts 60 days, can be refreshed
 * once it is a day old, and is unrecoverable the moment it expires. The check
 * runs before a request when the expiry is near, and again reactively when Meta
 * answers with 190/463, because a token can be closer to death than our
 * recorded expiry claims. Refreshed tokens are written back to the store.
 *
 * **It retries the failures worth retrying.** 5xx and Meta's quota codes back
 * off exponentially with jitter. A 400 does not: the request was wrong and
 * sending it again will be wrong again.
 *
 * **It waits for containers.** Publishing on Threads is two calls with an
 * asynchronous gap in the middle, and publishing into that gap fails. See
 * `awaitContainer`.
 */

import { setTimeout as delay } from "node:timers/promises";
import type { Account, Config } from "../config.js";
import { upsertToken } from "../auth/store.js";
import { expiryFrom, refreshLongLived, shouldRefresh } from "../auth/tokens.js";
import {
  ContainerError,
  isRefreshable,
  parseErrorBody,
  ThreadsError,
  TimeoutError,
  errorFor,
} from "./errors.js";

export type CallInit = {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, unknown>;
  /** Skip the automatic retry loop. Used by the container poller. */
  noRetry?: boolean;
};

export type Profile = {
  id: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
  is_verified?: boolean;
  is_eligible_for_geo_gating?: boolean;
};

/** Fields worth asking for on any post. Kept in one place so they cannot drift. */
export const POST_FIELDS = [
  "id",
  "text",
  "permalink",
  "timestamp",
  "media_type",
  "media_url",
  "thumbnail_url",
  "username",
  "shortcode",
  "is_quote_post",
  "has_replies",
  "quoted_post",
  "reposted_post",
  "link_attachment_url",
  "topic_tag",
  "alt_text",
].join(",");

/** Fields on a reply. `hide_status` and `replied_to` are the ones that matter. */
export const REPLY_FIELDS = [
  "id",
  "text",
  "username",
  "permalink",
  "timestamp",
  "media_type",
  "shortcode",
  "is_reply",
  "replied_to",
  "root_post",
  "has_replies",
  "hide_status",
  "reply_audience",
].join(",");

const PROFILE_FIELDS =
  "id,username,name,threads_profile_picture_url,threads_biography,is_verified,is_eligible_for_geo_gating";

export class ThreadsClient {
  private readonly config: Config;
  /** Resolved profile, keyed by token. Threads ids never change. */
  private readonly profiles = new Map<string, Profile>();
  private readonly resolving = new Map<string, Promise<Profile>>();
  private lastRequestAt = 0;

  constructor(config: Config) {
    this.config = config;
  }

  get accounts(): Account[] {
    return this.config.accounts;
  }

  /**
   * The live profile for an account, resolved once and cached.
   *
   * Concurrent tool calls share one in-flight lookup rather than each spending
   * a request on the same answer.
   */
  async profile(account: Account): Promise<Profile> {
    const key = account.accessToken;
    const cached = this.profiles.get(key);
    if (cached) return cached;

    const inFlight = this.resolving.get(key);
    if (inFlight) return inFlight;

    const work = (async () => {
      const me = (await this.call(account, "/me", { params: { fields: PROFILE_FIELDS } })) as Profile;
      this.profiles.set(key, me);
      // Backfill the config so `list_accounts` and account matching can name
      // a profile that was configured with only a token.
      if (!account.userId) account.userId = me.id;
      if (!account.username && me.username) account.username = me.username.toLowerCase();
      return me;
    })().finally(() => this.resolving.delete(key));

    this.resolving.set(key, work);
    return work;
  }

  /** The numeric profile id for an account, resolving it if necessary. */
  async userId(account: Account): Promise<string> {
    if (account.userId) return account.userId;
    return (await this.profile(account)).id;
  }

  /** Discard cached state for an account. Used by `doctor` and tests. */
  forget(account: Account): void {
    this.profiles.delete(account.accessToken);
  }

  /**
   * One Graph API call, with throttling, refresh and retry applied.
   *
   * GET parameters go in the query string; POST and DELETE parameters go in a
   * form body. Meta accepts either for most endpoints, but a long post body in
   * a query string runs into URL length limits at a proxy nobody controls.
   */
  async call(account: Account, path: string, init: CallInit = {}): Promise<unknown> {
    const method = init.method ?? "GET";
    const attempts = init.noRetry ? 1 : this.config.maxRetries + 1;
    let lastError: unknown;

    await this.maybeRefresh(account);

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.throttle();
      try {
        return await this.raw(account, path, method, init.params ?? {});
      } catch (error) {
        lastError = error;

        // A token that expired between our check and this call. Refresh once
        // and retry immediately; this is not a backoff case.
        if (error instanceof ThreadsError && isRefreshable(error.code, error.subcode)) {
          const refreshed = await this.refresh(account).catch(() => false);
          if (refreshed) continue;
        }

        if (!this.retryable(error) || attempt === attempts - 1) throw error;

        // Exponential with jitter. Meta's quota codes are per rolling window,
        // so this only helps a burst; a genuinely spent quota still fails, and
        // the error names the limit.
        const backoff = Math.min(8_000, 2 ** attempt * 500) + Math.random() * 250;
        await delay(backoff);
      }
    }

    throw lastError;
  }

  private retryable(error: unknown): boolean {
    if (error instanceof TimeoutError) return true;
    if (!(error instanceof ThreadsError)) return false;
    if (error.status >= 500) return true;
    // Code 2 is Meta's "temporary issue, try again".
    return error.code === 2 || error.code === 1;
  }

  /** Space requests apart so a burst of parallel tools does not trip a limit. */
  private async throttle(): Promise<void> {
    const gap = this.config.minRequestIntervalMs;
    if (gap <= 0) return;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await delay(wait);
    this.lastRequestAt = Date.now();
  }

  private async raw(
    account: Account,
    path: string,
    method: "GET" | "POST" | "DELETE",
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(`${this.config.graphHost}/v1.0${path}`);
    const body = new URLSearchParams();

    const all: Record<string, unknown> = { ...params, access_token: account.accessToken };
    for (const [key, value] of Object.entries(all)) {
      if (value === undefined || value === null || value === "") continue;
      const encoded = Array.isArray(value) ? value.join(",") : String(value);
      if (method === "GET") url.searchParams.set(key, encoded);
      else body.set(key, encoded);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        signal: controller.signal,
        headers: { "user-agent": this.config.userAgent },
        ...(method === "GET" ? {} : { body }),
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new TimeoutError(
          `Threads did not answer ${path} within ${this.config.requestTimeoutMs}ms.`,
          408,
          path,
        );
      }
      throw new ThreadsError(
        `Could not reach ${this.config.graphHost}: ${(error as Error).message}`,
        0,
        path,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) throw errorFor(res.status, path, text);

    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      // The delete endpoint answers `true` on success, which is valid JSON, but
      // a proxy has been known to return an empty body instead.
      return { raw: text };
    }
  }

  /** Refresh proactively when the recorded expiry is inside the window. */
  private async maybeRefresh(account: Account): Promise<void> {
    if (!shouldRefresh(account, this.config.refreshWindowDays)) return;
    await this.refresh(account).catch(() => false);
  }

  /**
   * Refresh one account's token and persist it.
   *
   * Returns false rather than throwing when it fails: a failed refresh should
   * surface as whatever the original call does, not as a second, less relevant
   * error about refreshing.
   */
  async refresh(account: Account): Promise<boolean> {
    try {
      const response = await refreshLongLived(account.accessToken, this.config.graphHost, this.config.requestTimeoutMs);
      const previous = account.accessToken;
      account.accessToken = response.access_token;
      account.expiresAt = expiryFrom(response);

      const profile = this.profiles.get(previous);
      if (profile) {
        this.profiles.delete(previous);
        this.profiles.set(account.accessToken, profile);
      }

      if (this.config.persistTokens && account.source === "store" && account.userId) {
        upsertToken(this.config.storePath, {
          user_id: account.userId,
          username: account.username,
          access_token: account.accessToken,
          expires_at: account.expiresAt,
          obtained_at: Date.now(),
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for a media container to finish processing.
   *
   * Publishing on Threads is create-then-publish, and between the two the
   * container is transcoding. Publish too early and the call fails with an
   * error that says nothing about timing, which is why so much Threads
   * automation "randomly" fails on video and works on text.
   *
   * Polling starts fast and slows down, so a text container (ready almost
   * immediately) does not pay for a video container's worst case. The status
   * poll deliberately skips the retry loop: it is already a loop, and layering
   * retries inside it turns a 60-second wait into an unbounded one.
   */
  async awaitContainer(account: Account, containerId: string): Promise<void> {
    const deadline = Date.now() + this.config.containerTimeoutMs;
    let wait = 500;

    while (Date.now() < deadline) {
      const status = (await this.call(account, `/${containerId}`, {
        params: { fields: "status,error_message" },
        noRetry: true,
      })) as { status?: string; error_message?: string };

      if (status.status === "FINISHED") return;

      if (status.status === "ERROR") {
        throw new ContainerError(
          `Threads could not process container ${containerId}: ${status.error_message ?? "no reason given"}. For media this is almost always the URL: it has to be publicly reachable over HTTPS, with no redirect to a login page, and an image or video content type.`,
          0,
          "/container",
          { detail: status.error_message ?? "" },
        );
      }

      if (status.status === "EXPIRED") {
        throw new ContainerError(
          `Container ${containerId} expired. An unpublished container lives 24 hours.`,
          0,
          "/container",
        );
      }

      await delay(wait);
      wait = Math.min(4_000, Math.round(wait * 1.5));
    }

    throw new ContainerError(
      `Container ${containerId} was still processing after ${Math.round(this.config.containerTimeoutMs / 1000)}s. It is not lost: it stays valid for 24 hours, so publish_staged with this id will work once Threads finishes. Raise THREADS_CONTAINER_TIMEOUT_MS for long videos.`,
      0,
      "/container",
    );
  }
}

/** Meta answers a successful delete with `true`, which is easy to misread. */
export function deleteSucceeded(response: unknown): boolean {
  if (response === true) return true;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    return r.success === true || r.raw === "true";
  }
  return false;
}

export { parseErrorBody };
