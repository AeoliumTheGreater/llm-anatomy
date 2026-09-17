// the residual stream is the straight line along y = 0; each layer hangs above it
const STREAM_Y = 0;
const BAND_Y = -120;
const EMBED_X = 0;
const FIRST_LAYER_X = 300;
const LAYER_WIDTH = 1400;
const OUTPUT_GAP = 60;
const OUTPUT_STEP = 300;

/** Builds the pre-norm decoder layer at a position along the stream: two sub-layers, each adding back. */
export function decoderLayer({ prefix, group, mixer, d, dff, index, input }) {
  const id = (name) => `${prefix}.${name}`;
  const mixerId = id(mixer.id);
  const left = FIRST_LAYER_X + index * LAYER_WIDTH;

  // the adders sit on the stream; everything they read from sits in the band above it
  const nodes = [
    makeNode(id("norm1"), "rmsNorm", { d }, left, BAND_Y, group),
    makeNode(mixerId, mixer.type, mixer.params, left + 300, BAND_Y, group),
    makeNode(id("add1"), "residualAdd", { d }, left + 600, STREAM_Y, group),
    makeNode(id("norm2"), "rmsNorm", { d }, left + 700, BAND_Y, group),
    makeNode(id("mlp"), "swiglu", { d, dff }, left + 1000, BAND_Y, group),
    makeNode(id("add2"), "residualAdd", { d }, left + 1300, STREAM_Y, group),
  ];

  // each sub-layer reads the stream, and its output is added back at the adder
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

/** Builds the embedding at the start of the stream. */
export function inputBlocks({ V, d }) {
  const nodes = [makeNode("embed", "embedding", { V, d, tied: true }, EMBED_X, STREAM_Y, null)];
  return { nodes, output: { node: "embed", port: "x" } };
}

/** Builds the final norm, output layer and sampling at the end of the stream. */
export function outputBlocks({ V, d, layerCount, input }) {
  const left = FIRST_LAYER_X + layerCount * LAYER_WIDTH + OUTPUT_GAP;
  const nodes = [
    makeNode("finalNorm", "rmsNorm", { d }, left, STREAM_Y, null),
    makeNode("lmHead", "lmHead", { d, V, tied: true }, left + OUTPUT_STEP, STREAM_Y, null),
    makeNode("sampling", "sampling", { temperature: 1, topP: 1 }, left + 2 * OUTPUT_STEP, STREAM_Y, null),
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
