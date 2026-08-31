/**
 * `threads-mcp doctor`: find out what is actually wrong.
 *
 * Threads fails in ways that look identical from a tool call. A missing scope
 * usually returns an empty result rather than an error. An expired token and a
 * token that was never long-lived both read as "rejected". A profile with 99
 * followers gets nothing back from demographics and no explanation.
 *
 * So this probes each capability separately with the cheapest call that proves
 * it, and reports what is granted, what is missing, and what to do about each.
 */

import { accountsFromStore } from "./auth/store.js";
import { ThreadsClient } from "./api/client.js";
import { loadConfig, type Account, type Config } from "./config.js";
import { daysRemaining } from "./auth/tokens.js";
import { ThreadsError } from "./api/errors.js";

type Check = { name: string; ok: boolean; detail: string; fix?: string };

const PASS = "  ok   ";
const FAIL = " fail  ";
const WARN = " warn  ";

function line(check: Check): string {
  const mark = check.ok ? PASS : check.detail.startsWith("not granted") ? WARN : FAIL;
  const fix = check.fix && !check.ok ? `\n         ${check.fix}` : "";
  return `[${mark}] ${check.name}: ${check.detail}${fix}`;
}

/**
 * Probe one capability.
 *
 * A permission failure is reported as a warning rather than an error: an app
 * that never asked for keyword search is not broken, it just cannot search.
 */
async function probe(name: string, fix: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    if (error instanceof ThreadsError && error.name === "PermissionError") {
      return { name, ok: false, detail: "not granted", fix };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail: message.slice(0, 160), fix };
  }
}

async function checkAccount(client: ThreadsClient, account: Account, config: Config): Promise<string[]> {
  const label = account.username ? `@${account.username}` : (account.userId ?? "unresolved");
  const lines: string[] = [`\n${label}  (credential from ${account.source})`];

  let userId: string;
  try {
    const profile = await client.profile(account);
    userId = profile.id;
    lines.push(
      line({
        name: "token",
        ok: true,
        detail: `valid, acting as @${profile.username ?? profile.id}${profile.is_verified ? ", verified" : ""}`,
      }),
    );
  } catch (error) {
    lines.push(
      line({
        name: "token",
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
        fix: "Run `threads-mcp login` to authorise again. An expired Threads token cannot be refreshed, only replaced.",
      }),
    );
    return lines;
  }

  const days = daysRemaining(account);
  if (days === undefined) {
    lines.push(
      line({
        name: "expiry",
        ok: true,
        detail: "unknown — this token came from the environment, so its expiry was never recorded",
        fix: "Run `threads-mcp login` so the server owns the token and can refresh it before it lapses.",
      }),
    );
  } else if (days <= 7) {
    lines.push(
      line({
        name: "expiry",
        ok: false,
        detail: `${days} days left`,
        fix: "Run `threads-mcp refresh` now. A token that lapses cannot be recovered.",
      }),
    );
  } else {
    lines.push(line({ name: "expiry", ok: true, detail: `${days} days left` }));
  }

  const checks = await Promise.all([
    probe("read own posts", "threads_basic is missing, which is unusual — re-authorise.", async () => {
      const response = (await client.call(account, `/${userId}/threads`, { params: { fields: "id", limit: 1 } })) as {
        data?: unknown[];
      };
      return `${response.data?.length ?? 0} post(s) readable`;
    }),

    probe("publishing quota", "Add threads_content_publish and re-authorise.", async () => {
      const response = (await client.call(account, `/${userId}/threads_publishing_limit`, {
        params: { fields: "quota_usage,reply_quota_usage" },
      })) as { data?: Array<{ quota_usage?: number; reply_quota_usage?: number }> };
      const row = response.data?.[0] ?? {};
      return `${row.quota_usage ?? 0}/250 posts and ${row.reply_quota_usage ?? 0}/1000 replies used today`;
    }),

    probe("replies", "Add threads_read_replies and re-authorise.", async () => {
      const response = (await client.call(account, `/${userId}/replies`, { params: { fields: "id", limit: 1 } })) as {
        data?: unknown[];
      };
      return `readable (${response.data?.length ?? 0} recent)`;
    }),

    probe("insights", "Add threads_manage_insights and re-authorise.", async () => {
      const response = (await client.call(account, `/${userId}/threads_insights`, {
        params: { metric: "followers_count" },
      })) as { data?: Array<{ total_value?: { value?: number } }> };
      const followers = response.data?.[0]?.total_value?.value;
      return followers === undefined ? "readable" : `${followers} followers`;
    }),

    probe(
      "keyword search",
      "Needs threads_keyword_search, which requires App Review. Without it, searches quietly return only your own posts.",
      async () => {
        const response = (await client.call(account, "/keyword_search", {
          params: { q: "threads", search_type: "TOP", fields: "id,username", limit: 2 },
        })) as { data?: Array<{ username?: string }> };
        const rows = response.data ?? [];
        const mine = account.username;
        const onlyMine = rows.length > 0 && rows.every((r) => r.username?.toLowerCase() === mine);
        return onlyMine ? "granted, but every result was your own — likely unapproved" : `${rows.length} result(s)`;
      },
    ),

    probe(
      "profile discovery",
      "Needs threads_profile_discovery and expanded access. Without it, only Meta's own accounts resolve.",
      async () => {
        const response = (await client.call(account, "/profile_lookup", {
          params: { username: "threads", fields: "id,username" },
        })) as { username?: string };
        return response.username ? `resolved @${response.username}` : "reachable";
      },
    ),
  ]);

  lines.push(...checks.map(line));

  const geo = (await client.profile(account)).is_eligible_for_geo_gating;
  lines.push(
    line({
      name: "geo-gating",
      ok: geo === true,
      detail: geo === true ? "eligible" : "not enabled for this profile",
      fix: "Meta enables geo-gating per profile. There is no way to request it through the API.",
    }),
  );

  return lines;
}

export async function runDoctor(): Promise<number> {
  const stored = accountsFromStore(loadConfig().storePath);
  const config = loadConfig(stored);
  const out = (text: string) => process.stdout.write(`${text}\n`);

  out("threads-mcp doctor");
  out("");

  // Network first. Every check below is meaningless if this fails, and the
  // errors it produces would all blame the token instead.
  try {
    const res = await fetch(`${config.graphHost}/v1.0/me`, { method: "GET" });
    out(line({ name: "network", ok: true, detail: `${config.graphHost} reachable (HTTP ${res.status} without a token, as expected)` }));
  } catch (error) {
    out(
      line({
        name: "network",
        ok: false,
        detail: `cannot reach ${config.graphHost}: ${(error as Error).message}`,
        fix: "Check the connection, a proxy, or THREADS_GRAPH_HOST.",
      }),
    );
    return 1;
  }

  out(
    line({
      name: "app credentials",
      ok: Boolean(config.appId && config.appSecret),
      detail: config.appId && config.appSecret ? "THREADS_APP_ID and THREADS_APP_SECRET are set" : "not set",
      fix: "Only `threads-mcp login` needs these. Refreshing an existing token does not.",
    }),
  );

  out(
    line({
      name: "token store",
      ok: true,
      detail: `${stored.length} token(s) at ${config.storePath}`,
    }),
  );

  if (config.readOnly) out(`[${WARN}] mode: THREADS_READ_ONLY=1, every write is hidden from the tool list`);
  if (!config.allowDestructive) out(`[${WARN}] mode: THREADS_ALLOW_DESTRUCTIVE=0, posting and deleting are blocked`);

  if (!config.accounts.length) {
    out("");
    out("No Threads profile is connected.");
    out("  Run `threads-mcp login`, or set THREADS_ACCESS_TOKEN to a long-lived token.");
    return 1;
  }

  const client = new ThreadsClient(config);
  let failed = false;

  for (const account of config.accounts) {
    const lines = await checkAccount(client, account, config);
    for (const l of lines) out(l);
    if (lines.some((l) => l.includes(FAIL))) failed = true;
  }

  out("");
  out(failed ? "Something above needs fixing." : "Everything checks out.");
  return failed ? 1 : 0;
}

/** `threads-mcp refresh`: extend every stored token now. */
export async function runRefresh(): Promise<number> {
  const stored = accountsFromStore(loadConfig().storePath);
  const config = loadConfig(stored);
  const out = (text: string) => process.stdout.write(`${text}\n`);

  if (!config.accounts.length) {
    out("No Threads profile is connected. Run `threads-mcp login`.");
    return 1;
  }

  const client = new ThreadsClient(config);
  let failed = false;

  for (const account of config.accounts) {
    const label = account.username ? `@${account.username}` : (account.userId ?? "unresolved");
    if (account.source !== "store") {
      out(`[${WARN}] ${label}: token came from the environment, so a refreshed value cannot be saved anywhere.`);
      continue;
    }
    const before = daysRemaining(account);
    const ok = await client.refresh(account);
    if (ok) {
      out(`[${PASS}] ${label}: ${before ?? "?"} → ${daysRemaining(account) ?? "?"} days`);
    } else {
      failed = true;
      out(`[${FAIL}] ${label}: refresh refused. A token must be at least 24 hours old and not yet expired. Run \`threads-mcp login\`.`);
    }
  }

  return failed ? 1 : 0;
}
