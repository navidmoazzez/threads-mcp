/**
 * Publishing: the two-step container dance, in one place.
 *
 * Every write to Threads is the same shape.
 *
 *   1. POST /{user-id}/threads          build a container. Nothing is public.
 *   2. wait                             the container transcodes.
 *   3. POST /{user-id}/threads_publish  the post appears.
 *
 * Step 2 is the one everybody skips. A text container is usually ready by the
 * time the next request lands, so code that omits the wait works during
 * development and then fails the first time someone attaches a video. Meta's
 * own guidance is to wait about 30 seconds; polling the container's status is
 * better than sleeping, because it is both faster for text and correct for a
 * five-minute video.
 *
 * The unpublished container is also the only draft state Threads has. It is
 * invisible, it holds for 24 hours, and it can be published later by id. That
 * is worth exposing as its own tool rather than hiding inside a helper, so an
 * agent can stage a post for a human to look at before anything is public.
 *
 * A note on ordering in `publishChain`: every part is validated before the
 * first one is posted. A thread is a chain of ordinary posts, each replying to
 * the one before, so there is no transaction and no rollback. Discovering on
 * part four that part five is 40 characters too long leaves four public posts
 * and no way to finish, and deleting them costs four of the day's hundred
 * deletions. Checking first costs nothing.
 */

import type { ThreadsClient } from "../api/client.js";
import { POST_FIELDS } from "../api/client.js";
import type { Account } from "../config.js";
import { checkMedia, mediaTypeFor, type MediaItem } from "./media.js";
import { countLinks, MAX_LINKS_PER_POST, normalizeTopicTag, overLimitMessage } from "./text.js";
import { TextTooLongError } from "../api/errors.js";

export type ReplyControl =
  | "everyone"
  | "accounts_you_follow"
  | "mentioned_only"
  | "parent_post_author_only"
  | "followers_only";

export type ContainerOptions = MediaItem & {
  text?: string;
  reply_to_id?: string;
  quote_post_id?: string;
  reply_control?: ReplyControl;
  link_attachment?: string;
  topic_tag?: string;
  allowlisted_country_codes?: string[];
  enable_reply_approvals?: boolean;
  auto_publish_text?: boolean;
  is_carousel_item?: boolean;
  children?: string[];
  media_type?: "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";
};

export type PublishedPost = {
  id: string;
  permalink?: string;
  timestamp?: string;
  text?: string;
  warnings?: string[];
};

/**
 * Everything checkable without a network call.
 *
 * Returns warnings, throws on anything that would certainly be refused. The
 * split matters: a `.webp` URL is a warning because it might be served as JPEG,
 * while a 600-character post is an error because Threads will never take it.
 */
export function validate(options: ContainerOptions, label = "This post"): string[] {
  const warnings: string[] = [];

  if (options.text !== undefined) {
    const problem = overLimitMessage(options.text, label);
    if (problem) throw new TextTooLongError(problem);

    const links = countLinks(options.text);
    if (links > MAX_LINKS_PER_POST) {
      warnings.push(
        `${label} contains ${links} distinct URLs. Threads accepts at most ${MAX_LINKS_PER_POST} and may refuse the post.`,
      );
    }
  }

  warnings.push(...checkMedia(options));

  if (options.link_attachment) {
    if (options.image_url || options.video_url) {
      throw new Error(
        "A link attachment renders as a preview card and Threads only allows it on a text-only post. Drop the media, or put the URL in the text instead.",
      );
    }
    try {
      const url = new URL(options.link_attachment);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("not http");
      }
    } catch {
      throw new Error(`link_attachment "${options.link_attachment}" is not a valid URL.`);
    }
  }

  if (options.topic_tag) normalizeTopicTag(options.topic_tag);

  if (options.allowlisted_country_codes?.length) {
    const bad = options.allowlisted_country_codes.filter((c) => !/^[A-Za-z]{2}$/.test(c.trim()));
    if (bad.length) {
      throw new Error(
        `Geo-gating takes ISO 3166-1 alpha-2 country codes, two letters each. These are not: ${bad.join(", ")}`,
      );
    }
  }

  if (options.reply_to_id && options.quote_post_id) {
    throw new Error("A post is either a reply or a quote, not both.");
  }

  return warnings;
}

/** Build the parameter map Meta expects, dropping anything unset. */
export function containerParams(options: ContainerOptions): Record<string, unknown> {
  const mediaType = options.media_type ?? mediaTypeFor(options);
  return {
    media_type: mediaType,
    text: options.text,
    image_url: options.image_url,
    video_url: options.video_url,
    alt_text: options.alt_text,
    reply_to_id: options.reply_to_id,
    quote_post_id: options.quote_post_id,
    reply_control: options.reply_control,
    link_attachment: options.link_attachment,
    topic_tag: options.topic_tag ? normalizeTopicTag(options.topic_tag) : undefined,
    allowlisted_country_codes: options.allowlisted_country_codes?.length
      ? options.allowlisted_country_codes.map((c) => c.trim().toUpperCase())
      : undefined,
    enable_reply_approvals: options.enable_reply_approvals ? "true" : undefined,
    auto_publish_text: options.auto_publish_text ? "true" : undefined,
    is_carousel_item: options.is_carousel_item ? "true" : undefined,
    children: options.children?.length ? options.children.join(",") : undefined,
  };
}

/** Step one. Builds a container and returns its id. Nothing is public yet. */
export async function createContainer(
  client: ThreadsClient,
  account: Account,
  options: ContainerOptions,
): Promise<string> {
  const userId = await client.userId(account);
  const created = (await client.call(account, `/${userId}/threads`, {
    method: "POST",
    params: containerParams(options),
  })) as { id?: string };

  if (!created.id) {
    throw new Error("Threads accepted the container request but returned no container id.");
  }
  return String(created.id);
}

/** Step three. Publishes a container that has finished processing. */
export async function publishContainer(
  client: ThreadsClient,
  account: Account,
  containerId: string,
): Promise<PublishedPost> {
  const userId = await client.userId(account);
  await client.awaitContainer(account, containerId);

  const published = (await client.call(account, `/${userId}/threads_publish`, {
    method: "POST",
    params: { creation_id: containerId },
  })) as { id?: string };

  if (!published.id) {
    throw new Error(`Threads published container ${containerId} but returned no post id.`);
  }

  const detail = (await client.call(account, `/${published.id}`, {
    params: { fields: "id,permalink,timestamp,text" },
  })) as Record<string, unknown>;

  return {
    id: String(published.id),
    permalink: detail.permalink as string | undefined,
    timestamp: detail.timestamp as string | undefined,
    text: detail.text as string | undefined,
  };
}

/** Create, wait, publish. The single-call path most tools want. */
export async function publish(
  client: ThreadsClient,
  account: Account,
  options: ContainerOptions,
): Promise<PublishedPost> {
  const warnings = validate(options);
  const containerId = await createContainer(client, account, options);
  const post = await publishContainer(client, account, containerId);
  return warnings.length ? { ...post, warnings } : post;
}

/**
 * Publish several posts as a chain, each replying to the one before.
 *
 * Threads has no thread endpoint. A "thread" is exactly this: ordinary posts
 * linked by `reply_to_id`. Which means it can half-publish, so every part is
 * validated first and the failure report names what did go out.
 */
export async function publishChain(
  client: ThreadsClient,
  account: Account,
  parts: ContainerOptions[],
  rootReplyTo?: string,
): Promise<{ posts: PublishedPost[]; warnings: string[] }> {
  if (parts.length === 0) throw new Error("A thread needs at least one post.");

  // Everything, before anything.
  const warnings: string[] = [];
  parts.forEach((part, index) => {
    warnings.push(...validate(part, `Part ${index + 1} of ${parts.length}`));
  });

  const posts: PublishedPost[] = [];
  let replyTo = rootReplyTo;

  for (const [index, part] of parts.entries()) {
    try {
      const containerId = await createContainer(client, account, { ...part, reply_to_id: replyTo });
      const post = await publishContainer(client, account, containerId);
      posts.push(post);
      replyTo = post.id;
    } catch (error) {
      // Say exactly how far it got. A partially published thread is recoverable
      // by hand; one that reports only "failed" is not.
      const done = posts.length;
      const summary = done
        ? `Parts 1-${done} of ${parts.length} are published (last id ${posts[done - 1]!.id}). Part ${index + 1} failed.`
        : `Nothing was published. Part ${index + 1} failed.`;
      throw new Error(`${summary} ${(error as Error).message}`);
    }
  }

  return { posts, warnings };
}

/**
 * Stage a carousel: every child first, then the parent binding them together.
 *
 * Children are created in order and then waited on together rather than one at
 * a time, so twenty images transcode in parallel instead of in series.
 */
export async function publishCarousel(
  client: ThreadsClient,
  account: Account,
  items: MediaItem[],
  options: Omit<ContainerOptions, "children" | "media_type"> = {},
): Promise<PublishedPost> {
  const warnings = validate({ ...options, image_url: undefined, video_url: undefined });
  for (const [index, item] of items.entries()) {
    warnings.push(...checkMedia(item).map((w) => `Item ${index + 1}: ${w}`));
  }

  const children: string[] = [];
  for (const item of items) {
    children.push(
      await createContainer(client, account, {
        ...item,
        media_type: mediaTypeFor(item) === "VIDEO" ? "VIDEO" : "IMAGE",
        is_carousel_item: true,
      }),
    );
  }

  await Promise.all(children.map((id) => client.awaitContainer(account, id)));

  const parentId = await createContainer(client, account, {
    ...options,
    media_type: "CAROUSEL",
    children,
  });

  const post = await publishContainer(client, account, parentId);
  return warnings.length ? { ...post, warnings, ...{} } : post;
}

/** Read a post back in full, for the tools that return one. */
export async function readPost(
  client: ThreadsClient,
  account: Account,
  id: string,
): Promise<Record<string, unknown>> {
  return (await client.call(account, `/${id}`, { params: { fields: POST_FIELDS } })) as Record<string, unknown>;
}
