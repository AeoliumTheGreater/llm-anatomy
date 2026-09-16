import { sameEndpoint } from "../graph.js";
import { portPoint } from "./canvas.js";
import { svg } from "./dom.js";
import { sampleCubic, seedFrom, sketchArrowHead, sketchPolyline } from "./sketch.js";

const cache = new Map();
const CACHE_LIMIT = 4000;

/** Builds a curved path from an output port to an input port, leaving along each port's normal. */
export function edgeCurve(from, to) {
  const reach = Math.max(70, Math.hypot(to.x - from.x, to.y - from.y) / 2.2);
  const c0 = [from.x + from.nx * reach, from.y + from.ny * reach];
  const c1 = [to.x + to.nx * reach, to.y + to.ny * reach];
  return { points: sampleCubic([from.x, from.y], c0, c1, [to.x, to.y]), c0, c1 };
}

/** Builds the plain path used for pointer hits. */
export function edgePath(from, to) {
  const { c0, c1 } = edgeCurve(from, to);
  return `M ${from.x} ${from.y} C ${c0[0]} ${c0[1]}, ${c1[0]} ${c1[1]}, ${to.x} ${to.y}`;
}

/** Names a curve by its ends, so the same arrow keeps the same wobble. */
function curveKey(from, to) {
  return `${Math.round(from.x)},${Math.round(from.y)},${from.nx},${from.ny}-${Math.round(to.x)},${Math.round(to.y)},${to.nx},${to.ny}`;
}

/** Returns the hand-drawn line and arrowhead for a curve, reusing earlier work. */
function sketchFor(key, points) {
  const cached = cache.get(key);
  if (cached) return cached;
  const seed = seedFrom(key);
  const drawn = { line: sketchPolyline(points, seed), head: sketchArrowHead(points, seed) };
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, drawn);
  return drawn;
}

/** Draws every connection as an arrow; edges of a collapsed group meet at the group box. */
export function renderEdges(layer, { graph, layout, selection, invalid }) {
  layer.replaceChildren();
  const drawn = new Set();

  graph.edges.forEach((edge, index) => {
    // skips edges inside a collapsed group and duplicates that meet at its box
    const from = portPoint(layout, edge.from, "outputs");
    const to = portPoint(layout, edge.to, "inputs");
    if (!from || !to) return;
    if (from.hiddenIn && from.hiddenIn === to.hiddenIn) return;
    const key = curveKey(from, to);
    if (drawn.has(key)) return;
    drawn.add(key);

    // draws the arrow, plus a wide transparent path for pointer hits
    const { points } = edgeCurve(from, to);
    const { line, head } = sketchFor(key, points);
    const grouped = Boolean(from.hiddenIn || to.hiddenIn);
    const selected = selection?.kind === "edge" && sameEndpoint(selection.from, edge.from) && sameEndpoint(selection.to, edge.to);
    const g = svg("g", {
      class: ["edge", grouped && "is-grouped", selected && "is-selected", invalid.has(index) && "is-invalid"].filter(Boolean).join(" "),
      "data-edge-index": index,
    }, layer);
    if (!grouped) svg("path", { class: "edge-hit", d: edgePath(from, to), "data-edge": index }, g);
    svg("path", { class: "edge-line", d: line }, g);
    svg("path", { class: "edge-head", d: head }, g);
  });
}

/** Redraws only the arrows touching one block, which is all a drag can move. */
export function updateEdgesFor(layer, { graph, layout }, nodeId) {
  graph.edges.forEach((edge, index) => {
    if (edge.from.node !== nodeId && edge.to.node !== nodeId) return;
    const g = layer.querySelector(`[data-edge-index="${index}"]`);
    const from = portPoint(layout, edge.from, "outputs");
    const to = portPoint(layout, edge.to, "inputs");
    if (!g || !from || !to) return;
    const { points } = edgeCurve(from, to);
    const { line, head } = sketchFor(curveKey(from, to), points);
    g.querySelector(".edge-line")?.setAttribute("d", line);
    g.querySelector(".edge-head")?.setAttribute("d", head);
    g.querySelector(".edge-hit")?.setAttribute("d", edgePath(from, to));
  });
}

/** Draws the connection being dragged, or clears it when either end is missing. */
export function renderPendingEdge(layer, from, to) {
  layer.replaceChildren();
  if (!from || !to) return;
  const target = { x: to.x, y: to.y, nx: -from.nx, ny: -from.ny };
  const { points } = edgeCurve(from, target);
  svg("path", { class: "edge-pending", d: sketchPolyline(points, 7) }, layer);
}
