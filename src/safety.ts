/**
 * Decides whether a write is allowed to reach Threads.
 *
 * The hazard is specific and worth naming. A Threads post is public the instant
 * it lands, and Threads has no edit endpoint: fixing a typo means deleting and
 * republishing, which loses the replies and the likes and spends one of the
 * hundred deletions the account gets each day. There is no unsend and no
 * revision. None of that is dangerous when a person meant it.
 *
 * So: everything works, and the operations that reach other people need an
 * explicit `confirm: true` the model has to set deliberately after reading a
 * description that says why. That is a speed bump a careless call trips over
 * and an intentional one clears in a single retry.
 *
 * Hiding a reply is not guarded. It is one call to undo and reversible from the
 * app, and a confirmation on every hide would train the model to pass `confirm`
 * reflexively, which is worse than not asking at all.
 *
 * THREADS_READ_ONLY=1 removes every write from the tool list entirely, for
 * pointing an agent at an account it should only ever read.
 */

import { appendFileSync } from "node:fs";
import type { Config } from "./config.js";
import { WriteBlockedError } from "./api/errors.js";

export type Risk =
  /** Reads public data, or your own. */
  | "read"
  /** Changes something reversible: hiding a reply, approving one. */
  | "write"
  /** Public the moment it runs, or cannot be undone. */
  | "destructive";

/** Which surface a guard is protecting, so refusals name the right syntax. */
export type Surface = "mcp" | "cli";

export class WriteGuard {
  private readonly config: Config;
  private readonly surface: Surface;

  constructor(config: Config, surface: Surface = "mcp") {
    this.config = config;
    this.surface = surface;
  }

  /** `--confirm` in a terminal, `confirm: true` in a tool call. */
  private get confirmFlag(): string {
    return this.surface === "cli" ? "--confirm" : "confirm: true";
  }

  get readOnly(): boolean {
    return this.config.readOnly;
  }

  check(tool: string, risk: Risk, confirm: boolean | undefined, summary: string): void {
    if (risk === "read") return;

    if (this.config.readOnly) {
      this.audit(tool, summary, "blocked: read-only");
      throw new WriteBlockedError(
        `${tool} is unavailable: this server is running with THREADS_READ_ONLY=1.`,
      );
    }

    if (risk === "destructive") {
      if (!this.config.allowDestructive) {
        this.audit(tool, summary, "blocked: destructive disabled");
        throw new WriteBlockedError(
          `${tool} is unavailable: this server is running with THREADS_ALLOW_DESTRUCTIVE=0.`,
        );
      }
      if (confirm !== true) {
        this.audit(tool, summary, "blocked: no confirm");
        throw new WriteBlockedError(
          `${tool} is public or irreversible, so it will not run without ${this.confirmFlag}. About to: ${summary}. Call again with ${this.confirmFlag} if that is what was asked for.`,
        );
      }
    }

    this.audit(tool, summary, "allowed");
  }

  /** Append-only record of every attempted write, when THREADS_AUDIT_LOG is set. */
  private audit(tool: string, summary: string, outcome: string): void {
    if (!this.config.auditPath) return;
    const line = JSON.stringify({ at: new Date().toISOString(), tool, summary, outcome });
    try {
      appendFileSync(this.config.auditPath, `${line}\n`, { mode: 0o600 });
    } catch {
      // A failing audit log must never take the tool call down with it.
    }
  }
}

/**
 * MCP annotations for a risk level.
 *
 * Clients use these to decide what to auto-approve, so they have to be honest.
 * `openWorldHint` is true for everything because every call leaves the machine,
 * and `idempotentHint` is false for a post because calling it twice posts twice.
 */
export function annotationsFor(
  risk: Risk,
  options: { idempotent?: boolean } = {},
): Record<string, boolean> {
  return {
    readOnlyHint: risk === "read",
    destructiveHint: risk === "destructive",
    idempotentHint: options.idempotent ?? risk === "read",
    openWorldHint: true,
  };
}
