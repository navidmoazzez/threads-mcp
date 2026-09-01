import { describe, expect, it } from "vitest";
import { cursorOf, dataOf, renderList, renderPost, renderProfile } from "../src/format/posts.js";

const post = {
  id: "17924",
  text: "Shipping today.",
  permalink: "https://www.threads.com/@thenavidm/post/CxYz",
  timestamp: "2026-08-31T09:14:02+0000",
  media_type: "TEXT_POST",
  username: "thenavidm",
  has_replies: true,
};

describe("rendering a post", () => {
  it("normalises the offset timestamp Threads returns into ISO UTC", () => {
    // Threads answers with +0000 rather than Z. Two posts have to compare, so
    // everything is normalized through Date.
    expect(renderPost(post)).toContain('posted_at="2026-08-31T09:14:02.000Z"');
  });

  it("reproduces the text exactly, without indenting it", () => {
    const output = renderPost({ ...post, text: "line one\nline two" });
    expect(output).toContain("line one\nline two");
  });

  it("escapes an attribute that would otherwise break the markup", () => {
    const output = renderPost({ ...post, username: 'a"b' });
    expect(output).toContain('author="a&quot;b"');
    expect(output).not.toContain('author="a"b"');
  });

  it("labels a reply as a reply and carries its parent", () => {
    const output = renderPost({ ...post, is_reply: true, replied_to: { id: "999" } });
    expect(output).toContain('type="reply"');
    expect(output).toContain('replied_to="999"');
  });

  it("nests a quoted post rather than flattening it", () => {
    const output = renderPost({ ...post, is_quote_post: true, quoted_post: { ...post, id: "555" } });
    expect(output).toContain("<quoted_post");
    expect(output).toContain('id="555"');
    expect(output).toContain('type="quote"');
  });

  it("surfaces a hidden reply instead of letting it vanish", () => {
    const output = renderPost({ ...post, hide_status: "HIDDEN" });
    expect(output).toContain('hidden="HIDDEN"');
  });

  it("does not mark an unhidden reply as hidden", () => {
    expect(renderPost({ ...post, hide_status: "NOT_HUSHED" })).not.toContain("hidden=");
  });

  it("renders a carousel's children", () => {
    const output = renderPost({
      ...post,
      media_type: "CAROUSEL_ALBUM",
      children: { data: [{ media_type: "IMAGE", media_url: "https://a" }, { media_type: "IMAGE", media_url: "https://b" }] },
    });
    expect(output).toContain('<media type="carousel" count="2">');
  });
});

describe("rendering a listing", () => {
  it("carries the cursor and the count on the root element", () => {
    const output = renderList([post, post], { source: "posts", cursor: "abc", meta: { account: "thenavidm" } });
    expect(output).toContain('<posts count="2" account="thenavidm" cursor="abc">');
    expect(output.trimEnd().endsWith("</posts>")).toBe(true);
  });

  it("is dramatically smaller than the JSON it replaces", () => {
    const fat = Array.from({ length: 25 }, (_, i) => ({
      ...post,
      id: String(i),
      shortcode: "CxYz",
      thumbnail_url: null,
      is_quote_post: false,
      children: null,
    }));
    const tagged = renderList(fat, { source: "posts" });
    expect(tagged.length).toBeLessThan(JSON.stringify(fat).length);
  });
});

describe("reading a Graph API listing", () => {
  it("pulls the cursor out of the paging envelope", () => {
    expect(cursorOf({ paging: { cursors: { after: "xyz" } } })).toBe("xyz");
    expect(cursorOf({ paging: {} })).toBeUndefined();
    expect(cursorOf({})).toBeUndefined();
  });

  it("returns an empty array for a response with no data", () => {
    expect(dataOf({})).toEqual([]);
    expect(dataOf({ data: [1, 2] })).toHaveLength(2);
  });
});

describe("rendering a profile", () => {
  it("includes the bio and the extra stats", () => {
    const output = renderProfile(
      { id: "1", username: "thenavidm", threads_biography: "hello", is_verified: true },
      { followers: 1200, views_7d: 40000 },
    );
    expect(output).toContain('username="thenavidm"');
    expect(output).toContain('verified="true"');
    expect(output).toContain('followers="1200"');
    expect(output).toContain("hello");
    expect(output).toContain('name="views_7d"');
  });
});
