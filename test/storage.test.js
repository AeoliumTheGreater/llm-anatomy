import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkingCopy } from "../src/graph.js";
import { exportGraph, importGraph, loadWorkingCopy, saveWorkingCopy, clearWorkingCopy } from "../src/storage.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

/** Builds an in-memory stand-in for localStorage. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const blocked = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

test("export followed by import returns the same graph", () => {
  const copy = makeWorkingCopy(QWEN3_5);
  const { graph, errors } = importGraph(exportGraph(copy));
  assert.deepEqual(errors, []);
  assert.deepEqual(graph, copy);
});

test("import reports broken JSON and schema problems with their location", () => {
  assert.match(importGraph("{ nope").errors[0], /^JSON: /);
  const broken = structuredClone(QWEN3_5);
  broken.nodes[0].type = "teleporter";
  assert.deepEqual(importGraph(JSON.stringify(broken)).errors, ['nodes[0].type: unknown block type "teleporter"']);
});

test("working copies save, load and clear", () => {
  const storage = memoryStorage();
  const copy = makeWorkingCopy(QWEN3_5);
  assert.equal(saveWorkingCopy(storage, "qwen3_5_0_8b", copy), true);
  assert.deepEqual(loadWorkingCopy(storage, "qwen3_5_0_8b"), copy);
  clearWorkingCopy(storage, "qwen3_5_0_8b");
  assert.equal(loadWorkingCopy(storage, "qwen3_5_0_8b"), null);
});

test("blocked or missing storage fails softly", () => {
  assert.equal(loadWorkingCopy(blocked, "x"), null);
  assert.equal(saveWorkingCopy(blocked, "x", {}), false);
  assert.equal(loadWorkingCopy(null, "x"), null);
  assert.equal(saveWorkingCopy(null, "x", {}), false);
});
