import { describe, expect, it } from "vitest";
import { assertCarouselSize, assertMediaUrl, checkMedia, formatWarning, mediaTypeFor } from "../src/content/media.js";
import { containerParams, validate } from "../src/content/containers.js";
import { parsePostRef, requireMediaId, isMediaId } from "../src/api/identity.js";

describe("media URLs", () => {
  it("refuses a local path, which cannot possibly work", () => {
    // Threads fetches media itself, so a local path fails minutes later as an
    // opaque container error. Catching it here is the whole point.
    expect(() => assertMediaUrl("/Users/me/photo.jpg", "image")).toThrow(/local path/);
    expect(() => assertMediaUrl("./photo.jpg", "image")).toThrow(/local path/);
  });

  it("refuses a data URI", () => {
    expect(() => assertMediaUrl("data:image/png;base64,AAA", "image")).toThrow(/data: URI/);
  });

  it("refuses plain HTTP and says so specifically", () => {
    expect(() => assertMediaUrl("http://example.com/a.jpg", "image")).toThrow(/plain HTTP/);
  });

  it("refuses a host Meta cannot reach", () => {
    expect(() => assertMediaUrl("https://localhost:3000/a.jpg", "image")).toThrow(/not reachable/);
    expect(() => assertMediaUrl("https://192.168.1.5/a.jpg", "image")).toThrow(/not reachable/);
  });

  it("accepts an ordinary CDN URL with no extension", () => {
    expect(() => assertMediaUrl("https://cdn.example.com/abc123", "image")).not.toThrow();
  });

  it("warns about an unsupported extension rather than refusing it", () => {
    // A .webp might be served as JPEG. A warning is right; an error is not.
    expect(formatWarning("https://cdn.example.com/a.webp", "image")).toMatch(/webp/);
    expect(formatWarning("https://cdn.example.com/a.jpg", "image")).toBeUndefined();
    expect(formatWarning("https://cdn.example.com/abc", "image")).toBeUndefined();
  });

  it("refuses an image and a video on the same post", () => {
    expect(() => checkMedia({ image_url: "https://a.example/i.jpg", video_url: "https://a.example/v.mp4" })).toThrow(
      /not both/,
    );
  });

  it("infers the container type from what was passed", () => {
    expect(mediaTypeFor({})).toBe("TEXT");
    expect(mediaTypeFor({ image_url: "https://a" })).toBe("IMAGE");
    expect(mediaTypeFor({ video_url: "https://a" })).toBe("VIDEO");
  });

  it("enforces the carousel bounds", () => {
    expect(() => assertCarouselSize(1)).toThrow(/2 to 20/);
    expect(() => assertCarouselSize(21)).toThrow(/2 to 20/);
    expect(() => assertCarouselSize(2)).not.toThrow();
  });
});

describe("validating a post before anything is sent", () => {
  it("refuses text over the limit", () => {
    expect(() => validate({ text: "a".repeat(501) })).toThrow(/501 characters/);
  });

  it("refuses a link card on a post with media", () => {
    expect(() =>
      validate({ text: "x", image_url: "https://cdn.example.com/a.jpg", link_attachment: "https://navid.me" }),
    ).toThrow(/text-only/);
  });

  it("refuses a post that is both a reply and a quote", () => {
    expect(() => validate({ text: "x", reply_to_id: "1", quote_post_id: "2" })).toThrow(/not both/);
  });

  it("refuses country codes that are not ISO alpha-2", () => {
    expect(() => validate({ text: "x", allowlisted_country_codes: ["USA", "GB"] })).toThrow(/USA/);
  });

  it("warns rather than throws when there are too many links", () => {
    const warnings = validate({
      text: "https://a.example https://b.example https://c.example https://d.example https://e.example https://f.example",
    });
    expect(warnings.join(" ")).toMatch(/6 distinct URLs/);
  });
});

describe("building container parameters", () => {
  it("drops everything unset, so Meta never sees an empty field", () => {
    const params = containerParams({ text: "hello" });
    expect(params.media_type).toBe("TEXT");
    expect(params.text).toBe("hello");
    expect(params.image_url).toBeUndefined();
    expect(params.children).toBeUndefined();
  });

  it("uppercases country codes and joins carousel children", () => {
    const params = containerParams({ allowlisted_country_codes: ["gb", " se "], children: ["1", "2"] });
    expect(params.allowlisted_country_codes).toEqual(["GB", "SE"]);
    expect(params.children).toBe("1,2");
  });

  it("strips a leading # from a topic tag", () => {
    expect(containerParams({ text: "x", topic_tag: "#ai" }).topic_tag).toBe("ai");
  });
});

describe("post references", () => {
  it("recognises a numeric media id", () => {
    expect(isMediaId("17924123456")).toBe(true);
    expect(isMediaId("abc")).toBe(false);
    expect(requireMediaId(" 17924123456 ")).toBe("17924123456");
  });

  it("parses both threads.net and threads.com permalinks", () => {
    expect(parsePostRef("https://www.threads.com/@navid/post/CxYz").shortcode).toBe("CxYz");
    expect(parsePostRef("https://threads.net/@navid/post/CxYz").username).toBe("navid");
  });

  it("explains why a permalink alone cannot be used", () => {
    // Threads publishes no shortcode-to-id endpoint. Saying so beats sending
    // the shortcode and letting Meta return something unhelpful.
    expect(() => requireMediaId("https://www.threads.com/@navid/post/CxYz")).toThrow(/no public endpoint/);
  });

  it("refuses anything that is neither", () => {
    expect(() => requireMediaId("nonsense")).toThrow(/not a Threads post id/);
  });
});
