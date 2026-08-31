/** Every tool, in the order they should appear in a client's tool list. */

import { ACCOUNT_TOOLS } from "./accounts.js";
import { POST_TOOLS } from "./posts.js";
import { REPLY_TOOLS } from "./replies.js";
import { READ_TOOLS } from "./read.js";
import { INSIGHT_TOOLS } from "./insights.js";
import { DISCOVER_TOOLS } from "./discover.js";
import type { AnyToolSpec } from "./kit.js";

export const ALL_TOOLS = [
  ...ACCOUNT_TOOLS,
  ...POST_TOOLS,
  ...REPLY_TOOLS,
  ...READ_TOOLS,
  ...INSIGHT_TOOLS,
  ...DISCOVER_TOOLS,
] as unknown as AnyToolSpec[];
