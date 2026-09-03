#!/usr/bin/env node
/**
 * Entry point.
 *
 * `threads-mcp`             stdio, which is what MCP clients launch
 * `threads-mcp login`       run OAuth and store a 60-day token
 * `threads-mcp refresh`     extend every stored token now
 * `threads-mcp doctor`      check the setup and say what is wrong
 * `threads-mcp --http`      HTTP, for running it somewhere always on
 *
 * `threads-cli`             the same tools as shell commands
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { loadConfig } from "./config.js";
import { accountsFromStore } from "./auth/store.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";
import { daysRemaining } from "./auth/tokens.js";
import { runCli, isCliCommand } from "./cli.js";

const HELP = `threads-mcp ${VERSION}

  threads-mcp                     Run over stdio. This is what an MCP client launches.
  threads-mcp login               Authorise a Threads profile and store a 60-day token.
  threads-mcp refresh             Extend every stored token by another 60 days.
  threads-mcp doctor              Check the setup and report what is wrong.
  threads-mcp --http [--port=N]   Run over HTTP, for a machine that is always on.
  threads-mcp --version           Print the version.

  threads-cli                     List every tool as a shell command.
  threads-cli <command> --help    What one command takes.
  threads-cli schema <command>    The JSON schema an MCP client sees.

Credentials, in priority order:
  THREADS_ACCOUNTS          JSON array, for several profiles at once:
                            [{"access_token":"THQ...","username":"you"}]
  THREADS_ACCESS_TOKEN      a long-lived token for one profile
  THREADS_USER_ID           numeric profile id. Resolved from the token when absent
  THREADS_USERNAME          username, for matching and display. Also resolved
  the token store           written by \`login\`, and the only source this
                            server can keep refreshed on its own

For \`login\` only:
  THREADS_APP_ID            Threads app id from developers.facebook.com
  THREADS_APP_SECRET        Threads app secret

Options:
  THREADS_DEFAULT_ACCOUNT           which username acts when a tool names none
  THREADS_READ_ONLY=1               hide every write from the tool list
  THREADS_ALLOW_DESTRUCTIVE=0       keep writes, block posting and deleting
  THREADS_TOKEN_STORE               where tokens are kept, default ~/.threads-mcp/tokens.json
  THREADS_PERSIST_TOKENS=0          stop writing refreshed tokens back to the store
  THREADS_REFRESH_WINDOW_DAYS       refresh this many days before expiry, default 20
  THREADS_CONTAINER_TIMEOUT_MS      how long to wait for media, default 120000
  THREADS_REQUEST_TIMEOUT_MS        per-request deadline, default 30000
  THREADS_MIN_REQUEST_INTERVAL_MS   spacing between requests, default 120
  THREADS_MAX_RETRIES               retries on 5xx and quota codes, default 3
  THREADS_AUDIT_LOG                 append-only log of every attempted write
  THREADS_GRAPH_HOST                override the Graph host, default graph.threads.net
  THREADS_USER_AGENT                override the User-Agent sent to Meta
  THREADS_HTTP_PORT / _HOST / _TOKEN  for --http

https://github.com/thenavidm/threads-mcp-cli
`;

/**
 * One entry point, two programs. `threads-mcp` is the server and must stay
 * silent on stdout; `threads-cli` is the one a person types. Running the CLI
 * binary with no arguments is someone asking what they can type, so it lists
 * the commands rather than hanging on a transport that will never speak.
 */
function invokedAsCli(): boolean {
  const name = (process.argv[1] ?? "").split("/").pop() ?? "";
  return name.startsWith("threads-cli");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (invokedAsCli() && argv.length === 0) {
    process.exitCode = await runCli(["tools"]);
    return;
  }

  // Checked before --help and --version so `<tool> --help` reaches the tool.
  // A bare `--help` starts with a dash, so it falls through to the block below.
  if (isCliCommand(argv)) {
    process.exitCode = await runCli(argv);
    return;
  }

  // An unknown word used to fall through and start the server, which then sat
  // waiting on stdin: a typo looked like a hang, and scripts saw exit code 0.
  //
  // `doctor`, `login` and `refresh` belong to the entry point rather than the
  // tool list, and they are the first things someone types when nothing works.
  // Rejecting them as unknown commands sent them to the server binary to
  // diagnose the CLI.
  const ENTRY_COMMANDS = new Set(["doctor", "login", "refresh", "help"]);

  if (
    invokedAsCli() &&
    command !== undefined &&
    !command.startsWith("-") &&
    !ENTRY_COMMANDS.has(command)
  ) {
    process.stderr.write(
      `${JSON.stringify({ error: `Unknown command '${command}'. Run \`threads-cli\` to list them.` }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "login") {
    const { runLogin } = await import("./auth/login.js");
    process.exitCode = await runLogin(argv.slice(1));
    return;
  }
  if (command === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
    return;
  }
  if (command === "refresh") {
    const { runRefresh } = await import("./doctor.js");
    process.exitCode = await runRefresh();
    return;
  }

  // The store is read here rather than inside loadConfig so that the config
  // module stays free of filesystem access and remains trivially testable.
  const stored = accountsFromStore(loadConfig().storePath);
  const config = loadConfig(stored);
  const built = buildServer(config);

  // Warn, never block. A network check at startup would delay the handshake,
  // and the failure is more actionable on the tool call that hits it.
  if (config.accounts.length === 0) {
    process.stderr.write(
      "[threads-mcp] No credentials configured. Every tool will report the missing setup. Run `threads-mcp login`.\n",
    );
  } else {
    const soon = config.accounts.filter((a) => {
      const days = daysRemaining(a);
      return days !== undefined && days <= 7;
    });
    if (soon.length) {
      process.stderr.write(
        `[threads-mcp] ${soon.length} token(s) expire within a week and will be refreshed automatically on the next call. An expired Threads token cannot be recovered.\n`,
      );
    }
  }

  const shutdown = async (close?: () => Promise<void>): Promise<void> => {
    if (close) await close().catch(() => undefined);
    process.exit(0);
  };

  if (argv.includes("--http")) {
    const { close } = await startHttpServer(built, httpOptionsFromEnv(argv));
    process.on("SIGTERM", () => void shutdown(close));
    process.on("SIGINT", () => void shutdown(close));
    return;
  }

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // Handled so `docker stop` and a client shutting down return promptly rather
  // than waiting out a grace period.
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[threads-mcp] ${(error as Error).message}\n`);
  process.exit(1);
});
