/**
 * Typed errors for every way a Threads API call can fail.
 *
 * Meta returns a consistent envelope, and the interesting part is not the HTTP
 * status:
 *
 *   {"error":{"message":"...","type":"OAuthException","code":190,
 *             "error_subcode":463,"fbtrace_id":"..."}}
 *
 * `code` and `error_subcode` are the fields that actually distinguish "your
 * token expired" (190/463) from "you never had this permission" (190/458) from
 * "you are posting too fast" (4 or 32), and all three arrive as HTTP 400. Throw
 * that away and hand a model a bare string, and a model that could have
 * refreshed a token or waited out a quota instead just gives up.
 *
 * Every error here keeps the code, the subcode and the endpoint, and carries a
 * message naming the actual fix, including which OAuth scope was missing when
 * that is what happened.
 */

export class ThreadsError extends Error {
  readonly status: number;
  readonly endpoint: string;
  /** Meta's numeric error code. 0 when absent. */
  readonly code: number;
  readonly subcode: number;
  /** Meta's error type, e.g. "OAuthException". */
  readonly type: string;
  readonly detail: string;
  /** Meta's trace id. The only useful thing to quote in a bug report. */
  readonly traceId: string;

  constructor(
    message: string,
    status: number,
    endpoint: string,
    parts: Partial<{ code: number; subcode: number; type: string; detail: string; traceId: string }> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.endpoint = endpoint;
    this.code = parts.code ?? 0;
    this.subcode = parts.subcode ?? 0;
    this.type = parts.type ?? "";
    this.detail = parts.detail ?? "";
    this.traceId = parts.traceId ?? "";
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      type: this.name,
      status: this.status,
      endpoint: this.endpoint,
      ...(this.code ? { code: this.code } : {}),
      ...(this.subcode ? { subcode: this.subcode } : {}),
      ...(this.type ? { meta_type: this.type } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.traceId ? { trace_id: this.traceId } : {}),
    };
  }
}

/** The token is expired, revoked, or was never valid. A refresh may fix it. */
export class AuthenticationError extends ThreadsError {}

/** Authenticated, but the app lacks the scope, or App Review has not granted it. */
export class PermissionError extends ThreadsError {}

/** Bad arguments: a container that will not build, an unreachable media URL. */
export class ValidationError extends ThreadsError {}

/** The post, container or profile does not exist, or is not visible to you. */
export class NotFoundError extends ThreadsError {}

/** A published or reply quota is exhausted for the rolling 24-hour window. */
export class RateLimitError extends ThreadsError {}

/** 5xx. Upstream, usually transient, worth retrying. */
export class ServerError extends ThreadsError {}

/** Nothing arrived before our own deadline. */
export class TimeoutError extends ThreadsError {}

/** A media container failed to process, expired, or never finished. */
export class ContainerError extends ThreadsError {}

/** Writes are disabled, or a destructive tool was called without `confirm`. */
export class WriteBlockedError extends ThreadsError {
  constructor(message: string) {
    super(message, 0, "(local)", { type: "WriteBlocked" });
  }
}

/** A post is longer than Threads will accept. Raised before anything is sent. */
export class TextTooLongError extends ThreadsError {
  constructor(message: string) {
    super(message, 0, "(local)", { type: "TextTooLong" });
  }
}

export type MetaErrorBody = {
  code: number;
  subcode: number;
  type: string;
  message: string;
  traceId: string;
};

/**
 * Pull Meta's error envelope out of a response body.
 *
 * Falls back to raw text capped at 500 characters, so an HTML error page from
 * a load balancer in front of the Graph API does not become the whole message.
 */
export function parseErrorBody(body: string): MetaErrorBody {
  const empty = { code: 0, subcode: 0, type: "", message: "", traceId: "" };
  const text = body.trim();
  if (!text) return empty;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const err = (parsed as Record<string, unknown>).error;
      if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        return {
          code: typeof e.code === "number" ? e.code : 0,
          subcode: typeof e.error_subcode === "number" ? e.error_subcode : 0,
          type: typeof e.type === "string" ? e.type : "",
          message: typeof e.message === "string" ? e.message.slice(0, 500) : "",
          traceId: typeof e.fbtrace_id === "string" ? e.fbtrace_id : "",
        };
      }
    }
  } catch {
    // Not JSON. Fall through to the raw text.
  }

  return { ...empty, message: text.replace(/\s+/g, " ").slice(0, 500) };
}

/**
 * Meta's OAuth error codes, as far as they are documented and observed.
 *
 * 190 is every token problem at once, and the subcode is what separates them.
 * 463 means expired, which a refresh fixes. 467 means invalidated, which it
 * does not: the person has to authorise again.
 */
const OAUTH_CODE = 190;
const SUBCODE_EXPIRED = 463;
const SUBCODE_INVALIDATED = 467;
const SUBCODE_CHANGED_PASSWORD = 460;

/** True when this failure means a token refresh is worth attempting. */
export function isRefreshable(code: number, subcode: number): boolean {
  return code === OAUTH_CODE && subcode === SUBCODE_EXPIRED;
}

/** True when the token is dead and only a fresh authorisation will help. */
export function isUnrecoverableToken(code: number, subcode: number): boolean {
  return code === OAUTH_CODE && (subcode === SUBCODE_INVALIDATED || subcode === SUBCODE_CHANGED_PASSWORD);
}

/**
 * The scope each endpoint needs, so a permission failure can name it.
 *
 * Threads splits its permissions far more finely than most APIs, and the error
 * Meta returns for a missing one does not say which is missing. Being told
 * "add threads_manage_insights" is the difference between a two-minute fix in
 * the App Dashboard and an afternoon of guessing.
 */
const SCOPE_FOR: Array<[RegExp, string]> = [
  [/threads_publish|\/threads$/, "threads_content_publish"],
  [/manage_reply|pending_replies/, "threads_manage_replies"],
  [/\/replies|\/conversation/, "threads_read_replies"],
  [/insights/, "threads_manage_insights"],
  [/keyword_search/, "threads_keyword_search"],
  [/profile_lookup/, "threads_profile_discovery"],
  [/location_search/, "threads_location_tagging"],
];

export function scopeFor(endpoint: string): string | undefined {
  for (const [pattern, scope] of SCOPE_FOR) {
    if (pattern.test(endpoint)) return scope;
  }
  return undefined;
}

/** Map a status plus Meta's error code onto the right class. */
export function errorFor(status: number, endpoint: string, body: string): ThreadsError {
  const { code, subcode, type, message, traceId } = parseErrorBody(body);
  const parts = { code, subcode, type, detail: message, traceId };

  // Meta signals a spent quota with codes 4, 17 and 32 rather than HTTP 429.
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return new RateLimitError(
      `Threads rate limited ${endpoint}. Posting is capped at 250 posts and 1,000 replies per rolling 24 hours, and deletes at 100. Call get_publishing_limit to see what is left.`,
      status,
      endpoint,
      parts,
    );
  }

  if (code === OAUTH_CODE || status === 401) {
    if (isUnrecoverableToken(code, subcode)) {
      return new AuthenticationError(
        `The Threads token was invalidated and cannot be refreshed. Run \`threads-mcp login\` to authorise again.`,
        status,
        endpoint,
        parts,
      );
    }
    return new AuthenticationError(
      `Threads rejected the token for ${endpoint}. A long-lived token lasts 60 days and dies permanently if it is never refreshed. Try \`threads-mcp refresh\`, then \`threads-mcp login\` if that fails.`,
      status,
      endpoint,
      parts,
    );
  }

  if (status === 403 || code === 10 || (code >= 200 && code <= 299)) {
    const scope = scopeFor(endpoint);
    return new PermissionError(
      scope
        ? `Threads refused ${endpoint}. This endpoint needs the \`${scope}\` scope, granted both when the profile authorises the app and by App Review for anyone other than a tester on your own app.`
        : `Threads refused ${endpoint} for this profile. This is usually a missing OAuth scope or an App Review permission that has not been granted.`,
      status,
      endpoint,
      parts,
    );
  }

  if (status === 404 || code === 803) {
    return new NotFoundError(
      `Not found via ${endpoint}. Check the post or container id. A deleted post, a container that expired after 24 hours, and an id that never existed all look the same here.`,
      status,
      endpoint,
      parts,
    );
  }

  if (status >= 500) {
    return new ServerError(
      `Threads returned ${status} for ${endpoint}. This is upstream and usually transient.`,
      status,
      endpoint,
      parts,
    );
  }

  return new ValidationError(
    `Threads rejected the request to ${endpoint}${code ? ` (code ${code}${subcode ? `/${subcode}` : ""})` : ""}.`,
    status,
    endpoint,
    parts,
  );
}
