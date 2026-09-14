// the residual stream runs down the left column and each sub-layer's branch down the right
export const STREAM_X = 0;
export const BRANCH_X = 240;
export const LAYER_HEIGHT = 480;

/** Builds one pre-norm decoder layer: norm, mixer, add, norm, SwiGLU MLP, add. */
export function decoderLayer({ prefix, group, mixer, d, dff, top, input }) {
  const id = (name) => `${prefix}.${name}`;
  const mixerId = id(mixer.id);

  // lays the blocks out top to bottom
  const nodes = [
    makeNode(id("norm1"), "rmsNorm", { d }, BRANCH_X, top, group),
    makeNode(mixerId, mixer.type, mixer.params, BRANCH_X, top + 80, group),
    makeNode(id("add1"), "residualAdd", { d }, STREAM_X, top + 160, group),
    makeNode(id("norm2"), "rmsNorm", { d }, BRANCH_X, top + 240, group),
    makeNode(id("mlp"), "swiglu", { d, dff }, BRANCH_X, top + 320, group),
    makeNode(id("add2"), "residualAdd", { d }, STREAM_X, top + 400, group),
  ];

  // wires the two branches and their residual skips
  const edges = [
    makeEdge(input, id("norm1"), "x"),
    makeEdge(input, id("add1"), "a"),
    makeEdge({ node: id("norm1"), port: "y" }, mixerId, "x"),
    makeEdge({ node: mixerId, port: "y" }, id("add1"), "b"),
    makeEdge({ node: id("add1"), port: "y" }, id("norm2"), "x"),
    makeEdge({ node: id("add1"), port: "y" }, id("add2"), "a"),
    makeEdge({ node: id("norm2"), port: "y" }, id("mlp"), "x"),
    makeEdge({ node: id("mlp"), port: "y" }, id("add2"), "b"),
  ];

  return { nodes, edges, output: { node: id("add2"), port: "y" } };
}

/** Builds the embedding at the top of a decoder-only model. */
export function inputBlocks({ V, d }) {
  const nodes = [makeNode("embed", "embedding", { V, d, tied: true }, STREAM_X, 0, null)];
  return { nodes, output: { node: "embed", port: "x" } };
}

/** Builds the final norm, output layer and sampling below the last layer. */
export function outputBlocks({ V, d, top, input }) {
  const nodes = [
    makeNode("finalNorm", "rmsNorm", { d }, STREAM_X, top, null),
    makeNode("lmHead", "lmHead", { d, V, tied: true }, STREAM_X, top + 80, null),
    makeNode("sampling", "sampling", { temperature: 1, topP: 1 }, STREAM_X, top + 160, null),
  ];
  const edges = [
    makeEdge(input, "finalNorm", "x"),
    makeEdge({ node: "finalNorm", port: "y" }, "lmHead", "x"),
    makeEdge({ node: "lmHead", port: "logits" }, "sampling", "logits"),
  ];
  return { nodes, edges };
}

/** Builds a node record. */
function makeNode(id, type, params, x, y, group) {
  return { id, type, params, position: { x, y }, group };
}

/** Builds an edge record from an endpoint to a node's input port. */
function makeEdge(from, node, port) {
  return { from, to: { node, port } };
}
