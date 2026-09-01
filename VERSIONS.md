# Threads MCP Versions

| Component | Version | Last Updated |
|-----------|---------|--------------|
| threads-mcp | 1.0.0 | 2026-08-31 |

---

## 1.0.0

First release. TypeScript, 30 tools, 57 tests.

### Four things Threads does differently

**Publishing is two calls with a gap in the middle.** A container is created,
it processes asynchronously, then it is published. Publishing into that gap
fails with an error that says nothing about timing, which is why so much Threads
automation works on text and breaks the first time someone attaches a video.
The container status is polled rather than slept on, starting at 500ms and
backing off to 4s, so text publishes almost immediately and a five-minute video
still works.

That unpublished container is also the only draft state Threads has: invisible,
valid for 24 hours, publishable later by id. Exposed as `stage_post` and
`publish_staged` rather than hidden inside a helper, because showing a human a
post before it is public is worth a tool of its own.

**The 500-character limit is not `String.length`.** Meta caps a post at 500
characters and counts emoji as UTF-8 bytes. A family emoji is one character to a
reader, eleven UTF-16 code units, and 25 bytes. So 130 of them is 130 characters,
comfortably inside the cap, and 3,250 bytes, which is refused. Both limits are
measured separately with `Intl.Segmenter`, and the error names which one was
crossed and by how much.

This matters most for `create_thread`. Threads has no thread endpoint: a thread
is ordinary posts chained by `reply_to_id`, so it can half-publish and nothing
rolls it back. Every part is validated before the first is published, and if a
later part still fails the error names exactly how far it got and gives back the
last published id.

**There is no edit.** No endpoint changes a published post. Fixing a typo means
delete and repost, losing the replies, likes and reposts, and spending one of
the 100 deletions the account gets per rolling 24 hours. That is why nine tools
refuse to run without `confirm: true`, and why `stage_post` exists.

`delete_post` uses HTTP DELETE. Sending POST to the same path returns a
success-shaped response for a request that deleted nothing.

**Tokens die on a 60-day clock.** A long-lived token can be refreshed once it is
24 hours old and never after it expires, and an expired one is replaced only by
walking the whole OAuth flow again. `threads-mcp login` stores the token where
the server can reach it, and it is then refreshed automatically inside the last
seven days of its life, plus reactively when Meta answers 190/463. A token
pasted into a client config cannot be refreshed by anything, and the docs say so
rather than letting it lapse quietly.

### Setup is one command

`threads-mcp login` opens the authorisation page, catches the redirect on a
loopback listener, exchanges the code, exchanges the short-lived token for a
60-day one, verifies it against `GET /me`, and writes it at mode 0600. The Meta
app itself still has to be created by hand, and the README walks through it,
including the Threads Tester role that everyone forgets and that makes every
call return empty until it is accepted.

`threads-mcp doctor` probes each capability separately rather than reporting one
verdict: publishing, replies, insights, keyword search, profile discovery and
geo-gating each get their own line, because Threads' permissions are granular
and a missing one usually reads as an empty result rather than an error.
`threads_keyword_search` is the worst of them, since Meta silently narrows an
unapproved search to your own posts, so both `doctor` and `search_keyword`
detect that case and say so.

### Output is a tenth the size

Listings render as tagged text rather than Graph API JSON. Timestamps are
normalized from Meta's `+0000` offset format to ISO-8601 UTC so they compare,
every attribute is escaped, quoted and reposted posts nest rather than
flattening, and hidden replies render as hidden so a gap in a conversation is
visible instead of implied.

### One tool that is not an endpoint

`get_top_posts` fetches recent posts, pulls insights for each, and ranks by
engagement against views. Sorting by raw likes mostly ranks posts by age.
Threads reports views alongside likes, replies, reposts and quotes, which makes
a real engagement rate possible, and nothing surfaces it by default.
