/**
 * Which profiles are connected, who they are, and how much runway is left.
 *
 * Two things here have no equivalent on most platforms and matter enough to be
 * tools rather than footnotes: the 60-day token clock, and the daily publishing
 * quota. Both fail silently and both are cheap to check.
 */

import { z } from "zod";
import { accountArg, clamp, defineTool } from "./kit.js";
import { renderProfile } from "../format/posts.js";
import { daysRemaining } from "../auth/tokens.js";

export const listAccounts = defineTool({
  name: "list_accounts",
  title: "List connected Threads profiles",
  description:
    "Every connected Threads profile, which one acts by default, and how many days each token has left before it expires. Call this first when more than one profile might be connected.",
  schema: {
    fast: z
      .boolean()
      .optional()
      .describe("Skip the live profile lookups and return only what is configured locally."),
  },
  risk: "read",
  handler: async ({ fast }, ctx) => {
    const accounts = ctx.config.accounts;
    if (!accounts.length) {
      return {
        count: 0,
        note: "No Threads profile is connected. Run `threads-mcp login`, or set THREADS_ACCESS_TOKEN.",
      };
    }

    const defaultAccount = ctx.account();

    if (fast) {
      return {
        count: accounts.length,
        read_only: ctx.config.readOnly,
        accounts: accounts.map((a) => ({
          username: a.username ?? null,
          user_id: a.userId ?? null,
          source: a.source,
          token_days_left: daysRemaining(a) ?? null,
          is_default: a === defaultAccount,
        })),
      };
    }

    // One bad token must not hide the rest, so each profile is resolved
    // independently and a failure is reported in place.
    const rows = await Promise.all(
      accounts.map(async (a) => {
        const days = daysRemaining(a) ?? null;
        try {
          const profile = await ctx.client.profile(a);
          return {
            username: profile.username ?? null,
            user_id: profile.id,
            name: profile.name ?? null,
            verified: profile.is_verified ?? null,
            geo_gating_eligible: profile.is_eligible_for_geo_gating ?? null,
            source: a.source,
            token_days_left: days,
            is_default: a === defaultAccount,
            status: "ok" as const,
          };
        } catch (error) {
          return {
            username: a.username ?? null,
            user_id: a.userId ?? null,
            source: a.source,
            token_days_left: days,
            is_default: a === defaultAccount,
            status: "error" as const,
            detail: (error as Error).message.slice(0, 200),
          };
        }
      }),
    );

    const expiring = rows.filter((r) => typeof r.token_days_left === "number" && r.token_days_left <= 7);

    return {
      count: rows.length,
      healthy: rows.filter((r) => r.status === "ok").length,
      read_only: ctx.config.readOnly,
      accounts: rows,
      ...(expiring.length
        ? {
            warning: `${expiring.length} token(s) expire within a week. A Threads token that lapses cannot be refreshed, only replaced by authorising again. Call refresh_token, or run \`threads-mcp refresh\`.`,
          }
        : {}),
    };
  },
});

export const whoami = defineTool({
  name: "whoami",
  title: "Verify the token and show the profile",
  description:
    "Confirm which Threads profile the current token acts as, and return the live profile: username, name, bio, verification, and whether the profile is eligible for geo-gated posts. Use this to check credentials before anything else.",
  schema: { ...accountArg },
  risk: "read",
  handler: async ({ account }, ctx) => {
    const chosen = ctx.account(account);
    const profile = await ctx.client.profile(chosen);
    const days = daysRemaining(chosen);
    return renderProfile(profile, {
      token_days_left: days ?? undefined,
      credential_source: chosen.source,
    });
  },
});

export const getPublishingLimit = defineTool({
  name: "get_publishing_limit",
  title: "Check the daily publishing quota",
  description:
    "How much of the rolling 24-hour quota this profile has spent. Threads allows 250 posts, 1,000 replies and 100 deletes per 24 hours, and refuses everything once a quota is gone. Check this before a bulk run rather than discovering it halfway through.",
  schema: { ...accountArg },
  risk: "read",
  handler: async ({ account }, ctx) => {
    const chosen = ctx.account(account);
    const userId = await ctx.client.userId(chosen);
    const response = (await ctx.client.call(chosen, `/${userId}/threads_publishing_limit`, {
      params: { fields: "config,quota_usage,reply_config,reply_quota_usage,delete_quota_usage,location_search_quota_usage" },
    })) as { data?: Array<Record<string, unknown>> };

    const row = response.data?.[0] ?? {};
    const config = (row.config ?? {}) as { quota_total?: number };
    const replyConfig = (row.reply_config ?? {}) as { quota_total?: number };

    const used = Number(row.quota_usage ?? 0);
    const total = Number(config.quota_total ?? 250);
    const repliesUsed = Number(row.reply_quota_usage ?? 0);
    const repliesTotal = Number(replyConfig.quota_total ?? 1000);

    return {
      posts: { used, total, remaining: Math.max(0, total - used) },
      replies: { used: repliesUsed, total: repliesTotal, remaining: Math.max(0, repliesTotal - repliesUsed) },
      deletes: { used: Number(row.delete_quota_usage ?? 0), total: 100 },
      location_searches: { used: Number(row.location_search_quota_usage ?? 0), total: 500 },
      note: "Quotas are a rolling 24-hour window, not a calendar day. A carousel counts as one post however many items it holds.",
    };
  },
});

export const refreshToken = defineTool({
  name: "refresh_token",
  title: "Extend this profile's token by 60 days",
  description:
    "Refresh the long-lived access token, giving it another 60 days. A Threads token can be refreshed once it is 24 hours old and never after it expires, so an expired one has to be replaced by authorising again. This server refreshes automatically when a token is inside its refresh window; call this to do it now.",
  schema: { ...accountArg },
  risk: "write",
  idempotent: true,
  summary: ({ account }) => `refresh the token for ${account ?? "the default profile"}`,
  handler: async ({ account }, ctx) => {
    const chosen = ctx.account(account);
    const before = daysRemaining(chosen);
    const refreshed = await ctx.client.refresh(chosen);

    if (!refreshed) {
      throw new Error(
        "The refresh was refused. A token can only be refreshed once it is at least 24 hours old and before it expires. If it has already expired, run `threads-mcp login` to authorise again.",
      );
    }

    const after = daysRemaining(chosen);
    return {
      refreshed: true,
      days_left_before: before ?? null,
      days_left_now: after ?? null,
      persisted: ctx.config.persistTokens && chosen.source === "store",
      note:
        chosen.source === "store"
          ? "Written back to the token store."
          : "This token came from the environment, so the new value could not be saved. Update THREADS_ACCESS_TOKEN, or run `threads-mcp login` so the server can manage it.",
    };
  },
});

export const ACCOUNT_TOOLS = [listAccounts, whoami, getPublishingLimit, refreshToken];

export { clamp };
