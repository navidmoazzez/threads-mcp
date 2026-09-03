import { afterEach, describe, expect, it } from "vitest";
import { numericFlag } from "../src/config.js";
import { httpOptionsFromEnv } from "../src/transport/http.js";
import { loginOptionsFrom } from "../src/auth/login.js";

afterEach(() => {
  delete process.env.THREADS_HTTP_PORT;
  delete process.env.THREADS_HTTP_HOST;
});

describe("numericFlag", () => {
  it("reads the equals form", () => {
    expect(numericFlag(["--port=9001"], "port", 8787)).toBe(9001);
  });

  // The regression this file exists for: only the equals form parsed, so
  // `--port 9001` silently bound the default and looked like a broken flag.
  it("reads the space form", () => {
    expect(numericFlag(["--port", "9001"], "port", 8787)).toBe(9001);
  });

  it("falls back when the flag is absent", () => {
    expect(numericFlag(["--http"], "port", 8787)).toBe(8787);
  });

  it("falls back rather than binding NaN on a typo", () => {
    expect(numericFlag(["--port", "eight"], "port", 8787)).toBe(8787);
    expect(numericFlag(["--port=0"], "port", 8787)).toBe(8787);
    expect(numericFlag(["--port=-1"], "port", 8787)).toBe(8787);
  });

  it("falls back when the space form has nothing after it", () => {
    expect(numericFlag(["--port"], "port", 8787)).toBe(8787);
  });

  it("does not match a flag that merely starts the same way", () => {
    expect(numericFlag(["--portable=1"], "port", 8787)).toBe(8787);
  });
});

describe("httpOptionsFromEnv", () => {
  it("takes either spelling of --port", () => {
    expect(httpOptionsFromEnv(["--http", "--port=9001"]).port).toBe(9001);
    expect(httpOptionsFromEnv(["--http", "--port", "9001"]).port).toBe(9001);
  });

  it("defaults to 8787 with no flag and no env", () => {
    expect(httpOptionsFromEnv(["--http"]).port).toBe(8787);
  });

  it("reads THREADS_HTTP_PORT, and the flag beats it", () => {
    process.env.THREADS_HTTP_PORT = "7000";
    expect(httpOptionsFromEnv(["--http"]).port).toBe(7000);
    expect(httpOptionsFromEnv(["--http", "--port", "9001"]).port).toBe(9001);
  });

  // There is no --host flag: binding a public interface should take a
  // deliberate environment variable, not a word typed next to --http.
  it("takes the host from the environment only, defaulting to loopback", () => {
    expect(httpOptionsFromEnv(["--http", "--host", "0.0.0.0"]).host).toBe("127.0.0.1");
    process.env.THREADS_HTTP_HOST = "0.0.0.0";
    expect(httpOptionsFromEnv(["--http"]).host).toBe("0.0.0.0");
  });
});

describe("loginOptionsFrom", () => {
  it("takes either spelling of --port", () => {
    expect(loginOptionsFrom(["--port=9000"]).port).toBe(9000);
    expect(loginOptionsFrom(["--port", "9000"]).port).toBe(9000);
  });

  it("defaults to 8788", () => {
    expect(loginOptionsFrom([]).port).toBe(8788);
    expect(loginOptionsFrom(["--manual"]).port).toBe(8788);
  });

  it("still reads the other flags", () => {
    expect(loginOptionsFrom(["--manual"]).manual).toBe(true);
    expect(loginOptionsFrom(["--port", "9000", "--all-scopes"]).scopes.length).toBeGreaterThan(
      loginOptionsFrom([]).scopes.length,
    );
  });
});
