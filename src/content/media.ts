/**
 * Media rules, checked before a container is created.
 *
 * Threads does not upload bytes. You hand it a public URL and it fetches the
 * file itself, asynchronously, and reports the result minutes later as a
 * container in state ERROR with a message like "Media download failed". By
 * then the useful context is gone.
 *
 * So the checks that can be made locally are made locally, in the one place the
 * numbers are written down. Everything here comes from Meta's published specs.
 */

export const IMAGE_SPEC = {
  formats: ["jpeg", "jpg", "png"],
  maxBytes: 8 * 1024 * 1024,
  minWidth: 320,
  maxWidth: 1440,
  /** Widest and tallest Threads will accept, as width:height. */
  maxAspect: 10,
} as const;

export const VIDEO_SPEC = {
  formats: ["mp4", "mov"],
  maxBytes: 1024 * 1024 * 1024,
  maxSeconds: 300,
  codecs: ["h264", "hevc"],
  recommendedAspect: "9:16",
} as const;

export const CAROUSEL = { min: 2, max: 20 } as const;

/**
 * Reject a media URL that cannot possibly work, before spending a container on
 * it.
 *
 * Deliberately narrow. It refuses what is certainly wrong (not a URL, not
 * HTTPS, a local path, a `data:` URI) and lets everything else through, because
 * a URL with no file extension is completely normal for a CDN and refusing it
 * would break more than it fixed.
 */
export function assertMediaUrl(url: string, kind: "image" | "video"): void {
  const value = url.trim();

  if (!value) throw new Error(`A ${kind} URL is required.`);

  if (value.startsWith("data:")) {
    throw new Error(
      `Threads cannot take a data: URI. It fetches media from a public URL itself, so the ${kind} has to be hosted somewhere it can reach.`,
    );
  }

  if (/^(file:|\/|\.\/|~\/|[A-Za-z]:\\)/.test(value)) {
    throw new Error(
      `"${value}" is a local path. Threads has no upload endpoint: it fetches media from a public URL, so upload the ${kind} somewhere reachable first and pass that URL.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`"${value}" is not a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    if (parsed.protocol === "http:") {
      throw new Error(`Threads requires HTTPS for media URLs. "${value}" is plain HTTP.`);
    }
    throw new Error(`Media URLs must be HTTPS. "${value}" uses ${parsed.protocol}`);
  }

  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(parsed.hostname)) {
    throw new Error(
      `"${parsed.hostname}" is not reachable from Meta's servers. Threads fetches the ${kind} itself, so a URL that only works on your machine will fail as a container error several minutes later.`,
    );
  }
}

/** The extension, lowercased, when the URL has one. */
export function extensionOf(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const match = /\.([A-Za-z0-9]+)$/.exec(path);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Warn about an extension Threads does not support.
 *
 * A warning rather than an error: the extension in a URL is a hint, not a
 * content type, and plenty of perfectly good CDN URLs end in `.webp?format=jpg`
 * or nothing at all. Being told up front that a `.webp` is likely to fail is
 * worth more than being stopped by it.
 */
export function formatWarning(url: string, kind: "image" | "video"): string | undefined {
  const ext = extensionOf(url);
  if (!ext) return undefined;
  const allowed: readonly string[] = kind === "image" ? IMAGE_SPEC.formats : VIDEO_SPEC.formats;
  if (allowed.includes(ext)) return undefined;
  return `The URL ends in .${ext}. Threads accepts ${allowed.join(", ")} for ${kind}s; anything else usually comes back as a container error a few minutes after posting.`;
}

export type MediaItem = { image_url?: string; video_url?: string; alt_text?: string };

/** Which container type a set of arguments implies. */
export function mediaTypeFor(item: MediaItem): "TEXT" | "IMAGE" | "VIDEO" {
  if (item.video_url) return "VIDEO";
  if (item.image_url) return "IMAGE";
  return "TEXT";
}

/** Validate one carousel item or post attachment. Returns any warnings. */
export function checkMedia(item: MediaItem): string[] {
  const warnings: string[] = [];

  if (item.image_url && item.video_url) {
    throw new Error(
      "A Threads post carries an image or a video, not both. For several pieces of media use create_carousel.",
    );
  }

  if (item.image_url) {
    assertMediaUrl(item.image_url, "image");
    const warning = formatWarning(item.image_url, "image");
    if (warning) warnings.push(warning);
  }

  if (item.video_url) {
    assertMediaUrl(item.video_url, "video");
    const warning = formatWarning(item.video_url, "video");
    if (warning) warnings.push(warning);
  }

  return warnings;
}

export function assertCarouselSize(count: number): void {
  if (count < CAROUSEL.min || count > CAROUSEL.max) {
    throw new Error(
      `A Threads carousel holds ${CAROUSEL.min} to ${CAROUSEL.max} items. You passed ${count}.`,
    );
  }
}
