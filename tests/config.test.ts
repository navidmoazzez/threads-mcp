import { afterEach, describe, expect, it } from "vitest";
import { accountsFromJson, loadConfig, normalizeUsername, selectAccount, type Account } from "../src/config.js";

const KEYS = [
  "THREADS_ACCOUNTS",
  "THREADS_ACCESS_TOKEN",
  "THREADS_USER_ID",
  "THREADS_USERNAME",
  "THREADS_DEFAULT_ACCOUNT",
  "THREADS_READ_ONLY",
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

const account = (username: string, userId = "1"): Account => ({
  accessToken: "t",
  username,
  userId,
  source: "env",
});

describe("parsing THREADS_ACCOUNTS", () => {
  it("accepts snake_case and camelCase, because both get pasted around", () => {
    const parsed = accountsFromJson(
      JSON.stringify([
        { access_token: "a", user_id: "1", username: "@One" },
        { accessToken: "b", userId: 2, username: "two" },
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.username).toBe("one");
    expect(parsed[1]!.userId).toBe("2");
  });

  it("ignores malformed JSON rather than taking the server down", () => {
    expect(accountsFromJson("{not json")).toEqual([]);
  });

  it("drops entries with no token", () => {
    expect(accountsFromJson(JSON.stringify([{ username: "nope" }]))).toEqual([]);
  });
});

describe("choosing which profile acts", () => {
  it("prefers an exact match over a prefix", () => {
    // The whole reason exact wins: "navid" is a prefix of "navidmedia", so a
    // prefix-first search would post to the wrong profile.
    const config = loadConfig([account("navidmedia", "1"), account("navid", "2")]);
    expect(selectAccount(config, "navid").userId).toBe("2");
  });

  it("falls back to a prefix when nothing matches exactly", () => {
    const config = loadConfig([account("navidmedia", "1")]);
    expect(selectAccount(config, "navidm").userId).toBe("1");
  });

  it("honours THREADS_DEFAULT_ACCOUNT over declaration order", () => {
    process.env.THREADS_DEFAULT_ACCOUNT = "second";
    const config = loadConfig([account("first", "1"), account("second", "2")]);
    expect(selectAccount(config).userId).toBe("2");
  });

  it("falls through a default that is no longer connected", () => {
    process.env.THREADS_DEFAULT_ACCOUNT = "gone,second";
    const config = loadConfig([account("first", "1"), account("second", "2")]);
    expect(selectAccount(config).userId).toBe("2");
  });

  it("matches a numeric hint against the profile id", () => {
    const config = loadConfig([account("one", "111"), account("two", "222")]);
    expect(selectAccount(config, "222").username).toBe("two");
  });

  it("fails loudly and lists what is connected, rather than guessing", () => {
    const config = loadConfig([account("one"), account("two")]);
    expect(() => selectAccount(config, "three")).toThrow(/one, two/);
  });

  it("explains what to do when nothing is connected", () => {
    const config = loadConfig([]);
    expect(() => selectAccount(config)).toThrow(/threads-mcp login/);
  });
});

describe("credential priority", () => {
  it("lets an explicit environment token win over the store", () => {
    process.env.THREADS_ACCESS_TOKEN = "from-env";
    const config = loadConfig([{ accessToken: "from-store", source: "store" }]);
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0]!.accessToken).toBe("from-env");
  });

  it("uses the store when nothing is in the environment", () => {
    const config = loadConfig([{ accessToken: "from-store", source: "store" }]);
    expect(config.accounts[0]!.source).toBe("store");
  });
});

describe("normalizeUsername", () => {
  it("strips the @ and lowercases", () => {
    expect(normalizeUsername("  @TheNavidM ")).toBe("thenavidm");
  });
});
