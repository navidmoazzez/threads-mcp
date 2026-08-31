/**
 * Resolving credentials, and the multi-account model.
 *
 * Threads is not like a platform with app passwords. Every credential here is
 * an OAuth token minted against a Meta app, it is bound to one Threads profile,
 * and it dies after 60 days unless something refreshes it. That shapes the
 * whole design: tokens arrive from three places, and the one that matters most
 * is the token store `threads-mcp login` writes, because that is the only one
 * this server can keep alive on its own.
 *
 * Three sources, in priority order:
 *   1. THREADS_ACCOUNTS      a JSON array, for several profiles at once
 *   2. THREADS_ACCESS_TOKEN  the single-account variable
 *   3. the token store       ~/.threads-mcp/tokens.json, written by `login`
 *
 * The store is last rather than first so an explicit environment variable
 * always wins. Someone who exports a token into one client's config expects
 * that token to be the one used, not a stale one a login left on disk months
 * ago.
 *
 * `user_id` is deliberately optional everywhere. Almost every Threads endpoint
 * is keyed by the numeric profile id, and asking a person to find theirs before
 * anything works is a setup step with no reason to exist: `GET /me` returns it,
 * and the client resolves and caches it on first use.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export type Account = {
  /** Long-lived user access token for one Threads profile. */
  accessToken: string;
  /**
   * Numeric Threads profile id. Optional: resolved from `GET /me` and cached
   * on first use when it is not supplied.
   */
  userId?: string;
  /**
   * Username without the @, when known. Used for matching an `account`
   * argument and for display. Resolved from `GET /me` when absent.
   */
  username?: string;
  /** Unix ms when this token expires, when known. */
  expiresAt?: number;
  /** Where this credential came from. Shown by `doctor` and `list_accounts`. */
  source: "env" | "env-json" | "store";
};

export type Config = {
  accounts: Account[];
  /** Usernames preferred, in order, when a tool is called without `account`. */
  preferred: string[];
  /** Meta app credentials. Needed by `login` and by token refresh. */
  appId?: string;
  appSecret?: string;
  readOnly: boolean;
  allowDestructive: boolean;
  /**
   * Refresh a token this many days before it expires.
   *
   * Wide on purpose. Meta refuses to refresh a token in its first 24 hours, so
   * a narrow window plus infrequent runs can miss every chance it gets. A wide
   * one means many attempts before anything actually lapses, and refreshing
   * twice just resets the clock twice.
   */
  refreshWindowDays: number;
  /** Write refreshed tokens back to the store. */
  persistTokens: boolean;
  storePath: string;
  requestTimeoutMs: number;
  minRequestIntervalMs: number;
  maxRetries: number;
  /** How long to wait for a media container to finish processing. */
  containerTimeoutMs: number;
  graphHost: string;
  userAgent: string;
  auditPath?: string;
};

export const DEFAULT_GRAPH_HOST = "https://graph.threads.net";

/** Where `login` writes tokens, and where refreshed tokens are written back. */
export function defaultStorePath(): string {
  return process.env.THREADS_TOKEN_STORE || join(homedir(), ".threads-mcp", "tokens.json");
}

/** Strip a leading @ and lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function normalizeHost(raw: string | undefined, fallback: string): string {
  const t = (raw ?? "").trim();
  if (!t) return fallback;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return withScheme.replace(/\/+$/, "");
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(`[threads-mcp] ${name}="${raw}" is not a positive number. Using ${fallback}.\n`);
    return fallback;
  }
  return n;
}

/**
 * Read `THREADS_ACCOUNTS`, a JSON array.
 *
 * Both snake_case and camelCase keys are accepted, because the same JSON gets
 * pasted between a shell export and a client config file, and the two
 * conventions do not survive that trip intact.
 */
export function accountsFromJson(raw: string | undefined): Account[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write("[threads-mcp] THREADS_ACCOUNTS is not valid JSON. Ignoring it.\n");
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Account[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const token = e.access_token ?? e.accessToken ?? e.token;
    if (typeof token !== "string" || !token.trim()) continue;
    const userId = e.user_id ?? e.userId ?? e.id;
    const username = e.username ?? e.account_name ?? e.handle;
    const expires = e.expires_at ?? e.expiresAt;
    out.push({
      accessToken: token.trim(),
      userId: typeof userId === "string" ? userId : typeof userId === "number" ? String(userId) : undefined,
      username: typeof username === "string" ? normalizeUsername(username) : undefined,
      expiresAt: typeof expires === "number" ? expires : undefined,
      source: "env-json",
    });
  }
  return out;
}

function accountFromSingleEnv(): Account[] {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token || !token.trim()) return [];
  const userId = process.env.THREADS_USER_ID;
  const username = process.env.THREADS_USERNAME;
  return [
    {
      accessToken: token.trim(),
      userId: userId?.trim() || undefined,
      username: username ? normalizeUsername(username) : undefined,
      source: "env",
    },
  ];
}

export function loadConfig(stored: Account[] = []): Config {
  const fromJson = accountsFromJson(process.env.THREADS_ACCOUNTS);
  const fromEnv = accountFromSingleEnv();
  const accounts = fromJson.length > 0 ? fromJson : fromEnv.length > 0 ? fromEnv : stored;

  const preferred = (process.env.THREADS_DEFAULT_ACCOUNT ?? "")
    .split(",")
    .map((s) => normalizeUsername(s))
    .filter(Boolean);

  return {
    accounts,
    preferred,
    appId: process.env.THREADS_APP_ID?.trim() || undefined,
    appSecret: process.env.THREADS_APP_SECRET?.trim() || undefined,
    readOnly: envFlag("THREADS_READ_ONLY", false),
    allowDestructive: envFlag("THREADS_ALLOW_DESTRUCTIVE", true),
    refreshWindowDays: envInt("THREADS_REFRESH_WINDOW_DAYS", 20),
    persistTokens: envFlag("THREADS_PERSIST_TOKENS", true),
    storePath: defaultStorePath(),
    requestTimeoutMs: envInt("THREADS_REQUEST_TIMEOUT_MS", 30_000),
    minRequestIntervalMs: envInt("THREADS_MIN_REQUEST_INTERVAL_MS", 120),
    maxRetries: envInt("THREADS_MAX_RETRIES", 3),
    containerTimeoutMs: envInt("THREADS_CONTAINER_TIMEOUT_MS", 120_000),
    graphHost: normalizeHost(process.env.THREADS_GRAPH_HOST, DEFAULT_GRAPH_HOST),
    userAgent: process.env.THREADS_USER_AGENT || "threads-mcp",
    auditPath: process.env.THREADS_AUDIT_LOG || undefined,
  };
}

/**
 * Pick which profile a call acts as.
 *
 * With no hint: the first configured `THREADS_DEFAULT_ACCOUNT` that is actually
 * connected, else the first account. Exact username match beats prefix match,
 * because "navid" is a prefix of "navidmedia", and a prefix-first search would
 * hand an unnamed post to the wrong profile whenever both are connected. A
 * name that matches nothing fails and lists what is connected, rather than
 * quietly posting somewhere else.
 */
export function selectAccount(config: Config, hint?: string): Account {
  if (config.accounts.length === 0) {
    throw new Error(
      "No Threads account configured. Run `threads-mcp login` to authorise one, or set THREADS_ACCESS_TOKEN. Run `threads-mcp doctor` for details.",
    );
  }

  if (!hint) {
    for (const want of config.preferred) {
      const exact = config.accounts.find((a) => a.username === want);
      if (exact) return exact;
      const prefix = config.accounts.find((a) => a.username?.startsWith(want));
      if (prefix) return prefix;
    }
    return config.accounts[0]!;
  }

  const needle = normalizeUsername(hint);

  // A numeric hint is a profile id, not a username.
  if (/^\d+$/.test(needle)) {
    const byId = config.accounts.find((a) => a.userId === needle);
    if (byId) return byId;
  }

  const exact = config.accounts.find((a) => a.username === needle);
  if (exact) return exact;

  const prefix = config.accounts.find((a) => a.username?.startsWith(needle));
  if (prefix) return prefix;

  const known = config.accounts.map((a) => a.username ?? a.userId ?? "(unresolved)").join(", ");
  throw new Error(
    `No connected Threads account matches "${hint}". Connected: ${known || "(none)"}. Usernames are resolved on first use, so a freshly added token may need one call before it can be named.`,
  );
}
