/**
 * Replies, conversations, and moderation of both.
 *
 * Threads exposes three different reply views and they are not
 * interchangeable, which is the single most common source of confusion here:
 *
 *   /{post-id}/replies       direct replies to one post, one level deep
 *   /{post-id}/conversation  the whole tree under one post, flattened
 *   /{user-id}/replies       every reply you have received, across all posts
 *
 * The third is the one an agent actually wants when asked "what needs
 * answering", and it is the one nothing surfaces by default.
 */

import { z } from "zod";
import { accountArg, clamp, confirmArg, defineTool, pageArgs, snippet } from "./kit.js";
import { REPLY_FIELDS } from "../api/client.js";
import { cursorOf, dataOf, renderList } from "../format/posts.js";
import { requireMediaId } from "../api/identity.js";
import { publish } from "../content/containers.js";

export const replyToPost = defineTool({
  name: "reply_to",
  title: "Reply to a post",
  description:
    "Publish a reply to a Threads post, yours or anyone's. Public the moment it runs and counted against the 1,000-reply daily quota, so it needs confirm: true.",
  schema: {
    id: z.string().describe("Numeric id of the post being replied to."),
    text: z.string().describe("The reply. 500 characters."),
    image_url: z.string().optional().describe("Optional public HTTPS image URL."),
    video_url: z.string().optional().describe("Optional public HTTPS video URL."),
    alt_text: z.string().optional(),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `reply to Threads post ${args.id}: "${snippet(args.text)}"`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    return publish(ctx.client, account, {
      text: args.text,
      image_url: args.image_url,
      video_url: args.video_url,
      alt_text: args.alt_text,
      reply_to_id: requireMediaId(args.id),
    });
  },
});

export const getReplies = defineTool({
  name: "get_replies",
  title: "Read direct replies to a post",
  description:
    "The direct replies to one post, one level deep. For the whole tree underneath it, including replies to replies, use get_conversation.",
  schema: {
    id: z.string().describe("Numeric id of the post."),
    reverse: z.boolean().optional().describe("Oldest first. Defaults to newest first."),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    const response = (await ctx.client.call(account, `/${id}/replies`, {
      params: {
        fields: REPLY_FIELDS,
        limit: clamp(args.limit, 25),
        after: args.cursor,
        reverse: args.reverse === true ? "true" : undefined,
      },
    })) as Record<string, unknown>;

    return renderList(dataOf(response), {
      source: "replies",
      cursor: cursorOf(response),
      meta: { post_id: id },
    }, "reply");
  },
});

export const getConversation = defineTool({
  name: "get_conversation",
  title: "Read a whole conversation",
  description:
    "Every reply under one of your posts, including replies to replies, flattened into one list with each reply naming its parent. Only works on posts you own. This is what to read before deciding what deserves an answer.",
  schema: {
    id: z.string().describe("Numeric id of one of your posts."),
    reverse: z.boolean().optional(),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    const response = (await ctx.client.call(account, `/${id}/conversation`, {
      params: {
        fields: REPLY_FIELDS,
        limit: clamp(args.limit, 50),
        after: args.cursor,
        reverse: args.reverse === true ? "true" : undefined,
      },
    })) as Record<string, unknown>;

    return renderList(dataOf(response), {
      source: "conversation",
      cursor: cursorOf(response),
      meta: { root_post_id: id },
    }, "reply");
  },
});

export const getAllReplies = defineTool({
  name: "get_all_replies",
  title: "Read every reply across all your posts",
  description:
    "Every reply you have received, newest first, across every post. This is the inbox view: use it to find what needs answering without walking each post one at a time.",
  schema: {
    since_hours: z
      .number()
      .optional()
      .describe("Only replies from the last N hours. Filtered after fetching, so pair it with a larger limit."),
    ...pageArgs,
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const response = (await ctx.client.call(account, `/${userId}/replies`, {
      params: { fields: REPLY_FIELDS, limit: clamp(args.limit, 25), after: args.cursor },
    })) as Record<string, unknown>;

    let replies = dataOf(response);
    if (args.since_hours) {
      const cutoff = Date.now() - args.since_hours * 3_600_000;
      replies = replies.filter((r) => {
        const at = new Date(String(r.timestamp)).getTime();
        return Number.isNaN(at) || at >= cutoff;
      });
    }

    return renderList(replies, {
      source: "replies",
      cursor: cursorOf(response),
      meta: { scope: "all_posts", ...(args.since_hours ? { since_hours: args.since_hours } : {}) },
    }, "reply");
  },
});

export const hideReply = defineTool({
  name: "hide_reply",
  title: "Hide or unhide a reply",
  description:
    "Hide a reply on one of your posts, or unhide one you hid. Hiding a top-level reply cascades to everything nested under it. Reversible in one call, so this does not need a confirmation.",
  schema: {
    reply_id: z.string().describe("Numeric id of the reply."),
    hide: z.boolean().optional().describe("True to hide, false to unhide. Defaults to true."),
    ...accountArg,
  },
  risk: "write",
  idempotent: true,
  summary: (args) => `${args.hide === false ? "unhide" : "hide"} Threads reply ${args.reply_id}`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.reply_id);
    const hide = args.hide !== false;
    await ctx.client.call(account, `/${id}/manage_reply`, {
      method: "POST",
      params: { hide: hide ? "true" : "false" },
    });
    return {
      reply_id: id,
      hidden: hide,
      note: hide ? "Nested replies under this one are hidden too." : undefined,
    };
  },
});

export const getPendingReplies = defineTool({
  name: "get_pending_replies",
  title: "Read the reply approval queue",
  description:
    "Replies waiting for approval on posts published with enable_reply_approvals. They are invisible to everyone until approved. Empty unless reply approvals were switched on for the post.",
  schema: { ...pageArgs, ...accountArg },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const userId = await ctx.client.userId(account);
    const response = (await ctx.client.call(account, `/${userId}/pending_replies`, {
      params: {
        fields: `${REPLY_FIELDS},reply_approval_status`,
        limit: clamp(args.limit, 25),
        after: args.cursor,
      },
    })) as Record<string, unknown>;

    return renderList(dataOf(response), {
      source: "pending_replies",
      cursor: cursorOf(response),
    }, "reply");
  },
});

export const managePendingReply = defineTool({
  name: "manage_pending_reply",
  title: "Approve or ignore a pending reply",
  description:
    "Approve a reply waiting in the approval queue, making it public, or ignore it so it stays hidden. Approving is public, so it needs confirm: true.",
  schema: {
    reply_id: z.string().describe("Numeric id of the pending reply."),
    action: z.enum(["approve", "ignore"]).describe("approve makes it public; ignore leaves it hidden."),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `${args.action} pending Threads reply ${args.reply_id}`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.reply_id);
    await ctx.client.call(account, `/${id}/manage_pending_reply`, {
      method: "POST",
      params: { approve: args.action === "approve" ? "true" : "false" },
    });
    return { reply_id: id, action: args.action, public: args.action === "approve" };
  },
});

export const REPLY_TOOLS = [
  replyToPost,
  getReplies,
  getConversation,
  getAllReplies,
  hideReply,
  getPendingReplies,
  managePendingReply,
];
