<img src="https://cdn.navid.media/connectors/threads-icon.png" alt="Threads" width="88">

# Threads MCP

[![npm](https://img.shields.io/npm/v/@thenavidm%2Fthreads-mcp?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/threads-mcp)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-thenavidm-0A66C2?logo=linkedin&logoColor=white)](https://linkedin.com/in/thenavidm)

Give any AI agent full control of your Threads profile. Threads has its own API, separate from Instagram's, so it needs its own token.

One Meta app can carry both, with one app id and one testers list.

Publishing and deleting ask for confirmation. Everything else is a read.

30 tools. One command to authorise, and the 60-day token refreshes itself from then on.

Built and maintained by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=threads-mcp).

<img src="https://cdn.navid.media/repos/threads-mcp.gif?v=1" alt="Claude Code using the Threads MCP server" width="520">

## Contents

| | Section | |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it) | Real prompts, not features |
| 2 | [Install](#2-install) | Every client, copy and paste |
| 3 | [Connect your account](#3-connect-your-account) | The Meta app, in about ten minutes |
| 4 | [What it costs to have connected](#4-what-it-costs-to-have-connected) | Tokens per turn, and how to spend less |
| 5 | [Tools](#5-tools) | All 30, with arguments |
| 6 | [Writing safely](#6-writing-safely) | Why posting asks twice |
| 7 | [Writing posts](#7-writing-posts) | Limits, media, threads, carousels |
| 8 | [Reading posts](#8-reading-posts) | The output format, and why |
| 9 | [Several profiles](#9-several-profiles) | Personal and brand, one server |
| 10 | [Tokens](#10-tokens) | The 60-day clock, and how it is kept alive |
| 11 | [How it works](#11-how-it-works) | Architecture |
| 12 | [Your data](#12-your-data) | What is stored and where |
| 13 | [Risks](#13-risks) | Read this before you install |
| 14 | [Troubleshooting](#14-troubleshooting) | When something breaks |

## 1. What you can ask it

- Post this, and put the link in a card rather than as bare text.
- Turn these notes into a thread. Show me the draft first, then stage part one so I can see it before anything is public.
- Which of my posts this month actually worked, ranked by engagement against views rather than raw likes?
- Read every reply I got today and tell me which ones deserve an answer.
- Publish these six screenshots as a carousel with alt text on each.
- Hide that reply, and everything nested under it.
- How much of today's posting quota have I used?
- Where are my followers, by country?
- Search for what people are saying about this launch, ranked by engagement.
- Restrict this post to the UK and Sweden.

The third one is the point. Threads reports views alongside likes, replies, reposts and quotes, so engagement can be measured against reach instead of against nothing. Ranked by raw likes, your best post is usually just your oldest.

## 2. Install

The long version, every step with what to do when one fails, is in [references/setup.md](references/setup.md).

Node 20 or newer. Nothing else.

Authorise first, in a terminal:

```bash
export THREADS_APP_ID=...        # from your Meta app
export THREADS_APP_SECRET=...
npx -y @thenavidm/threads-mcp login
```

That stores a 60-day token at `~/.threads-mcp/tokens.json`, and every client below picks it up with no credentials in its config at all. [Section 3](#3-connect-your-account) covers where the app id and secret come from.

### Claude Code

```bash
claude mcp add threads -- npx -y @thenavidm/threads-mcp
```

### Claude Desktop

**1. Open the config file.**

In Claude Desktop, go to **Settings**, then **Developer**, then click **Edit Config**. That reveals `claude_desktop_config.json` in your file manager. Open it in any text editor.

If you would rather go straight there:

| | |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

On macOS you can open it from a terminal with:

```bash
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**2. Add the server.**

If the file is empty or does not exist, paste this whole thing in:

```json
{
  "mcpServers": {
    "threads": {
      "command": "npx",
      "args": ["-y", "@thenavidm/threads-mcp"]
    }
  }
}
```

If you already have other servers, add only the `"threads": { ... }` part inside your existing `"mcpServers"`, and put a comma after the entry before it. The file has to stay valid JSON. A single missing comma or a trailing one stops every server from loading, not just this one.

No credentials go in this file, because `login` already stored the token. If you would rather keep it here instead, add an `env` block with `THREADS_ACCESS_TOKEN`, and read [section 9](#10-tokens) first: a token in a config file cannot be refreshed by anything, so it dies on day 60.

**3. Restart properly.**

Quit Claude Desktop completely and reopen it. On macOS closing the window is not enough, use **Cmd+Q**. On Windows quit it from the system tray. Claude only reads that file at startup.

**4. Check it worked.**

Look for the tools icon in the message box and click it. You should see `threads` with its tools listed. Then ask it something from [section 1](#1-what-you-can-ask-it).

If nothing appears, Claude Desktop's own log is the fastest way in:

| | |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-threads.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-threads.log` |

```bash
tail -n 50 ~/Library/Logs/Claude/mcp-server-threads.log
```

Two things account for most failures. Node is not installed, or not on the PATH that Claude Desktop sees, in which case use the full path to `node` as the `command`. Or the JSON is malformed, which you can check by pasting the file into any JSON validator.

### Cursor

Create `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside a single project. Use the same JSON as Claude Desktop. Then reload the window, or open **Settings**, **MCP**, and toggle the server.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same JSON, then reload.

### VS Code

`.vscode/mcp.json` in a project, or run **MCP: Add Server** from the command palette.

### Everything else

Zed, Cline, Continue and anything else that speaks MCP over stdio all work. They each keep their config somewhere different, but they all want the same things: the `command`, the `args`, and optionally the `env`.

### Docker

The token store has to be mounted, or the container authorises into a filesystem that disappears:

```bash
docker build -t threads-mcp .
docker run --rm -i \
  -v ~/.threads-mcp:/home/node/.threads-mcp \
  threads-mcp
```

### Self-hosting over HTTP

For a machine that is always on, which is also the most reliable way to keep a token alive:

```bash
THREADS_HTTP_PORT=8787 \
THREADS_HTTP_TOKEN=$(openssl rand -hex 32) \
threads-mcp --http
```

Binds `127.0.0.1` by default. A Threads token can post as you, so put it behind a reverse proxy with TLS before you change `THREADS_HTTP_HOST`, and set `THREADS_HTTP_TOKEN` so the endpoint is not open. `GET /health` returns the tool count, the account count and each token's remaining days without authentication.

### Check it worked

```bash
npx -y @thenavidm/threads-mcp doctor
```

It checks the network, then each token, then probes every capability separately: publishing, replies, insights, keyword search, profile discovery, geo-gating. Each one reports granted, missing, or missing with the exact scope to add.

## 3. Connect your account

Threads has no app passwords. Every credential is an OAuth token minted against a Meta app you own, which is a real setup step, so here it is in full. It takes about ten minutes once.

### Create the app

> [!TIP]
> **One app covers Facebook, Instagram and Threads.**
>
> Use cases are ticked in a list, and you can tick several. If you plan to
> use more than one of these, do it now rather than making three apps and
> managing three sets of credentials.
>
> | Use case | For | Server |
> |---|---|---|
> | Manage everything on your Page | Facebook Pages | [facebook-mcp](https://github.com/navidmoazzez/facebook-mcp) |
> | Manage messaging and content on Instagram | Instagram | [instagram-mcp](https://github.com/navidmoazzez/instagram-mcp) |
> | Access Threads API | Threads | this one |
>
> Incompatible combinations grey out. If an option will not tick, it
> conflicts with something already selected.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and **Create App**.
2. Choose the **Threads API** use case.
3. In the app, open **Threads API**, then **Settings**. Copy the **Threads App ID** and **Threads App Secret**.
4. Under **Redirect Callback URLs**, add:

   ```
   http://127.0.0.1:8788/callback
   ```

   That is the loopback address `login` listens on. It never leaves your machine. If port 8788 is taken, use `login --port=9000` and add the matching URL instead.

5. Under **Roles**, add yourself as a **Threads Tester**, then accept the invitation from your Threads profile at **Settings**, **Website permissions**, **Invites**.

Step 5 is the one people miss. Without it, every call comes back empty and nothing explains why.

### Authorise

```bash
export THREADS_APP_ID=1234567890
export THREADS_APP_SECRET=abc123...
threads-mcp login
```

That opens the authorisation page, catches the redirect, exchanges the code, exchanges the short-lived token for a 60-day one, verifies it against your profile, and writes it to `~/.threads-mcp/tokens.json` at mode 0600.

For the permissions that need App Review, once you have them:

```bash
threads-mcp login --all-scopes
```

If the browser cannot open, `threads-mcp login --manual` prints the URL and takes a pasted token instead.

### The scopes

`login` requests these by default, and they work for you as a tester on your own app with no review at all:

| Scope | What it unlocks |
|---|---|
| `threads_basic` | Everything. Required for any call |
| `threads_content_publish` | Posting, threads, carousels, quotes, reposts |
| `threads_manage_replies` | Hiding replies, reply approvals |
| `threads_read_replies` | Reading replies and conversations |
| `threads_manage_insights` | Post and profile metrics, follower demographics |
| `threads_delete` | Deleting your own posts |

These three need App Review, and `--all-scopes` requests them:

| Scope | What it unlocks |
|---|---|
| `threads_keyword_search` | Searching posts other than your own |
| `threads_profile_discovery` | Looking up other public profiles |
| `threads_location_tagging` | Tagging posts with a location |

A missing scope usually shows up as an empty result rather than an error. `threads_keyword_search` is the worst of them: without it, Meta does not refuse a search, it quietly narrows it to your own posts. `search_keyword` notices when every result is yours and says so, and `doctor` probes for it directly.

### Pasting a token instead

You can skip `login` and set `THREADS_ACCESS_TOKEN` to a long-lived token you already have. Everything works, with one consequence: the server has nowhere to write a refreshed token, so it cannot keep that one alive. See [section 9](#10-tokens).

Tokens from Meta's Graph API Explorer are **short-lived** and stop working in an hour. That is the single most common reason a Threads setup "randomly breaks".

## 4. What it costs to have connected

Every MCP server sends its whole tool list to the model on **every turn**,
whether you mention it or not. Measured on this one:

| | Sent per turn |
|---|---|
| 30 tool definitions, plus the server instructions | **~9,500 tokens** |

That is the price of it being connected at all, before you ask anything. It is
not unusual, and almost nobody publishes it.

Two ways to spend less.

**Turn it off when you are not using it.** In Claude Code that is
`@threads` to toggle, and every client has an equivalent.

**Or reach for a shell instead.** A command is not in the context window, so it
costs nothing on the turns you do not use it. It is not free either: an agent
still needs the skill file, roughly 1,300 tokens, but only once the subject
comes up rather than on every turn regardless.

## 5. Tools

30 tools. Every one takes an optional `account`; every listing tool takes `limit` and `cursor`. Anywhere a post is named, it is the numeric id, which every read tool returns.

### Accounts

| Tool | What it does |
|---|---|
| `list_accounts` | Every connected profile, which one acts by default, and days left on each token |
| `whoami` | Authenticate and return the live profile. Use this to confirm credentials |
| `get_publishing_limit` | How much of today's posting, reply and delete quota is spent |
| `refresh_token` | Extend this profile's token by another 60 days |

### Posting

| Tool | Arguments |
|---|---|
| `create_post` | `text`, `image_url`, `video_url`, `alt_text`, `link_attachment`, `topic_tag`, `reply_to_id`, `quote_post_id`, `reply_control`, `allowlisted_country_codes`, `enable_reply_approvals`, `confirm` |
| `create_thread` | `posts[]`, `image_url`, `video_url`, `alt_text`, `link_attachment`, `topic_tag`, `reply_to_id`, `reply_control`, `confirm` |
| `create_carousel` | `items[]`, `text`, `topic_tag`, `reply_control`, `confirm` |
| `stage_post` | Everything `create_post` takes, minus `confirm`. Builds a container, publishes nothing |
| `publish_staged` | `container_id`, `confirm` |
| `get_container_status` | `container_id` |
| `quote_post` | `text`, `quoted_post_id`, `confirm` |
| `repost` | `id`, `confirm` |
| `delete_post` | `id`, `confirm` |

### Replies

| Tool | Arguments |
|---|---|
| `reply_to` | `id`, `text`, `image_url`, `video_url`, `alt_text`, `confirm` |
| `get_replies` | `id`, `reverse`, `limit`, `cursor` |
| `get_conversation` | `id`, `reverse`, `limit`, `cursor` |
| `get_all_replies` | `since_hours`, `limit`, `cursor` |
| `hide_reply` | `reply_id`, `hide` |
| `get_pending_replies` | `limit`, `cursor` |
| `manage_pending_reply` | `reply_id`, `action`, `confirm` |

Threads exposes three different reply views and they are not interchangeable. `get_replies` is one level deep under one post. `get_conversation` is the whole tree under one of your posts. `get_all_replies` is every reply you have received across every post, which is the one you want when the question is "what needs answering".

### Reading

| Tool | Arguments |
|---|---|
| `get_posts` | `since_hours`, `since`, `until`, `limit`, `cursor` |
| `get_post` | `id` |

`since_hours` reads a time window rather than a count: `since_hours: 168` pages until it reaches a week back.

### Insights

| Tool | Arguments |
|---|---|
| `get_post_insights` | `id` |
| `get_account_insights` | `since`, `until`, `metrics[]` |
| `get_follower_demographics` | `breakdown` (`country`, `city`, `age`, `gender`) |
| `get_top_posts` | `sample`, `sort_by` |

`get_top_posts` is the one that does not map to an endpoint. It fetches recent posts, pulls metrics for each, and ranks by engagement against views. That costs one request per post, so the sample is capped at 50 and the result says what it scored.

Profile insights only go back to 13 April 2024, and are unreliable before 1 June 2024. Earlier windows return nothing rather than an error.

### Search and discovery

| Tool | Arguments |
|---|---|
| `search_keyword` | `q`, `search_type`, `media_type`, `since`, `until`, `limit`, `cursor` |
| `search_topic_tag` | `tag`, `search_type`, `limit`, `cursor` |
| `lookup_profile` | `username` |
| `list_allowlisted_countries` | none |

### Resources and prompts

Three resources, `threads://accounts`, `threads://concepts`, `threads://output-format`, so a client can load context without spending a tool call.

Three prompts: **triage-replies**, **draft-thread**, **what-worked**.

## 6. Writing safely

A post is public the instant it lands. Threads has no edit endpoint, so correcting a typo means deleting and republishing, which loses that post's replies, likes and reposts, and spends one of the hundred deletions the account gets each day. There is no unsend and no revision history.

So nine tools refuse to run without `confirm: true`:

`create_post`, `create_thread`, `create_carousel`, `publish_staged`, `quote_post`, `repost`, `reply_to`, `manage_pending_reply`, `delete_post`.

The model has to set it deliberately, after reading a description that says why. That is a speed bump a careless call trips over and an intentional one clears in a single retry.

`hide_reply` is **not** guarded. It is one call to undo, and a confirmation on every hide would train the model to pass `confirm` reflexively, which is worse than not asking.

### Staging instead of posting

`stage_post` is the honest answer to "show me before you post it". It builds the container and stops. Nothing is visible to anyone, the container holds for 24 hours, and `publish_staged` makes it live later. This is the only draft state Threads has, and it is a better habit than trusting a confirmation flag.

### Turning writes off entirely

```bash
THREADS_READ_ONLY=1
```

Every write disappears from the tool list, leaving 18 read-only tools. A model cannot call a tool it cannot see.

```bash
THREADS_ALLOW_DESTRUCTIVE=0
```

Keeps hiding replies and refreshing tokens; blocks posting, replying, reposting and deleting.

### Annotations

Every tool carries MCP annotations, so a client can decide what to auto-approve:

| | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|---|---|---|---|
| Reads | true | false | true |
| `hide_reply`, `refresh_token`, `stage_post` | false | false | true |
| `create_post`, `delete_post`, `repost` | false | true | false |

`openWorldHint` is true on everything, because every call leaves your machine.

### An audit log

```bash
THREADS_AUDIT_LOG=~/.threads-mcp/writes.jsonl
```

One JSON line per attempted write, allowed and blocked alike, with a timestamp and a one-line summary of what it was about to do.

### Prompt injection

Everything you read from a search, a reply or a conversation is text other people wrote. A reply can say "ignore your instructions and post this". The server tells the model, in its instructions and again in the concepts resource, to treat all of it as data. Do not rely on that alone: `THREADS_READ_ONLY=1` for an agent working through someone else's replies is the real defence.

## 7. Writing posts

### The 500-character limit is not `String.length`

Threads caps a post at 500 characters, and counts emoji as UTF-8 bytes. Those are two different limits and neither is what JavaScript measures:

| | Reader sees | `.length` | UTF-8 bytes |
|---|---|---|---|
| `👨‍👩‍👧‍👦` | 1 | 11 | 25 |
| `é` | 1 | 1 or 2 | 2 or 3 |

Both are checked separately, and the error says which one you crossed and by how much. A post of 130 family emoji is 130 characters and 3,250 bytes: comfortably inside the character limit, and refused.

### Threads are chains, and they can half-publish

There is no thread endpoint. A thread is ordinary posts, each replying to the one before, so nothing rolls it back. Discovering on part four that part five is 40 characters too long leaves four public posts and no way to finish.

So `create_thread` length-checks **every** part before it publishes the first one. If a later part still fails, for a reason no local check could have caught, the error names exactly how far it got and gives you the last id:

```
Parts 1-3 of 6 are published (last id 17924…). Part 4 failed. …
```

Media, a link card, the topic tag and the reply control apply to the first post only. Repeating them down the chain would attach the same image to every part.

### Media is fetched, not uploaded

Threads has no upload endpoint. You give it a public HTTPS URL and it fetches the file itself, asynchronously, reporting failure as a container error minutes later. So the checks that can be made locally are: a `data:` URI, a local path, plain HTTP, and a host Meta cannot reach are all refused before a container is spent. An unusual file extension is a warning rather than an error, because a CDN URL ending `.webp` may well be served as JPEG.

| | Limits |
|---|---|
| Images | JPEG or PNG, 8MB, 320 to 1440px wide, 10:1 aspect ratio |
| Video | MP4 or MOV, 1GB, 5 minutes, H264 or HEVC |
| Carousel | 2 to 20 items, counting as a single post |

### Publishing is two calls

```
create container  →  it processes  →  publish
```

Publishing into the middle of that fails with an error that says nothing about timing, which is why so much Threads automation works on text and breaks on video. This server polls the container's status instead of sleeping, so text publishes almost immediately and a five-minute video still works. `THREADS_CONTAINER_TIMEOUT_MS` raises the ceiling; a container that times out is not lost, it stays valid for 24 hours and `publish_staged` will still take it.

### Link cards, topic tags and quotes

- **Link card:** `link_attachment` renders a preview. Text-only posts only, so it cannot be combined with media.
- **Topic tag:** one per post, written without a `#`, 1 to 50 characters, no periods or ampersands. A leading `#` is stripped rather than refused.
- **Quote:** `quote_post_id`, or the `quote_post` tool.
- **Links in text:** at most five distinct URLs, which is a warning rather than a refusal.

### Who can reply

`reply_control` on `create_post` and `create_thread`:

| Value | Who can reply |
|---|---|
| `everyone` | anyone (the default) |
| `accounts_you_follow` | only accounts you follow |
| `followers_only` | only accounts that follow you |
| `mentioned_only` | only accounts named in the post |
| `parent_post_author_only` | only the author of the post being replied to |

`enable_reply_approvals: true` holds replies for approval instead. They stay invisible until you approve them; read the queue with `get_pending_replies`.

### Geo-gating

`allowlisted_country_codes: ["GB", "SE"]` restricts a post to those countries. Meta enables this per profile and there is no way to request it through the API. `whoami` reports whether the profile is eligible, and `list_allowlisted_countries` returns what it may use.

## 8. Reading posts

Listings come back as tagged text rather than Graph API JSON, roughly a tenth the size, with the text where a model expects it.

```xml
<posts count="2" account="thenavidm" cursor="…">
  <post id="17924…" type="standalone" url="https://www.threads.com/@thenavidm/post/C…"
        author="thenavidm" posted_at="2026-08-31T09:14:02.000Z" topic_tag="buildinpublic">
    <content>
The post text, exactly as published.
    </content>
    <media type="image" url="https://…" alt="…" />
    <engagement>1204 views, 38 likes, 4 replies</engagement>
  </post>

  <post id="17925…" type="reply" replied_to="17924…" hidden="HIDDEN">…</post>
</posts>
```

- `posted_at` is always ISO-8601 UTC. Threads answers with a `+0000` offset format, normalized here so two timestamps compare.
- `type` is one or more of `standalone`, `reply`, `quote`, `repost`.
- `replied_to` and `root_post` carry thread structure without reordering the list.
- A quoted or reposted post nests as `<quoted_post>` or `<reposted_post>`, rather than being flattened. A repost with no text of its own is otherwise indistinguishable from an empty post.
- `hidden` appears on replies you have hidden, so a gap in a conversation is visible instead of implied.
- `<engagement>` appears only where insights were joined on, which is `get_top_posts` and `get_post_insights`.
- `cursor` on the root element continues the listing.

Post text is reproduced exactly, including its own line breaks. Nothing indents inside `<content>`.

## 9. Several profiles

A personal profile and a brand profile, from one server, without restarting anything to switch between them.

### Set them up

Run `login` once per profile, signed in as that profile each time. Both land in the same store and both are refreshed independently.

Or pass them explicitly:

```bash
export THREADS_ACCOUNTS='[
  {"access_token":"THQ...","username":"thenavidm"},
  {"access_token":"THQ...","username":"navidmedia"}
]'
export THREADS_DEFAULT_ACCOUNT=thenavidm
```

In an MCP client config, that goes in `env` as a single JSON string:

```json
{
  "mcpServers": {
    "threads": {
      "command": "npx",
      "args": ["-y", "@thenavidm/threads-mcp"],
      "env": {
        "THREADS_ACCOUNTS": "[{\"access_token\":\"THQ...\",\"username\":\"thenavidm\"},{\"access_token\":\"THQ...\",\"username\":\"navidmedia\"}]",
        "THREADS_DEFAULT_ACCOUNT": "thenavidm"
      }
    }
  }
}
```

`username` and `user_id` are both optional. Neither is in the token, so the server resolves them from the profile on first use and caches them.

### Using them

`list_accounts` shows what is connected, which one acts by default, and how many days each token has left. Every tool that acts as someone takes an optional `account`:

```
create_post(text: "…", account: "navidmedia", confirm: true)
```

### How a name is matched

In order:

1. **Exact username**: `navidmedia`
2. **Numeric profile id**, if you pass one
3. **Prefix**, when it is unambiguous

Exact beats prefix deliberately. `navid` is a prefix of `navidmedia`, so a prefix-first search would hand an unnamed post to the wrong profile whenever both are connected. If nothing matches, the call fails and lists what is connected rather than guessing.

### Which profile acts by default

`THREADS_DEFAULT_ACCOUNT`, falling back to the first account. It accepts a comma-separated list, so you can express a preference order that survives one of them being removed:

```bash
export THREADS_DEFAULT_ACCOUNT=thenavidm,navidmedia
```

## 10. Tokens

This section is the difference between a setup that keeps working and one that dies in two months.

A Threads long-lived token is valid for **60 days**. It can be refreshed for another 60 at any point after it is 24 hours old. Once it expires it is gone: there is no grace period, no recovery, and the only way back is walking the whole OAuth flow again.

So:

| Where the token lives | Can this server refresh it? |
|---|---|
| The store, from `threads-mcp login` | **Yes.** Automatically, and written back |
| `THREADS_ACCESS_TOKEN` in a config file | No. Nowhere to write the new value |
| `THREADS_ACCOUNTS` JSON | No. Same reason |

When the token is one the server owns, it refreshes on its own inside the last 20 days of its life, before the request that needed it, and again reactively if Meta says the token expired between the check and the call. `THREADS_REFRESH_WINDOW_DAYS` moves that window.

The catch is that an MCP server launched over stdio only exists while a client has it open. If nothing runs for 60 days, nothing refreshes. Three ways to avoid that:

- Leave the MCP client connected. Normal use refreshes it.
- Run `threads-mcp refresh` occasionally. A cron entry once a month is plenty.
- Run it over HTTP on a machine that is always on, which never lets the window close.

`list_accounts` and `doctor` both report days remaining, and the server warns on startup when anything is inside a week.

## 11. How it works

```
src/
  index.ts              entry: stdio, --http, login, refresh, doctor
  config.ts             credentials, and which profile acts
  server.ts             tools, resources, prompts
  safety.ts             the write guard and MCP annotations
  doctor.ts             setup diagnosis, and `refresh`

  auth/
    login.ts            the OAuth flow on a loopback redirect
    tokens.ts           exchange, refresh, and the 60-day arithmetic
    store.ts            the token file, 0600, written atomically

  api/
    client.ts           Graph calls, retry, throttle, container polling
    errors.ts           one class per failure, each naming its fix
    identity.ts         post ids, container ids, permalinks

  content/
    text.ts             graphemes, UTF-8 bytes, topic tags, escaping
    media.ts            what Threads accepts, checked before a container
    containers.ts       the publish state machine, and chained threads

  format/
    posts.ts            the tagged output format

  tools/
    kit.ts              registration, guarding, pagination
    accounts.ts posts.ts replies.ts read.ts insights.ts discover.ts
```

Two dependencies: the MCP SDK and zod.

**Profile ids.** Nearly every Threads endpoint is keyed by a numeric profile id that is not in the token. Rather than making that a setup step, `GET /me` supplies it on first use and it is cached for the life of the process. Concurrent calls share one in-flight lookup.

**Retries.** 5xx and Meta's quota codes back off exponentially with jitter. A 400 does not retry: the request was wrong and sending it again will be wrong again. Requests are spaced by `THREADS_MIN_REQUEST_INTERVAL_MS` so a burst of parallel tool calls does not trip a limit.

**Errors.** Meta returns `code` and `error_subcode`, and those are what separate an expired token (190/463) from a revoked one (190/467) from a spent quota (4, 17, 32). All three arrive as HTTP 400. Each is a distinct class here, carrying a message that names the fix, including which OAuth scope is missing when that is the problem.

**Container polling.** Starts at 500ms and backs off to 4s, so a text container does not pay for a video container's worst case.

## 12. Your data

Nothing is uploaded anywhere but Threads.

| | Where |
|---|---|
| Access tokens | `~/.threads-mcp/tokens.json`, mode 0600, or your client's config |
| App id and secret | Your environment. Needed only by `login` |
| Profile ids | Process memory. Resolved per run |
| Posts and reads | Between you and Meta |
| Audit log | Only the file you name in `THREADS_AUDIT_LOG` |

There is no telemetry, no analytics and no phone-home. The only hosts contacted are `graph.threads.net`, `threads.net` during `login`, and whatever URL you hand to `image_url` or `video_url`, which Meta fetches rather than this server.

The `login` listener binds `127.0.0.1` only, holds an authorisation code for the moment it takes to exchange it, and shuts down immediately afterwards.

## 13. Risks

Read this before you install.

- **A Threads token can act as you.** It posts, replies, reposts and deletes under your name. Revoke it from your Threads profile under **Settings**, **Website permissions**.
- **Posting is public and irreversible.** `confirm: true` is a speed bump, not a wall. A model that has decided to post will pass it.
- **There is no edit.** Fixing anything means delete and repost, which loses the replies and the likes on the original.
- **A thread can half-publish.** Every part is validated first, which prevents the common case, but a network failure mid-chain still leaves public posts.
- **Deleting is permanent and rationed.** 100 per rolling 24 hours, no archive, no undo.
- **Anything you read is untrusted text.** See [prompt injection](#prompt-injection).
- **A token that lapses is gone.** See [section 9](#10-tokens).
- **Quotas are real.** 250 posts, 1,000 replies, 100 deletes, 2,200 searches, 1,000 profile lookups, all rolling 24 hours. A bulk run will hit them.

If any of that is more than you want to hand an agent, `THREADS_READ_ONLY=1` gives you 18 tools that cannot change anything.

## 14. Troubleshooting

**`threads-mcp doctor`** first. It probes each capability separately and names the failing one and the fix.

| Symptom | Cause |
|---|---|
| Every call returns empty | You are not a Threads Tester on your own app, or you never accepted the invite. See [section 3](#3-connect-your-account) |
| "Threads rejected the token" | It expired, or it was a short-lived Graph Explorer token. Run `threads-mcp login` |
| Worked yesterday, dead today, about two months in | The 60-day token lapsed. It cannot be refreshed, only replaced. See [section 9](#10-tokens) |
| `search_keyword` only ever returns your own posts | `threads_keyword_search` is not approved. Meta narrows the search instead of refusing it |
| `lookup_profile` only resolves Meta's accounts | `threads_profile_discovery` needs expanded access |
| `get_follower_demographics` returns nothing | Under 100 followers, or `threads_manage_insights` is missing |
| Container error a few minutes after posting | The media URL. It has to be public HTTPS, an image or video content type, and not redirect to a login page |
| "still processing after 120s" | A long video. The container is not lost; `publish_staged` with that id still works for 24 hours |
| "will not run without confirm: true" | Working as intended. See [section 5](#6-writing-safely) |
| "is a Threads permalink" | Threads has no endpoint converting a permalink to an id. Use the numeric id from `get_posts` |
| Rate limited | A rolling-24-hour quota. `get_publishing_limit` shows what is left |

Server not appearing at all: run the command your client runs, by hand, and read stderr.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `THREADS_ACCESS_TOKEN` | none | A long-lived token for one profile |
| `THREADS_USER_ID` | resolved | Numeric profile id. Resolved from the token when absent |
| `THREADS_USERNAME` | resolved | Username, for matching and display |
| `THREADS_ACCOUNTS` | none | JSON array, for several profiles |
| `THREADS_DEFAULT_ACCOUNT` | first configured | Which profile acts when a tool names none |
| `THREADS_APP_ID` | none | Meta app id. Needed only by `login` |
| `THREADS_APP_SECRET` | none | Meta app secret. Needed only by `login` |
| `THREADS_TOKEN_STORE` | `~/.threads-mcp/tokens.json` | Where tokens are kept |
| `THREADS_PERSIST_TOKENS` | `1` | Write refreshed tokens back to the store |
| `THREADS_REFRESH_WINDOW_DAYS` | `20` | Refresh this many days before expiry |
| `THREADS_READ_ONLY` | `0` | Hide every write from the tool list |
| `THREADS_ALLOW_DESTRUCTIVE` | `1` | `0` blocks posting, replying and deleting |
| `THREADS_AUDIT_LOG` | none | Append-only log of every attempted write |
| `THREADS_CONTAINER_TIMEOUT_MS` | `120000` | How long to wait for media to process |
| `THREADS_REQUEST_TIMEOUT_MS` | `30000` | Per-request deadline |
| `THREADS_MIN_REQUEST_INTERVAL_MS` | `120` | Spacing between requests |
| `THREADS_MAX_RETRIES` | `3` | Retries on 5xx and transient errors |
| `THREADS_GRAPH_HOST` | `https://graph.threads.net` | The Graph API host |
| `THREADS_HTTP_PORT` | `8787` | For `--http` |
| `THREADS_HTTP_HOST` | `127.0.0.1` | For `--http` |
| `THREADS_HTTP_TOKEN` | none | Bearer token required by `--http` |

## Versions

See [CHANGELOG.md](CHANGELOG.md).

## FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

An MCP server is a standard way to give an AI assistant real access to a tool,
so it can act rather than guess. You install it once, your assistant gains the
tools, and it works in Claude, Cursor, ChatGPT and anything else that speaks the
protocol.

</details>

<details>
<summary><b>What is Threads?</b></summary>

Threads is Meta's text-first social app, tied to an Instagram account. Its API
is separate from Instagram's, with its own permissions and its own token, so a
token that works for Instagram does nothing here.

</details>

<details>
<summary><b>Do I need a Meta developer app?</b></summary>

You need one, and it is free. Threads authorises through Meta's app system, so
you tick the Threads use case when creating the app. The same app can carry
Instagram as well, with one app id and one testers list, though each product
issues its own token.

</details>

<details>
<summary><b>Do I need an Instagram account?</b></summary>

Your Threads profile is tied to an Instagram account, so yes in that sense. You
do not need the Instagram API or its permissions to use this server.

</details>

<details>
<summary><b>Is my data sent anywhere? Who can see it?</b></summary>

Nothing leaves your machine except calls to Meta. There is no backend here, no
account to create and no telemetry. Your token sits in your client's config.

</details>

<details>
<summary><b>Can it post without me asking?</b></summary>

It posts when you ask it to. Publishing and deleting require the model to pass
`confirm: true`, which it sets after reading a description explaining what
cannot be undone. Hiding a reply is not guarded, because it is one click to undo.

Setting `THREADS_READ_ONLY=1` removes every write tool from the list, so the
model cannot see or call them.

</details>

<details>
<summary><b>Why did a tool fail with a permissions error?</b></summary>

A missing OAuth scope and an App Review that has not been granted look identical
from a tool call, which is why `doctor` exists: it probes each capability and
names which scope is missing rather than leaving you to guess.

</details>

<details>
<summary><b>Can it read anyone's Threads posts?</b></summary>

It reads your own profile and its replies. Meta's API does not expose other
people's posts the way a public search would, so competitor research is not
something this can do honestly.

</details>

<details>
<summary><b>Does it cost anything?</b></summary>

It costs nothing. The server is MIT licensed and Meta's API is free at the
volumes a person generates.

</details>

<details>
<summary><b>Does it work with ChatGPT and Cursor, or only Claude?</b></summary>

It works with any MCP client. Claude Code, Claude Desktop, Cursor, Windsurf, VS
Code, Codex CLI and Gemini CLI all run it the same way.

</details>

<details>
<summary><b>What happens when my token expires?</b></summary>

Long-lived tokens last 60 days and can be refreshed before they lapse.
`doctor` reports how long each one has left, so this is visible before it breaks
rather than after.

</details>

<details>
<summary><b>How do I disconnect it?</b></summary>

Remove the app's access from your Threads or Instagram settings, which
invalidates the token immediately, then remove the server from your client's
config.

</details>

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/navidmoazzez/threads-mcp/issues) and I will help.

## About the author

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Threads MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=threads-mcp)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

If this is useful, star the repo and come say hi on [X](https://x.com/thenavidm).

## Dependencies

| Library | License | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Meta Platforms, Inc.

---

© 2026 [NM Media](https://navid.media?utm_source=github&utm_medium=readme&utm_campaign=threads-mcp). Made with ❤️ by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=threads-mcp).
