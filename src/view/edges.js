import { sameEndpoint } from "../graph.js";
import { portPoint } from "./canvas.js";
import { svg } from "./dom.js";

/** Builds a curved SVG path from an output port down to an input port. */
export function edgePath(from, to) {
  const bend = Math.max(40, Math.abs(to.y - from.y) / 2);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`;
}

/** Draws every connection; edges into a collapsed group meet at the group box. */
export function renderEdges(layer, { graph, layout, selection, invalid }) {
  layer.replaceChildren();
  const drawn = new Set();

  graph.edges.forEach((edge, index) => {
    // skips edges inside a collapsed group and duplicates that meet at its box
    const from = portPoint(layout, edge.from, "outputs");
    const to = portPoint(layout, edge.to, "inputs");
    if (!from || !to) return;
    if (from.hiddenIn && from.hiddenIn === to.hiddenIn) return;
    const d = edgePath(from, to);
    if (drawn.has(d)) return;
    drawn.add(d);

    // draws the visible line and a wider transparent path for pointer hits
    const grouped = Boolean(from.hiddenIn || to.hiddenIn);
    const selected = selection?.kind === "edge" && sameEndpoint(selection.from, edge.from) && sameEndpoint(selection.to, edge.to);
    const g = svg("g", {
      class: ["edge", grouped && "is-grouped", selected && "is-selected", invalid.has(index) && "is-invalid"].filter(Boolean).join(" "),
    }, layer);
    if (!grouped) svg("path", { class: "edge-hit", d, "data-edge": index }, g);
    svg("path", { class: "edge-line", d }, g);
  });
}

/** Draws the connection being dragged, or clears it when either end is missing. */
export function renderPendingEdge(layer, from, to) {
  layer.replaceChildren();
  if (from && to) svg("path", { class: "edge-pending", d: edgePath(from, to) }, layer);
}
