/**
 * `threads-mcp login`: the whole OAuth flow, on the command line.
 *
 * Threads is not a platform where you can paste a credential and be done. You
 * need a Meta app, and the token that app's Graph Explorer hands out is
 * short-lived, so the usual "paste a token into the config" route produces
 * something that stops working in an hour. That is why so many Threads
 * integrations are described as flaky: they are not flaky, they were set up
 * with the wrong kind of token.
 *
 * This command does the sequence properly: opens the authorisation URL, catches
 * the redirect on a loopback listener, exchanges the code, exchanges the
 * short-lived token for a 60-day one, verifies it against `GET /me`, and writes
 * it to a store the server can refresh on its own afterwards.
 *
 * The loopback redirect binds 127.0.0.1 on a port you choose, and the same URL
 * has to be listed as a valid redirect URI in the app's settings. That is the
 * one manual step nothing can remove.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { loadConfig, normalizeUsername, type Account } from "../config.js";
import { exchangeForLongLived, expiryFrom } from "./tokens.js";
import { upsertToken } from "./store.js";
import { ThreadsClient } from "../api/client.js";

const AUTH_HOST = "https://threads.net";

/** Every scope this server can use. Anything not granted simply stays unused. */
export const ALL_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_replies",
  "threads_read_replies",
  "threads_manage_insights",
  "threads_delete",
  "threads_keyword_search",
  "threads_profile_discovery",
  "threads_location_tagging",
];

/** The subset that needs nothing from App Review while you are a tester. */
export const CORE_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_replies",
  "threads_read_replies",
  "threads_manage_insights",
  "threads_delete",
];

export function authorizeUrl(appId: string, redirectUri: string, scopes: string[]): string {
  const url = new URL(`${AUTH_HOST}/oauth/authorize`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

function open(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  } catch {
    // No browser is fine. The URL is printed either way.
  }
}

/** Wait for Meta to redirect back with `?code=`. Resolves with the code. */
function awaitCode(port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>threads-mcp</title>` +
          `<body style="font:16px system-ui;padding:3rem;max-width:34rem">` +
          (code
            ? `<h1>Authorised</h1><p>You can close this tab and go back to the terminal.</p>`
            : `<h1>Authorisation failed</h1><p>${error ?? "No code was returned."}</p>`) +
          `</body>`,
      );

      server.close();
      clearTimeout(timer);
      if (code) resolve(code);
      else reject(new Error(error ?? "Threads returned no authorisation code."));
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`No redirect arrived within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not listen on 127.0.0.1:${port}: ${error.message}. Pass --port to use another one, and add the matching redirect URI to the app.`,
        ),
      );
    });

    // Only loopback. This listener briefly holds an authorisation code.
    server.listen(port, "127.0.0.1");
  });
}

/** Exchange the authorisation code for a short-lived token. */
async function exchangeCode(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
  graphHost: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${graphHost}/oauth/access_token`, { method: "POST", body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Code exchange failed (${res.status}): ${text.slice(0, 300)}`);

  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) throw new Error("Code exchange returned no access_token.");
  return parsed.access_token;
}

export type LoginOptions = {
  port: number;
  scopes: string[];
  /** Skip the browser and take a short-lived token pasted in by hand. */
  manual: boolean;
};

export function loginOptionsFrom(argv: string[]): LoginOptions {
  const portFlag = argv.find((a) => a.startsWith("--port="));
  const port = Number(portFlag?.split("=")[1] ?? 8788);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8788,
    scopes: argv.includes("--all-scopes") ? ALL_SCOPES : CORE_SCOPES,
    manual: argv.includes("--manual"),
  };
}

export async function runLogin(argv: string[] = []): Promise<number> {
  const options = loginOptionsFrom(argv);
  const config = loadConfig();
  const out = (line: string) => process.stdout.write(`${line}\n`);

  if (!config.appId || !config.appSecret) {
    out("threads-mcp login needs a Meta app.");
    out("");
    out("  1. Create one at developers.facebook.com, add the Threads use case,");
    out("     and copy the Threads App ID and App Secret from its settings.");
    out(`  2. Add http://127.0.0.1:${options.port}/callback as a valid`);
    out("     OAuth redirect URI on that app.");
    out("  3. Export both and run this again:");
    out("");
    out("       export THREADS_APP_ID=...");
    out("       export THREADS_APP_SECRET=...");
    out("       threads-mcp login");
    out("");
    return 1;
  }

  const redirectUri = `http://127.0.0.1:${options.port}/callback`;
  const url = authorizeUrl(config.appId, redirectUri, options.scopes);

  let shortLived: string;

  if (options.manual) {
    out("Open this URL, authorise, then paste the short-lived token:");
    out("");
    out(`  ${url}`);
    out("");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    shortLived = (await rl.question("Short-lived token: ")).trim();
    rl.close();
    if (!shortLived) {
      out("Nothing pasted.");
      return 1;
    }
  } else {
    out(`Redirect URI: ${redirectUri}`);
    out(`Scopes:       ${options.scopes.join(", ")}`);
    out("");
    out("Opening the authorisation page. If nothing opens, use this URL:");
    out("");
    out(`  ${url}`);
    out("");
    out("Waiting for the redirect…");

    const waiting = awaitCode(options.port, 300_000);
    open(url);
    const code = await waiting;

    out("Got the code. Exchanging it…");
    shortLived = await exchangeCode(config.appId, config.appSecret, redirectUri, code, config.graphHost);
  }

  out("Exchanging for a 60-day token…");
  const longLived = await exchangeForLongLived(shortLived, config.appSecret, config.graphHost);
  const expiresAt = expiryFrom(longLived);

  // Verify before storing. A token that cannot read /me is not worth keeping,
  // and finding that out now is better than on the first tool call.
  const account: Account = { accessToken: longLived.access_token, source: "store" };
  const client = new ThreadsClient({ ...config, accounts: [account] });
  const profile = await client.profile(account);

  upsertToken(config.storePath, {
    user_id: profile.id,
    username: profile.username ? normalizeUsername(profile.username) : undefined,
    access_token: longLived.access_token,
    expires_at: expiresAt,
    obtained_at: Date.now(),
    scopes: options.scopes,
  });

  const days = expiresAt ? Math.round((expiresAt - Date.now()) / 86_400_000) : 60;

  out("");
  out(`Authorised as @${profile.username ?? profile.id} (${profile.id}).`);
  out(`Token valid for ${days} days, saved to ${config.storePath}`);
  out("");
  out("The server refreshes it automatically while it is running. If nothing runs");
  out("for 60 days the token expires for good, so run `threads-mcp refresh` if you");
  out("are going away, or just leave the MCP client connected.");
  out("");
  out("Check everything with: threads-mcp doctor");
  return 0;
}
