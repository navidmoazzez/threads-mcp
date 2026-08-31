/**
 * HTTP transport, for running the server somewhere always on.
 *
 * Streamable HTTP, stateless: every request builds its own transport and tears
 * it down. No session map means no session leak, which matters more here than
 * the reconnect support a stateful server would buy.
 *
 * There is a second reason to run this way for Threads specifically. A token
 * only stays alive if something refreshes it inside its 60-day window, and an
 * MCP server launched over stdio only exists while a client has it open. A
 * long-running HTTP instance refreshes on its own and never lets the window
 * close.
 *
 * Bound to 127.0.0.1 by default. A Threads token can post as you, so a server
 * that binds 0.0.0.0 without being asked is a mistake waiting to be made once;
 * THREADS_HTTP_HOST is there for people who mean it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BuiltServer } from "../server.js";
import { daysRemaining } from "../auth/tokens.js";

export type HttpOptions = {
  port: number;
  host: string;
  /** When set, every request must send `Authorization: Bearer <token>`. */
  token?: string;
};

export function httpOptionsFromEnv(argv: string[] = []): HttpOptions {
  const flag = argv.find((a) => a.startsWith("--port="));
  const port = Number(flag?.split("=")[1] ?? process.env.THREADS_HTTP_PORT ?? 8787);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host: process.env.THREADS_HTTP_HOST || "127.0.0.1",
    token: process.env.THREADS_HTTP_TOKEN || undefined,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Constant-time-ish comparison, so the token cannot be guessed byte by byte. */
function tokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

async function handle(
  built: BuiltServer,
  options: HttpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Health needs no auth: it reports counts, never content.
  if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        tools: built.toolCount,
        accounts: built.config.accounts.length,
        read_only: built.config.readOnly,
        tokens: built.config.accounts.map((a) => ({
          username: a.username ?? null,
          days_left: daysRemaining(a) ?? null,
        })),
      }),
    );
    return;
  }

  if (options.token) {
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!provided || !tokenMatches(options.token, provided)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => void transport.close());
  await built.server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}

export async function startHttpServer(
  built: BuiltServer,
  options: HttpOptions,
): Promise<{ close: () => Promise<void> }> {
  const http = createServer((req, res) => {
    void handle(built, options, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: (error as Error)?.message ?? "internal error" },
          id: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve) => http.listen(options.port, options.host, resolve));

  process.stderr.write(
    `[threads-mcp] HTTP on http://${options.host}:${options.port} (${built.toolCount} tools, ${built.config.accounts.length} account(s))${
      options.token ? "" : "\n[threads-mcp] No THREADS_HTTP_TOKEN set: this endpoint is unauthenticated."
    }\n`,
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
      }),
  };
}
