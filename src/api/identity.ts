/**
 * Post ids, container ids, and the two hostnames Threads answers on.
 *
 * A Threads post has a numeric media id, which is what every endpoint wants,
 * and a permalink containing a shortcode, which is what a person copies out of
 * the app. They are not the same string and there is no public endpoint that
 * converts a shortcode back into an id.
 *
 * So: anywhere a tool takes a post, it accepts a numeric id, or a permalink
 * whose numeric id we can read. A permalink that carries only a shortcode is
 * refused with an explanation rather than being silently sent to the API as a
 * malformed id, which fails several layers later with a message about nothing.
 */

/** Threads moved to threads.com; threads.net still resolves. Both are accepted. */
const PERMALINK = /^https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@([\w.]+)\/)?post\/([A-Za-z0-9_-]+)/i;

export type PostRef = {
  /** The numeric media id, when it could be determined. */
  id?: string;
  /** The permalink shortcode, when the input was a URL. */
  shortcode?: string;
  username?: string;
};

/** True for a bare numeric Threads media or container id. */
export function isMediaId(value: string): boolean {
  return /^\d{5,}$/.test(value.trim());
}

export function parsePostRef(raw: string): PostRef {
  const value = raw.trim();
  if (isMediaId(value)) return { id: value };

  const match = PERMALINK.exec(value);
  if (match) {
    return { shortcode: match[2], username: match[1]?.toLowerCase() };
  }

  return {};
}

/**
 * Resolve whatever the caller passed into the numeric id the API needs.
 *
 * Threads publishes no shortcode-to-id endpoint, so a permalink alone cannot be
 * resolved. Saying that plainly is better than sending the shortcode and
 * letting Meta return a generic "Unsupported get request".
 */
export function requireMediaId(raw: string): string {
  const ref = parsePostRef(raw);
  if (ref.id) return ref.id;
  if (ref.shortcode) {
    throw new Error(
      `"${raw}" is a Threads permalink. Threads has no public endpoint that converts a permalink shortcode back into the numeric post id the API needs. Use the numeric id, which get_posts returns for every post alongside its permalink.`,
    );
  }
  throw new Error(
    `"${raw}" is not a Threads post id. Pass the numeric id, which get_posts and get_replies return on every result.`,
  );
}

/** Best-effort permalink, for display when the API did not return one. */
export function webUrl(username: string | undefined, shortcode: string | undefined): string | undefined {
  if (!username || !shortcode) return undefined;
  return `https://www.threads.com/@${username}/post/${shortcode}`;
}
