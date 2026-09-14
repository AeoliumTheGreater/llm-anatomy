import { test } from "node:test";
import assert from "node:assert/strict";

import { diffGraphs } from "../src/diff.js";
import { PRESET as QWEN2_5 } from "../src/presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

test("Qwen3-1.7B against Qwen3.5-0.8B reports Gated DeltaNet only in Qwen3.5-0.8B", () => {
  const { structural } = diffGraphs(QWEN3, QWEN3_5);
  const deltaNet = structural.filter((line) => line.startsWith("Gated DeltaNet"));
  assert.deepEqual(deltaNet, ["Gated DeltaNet: 18 layers in Qwen3.5-0.8B, none in Qwen3-1.7B"]);
  assert.ok(structural.includes("Grouped-query attention: 28 layers in Qwen3-1.7B, 6 in Qwen3.5-0.8B"));
});

test("the configuration table lists only differing values", () => {
  const { configRows } = diffGraphs(QWEN2_5, QWEN3);
  const labels = configRows.map((r) => r.label);
  assert.ok(labels.includes("Width d"));
  assert.ok(!labels.includes("Vocabulary V"));
  assert.deepEqual(configRows.find((r) => r.label === "Grouped-query attention: Query heads"), { label: "Grouped-query attention: Query heads", a: "14", b: "16" });
});

test("a graph compared with itself has no differences", () => {
  assert.deepEqual(diffGraphs(QWEN3_5, QWEN3_5), { configRows: [], structural: [] });
});
