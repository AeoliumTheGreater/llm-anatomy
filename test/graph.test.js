import { test } from "node:test";
import assert from "node:assert/strict";

import { addNode } from "../src/graph.js";

// placeholder until graph operations are implemented
test("graph module loads", () => {
  assert.equal(typeof addNode, "function");
});
