# Working on threads-mcp-cli

For agents editing this repository. Users read the README. Driving the server is
`SKILL.md`.

## Non-negotiables

**Commit as `n@navid.me`.** Never pass `-c user.email=`. The global config is
correct and the override is the bug.

**Threads is not Instagram.** Separate API, separate permissions, separate token
against its own host. An Instagram token does nothing here. One Meta app can
carry both use cases, but each product mints its own token.

**Writes are on by default.** `THREADS_READ_ONLY=1` removes the write tools from
the list rather than refusing at call time.

**`confirm: true` on publishing and deleting only.** Hiding a reply is one click
to undo and is not guarded. Confirming everything trains the reflex that makes
the confirmation on a delete worthless.

**A missing scope and an ungranted App Review look identical from a tool call.**
That is why `doctor` probes each capability and names which scope is absent
rather than leaving the caller to guess. Keep that true when adding tools.

**Do not imply it can read other people's posts.** Meta's API does not expose
them, so competitor research is not something this can do honestly.

## Before claiming it works

```bash
npm run build && npm test && npm run typecheck
npx @modelcontextprotocol/inspector node dist/index.js
```
