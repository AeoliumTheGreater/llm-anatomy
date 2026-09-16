import { test } from "node:test";
import assert from "node:assert/strict";

import { INTERNALS, internalsFor } from "../src/internals.js";
import { BLOCK_TYPES } from "../src/catalogue.js";
import { resolveShape } from "../src/shapes.js";
import { PRESET as QWEN2_5 } from "../src/presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

const LINK = /\[[^\]]+\]\(https:\/\/[^)\s]+\)/;
const SYMBOLIC = new Set(["B", "T"]);

test("every block type has an internal graph", () => {
  for (const type of Object.keys(BLOCK_TYPES)) {
    assert.ok(INTERNALS[type], `no internals for ${type}`);
  }
});

test("every internal graph is joined up and sourced", () => {
  for (const [key, entry] of Object.entries(INTERNALS)) {
    const ids = new Set(entry.nodes.map((n) => n.id));
    assert.equal(ids.size, entry.nodes.length, `${key} has a repeated step id`);

    for (const [from, to] of entry.edges) {
      assert.ok(ids.has(from), `${key}: edge from unknown step "${from}"`);
      assert.ok(ids.has(to), `${key}: edge to unknown step "${to}"`);
    }

    // every step is joined to the chain, so nothing floats on its own
    const linked = new Set(entry.edges.flat());
    for (const node of entry.nodes) {
      if (entry.nodes.length > 1) assert.ok(linked.has(node.id), `${key}.${node.id} is not connected`);
      assert.match(node.description, LINK.test(node.description) ? LINK : /./, `${key}.${node.id}`);
      if (node.drill) assert.ok(INTERNALS[node.drill], `${key}.${node.id} opens missing "${node.drill}"`);
    }

    // at least one step of each graph cites a source
    assert.ok(entry.nodes.some((n) => LINK.test(n.description)), `${key} has no source link`);
  }
});

test("internal shapes resolve against the preset that uses them", () => {
  const node = QWEN3_5.nodes.find((n) => n.type === "gatedDeltaNet");
  for (const step of internalsFor("gatedDeltaNet", node.params).nodes) {
    if (!step.shape) continue;
    for (const dim of resolveShape(step.shape, node.params, QWEN3_5.globals)) {
      assert.ok(typeof dim === "number" || SYMBOLIC.has(dim), `unresolved ${dim} in ${step.id}`);
    }
  }
});

test("steps a model does not use are dropped, and the chain closes over the gap", () => {
  const qwen25 = QWEN2_5.nodes.find((n) => n.type === "attention");
  const qwen35 = QWEN3_5.nodes.find((n) => n.type === "attention");

  // Qwen2.5 has no QK-norm and no output gate
  const plain = internalsFor("attention", qwen25.params);
  const ids = plain.nodes.map((n) => n.id);
  assert.ok(!ids.includes("qkNorm"));
  assert.ok(!ids.includes("gate"));
  assert.ok(plain.edges.some(([from, to]) => from === "qProj" && to === "rope"), "the chain skips the missing step");
  assert.ok(plain.edges.some(([from, to]) => from === "weights" && to === "oProj"));

  // Qwen3.5 has both
  const gated = internalsFor("attention", qwen35.params).nodes.map((n) => n.id);
  assert.ok(gated.includes("qkNorm"));
  assert.ok(gated.includes("gate"));
});

test("a deeper level opens from the step that names it", () => {
  const deltaRule = INTERNALS.gatedDeltaNet.nodes.find((n) => n.id === "state");
  assert.equal(deltaRule.drill, "gatedDeltaNet.deltaRule");
  assert.equal(internalsFor("gatedDeltaNet.deltaRule", {}).nodes.length, 4);
  assert.equal(internalsFor("nothing.here", {}), null);
});
