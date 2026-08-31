/**
 * Measuring a Threads post, and escaping text for the output format.
 *
 * Threads caps a post at 500 characters, and Meta's own documentation adds that
 * emoji "count as UTF-8 bytes". Those are two different limits, and neither is
 * JavaScript's `String.length`:
 *
 *   "👨‍👩‍👧‍👦"   1 character to a reader, 11 UTF-16 code units to `.length`,
 *              25 bytes in UTF-8.
 *   "é"        1 character, but 1 or 2 code units depending on whether it
 *              arrived composed or decomposed, and 2 or 3 bytes.
 *
 * So a post of 480 emoji passes a naive `.length < 500` check and is refused by
 * Threads, and a post of 300 family emoji fails a naive byte check that Threads
 * would have accepted. Both limits are measured here, separately, and the error
 * says which one was crossed and by how much. That matters most for
 * `create_thread`, which checks every part before it posts any of them: a
 * thread that half-publishes and then fails on part four cannot be un-posted.
 *
 * Graphemes are counted with `Intl.Segmenter`, which is in every Node 20
 * runtime, so a flag or a family emoji counts as the one character a person
 * sees rather than the several code points it is made of.
 */

/** Threads' published limit for post and reply text. */
export const MAX_POST_CHARS = 500;

/**
 * The byte ceiling. Meta documents the character limit and notes that emoji are
 * counted as UTF-8 bytes, without publishing a separate byte number. 500 is
 * used for both, which is the conservative reading: a post inside both limits
 * is accepted under either interpretation.
 */
export const MAX_POST_BYTES = 500;

/** Threads' limit on a topic tag. */
export const MAX_TOPIC_TAG_CHARS = 50;

/** Threads accepts at most this many distinct URLs in one post's text. */
export const MAX_LINKS_PER_POST = 5;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Count what a reader would call characters, not UTF-16 code units. */
export function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** UTF-8 byte length, which is what Meta counts emoji against. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export type Measurement = {
  graphemes: number;
  bytes: number;
  /** True when the text is within both limits. */
  ok: boolean;
  /** Which limit was crossed, when one was. */
  over?: "characters" | "bytes";
};

export function measure(text: string): Measurement {
  const graphemes = graphemeLength(text);
  const bytes = byteLength(text);
  if (graphemes > MAX_POST_CHARS) return { graphemes, bytes, ok: false, over: "characters" };
  if (bytes > MAX_POST_BYTES) return { graphemes, bytes, ok: false, over: "bytes" };
  return { graphemes, bytes, ok: true };
}

/**
 * A one-line explanation of why a piece of text will not post.
 *
 * `label` names the part, so a thread failure says "part 4 of 6" rather than
 * making the reader work out which string was the problem.
 */
export function overLimitMessage(text: string, label = "This post"): string | undefined {
  const m = measure(text);
  if (m.ok) return undefined;
  if (m.over === "characters") {
    return `${label} is ${m.graphemes} characters. Threads allows ${MAX_POST_CHARS}. Trim ${m.graphemes - MAX_POST_CHARS}, or split it across a thread.`;
  }
  return `${label} is ${m.bytes} UTF-8 bytes (${m.graphemes} characters). Threads allows ${MAX_POST_BYTES} bytes, and counts emoji as bytes rather than characters, so an emoji-heavy post runs out of room before it looks full. Remove about ${m.bytes - MAX_POST_BYTES} bytes.`;
}

/** Count distinct URLs in post text, against Threads' five-link ceiling. */
export function countLinks(text: string): number {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return new Set(matches.map((u) => u.replace(/[.,;:!?)\]]+$/, ""))).size;
}

/** Escape for an XML attribute or text node in the output format. */
export function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Validate a topic tag.
 *
 * Threads allows one per post, 1 to 50 characters, and rejects periods and
 * ampersands. It is also written without a leading `#`, which is the mistake
 * everyone makes once, so a leading hash is stripped rather than refused.
 */
export function normalizeTopicTag(raw: string): string {
  const tag = raw.trim().replace(/^#/, "");
  if (!tag) throw new Error("A topic tag cannot be empty.");
  if (tag.length > MAX_TOPIC_TAG_CHARS) {
    throw new Error(`Topic tag is ${tag.length} characters. Threads allows ${MAX_TOPIC_TAG_CHARS}.`);
  }
  if (/[.&]/.test(tag)) {
    throw new Error(`Topic tag "${tag}" contains a period or an ampersand. Threads rejects both.`);
  }
  return tag;
}
