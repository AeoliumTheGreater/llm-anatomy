// the residual stream runs left to right along y = 0; each layer taps it, then writes back
const SPINE_Y = 0;
const BRANCH_UP_Y = -170;
const BRANCH_DOWN_Y = 170;
const FIRST_LAYER_X = 340;
const LAYER_WIDTH = 1360;
const OUTPUT_GAP = 140;
const OUTPUT_STEP = 300;

/** Builds the pre-norm decoder layer at a position along the stream: norm, mixer, add, norm, SwiGLU MLP, add. */
export function decoderLayer({ prefix, group, mixer, d, dff, index, input }) {
  const id = (name) => `${prefix}.${name}`;
  const mixerId = id(mixer.id);
  const left = FIRST_LAYER_X + index * LAYER_WIDTH;

  // the mixer branch sits above the stream and the MLP branch below it
  const nodes = [
    makeNode(id("norm1"), "rmsNorm", { d }, left + 60, BRANCH_UP_Y, group),
    makeNode(mixerId, mixer.type, mixer.params, left + 340, BRANCH_UP_Y, group),
    makeNode(id("add1"), "residualAdd", { d }, left + 620, SPINE_Y, group),
    makeNode(id("norm2"), "rmsNorm", { d }, left + 700, BRANCH_DOWN_Y, group),
    makeNode(id("mlp"), "swiglu", { d, dff }, left + 980, BRANCH_DOWN_Y, group),
    makeNode(id("add2"), "residualAdd", { d }, left + 1260, SPINE_Y, group),
  ];

  // wires each branch and the residual skip that passes it
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

/** Builds the embedding at the start of a decoder-only model. */
export function inputBlocks({ V, d }) {
  const nodes = [makeNode("embed", "embedding", { V, d, tied: true }, 0, SPINE_Y, null)];
  return { nodes, output: { node: "embed", port: "x" } };
}

/** Builds the final norm, output layer and sampling after the given number of layers. */
export function outputBlocks({ V, d, layerCount, input }) {
  const left = FIRST_LAYER_X + layerCount * LAYER_WIDTH + OUTPUT_GAP;
  const nodes = [
    makeNode("finalNorm", "rmsNorm", { d }, left, SPINE_Y, null),
    makeNode("lmHead", "lmHead", { d, V, tied: true }, left + OUTPUT_STEP, SPINE_Y, null),
    makeNode("sampling", "sampling", { temperature: 1, topP: 1 }, left + 2 * OUTPUT_STEP, SPINE_Y, null),
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
