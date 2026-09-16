import { test } from "node:test";
import assert from "node:assert/strict";

import { BLOCK_TYPES } from "../src/catalogue.js";
import { validateGraph, unconnectedInputs } from "../src/graph.js";
import { checkConnection } from "../src/shapes.js";
import { PRESET as QWEN2_5 } from "../src/presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

const PRESETS = [QWEN2_5, QWEN3, QWEN3_5];
const LINK = /\[[^\]]+\]\(https:\/\/[^)\s]+\)/;
const MIXERS = new Set(["attention", "gatedDeltaNet"]);
const SPINE = new Set(["embedding", "residualAdd", "lmHead", "sampling"]);

for (const preset of PRESETS) {
  test(`${preset.name} validates, is read-only and has every input connected`, () => {
    assert.deepEqual(validateGraph(preset), []);
    assert.equal(preset.readOnly, true);
    assert.deepEqual(unconnectedInputs(preset), []);
  });

  test(`${preset.name} edges all pass the shape check`, () => {
    for (const edge of preset.edges) assert.equal(checkConnection(preset, edge.from, edge.to).ok, true);
  });

  test(`${preset.name} repeats its group to the configured layer count`, () => {
    const [group] = preset.groups;
    const mixers = preset.nodes.filter((n) => n.group === group.id && MIXERS.has(n.type));
    assert.equal(mixers.length * group.repeat, preset.globals.layers);
  });

  test(`${preset.name} runs left to right along one residual stream`, () => {
    // everything that reads and writes the stream sits on the same line
    for (const node of preset.nodes.filter((n) => SPINE.has(n.type))) {
      assert.equal(node.position.y, 0, `${node.id} is off the stream`);
    }

    // each branch leaves the stream, and the mixer branch is above the MLP branch
    const mixer = preset.nodes.find((n) => MIXERS.has(n.type));
    const mlp = preset.nodes.find((n) => n.type === "swiglu");
    assert.ok(mixer.position.y < 0, "the mixer branch is above the stream");
    assert.ok(mlp.position.y > 0, "the MLP branch is below the stream");

    // the model reads from left to right
    const embed = preset.nodes.find((n) => n.type === "embedding");
    const sampling = preset.nodes.find((n) => n.type === "sampling");
    assert.ok(embed.position.x < mixer.position.x);
    assert.ok(mixer.position.x < sampling.position.x);
  });
}

test("Qwen3.5-0.8B runs three Gated DeltaNet layers before each attention layer", () => {
  const order = QWEN3_5.nodes
    .filter((n) => MIXERS.has(n.type))
    .sort((a, b) => a.position.x - b.position.x)
    .map((n) => n.type);
  assert.deepEqual(order, ["gatedDeltaNet", "gatedDeltaNet", "gatedDeltaNet", "attention"]);
});

test("every catalogue entry links its description to https sources", () => {
  for (const [id, type] of Object.entries(BLOCK_TYPES)) {
    assert.match(type.description, LINK, `${id} description`);
    assert.ok(type.sources.length > 0, `${id} sources`);
    for (const s of type.sources) assert.ok(s.url.startsWith("https://"), `${id} source ${s.url}`);
  }
});

test("every catalogue default is a valid parameter value", () => {
  const nodes = Object.entries(BLOCK_TYPES).map(([type, spec]) => ({
    id: type,
    type,
    params: Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p.default])),
    position: { x: 0, y: 0 },
    group: null,
  }));
  const graph = { id: "g", name: "G", readOnly: false, globals: {}, nodes, edges: [], groups: [], sources: [] };
  assert.deepEqual(validateGraph(graph), []);
});
