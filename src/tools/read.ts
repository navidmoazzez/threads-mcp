/**
 * Reading your own posts.
 *
 * `since_hours` pages until it reaches a time window rather than a count,
 * because "what did I post this week" is a question about time and turning it
 * into a guess at a post count is how you end up missing half of it.
 */

import { z } from "zod";
import { accountArg, clamp, defineTool, pageArgs } from "./kit.js";
import { POST_FIELDS } from "../api/client.js";
import { cursorOf, dataOf, renderList, renderPost } from "../format/posts.js";
import { requireMediaId } from "../api/identity.js";

export const getPosts = defineTool({
  name: "get_posts",
  title: "Read your recent posts",
  description:
    "Your own Threads posts, newest first, with ids and permalinks. The numeric id on each result is what every other tool wants: Threads has no way to convert a permalink back into an id, so this is where ids come from.",
  schema: {
    since_hours: z
      .number()
      .optional()
      .describe("Read back this many hours, paging as needed, rather than a fixed number of posts."),
    since: z.string().optional().describe("ISO date or Unix timestamp to start from."),
    until: z.string().optional().describe("ISO date or Unix timestamp to stop at."),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const pageSize = clamp(args.limit, 25);

    const cutoff = args.since_hours ? Date.now() - args.since_hours * 3_600_000 : undefined;
    const collected: Record<string, unknown>[] = [];
    let cursor = args.cursor;
    let reachedCutoff = false;

    // Without a window this is one page. With one, page until the timestamps
    // cross it, capped so a busy account cannot spin here forever.
    const maxPages = cutoff ? 10 : 1;

    for (let page = 0; page < maxPages; page++) {
      const response = (await ctx.client.call(account, `/${userId}/threads`, {
        params: {
          fields: POST_FIELDS,
          limit: cutoff ? 100 : pageSize,
          after: cursor,
          since: args.since,
          until: args.until,
        },
      })) as Record<string, unknown>;

      const items = dataOf(response);
      if (!items.length) break;

      for (const item of items) {
        if (cutoff) {
          const at = new Date(String(item.timestamp)).getTime();
          if (!Number.isNaN(at) && at < cutoff) {
            reachedCutoff = true;
            break;
          }
        }
        collected.push(item);
      }

      cursor = cursorOf(response);
      if (reachedCutoff || !cursor) break;
    }

    return renderList(collected, {
      source: "posts",
      cursor: reachedCutoff ? undefined : cursor,
      meta: {
        account: account.username,
        ...(args.since_hours ? { since_hours: args.since_hours } : {}),
      },
    });
  },
});

export const getPost = defineTool({
  name: "get_post",
  title: "Read one post",
  description:
    "One Threads post by its numeric id, with its full field set: text, media, permalink, topic tag, link attachment, quoted post and whether it has replies.",
  schema: {
    id: z.string().describe("Numeric post id."),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    const post = (await ctx.client.call(account, `/${id}`, {
      params: { fields: `${POST_FIELDS},allowlisted_country_codes` },
    })) as Record<string, unknown>;
    return renderPost(post, 0);
  },
});

export const READ_TOOLS = [getPosts, getPost];
