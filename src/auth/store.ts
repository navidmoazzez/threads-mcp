/**
 * Where tokens live between runs.
 *
 * A Threads long-lived token is valid for 60 days and can be refreshed for
 * another 60 at any point after it is 24 hours old. Miss that window and it is
 * gone permanently: there is no grace period and no way to refresh an expired
 * one. The whole point of writing tokens to a file the server owns is that the
 * server can then refresh them on its own, which an environment variable pasted
 * into a client config can never do.
 *
 * The file is written 0600, and the directory 0700, because it holds
 * credentials that can post as you. Writes go to a temporary file in the same
 * directory and are then renamed, so a crash mid-write leaves the previous
 * tokens intact rather than a truncated file that locks you out.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Account } from "../config.js";
import { normalizeUsername } from "../config.js";

export type StoredToken = {
  user_id: string;
  username?: string;
  access_token: string;
  /** Unix ms. */
  expires_at?: number;
  /** Unix ms this token was last minted or refreshed. */
  obtained_at?: number;
  scopes?: string[];
};

export type TokenFile = {
  version: 1;
  accounts: StoredToken[];
};

const EMPTY: TokenFile = { version: 1, accounts: [] };

export function readStore(path: string): TokenFile {
  if (!existsSync(path)) return { ...EMPTY, accounts: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY, accounts: [] };
    const accounts = (parsed as TokenFile).accounts;
    if (!Array.isArray(accounts)) return { ...EMPTY, accounts: [] };
    return {
      version: 1,
      accounts: accounts.filter(
        (a): a is StoredToken => Boolean(a && typeof a.access_token === "string" && typeof a.user_id === "string"),
      ),
    };
  } catch {
    // A corrupt store must not take the server down. It behaves as empty, and
    // `doctor` reports it, because silently overwriting someone's only working
    // token would be worse than refusing to read it.
    process.stderr.write(`[threads-mcp] Token store at ${path} is unreadable. Ignoring it.\n`);
    return { ...EMPTY, accounts: [] };
  }
}

export function writeStore(path: string, file: TokenFile): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = join(dir, `.tokens.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing useful to do; the rename failure is the real error.
    }
    throw error;
  }
}

/** Insert or replace one profile's token, keyed by profile id. */
export function upsertToken(path: string, token: StoredToken): void {
  const file = readStore(path);
  const rest = file.accounts.filter((a) => a.user_id !== token.user_id);
  writeStore(path, { version: 1, accounts: [...rest, token] });
}

export function removeToken(path: string, userIdOrUsername: string): boolean {
  const file = readStore(path);
  const needle = normalizeUsername(userIdOrUsername);
  const kept = file.accounts.filter(
    (a) => a.user_id !== needle && normalizeUsername(a.username ?? "") !== needle,
  );
  if (kept.length === file.accounts.length) return false;
  writeStore(path, { version: 1, accounts: kept });
  return true;
}

/** The stored tokens, as accounts the rest of the server understands. */
export function accountsFromStore(path: string): Account[] {
  return readStore(path).accounts.map((a) => ({
    accessToken: a.access_token,
    userId: a.user_id,
    username: a.username ? normalizeUsername(a.username) : undefined,
    expiresAt: a.expires_at,
    source: "store" as const,
  }));
}
