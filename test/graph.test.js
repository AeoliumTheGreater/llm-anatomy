import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addNode, removeNode, connect, disconnect, updateNode, makeWorkingCopy, unconnectedInputs,
  validateGraph, createHistory, commit, undo, redo, uniqueNodeId, createNode,
} from "../src/graph.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";

const node = (id, type = "rmsNorm") => ({ id, type, params: { d: 8 }, position: { x: 0, y: 0 }, group: null });
const empty = () => ({ id: "g", name: "G", readOnly: false, globals: {}, nodes: [], edges: [], groups: [], sources: [] });

test("addNode adds a node and ignores an existing id", () => {
  const once = addNode(empty(), node("a"));
  assert.equal(once.nodes.length, 1);
  assert.equal(addNode(once, node("a")), once);
});

test("removeNode drops the node and its edges", () => {
  let g = addNode(addNode(empty(), node("a")), node("b"));
  g = connect(g, { node: "a", port: "y" }, { node: "b", port: "x" });
  const after = removeNode(g, "a");
  assert.deepEqual(after.nodes.map((n) => n.id), ["b"]);
  assert.equal(after.edges.length, 0);
});

test("connect adds an edge once; adding it again changes nothing", () => {
  const g = addNode(addNode(empty(), node("a")), node("b"));
  const once = connect(g, { node: "a", port: "y" }, { node: "b", port: "x" });
  const twice = connect(once, { node: "a", port: "y" }, { node: "b", port: "x" });
  assert.equal(once.edges.length, 1);
  assert.equal(twice, once);
});

test("connect replaces the edge already feeding an input port", () => {
  let g = [node("a"), node("b"), node("c")].reduce(addNode, empty());
  g = connect(g, { node: "a", port: "y" }, { node: "c", port: "x" });
  g = connect(g, { node: "b", port: "y" }, { node: "c", port: "x" });
  assert.deepEqual(g.edges, [{ from: { node: "b", port: "y" }, to: { node: "c", port: "x" } }]);
});

test("disconnect removes only the named edge", () => {
  const first = QWEN3.edges[0];
  const g = disconnect(QWEN3, first.from, first.to);
  assert.equal(g.edges.length, QWEN3.edges.length - 1);
});

test("updateNode merges params and does not mutate the input", () => {
  const g = updateNode(QWEN3, "layer.mlp", { params: { dff: 100 } });
  assert.equal(g.nodes.find((n) => n.id === "layer.mlp").params.dff, 100);
  assert.equal(QWEN3.nodes.find((n) => n.id === "layer.mlp").params.dff, 6144);
});

test("uniqueNodeId skips ids in use", () => {
  const g = addNode(empty(), node("rmsNorm1"));
  assert.equal(uniqueNodeId(g, "rmsNorm"), "rmsNorm2");
});

test("createNode takes sizes from the graph globals and other values from the catalogue", () => {
  const created = createNode(QWEN3, "swiglu", { x: 20, y: 40 });
  assert.deepEqual(created, { id: "swiglu1", type: "swiglu", params: { d: 2048, dff: 6144 }, position: { x: 20, y: 40 }, group: null });
  assert.equal(createNode(QWEN3, "sampling", { x: 0, y: 0 }).params.temperature, 1);
});

test("makeWorkingCopy names the copy and makes it editable", () => {
  const copy = makeWorkingCopy(QWEN3);
  assert.equal(copy.name, "Qwen3-1.7B (edited)");
  assert.equal(copy.readOnly, false);
  assert.equal(copy.basePreset, "qwen3_1_7b");
  assert.notEqual(copy.nodes, QWEN3.nodes);
});

test("unconnectedInputs flags a missing input but not the external token input", () => {
  assert.deepEqual(unconnectedInputs(QWEN3), []);
  const edge = QWEN3.edges.find((e) => e.to.node === "layer.mlp");
  const g = disconnect(QWEN3, edge.from, edge.to);
  assert.deepEqual(unconnectedInputs(g), [{ node: "layer.mlp", port: "x" }]);
});

test("validateGraph names the problem and where it is", () => {
  const bad = { ...empty(), nodes: [{ ...node("a"), type: "nope" }, { ...node("b"), params: { d: -1 } }] };
  bad.edges = [{ from: { node: "b", port: "zz" }, to: { node: "missing", port: "x" } }];
  const errors = validateGraph(bad);
  assert.ok(errors.includes('nodes[0].type: unknown block type "nope"'));
  assert.ok(errors.includes("nodes[1].params.d: expected a positive integer"));
  assert.ok(errors.some((e) => e.startsWith("edges[0].from.port")));
  assert.ok(errors.includes('edges[0].to.node: unknown node "missing"'));
});

test("history undoes and redoes edits and ignores unchanged graphs", () => {
  const a = empty();
  const b = addNode(a, node("x"));
  let h = commit(createHistory(a), b);
  assert.equal(commit(h, b), h);
  h = undo(h);
  assert.equal(h.present, a);
  h = redo(h);
  assert.equal(h.present, b);
  assert.equal(redo(h), h);
});
