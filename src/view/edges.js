import { sameEndpoint } from "../graph.js";
import { portPoint } from "./canvas.js";
import { svg } from "./dom.js";

// connections run in straight horizontal and vertical segments through the gaps between blocks
const TAP = 16;
const TURN_GAP = 24;
const LANE_RISE = 44;
const CORNER = 8;
const HEAD = 8;
const LABEL_MIN = 140;
const PORT_GAP = 4;

/** Returns true when an axis-aligned segment runs through the inside of a box. */
function hits([x1, y1], [x2, y2], box) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return right > box.x + 1 && left < box.x + box.w - 1 && bottom > box.y + 1 && top < box.y + box.h - 1;
}

/** Returns true when any segment of a route runs through a box. */
function blocked(points, obstacles) {
  for (let i = 1; i < points.length; i += 1) {
    for (const box of obstacles) if (hits(points[i - 1], points[i], box)) return true;
  }
  return false;
}

/** Drops repeated points and points in the middle of a straight run. */
function tidy(points) {
  const out = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const before = out.at(-2);
      const sameX = before[0] === last[0] && last[0] === p[0];
      const sameY = before[1] === last[1] && last[1] === p[1];
      if (sameX || sameY) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Routes a connection with right angles: straight when it can, around blocks when it must. */
export function routeEdge(from, to, obstacles = []) {
  const start = [from.x, from.y];
  const end = [to.x, to.y];
  const tapX = from.x + TAP * (from.nx || 1);

  // a skip leaves the line at a tap, runs in a lane beside the blocks, and drops into the adder
  if (to.ny !== 0) {
    const lane = to.y + to.ny * LANE_RISE;
    return tidy([start, [tapX, from.y], [tapX, lane], [to.x, lane], end]);
  }

  // blocks on one row facing each other get a straight line
  if (Math.abs(from.y - to.y) < 0.5 && to.x > from.x) {
    const direct = [start, end];
    if (!blocked(direct, obstacles)) return direct;
  } else if (to.x - TURN_GAP > from.x) {
    // blocks on different rows turn in the gap just before the target
    const turnX = to.x - TURN_GAP;
    const bend = tidy([start, [turnX, from.y], [turnX, to.y], end]);
    if (!blocked(bend, obstacles)) return bend;
  }

  // anything else goes over the blocks in its way
  const lo = Math.min(from.x, to.x) - TURN_GAP;
  const hi = Math.max(from.x, to.x) + TURN_GAP;
  const inWay = obstacles.filter((b) => b.x + b.w > lo && b.x < hi);
  const ceiling = Math.min(from.y, to.y, ...inWay.map((b) => b.y)) - LANE_RISE;
  const inX = to.x - TURN_GAP;
  return tidy([start, [tapX, from.y], [tapX, ceiling], [inX, ceiling], [inX, to.y], end]);
}

/** Turns a route into an SVG path with small rounded corners. */
export function roundedPath(points, radius = CORNER) {
  const r1 = (v) => Math.round(v * 10) / 10;
  let d = `M ${r1(points[0][0])} ${r1(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const inLength = Math.hypot(x - px, y - py);
    const outLength = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const ax = x - ((x - px) / inLength) * r;
    const ay = y - ((y - py) / inLength) * r;
    const bx = x + ((nx - x) / outLength) * r;
    const by = y + ((ny - y) / outLength) * r;
    d += ` L ${r1(ax)} ${r1(ay)} Q ${r1(x)} ${r1(y)} ${r1(bx)} ${r1(by)}`;
  }
  const last = points.at(-1);
  return `${d} L ${r1(last[0])} ${r1(last[1])}`;
}

/** Draws a filled arrowhead at the end of a route. */
export function arrowHead(points, size = HEAD) {
  const [tx, ty] = points.at(-1);
  const [bx, by] = points.at(-2);
  const length = Math.hypot(tx - bx, ty - by) || 1;
  const ux = (tx - bx) / length;
  const uy = (ty - by) / length;
  const baseX = tx - ux * size;
  const baseY = ty - uy * size;
  const half = size * 0.55;
  return `M ${tx} ${ty} L ${baseX - uy * half} ${baseY + ux * half} L ${baseX + uy * half} ${baseY - ux * half} Z`;
}

/** Lists the boxes a connection must not pass through. */
export function obstaclesFor(layout) {
  const boxes = [];
  for (const item of layout.nodes.values()) {
    if (!item.hiddenBy) boxes.push({ x: item.x, y: item.y, w: item.w, h: item.h, node: item.node.id });
  }
  for (const box of layout.groups) {
    if (box.collapsed) boxes.push({ x: box.x, y: box.y, w: box.w, h: box.h, group: box.group.id });
  }
  return boxes;
}

/** Routes one edge, ignoring the boxes at its own two ends. */
function routeOne(edge, layout, obstacles) {
  const from = portPoint(layout, edge.from, "outputs");
  const to = portPoint(layout, edge.to, "inputs");
  if (!from || !to) return null;
  if (from.hiddenIn && from.hiddenIn === to.hiddenIn) return null;
  const others = obstacles.filter((b) =>
    b.node !== edge.from.node && b.node !== edge.to.node
    && !(b.group && (b.group === from.hiddenIn || b.group === to.hiddenIn)));
  return { from, to, points: routeEdge(from, to, others), grouped: Boolean(from.hiddenIn || to.hiddenIn) };
}

/** Routes every edge once; edges that would draw the same line are drawn once. */
export function routesFor(graph, layout, obstacles = obstaclesFor(layout)) {
  const routes = [];
  const seen = new Set();
  graph.edges.forEach((edge, index) => {
    const route = routeOne(edge, layout, obstacles);
    if (!route) return;
    const key = route.points.join(";");
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ ...route, index, edge });
  });
  return routes;
}

/** Pulls the end of a route back so the arrowhead meets the edge of the port dot. */
function trimEnd(points, by) {
  const [tx, ty] = points.at(-1);
  const [bx, by0] = points.at(-2);
  const length = Math.hypot(tx - bx, ty - by0);
  if (length <= by) return points;
  const t = (length - by) / length;
  return [...points.slice(0, -1), [bx + (tx - bx) * t, by0 + (ty - by0) * t]];
}

/** Draws the parts of one route into its group. */
function drawRoute(g, route, fanOut) {
  const { to, from, grouped, index } = route;
  const points = trimEnd(route.points, PORT_GAP);
  const d = roundedPath(points);
  if (!grouped) svg("path", { class: "edge-hit", d, "data-edge": index }, g);
  svg("path", { class: "edge-line", d }, g);
  svg("path", { class: "edge-head", d: arrowHead(points) }, g);

  // marks where a skip leaves the stream, and names it
  if (to.ny === 0 || points.length < 5) return;
  if (fanOut.get(`${from.x},${from.y}`) > 1) {
    svg("circle", { class: "edge-junction", cx: points[1][0], cy: points[1][1], r: 3.5 }, g);
  }
  const [laneStart, laneEnd] = [points[2], points[3]];
  if (Math.abs(laneEnd[0] - laneStart[0]) >= LABEL_MIN) {
    svg("text", {
      class: "edge-label", x: (laneStart[0] + laneEnd[0]) / 2, y: laneStart[1] - 7, "text-anchor": "middle",
    }, g).textContent = "skip: x unchanged";
  }
}

/** Counts how many drawn routes leave each output point. */
function countFanOut(routes) {
  const fanOut = new Map();
  for (const { from } of routes) {
    const key = `${from.x},${from.y}`;
    fanOut.set(key, (fanOut.get(key) ?? 0) + 1);
  }
  return fanOut;
}

/** Draws every connection as a right-angled arrow. */
export function renderEdges(layer, { graph, layout, selection, invalid }) {
  layer.replaceChildren();
  const routes = routesFor(graph, layout);
  const fanOut = countFanOut(routes);
  for (const route of routes) {
    const { edge, index, grouped } = route;
    const selected = selection?.kind === "edge" && sameEndpoint(selection.from, edge.from) && sameEndpoint(selection.to, edge.to);
    const g = svg("g", {
      class: ["edge", grouped && "is-grouped", selected && "is-selected", invalid.has(index) && "is-invalid"].filter(Boolean).join(" "),
      "data-edge-index": index,
    }, layer);
    drawRoute(g, route, fanOut);
  }
}

/** Redraws only the arrows touching one block, which is all a drag can move. */
export function updateEdgesFor(layer, { graph, layout }, nodeId) {
  const obstacles = obstaclesFor(layout);
  const touched = graph.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.from.node === nodeId || edge.to.node === nodeId);
  const fanOut = new Map();
  for (const { edge, index } of touched) {
    const g = layer.querySelector(`[data-edge-index="${index}"]`);
    const route = g && routeOne(edge, layout, obstacles);
    if (!route) continue;
    g.replaceChildren();
    drawRoute(g, { ...route, index }, fanOut);
  }
}

/** Draws the connection being dragged, or clears it when either end is missing. */
export function renderPendingEdge(layer, from, to) {
  layer.replaceChildren();
  if (!from || !to) return;
  svg("path", { class: "edge-pending", d: `M ${from.x} ${from.y} L ${to.x} ${to.y}` }, layer);
}
