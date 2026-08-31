/**
 * Searching Threads, and looking up other people.
 *
 * Both of these are gated behind App Review permissions that most apps do not
 * have, and the failure mode is quiet rather than loud: without
 * `threads_keyword_search`, Meta does not refuse the search, it silently
 * narrows it to your own posts. A result set that looks thin is
 * indistinguishable from a niche query. So these tools say which mode they are
 * in rather than letting a model draw a conclusion from a filtered corpus.
 */

import { z } from "zod";
import { accountArg, clamp, defineTool, pageArgs } from "./kit.js";
import { POST_FIELDS } from "../api/client.js";
import { cursorOf, dataOf, renderList, renderProfile } from "../format/posts.js";

const SCOPE_NOTE =
  "Without the threads_keyword_search permission Meta does not refuse this call, it quietly restricts results to your own posts. Treat a thin result set as possibly unapproved rather than as evidence the topic is quiet.";

export const searchKeyword = defineTool({
  name: "search_keyword",
  title: "Search public Threads posts",
  description:
    "Search public Threads posts by keyword. Capped at 2,200 queries per rolling 24 hours. Needs the threads_keyword_search permission for anything beyond your own posts.",
  schema: {
    q: z.string().describe("The keyword or phrase to search for."),
    search_type: z
      .enum(["TOP", "RECENT"])
      .optional()
      .describe("TOP ranks by engagement, RECENT by time. Defaults to TOP."),
    media_type: z
      .enum(["TEXT_POST", "IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REPOST_FACADE"])
      .optional()
      .describe("Only return posts of this media type."),
    since: z.string().optional().describe("ISO date or Unix timestamp."),
    until: z.string().optional().describe("ISO date or Unix timestamp."),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const response = (await ctx.client.call(account, "/keyword_search", {
      params: {
        q: args.q,
        search_type: args.search_type ?? "TOP",
        media_type: args.media_type,
        since: args.since,
        until: args.until,
        fields: POST_FIELDS,
        limit: clamp(args.limit, 25),
        after: args.cursor,
      },
    })) as Record<string, unknown>;

    const posts = dataOf(response);
    const mine = account.username;
    const onlyMine = posts.length > 0 && mine !== undefined && posts.every((p) => String(p.username).toLowerCase() === mine);

    return `${renderList(posts, {
      source: "search",
      cursor: cursorOf(response),
      meta: { query: args.q, search_type: args.search_type ?? "TOP" },
    })}${onlyMine ? `<note>Every result is from your own profile. ${SCOPE_NOTE}</note>\n` : ""}`;
  },
});

export const searchTopicTag = defineTool({
  name: "search_topic_tag",
  title: "Search a topic tag",
  description:
    "Public posts carrying a topic tag. Threads topic tags are written without a # and there is one per post, so this is an exact tag match rather than a text search. Shares the 2,200-query daily budget with search_keyword.",
  schema: {
    tag: z.string().describe("The topic tag, with or without a leading #."),
    search_type: z.enum(["TOP", "RECENT"]).optional(),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const tag = args.tag.trim().replace(/^#/, "");
    const response = (await ctx.client.call(account, "/keyword_search", {
      params: {
        q: tag,
        search_mode: "TAG",
        search_type: args.search_type ?? "TOP",
        fields: POST_FIELDS,
        limit: clamp(args.limit, 25),
        after: args.cursor,
      },
    })) as Record<string, unknown>;

    return renderList(dataOf(response), {
      source: "search",
      cursor: cursorOf(response),
      meta: { topic_tag: tag, mode: "TAG" },
    });
  },
});

export const lookupProfile = defineTool({
  name: "lookup_profile",
  title: "Look up a public profile",
  description:
    "A public Threads profile by username, with its follower count and seven-day totals for views, likes, quotes and reposts. Only returns public profiles with at least 100 followers, and is capped at 1,000 lookups per rolling 24 hours. Without expanded access this is limited to Meta's own accounts.",
  schema: {
    username: z.string().describe("The username, with or without the @. Must match exactly."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const username = args.username.trim().replace(/^@/, "");

    const profile = (await ctx.client.call(account, "/profile_lookup", {
      params: {
        username,
        fields:
          "id,username,name,threads_profile_picture_url,threads_biography,is_verified,followers_count,likes_count,quotes_count,reposts_count,views_count",
      },
    })) as Record<string, unknown>;

    return renderProfile(profile, {
      followers: profile.followers_count,
      views_7d: profile.views_count,
      likes_7d: profile.likes_count,
      quotes_7d: profile.quotes_count,
      reposts_7d: profile.reposts_count,
    });
  },
});

export const listAllowlistedCountries = defineTool({
  name: "list_allowlisted_countries",
  title: "Countries available for geo-gating",
  description:
    "The country codes this profile may restrict a post to. Geo-gating is only enabled for some profiles; whoami reports whether this one is eligible. Read this before passing allowlisted_country_codes to create_post.",
  schema: { ...accountArg },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const profile = await ctx.client.profile(account);

    if (profile.is_eligible_for_geo_gating === false) {
      return {
        eligible: false,
        note: "This profile is not eligible for geo-gated posts. Meta enables it per profile; there is no way to request it through the API.",
      };
    }

    const response = (await ctx.client.call(account, `/${userId}/allowlisted_country_codes`, {
      params: { limit: 200 },
    })) as Record<string, unknown>;

    const rows = dataOf(response);
    return {
      eligible: true,
      count: rows.length,
      countries: rows.map((r) => ({ code: r.country_code ?? r.code, name: r.name })),
    };
  },
});

export const DISCOVER_TOOLS = [searchKeyword, searchTopicTag, lookupProfile, listAllowlistedCountries];
