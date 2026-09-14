import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveShape, checkConnection, formatShape } from "../src/shapes.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";

const graph = {
  id: "g", name: "G", readOnly: false, globals: { d: 2048, V: 10 }, groups: [], sources: [], edges: [],
  nodes: [
    { id: "attn", type: "attention", params: { d: 1024, queryHeads: 8, kvHeads: 2, headDim: 128, qkNorm: true, bias: false, outputGate: false, ropeTheta: 1e6, rotaryFraction: 1 }, position: { x: 0, y: 0 }, group: null },
    { id: "mlp", type: "swiglu", params: { d: 2048, dff: 4 }, position: { x: 0, y: 0 }, group: null },
    { id: "head", type: "lmHead", params: { d: 2048, V: 10, tied: true }, position: { x: 0, y: 0 }, group: null },
    { id: "sample", type: "sampling", params: { temperature: 1, topP: 1 }, position: { x: 0, y: 0 }, group: null },
  ],
};

test("resolveShape uses node params before globals and keeps B and T symbolic", () => {
  assert.deepEqual(resolveShape(["B", "T", "d"], { d: 1024 }, { d: 2048 }), ["B", "T", 1024]);
  assert.deepEqual(resolveShape(["B", "T", "V"], {}, { V: 151936 }), ["B", "T", 151936]);
  assert.deepEqual(resolveShape(["B", "T", "unknown"], {}, {}), ["B", "T", "unknown"]);
  assert.equal(formatShape(["B", "T", 2048]), "[B, T, 2048]");
});

test("checkConnection accepts matching shapes", () => {
  for (const edge of QWEN3.edges) {
    assert.deepEqual(checkConnection(QWEN3, edge.from, edge.to), { ok: true, message: null });
  }
});

test("checkConnection names both shapes when they differ", () => {
  const result = checkConnection(graph, { node: "attn", port: "y" }, { node: "mlp", port: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.message, "Grouped-query attention output [B, T, 1024] does not match SwiGLU MLP input [B, T, 2048]");
});

test("checkConnection resolves V from globals for the sampling input", () => {
  assert.equal(checkConnection(graph, { node: "head", port: "logits" }, { node: "sample", port: "logits" }).ok, true);
  assert.equal(checkConnection(graph, { node: "head", port: "logits" }, { node: "mlp", port: "x" }).ok, false);
});

test("checkConnection rejects self-connections and wrong port directions", () => {
  assert.equal(checkConnection(graph, { node: "mlp", port: "y" }, { node: "mlp", port: "x" }).ok, false);
  assert.equal(checkConnection(graph, { node: "mlp", port: "x" }, { node: "attn", port: "x" }).ok, false);
});
