/**
 * Publishing.
 *
 * `create_post` is the one-call path and what most work should use. The staged
 * pair underneath it — `stage_post` and `publish_staged` — exposes the
 * unpublished container directly, because it is the only draft state Threads
 * has: invisible, valid for 24 hours, publishable later by id. That is exactly
 * what an agent needs when a human wants to see something before it is public.
 */

import { z } from "zod";
import { accountArg, confirmArg, defineTool, snippet } from "./kit.js";
import {
  createContainer,
  publish,
  publishCarousel,
  publishChain,
  publishContainer,
  validate,
  type ReplyControl,
} from "../content/containers.js";
import { assertCarouselSize } from "../content/media.js";
import { deleteSucceeded } from "../api/client.js";
import { requireMediaId } from "../api/identity.js";
import { measure } from "../content/text.js";

const replyControl = z
  .enum(["everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only"])
  .optional()
  .describe("Who may reply. Defaults to everyone.");

const mediaArgs = {
  image_url: z
    .string()
    .optional()
    .describe("Public HTTPS URL of a JPEG or PNG, 8MB or less. Threads fetches it itself; there is no upload endpoint."),
  video_url: z
    .string()
    .optional()
    .describe("Public HTTPS URL of an MP4 or MOV, up to 1GB and 5 minutes."),
  alt_text: z.string().optional().describe("Alt text for the attached image or video."),
};

const composeArgs = {
  text: z.string().optional().describe("Post body. 500 characters, and emoji count as UTF-8 bytes."),
  ...mediaArgs,
  link_attachment: z
    .string()
    .optional()
    .describe("A URL to render as a preview card. Text-only posts only; it cannot be combined with media."),
  topic_tag: z
    .string()
    .optional()
    .describe("One topic tag, without the #. 1-50 characters, no periods or ampersands."),
  reply_to_id: z.string().optional().describe("Numeric id of the post this replies to."),
  quote_post_id: z.string().optional().describe("Numeric id of a post to quote."),
  reply_control: replyControl,
  allowlisted_country_codes: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict who can see this post to these ISO 3166-1 alpha-2 country codes. Needs a profile Meta has made eligible; whoami reports whether this one is.",
    ),
  enable_reply_approvals: z
    .boolean()
    .optional()
    .describe("Hold replies for approval before they appear. Read the queue with get_pending_replies."),
};

export const createPost = defineTool({
  name: "create_post",
  title: "Publish a post",
  description:
    "Publish one post to Threads: creates the media container, waits for it to finish processing, then publishes. Public the moment it runs, and Threads has no edit endpoint, so this needs confirm: true. For anything over 500 characters use create_thread instead.",
  schema: { ...composeArgs, ...accountArg, ...confirmArg },
  risk: "destructive",
  summary: (args) => `post to Threads: "${snippet(args.text)}"`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const post = await publish(ctx.client, account, {
      text: args.text,
      image_url: args.image_url,
      video_url: args.video_url,
      alt_text: args.alt_text,
      link_attachment: args.link_attachment,
      topic_tag: args.topic_tag,
      reply_to_id: args.reply_to_id ? requireMediaId(args.reply_to_id) : undefined,
      quote_post_id: args.quote_post_id ? requireMediaId(args.quote_post_id) : undefined,
      reply_control: args.reply_control as ReplyControl | undefined,
      allowlisted_country_codes: args.allowlisted_country_codes,
      enable_reply_approvals: args.enable_reply_approvals,
    });
    return post;
  },
});

export const createThread = defineTool({
  name: "create_thread",
  title: "Publish a chain of posts",
  description:
    "Publish several posts as a thread, each replying to the one before. Threads has no thread endpoint: a thread is a chain of ordinary posts, so it can half-publish. Every part is length-checked before the first one goes out, and if a later part still fails the error names exactly how far it got. Public and irreversible, so this needs confirm: true.",
  schema: {
    posts: z
      .array(z.string())
      .min(1)
      .max(25)
      .describe("The parts, in order. Each is capped at 500 characters and validated before anything is published."),
    ...mediaArgs,
    link_attachment: composeArgs.link_attachment,
    topic_tag: composeArgs.topic_tag,
    reply_to_id: z
      .string()
      .optional()
      .describe("Start the thread as a reply to this post, rather than as a new one."),
    reply_control: replyControl,
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `post a ${args.posts.length}-part Threads thread starting "${snippet(args.posts[0])}"`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);

    // Media, the link card, the tag and the reply control apply to the first
    // post only. Repeating them down the chain would attach the same image to
    // every part, which is never what anyone means.
    const parts = args.posts.map((text, index) =>
      index === 0
        ? {
            text,
            image_url: args.image_url,
            video_url: args.video_url,
            alt_text: args.alt_text,
            link_attachment: args.link_attachment,
            topic_tag: args.topic_tag,
            reply_control: args.reply_control as ReplyControl | undefined,
          }
        : { text },
    );

    const { posts, warnings } = await publishChain(
      ctx.client,
      account,
      parts,
      args.reply_to_id ? requireMediaId(args.reply_to_id) : undefined,
    );

    return {
      parts: posts.length,
      root: posts[0]?.permalink ?? posts[0]?.id,
      posts: posts.map((p, i) => ({ part: i + 1, id: p.id, permalink: p.permalink })),
      ...(warnings.length ? { warnings } : {}),
    };
  },
});

export const createCarousel = defineTool({
  name: "create_carousel",
  title: "Publish a carousel",
  description:
    "Publish 2 to 20 images or videos as one carousel post. Each item is staged separately and they transcode in parallel, then a parent container binds them together. Counts as a single post against the daily quota. Public and irreversible, so this needs confirm: true.",
  schema: {
    items: z
      .array(
        z.object({
          image_url: z.string().optional(),
          video_url: z.string().optional(),
          alt_text: z.string().optional(),
        }),
      )
      .min(2)
      .max(20)
      .describe("2 to 20 items, each with an image_url or a video_url."),
    text: z.string().optional().describe("Caption for the carousel. 500 characters."),
    topic_tag: composeArgs.topic_tag,
    reply_control: replyControl,
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `post a ${args.items.length}-item Threads carousel: "${snippet(args.text)}"`,
  handler: async (args, ctx) => {
    assertCarouselSize(args.items.length);
    const account = ctx.account(args.account);
    return publishCarousel(ctx.client, account, args.items, {
      text: args.text,
      topic_tag: args.topic_tag,
      reply_control: args.reply_control as ReplyControl | undefined,
    });
  },
});

export const stagePost = defineTool({
  name: "stage_post",
  title: "Stage a post without publishing it",
  description:
    "Build a media container without publishing. Nothing appears anywhere: the container is invisible, holds for 24 hours, and is published later with publish_staged. This is the only draft state Threads has, and the right way to show a human a post before it goes public. Nothing is public, so no confirmation is needed.",
  schema: { ...composeArgs, ...accountArg },
  risk: "write",
  summary: (args) => `stage a Threads post: "${snippet(args.text)}"`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const options = {
      text: args.text,
      image_url: args.image_url,
      video_url: args.video_url,
      alt_text: args.alt_text,
      link_attachment: args.link_attachment,
      topic_tag: args.topic_tag,
      reply_to_id: args.reply_to_id ? requireMediaId(args.reply_to_id) : undefined,
      quote_post_id: args.quote_post_id ? requireMediaId(args.quote_post_id) : undefined,
      reply_control: args.reply_control as ReplyControl | undefined,
      allowlisted_country_codes: args.allowlisted_country_codes,
      enable_reply_approvals: args.enable_reply_approvals,
    };
    const warnings = validate(options);
    const containerId = await createContainer(ctx.client, account, options);

    return {
      container_id: containerId,
      published: false,
      expires_in_hours: 24,
      characters: args.text ? measure(args.text).graphemes : 0,
      next: `Call publish_staged with container_id ${containerId} to make it live.`,
      ...(warnings.length ? { warnings } : {}),
    };
  },
});

export const publishStaged = defineTool({
  name: "publish_staged",
  title: "Publish a staged container",
  description:
    "Publish a container created by stage_post, waiting for processing first. This is what makes it public, so it needs confirm: true.",
  schema: {
    container_id: z.string().describe("The container id returned by stage_post."),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `publish staged Threads container ${args.container_id}`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    return publishContainer(ctx.client, account, args.container_id);
  },
});

export const getContainerStatus = defineTool({
  name: "get_container_status",
  title: "Check a staged container",
  description:
    "The processing status of a container: IN_PROGRESS, FINISHED, ERROR or EXPIRED, with the failure reason when there is one. Useful when a video is taking a long time, or to check whether a staged post is still within its 24-hour window.",
  schema: {
    container_id: z.string(),
    ...accountArg,
  },
  risk: "read",
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const status = (await ctx.client.call(account, `/${args.container_id}`, {
      params: { fields: "status,error_message" },
    })) as { status?: string; error_message?: string };

    return {
      container_id: args.container_id,
      status: status.status ?? "UNKNOWN",
      ...(status.error_message ? { error_message: status.error_message } : {}),
      ...(status.status === "ERROR"
        ? {
            hint: "Container errors are nearly always the media URL. It has to be publicly reachable over HTTPS, return an image or video content type, and not redirect to a login page.",
          }
        : {}),
    };
  },
});

export const quotePost = defineTool({
  name: "quote_post",
  title: "Quote another post",
  description:
    "Publish a post that quotes an existing Threads post. Public and irreversible, so this needs confirm: true.",
  schema: {
    text: z.string().describe("Your commentary. 500 characters."),
    quoted_post_id: z.string().describe("Numeric id of the post being quoted."),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `quote Threads post ${args.quoted_post_id}: "${snippet(args.text)}"`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    return publish(ctx.client, account, {
      text: args.text,
      quote_post_id: requireMediaId(args.quoted_post_id),
    });
  },
});

export const repost = defineTool({
  name: "repost",
  title: "Repost a post",
  description:
    "Repost an existing Threads post to your own profile. This is visible to your followers immediately and the API has no un-repost call, so it needs confirm: true.",
  schema: {
    id: z.string().describe("Numeric id of the post to repost."),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `repost Threads post ${args.id}`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    const response = (await ctx.client.call(account, `/${id}/repost`, { method: "POST" })) as {
      id?: string;
    };
    return {
      repost_id: response.id ?? null,
      original: id,
      note: "Threads has no un-repost endpoint. Undo this in the app.",
    };
  },
});

export const deletePost = defineTool({
  name: "delete_post",
  title: "Delete one of your posts",
  description:
    "Permanently delete one of your own Threads posts. There is no undo, no archive, and no edit endpoint to reach for instead: replies and likes go with it. Deletions are also capped at 100 per rolling 24 hours. Needs confirm: true.",
  schema: {
    id: z.string().describe("Numeric id of the post to delete."),
    ...accountArg,
    ...confirmArg,
  },
  risk: "destructive",
  summary: (args) => `permanently delete Threads post ${args.id}`,
  handler: async (args, ctx) => {
    const account = ctx.account(args.account);
    const id = requireMediaId(args.id);
    // Meta's delete is an HTTP DELETE. Sending POST here returns a success-
    // shaped response for a request that deleted nothing.
    const response = await ctx.client.call(account, `/${id}`, { method: "DELETE" });
    return {
      deleted: deleteSucceeded(response) ? id : null,
      ...(deleteSucceeded(response) ? {} : { warning: "Threads did not confirm the deletion.", response }),
    };
  },
});

export const POST_TOOLS = [
  createPost,
  createThread,
  createCarousel,
  stagePost,
  publishStaged,
  getContainerStatus,
  quotePost,
  repost,
  deletePost,
];
