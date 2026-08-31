# Threads MCP setup

Threads has no app passwords and no personal access tokens. Every credential is
an OAuth token minted against a Meta app you create yourself. That is a real
setup step, and it is the part worth writing down properly.

The whole thing takes about ten minutes once.

## Prerequisites

Node 20 or newer, and a Threads profile.

## 1. Create the Meta app

1. [developers.facebook.com/apps](https://developers.facebook.com/apps),
   **Create App**.
2. Choose the **Threads API** use case.
3. Open **Threads API**, then **Settings**. Copy the **Threads App ID** and the
   **Threads App Secret**.
4. Under **Redirect Callback URLs**, add exactly:

   ```
   http://127.0.0.1:8788/callback
   ```

   That is the loopback address `login` listens on. Nothing leaves the machine.
   If 8788 is taken, use `login --port=9000` and add that URL instead.

## 2. Add yourself as a tester

Still in the app: **Roles**, then add your own Threads account as a
**Threads Tester**.

Then accept it. On Threads: **Settings**, **Website permissions**, **Invites**.

This step is the one everybody misses. Skip it and every API call returns an
empty result with no error explaining why.

## 3. Authorise

```bash
export THREADS_APP_ID=1234567890
export THREADS_APP_SECRET=abc123...
threads-mcp login
```

That opens the authorisation page, catches the redirect, exchanges the code,
exchanges the short-lived token for a 60-day one, verifies it, and writes it to
`~/.threads-mcp/tokens.json` at mode 0600.

If the browser cannot open, `threads-mcp login --manual` prints the URL and
takes a pasted token instead.

## 4. Check it

```bash
threads-mcp doctor
```

It probes each capability separately and names the fix for whichever fails.

## Scopes

Default, and all available to you as a tester on your own app with no review:

- `threads_basic`
- `threads_content_publish`
- `threads_manage_replies`
- `threads_read_replies`
- `threads_manage_insights`
- `threads_delete`

These need App Review, and `login --all-scopes` requests them:

- `threads_keyword_search`
- `threads_profile_discovery`
- `threads_location_tagging`

A missing scope usually shows up as an empty result rather than an error.

## Several profiles

Run `login` once per profile, signed in as that profile each time. Both land in
the same store and are refreshed independently. `list_accounts` shows what is
connected.

## The 60-day clock

A long-lived token is valid for 60 days. It can be refreshed once it is 24 hours
old, and never after it expires: an expired token is replaced only by doing the
OAuth flow again.

The server refreshes tokens it owns automatically, inside the last seven days.
But an MCP server over stdio only runs while a client has it open, so if nothing
runs for 60 days, nothing refreshes. Either leave the client connected, run
`threads-mcp refresh` occasionally, or run the server over HTTP somewhere
always on.

A token pasted into `THREADS_ACCESS_TOKEN` cannot be refreshed at all, because
there is nowhere to write the new value.

## Tokens from the Graph API Explorer

They are **short-lived** and stop working in an hour. This is the most common
reason a Threads setup appears to break at random. Use `login`.
