import { describe, expect, it } from "vitest";
import {
  byteLength,
  countLinks,
  escapeXml,
  graphemeLength,
  measure,
  normalizeTopicTag,
  overLimitMessage,
  MAX_POST_CHARS,
} from "../src/content/text.js";

describe("measuring a post", () => {
  it("counts a family emoji as one character, not eleven", () => {
    // The exact case that makes String.length wrong: this is one grapheme, but
    // eleven UTF-16 code units and twenty-five UTF-8 bytes.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    expect(family.length).toBe(11);
    expect(graphemeLength(family)).toBe(1);
    expect(byteLength(family)).toBe(25);
  });

  it("accepts exactly 500 characters and refuses 501", () => {
    expect(measure("a".repeat(500)).ok).toBe(true);
    const over = measure("a".repeat(501));
    expect(over.ok).toBe(false);
    expect(over.over).toBe("characters");
  });

  it("catches the byte limit before the character limit for emoji", () => {
    // 130 family emoji is 130 characters, well inside the 500-character cap,
    // but 3,250 bytes. A naive character check would let this through.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const text = family.repeat(130);
    const result = measure(text);
    expect(graphemeLength(text)).toBeLessThan(MAX_POST_CHARS);
    expect(result.ok).toBe(false);
    expect(result.over).toBe("bytes");
  });

  it("names the part in the error, so a thread failure is locatable", () => {
    const message = overLimitMessage("a".repeat(600), "Part 4 of 6");
    expect(message).toContain("Part 4 of 6");
    expect(message).toContain("600 characters");
  });

  it("says nothing when the text is fine", () => {
    expect(overLimitMessage("Shipping today.")).toBeUndefined();
  });
});

describe("links", () => {
  it("counts distinct URLs, ignoring trailing punctuation", () => {
    expect(countLinks("see https://navid.me/x, and https://navid.me/x.")).toBe(1);
    expect(countLinks("https://a.example and https://b.example")).toBe(2);
    expect(countLinks("no links here")).toBe(0);
  });
});

describe("topic tags", () => {
  it("strips a leading hash, which everyone adds once", () => {
    expect(normalizeTopicTag("#buildinpublic")).toBe("buildinpublic");
  });

  it("refuses the characters Threads refuses", () => {
    expect(() => normalizeTopicTag("build.in.public")).toThrow(/period or an ampersand/);
    expect(() => normalizeTopicTag("this&that")).toThrow(/period or an ampersand/);
  });

  it("refuses a tag over 50 characters", () => {
    expect(() => normalizeTopicTag("a".repeat(51))).toThrow(/50/);
  });
});

describe("escaping", () => {
  it("escapes every character that could break an attribute", () => {
    expect(escapeXml(`a"b<c>d&e'f`)).toBe("a&quot;b&lt;c&gt;d&amp;e&apos;f");
  });
});
