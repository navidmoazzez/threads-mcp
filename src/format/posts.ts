/**
 * Rendering posts for a model to read.
 *
 * The Threads Graph API answers with an object per post whose useful content is
 * a `text` field surrounded by ids, media URLs, permalinks, paging cursors and
 * a `quoted_post` that repeats the whole shape one level down. Handed straight
 * to a model, a 50-post listing is mostly punctuation, and the model spends its
 * attention finding the text rather than reading it.
 *
 * The tagged format below runs roughly a tenth the size and puts the text where
 * a model expects it. Rules that matter:
 *
 *   - **Timestamps are ISO-8601 UTC.** Threads returns an offset format
 *     (`2026-08-31T09:14:02+0000`) that `new Date()` parses but that two
 *     different posts can express differently. Normalized, so they compare.
 *   - **Every attribute is escaped.** A display name containing a quote must
 *     not be able to produce malformed output, or worse, close a tag.
 *   - **One renderer.** Posts, replies, quoted posts and search results all go
 *     through `renderPost`, so their handling cannot drift apart.
 *   - **Hidden and deleted replies render as themselves** rather than
 *     vanishing, so a gap in a conversation is visible instead of implied.
 *   - **`quoted_post` and `reposted_post` are nested, not flattened.** A repost
 *     with no text of its own is otherwise indistinguishable from an empty post.
 */

import { escapeXml } from "../content/text.js";

type Any = Record<string, any>;

/** ISO-8601 in UTC, or the raw value when it will not parse. */
function ts(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${escapeXml(value)}"`;
}

function pad(depth: number): string {
  return "  ".repeat(depth);
}

/** The type attribute: what kind of post this is, in one or more words. */
function kindOf(post: Any): string {
  const kinds: string[] = [];
  if (post.is_reply) kinds.push("reply");
  if (post.is_quote_post || post.quoted_post) kinds.push("quote");
  if (post.reposted_post) kinds.push("repost");
  if (!kinds.length) kinds.push("standalone");
  return kinds.join(" ");
}

function renderMedia(post: Any, depth: number): string {
  const type = String(post.media_type ?? "").toUpperCase();
  if (!type || type === "TEXT" || type === "TEXT_POST") return "";

  const url = post.media_url ?? post.thumbnail_url;
  if (type === "CAROUSEL_ALBUM" || type === "CAROUSEL") {
    const children = Array.isArray(post.children?.data) ? post.children.data : [];
    if (!children.length) return `${pad(depth)}<media type="carousel" />\n`;
    const inner = children
      .map(
        (child: Any) =>
          `${pad(depth + 1)}<item${attr("type", String(child.media_type ?? "").toLowerCase())}${attr("url", child.media_url)}${attr("alt", child.alt_text)} />\n`,
      )
      .join("");
    return `${pad(depth)}<media type="carousel" count="${children.length}">\n${inner}${pad(depth)}</media>\n`;
  }

  return `${pad(depth)}<media${attr("type", type.toLowerCase())}${attr("url", url)}${attr("alt", post.alt_text)} />\n`;
}

/** Engagement, when insights were joined onto the post. */
function renderEngagement(post: Any, depth: number): string {
  const metrics = post.__insights as Record<string, number> | undefined;
  if (!metrics) return "";
  const parts = Object.entries(metrics)
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => `${value} ${name}`);
  if (!parts.length) return "";
  return `${pad(depth)}<engagement>${escapeXml(parts.join(", "))}</engagement>\n`;
}

export function renderPost(post: Any, depth = 1, tag = "post"): string {
  const open =
    `${pad(depth)}<${tag}` +
    attr("id", post.id) +
    attr("type", kindOf(post)) +
    attr("url", post.permalink) +
    attr("author", post.username) +
    attr("posted_at", ts(post.timestamp)) +
    attr("replied_to", post.replied_to?.id) +
    attr("root_post", post.root_post?.id) +
    attr("has_replies", post.has_replies === true ? "true" : undefined) +
    attr("hidden", post.hide_status && post.hide_status !== "NOT_HUSHED" ? post.hide_status : undefined) +
    attr("reply_audience", post.reply_audience) +
    attr("topic_tag", post.topic_tag) +
    attr("link", post.link_attachment_url) +
    attr("countries", Array.isArray(post.allowlisted_country_codes) ? post.allowlisted_country_codes.join(",") : undefined) +
    ">\n";

  let body = "";

  // Text is reproduced exactly, including its own line breaks. Indenting inside
  // <content> would change the post.
  if (typeof post.text === "string" && post.text.length) {
    body += `${pad(depth + 1)}<content>\n${escapeXml(post.text)}\n${pad(depth + 1)}</content>\n`;
  }

  body += renderMedia(post, depth + 1);
  body += renderEngagement(post, depth + 1);

  if (post.quoted_post) body += renderPost(post.quoted_post, depth + 1, "quoted_post");
  if (post.reposted_post) body += renderPost(post.reposted_post, depth + 1, "reposted_post");

  return `${open}${body}${pad(depth)}</${tag}>\n`;
}

export type ListOptions = {
  /** What produced this list: "posts", "replies", "search", "conversation". */
  source: string;
  cursor?: string;
  /** Extra attributes on the root element, e.g. the account or query. */
  meta?: Record<string, unknown>;
};

export function renderList(posts: Any[], options: ListOptions, tag = "post"): string {
  const metaAttrs = Object.entries(options.meta ?? {})
    .map(([name, value]) => attr(name, value))
    .join("");

  const open =
    `<${options.source} count="${posts.length}"` + metaAttrs + attr("cursor", options.cursor) + ">\n";
  const body = posts.map((post) => renderPost(post, 1, tag)).join("");
  return `${open}${body}</${options.source}>\n`;
}

/** A profile, for whoami and lookup_profile. */
export function renderProfile(profile: Any, extra: Record<string, unknown> = {}): string {
  const open =
    `<profile` +
    attr("id", profile.id) +
    attr("username", profile.username) +
    attr("name", profile.name) +
    attr("verified", profile.is_verified === true ? "true" : undefined) +
    attr("followers", profile.followers_count ?? extra.followers) +
    attr("geo_gating_eligible", profile.is_eligible_for_geo_gating === true ? "true" : undefined) +
    ">\n";

  let body = "";
  if (profile.threads_biography) {
    body += `  <bio>\n${escapeXml(profile.threads_biography)}\n  </bio>\n`;
  }
  if (profile.threads_profile_picture_url) {
    body += `  <avatar${attr("url", profile.threads_profile_picture_url)} />\n`;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (name === "followers" || value === undefined) continue;
    body += `  <stat${attr("name", name)}${attr("value", value)} />\n`;
  }
  return `${open}${body}</profile>\n`;
}

/** Pull the paging cursor out of a Graph API listing. */
export function cursorOf(response: Any): string | undefined {
  const after = response?.paging?.cursors?.after;
  return typeof after === "string" && after ? after : undefined;
}

/** The `data` array of a Graph API listing, whatever shape it arrived in. */
export function dataOf(response: Any): Any[] {
  return Array.isArray(response?.data) ? response.data : [];
}
