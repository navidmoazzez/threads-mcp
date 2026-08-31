/**
 * Insights.
 *
 * Threads reports metrics in three different envelopes depending on the metric,
 * and the difference is not documented anywhere near the metric list:
 *
 *   total_value   {"value": 42}                    likes, replies, followers
 *   time_series   {"values":[{"value":…,"end_time":…}]}   views
 *   breakdown     nested by dimension               follower_demographics
 *
 * Handed to a model raw, those three shapes mean it has to guess where the
 * number is, and it guesses wrong on `views` about half the time because that
 * is the one that is a series. They are flattened here into one shape.
 *
 * `get_top_posts` is the tool that does not map to an endpoint. Ranking by
 * absolute likes tells you which posts are old; ranking by engagement against
 * views tells you which ones worked. That means a fetch per post, so it is
 * bounded and says what it sampled.
 */

import { z } from "zod";
import { accountArg, clamp, defineTool } from "./kit.js";
import { POST_FIELDS } from "../api/client.js";
import { dataOf } from "../format/posts.js";
import { requireMediaId } from "../api/identity.js";

const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
const ACCOUNT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "clicks", "followers_count"] as const;

type Metric = { name?: string; period?: string; total_value?: { value?: number }; values?: Array<{ value?: number; end_time?: string }> };

/** Flatten Meta's three insight envelopes into one name-to-number map. */
function flatten(rows: Metric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!row.name) continue;
    if (typeof row.total_value?.value === "number") {
      out[row.name] = row.total_value.value;
      continue;
    }
    if (Array.isArray(row.values)) {
      // A time series is summed. For `views` over a window that is the number
      // people mean; the series itself is returned separately when asked for.
      out[row.name] = row.values.reduce((sum, v) => sum + (typeof v.value === "number" ? v.value : 0), 0);
    }
  }
  return out;
}

export const getPostInsights = defineTool({
  name: "get_post_insights",
  title: "Metrics for one post",
  description:
    "Views, likes, replies, reposts, quotes and shares for one of your posts. Reply metrics count direct replies only, not the whole tree underneath.",
  schema: {
    id: z.string().describe("Numeric post id."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    const response = (await ctx.client.call(account, `/${id}/insights`, {
      params: { metric: POST_METRICS.join(",") },
    })) as Record<string, unknown>;

    const metrics = flatten(dataOf(response) as Metric[]);
    const views = metrics.views ?? 0;
    const interactions = (metrics.likes ?? 0) + (metrics.replies ?? 0) + (metrics.reposts ?? 0) + (metrics.quotes ?? 0);

    return {
      post_id: id,
      ...metrics,
      ...(views > 0 ? { engagement_rate: Number(((interactions / views) * 100).toFixed(2)) } : {}),
      note: Object.keys(metrics).length
        ? undefined
        : "No metrics returned. Reposts of other people's posts have none, and insights need the threads_manage_insights scope.",
    };
  },
});

export const getAccountInsights = defineTool({
  name: "get_account_insights",
  title: "Metrics for the whole profile",
  description:
    "Profile-level views, likes, replies, reposts, quotes, link clicks and follower count. Data starts on 13 April 2024 and is not reliable before 1 June 2024; earlier windows return nothing.",
  schema: {
    since: z.string().optional().describe("ISO date or Unix timestamp. Nothing before 2024-04-13 is available."),
    until: z.string().optional().describe("ISO date or Unix timestamp."),
    metrics: z
      .array(z.enum(ACCOUNT_METRICS))
      .optional()
      .describe("Which metrics to fetch. Defaults to all of them."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const wanted = args.metrics?.length ? args.metrics : ACCOUNT_METRICS;

    // followers_count rejects a date range, so it is fetched on its own
    // whenever a window was given. Sending it with since/until fails the whole
    // call, taking every other metric down with it.
    const windowed = wanted.filter((m) => m !== "followers_count");
    const wantsFollowers = wanted.includes("followers_count");
    const hasWindow = Boolean(args.since || args.until);

    const results: Record<string, number> = {};

    if (windowed.length) {
      const response = (await ctx.client.call(account, `/${userId}/threads_insights`, {
        params: { metric: windowed.join(","), since: args.since, until: args.until },
      })) as Record<string, unknown>;
      Object.assign(results, flatten(dataOf(response) as Metric[]));
    }

    if (wantsFollowers) {
      const response = (await ctx.client.call(account, `/${userId}/threads_insights`, {
        params: { metric: "followers_count" },
      })) as Record<string, unknown>;
      Object.assign(results, flatten(dataOf(response) as Metric[]));
    }

    return {
      account: account.username ?? userId,
      ...(hasWindow ? { since: args.since ?? null, until: args.until ?? null } : { window: "lifetime" }),
      ...results,
      ...(wantsFollowers && hasWindow
        ? { note: "followers_count is a current total and ignores the date range." }
        : {}),
    };
  },
});

export const getFollowerDemographics = defineTool({
  name: "get_follower_demographics",
  title: "Who follows this profile",
  description:
    "Follower breakdown by country, city, age or gender. One dimension per call: Threads refuses more than one breakdown at a time. Needs at least 100 followers, and ignores any date range.",
  schema: {
    breakdown: z
      .enum(["country", "city", "age", "gender"])
      .describe("Which dimension to break followers down by. Only one per call."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const response = (await ctx.client.call(account, `/${userId}/threads_insights`, {
      params: { metric: "follower_demographics", breakdown: args.breakdown },
    })) as Record<string, unknown>;

    const row = dataOf(response)[0] as
      | { total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> } }
      | undefined;

    const results = row?.total_value?.breakdowns?.[0]?.results ?? [];
    const buckets = results
      .map((r) => ({ value: r.dimension_values?.[0] ?? "unknown", followers: r.value ?? 0 }))
      .sort((a, b) => b.followers - a.followers);

    return {
      breakdown: args.breakdown,
      total: buckets.reduce((sum, b) => sum + b.followers, 0),
      buckets,
      ...(buckets.length
        ? {}
        : { note: "Nothing returned. Follower demographics need at least 100 followers and the threads_manage_insights scope." }),
    };
  },
});

export const getTopPosts = defineTool({
  name: "get_top_posts",
  title: "Rank your posts by what actually worked",
  description:
    "Fetch recent posts, pull the metrics for each, and rank them. Sorting by engagement rate rather than raw likes is the point: absolute likes mostly rank posts by age, while engagement against views shows which ones landed. Costs one request per post, so keep the sample modest.",
  schema: {
    sample: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("How many recent posts to score. Defaults to 20, capped at 50 because each one is a request."),
    sort_by: z
      .enum(["engagement_rate", "views", "likes", "replies", "reposts", "quotes"])
      .optional()
      .describe("Ranking key. Defaults to engagement_rate."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const sample = clamp(args.sample, 20, 50);
    const sortBy = args.sort_by ?? "engagement_rate";

    const listing = (await ctx.client.call(account, `/${userId}/threads`, {
      params: { fields: POST_FIELDS, limit: sample },
    })) as Record<string, unknown>;

    const posts = dataOf(listing);

    const scored = await Promise.all(
      posts.map(async (post) => {
        try {
          const response = (await ctx.client.call(account, `/${post.id}/insights`, {
            params: { metric: POST_METRICS.join(",") },
          })) as Record<string, unknown>;
          const metrics = flatten(dataOf(response) as Metric[]);
          const views = metrics.views ?? 0;
          const interactions =
            (metrics.likes ?? 0) + (metrics.replies ?? 0) + (metrics.reposts ?? 0) + (metrics.quotes ?? 0);
          return {
            id: String(post.id),
            permalink: post.permalink as string | undefined,
            posted_at: post.timestamp as string | undefined,
            excerpt: typeof post.text === "string" ? post.text.replace(/\s+/g, " ").slice(0, 120) : "",
            media_type: post.media_type as string | undefined,
            views,
            likes: metrics.likes ?? 0,
            replies: metrics.replies ?? 0,
            reposts: metrics.reposts ?? 0,
            quotes: metrics.quotes ?? 0,
            engagement_rate: views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : 0,
          };
        } catch {
          return null;
        }
      }),
    );

    const rows = scored.filter((r): r is NonNullable<typeof r> => r !== null);
    rows.sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number));

    const withViews = rows.filter((r) => r.views > 0).length;

    return {
      sampled: posts.length,
      scored: rows.length,
      sorted_by: sortBy,
      posts: rows,
      ...(sortBy === "engagement_rate" && withViews < rows.length
        ? {
            note: `${rows.length - withViews} post(s) reported no views, so their engagement rate is 0 rather than unknown. Sort by likes to include them fairly.`,
          }
        : {}),
    };
  },
});

export const INSIGHT_TOOLS = [getPostInsights, getAccountInsights, getFollowerDemographics, getTopPosts];
