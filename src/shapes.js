import { BLOCK_TYPES } from "./catalogue.js";

/** Replaces shape symbols with values from node params, then graph globals. */
export function resolveShape(shape, params, globals) {
  return shape.map((dim) => {
    if (typeof dim === "number") return dim;
    return params?.[dim] ?? globals?.[dim] ?? dim;
  });
}

/** Formats a shape as text, e.g. [B, T, 2048]. */
export function formatShape(shape) {
  return `[${shape.join(", ")}]`;
}

/** Returns true when two resolved shapes have the same dimensions. */
export function shapesMatch(a, b) {
  return a.length === b.length && a.every((dim, i) => dim === b[i]);
}

/** Returns the resolved shape of a node's port, or null if the port does not exist. */
export function portShape(graph, nodeId, portId, direction) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const port = BLOCK_TYPES[node?.type]?.[direction]?.find((p) => p.id === portId);
  if (!port) return null;
  return resolveShape(port.shape, node.params, graph.globals);
}

/** Checks that an output port fits an input port and names both shapes if not. */
export function checkConnection(graph, from, to) {
  // rejects missing ports and self-connections
  const outputShape = portShape(graph, from.node, from.port, "outputs");
  const inputShape = portShape(graph, to.node, to.port, "inputs");
  if (!outputShape || !inputShape) {
    return { ok: false, message: "Connections run from an output port to an input port." };
  }
  if (from.node === to.node) {
    return { ok: false, message: "A block cannot connect to itself." };
  }

  // compares the resolved shapes
  if (shapesMatch(outputShape, inputShape)) return { ok: true, message: null };
  const fromName = blockName(graph, from.node);
  const toName = blockName(graph, to.node);
  return {
    ok: false,
    message: `${fromName} output ${formatShape(outputShape)} does not match ${toName} input ${formatShape(inputShape)}`,
  };
}

/** Returns the catalogue name of a node's block type. */
function blockName(graph, nodeId) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return BLOCK_TYPES[node.type].name;
}
