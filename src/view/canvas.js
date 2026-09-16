import { BLOCK_TYPES } from "../catalogue.js";
import { internalsFor } from "../internals.js";
import { countBlockParams, formatCount } from "../params.js";
import { formatShape, portShape, resolveShape } from "../shapes.js";
import { categoryClass, svg } from "./dom.js";
import { seedFrom, sketchCircle, sketchRect } from "./sketch.js";

export const NODE_W = 216;
export const NODE_H = 52;
export const ADD_SIZE = 52;
export const GRID = 20;
const GROUP_PAD = 28;
const GROUP_HEADER = 34;
const COLLAPSED_W = 300;
const COLLAPSED_H = 104;
const STEP_W = 230;
const STEP_H = 60;
const STEP_GAP_X = 92;
const STEP_GAP_Y = 34;
const LEAVE_MS = 300;

const shapeCache = new Map();

/** Returns a hand-drawn box path, drawing each size only once. */
function boxPath(key, w, h) {
  const id = `${key}:${w}x${h}`;
  if (!shapeCache.has(id)) shapeCache.set(id, sketchRect(w, h, seedFrom(id)));
  return shapeCache.get(id);
}

/** Returns a hand-drawn circle path, drawing each size only once. */
function circlePath(key, r) {
  const id = `${key}:o${r}`;
  if (!shapeCache.has(id)) shapeCache.set(id, sketchCircle(r, r, r, seedFrom(id)));
  return shapeCache.get(id);
}

/** Returns the size of a block on the canvas. */
function sizeOf(node) {
  return node.type === "residualAdd" ? { w: ADD_SIZE, h: ADD_SIZE } : { w: NODE_W, h: NODE_H };
}

/** Computes where every node, group and port sits along the left-to-right stream. */
export function layoutGraph(graph, { collapsed, drag }) {
  // measures each group around its members
  const groups = [];
  for (const group of graph.groups) {
    const members = graph.nodes.filter((n) => n.group === group.id);
    if (members.length === 0) continue;
    const left = Math.min(...members.map((n) => n.position.x)) - GROUP_PAD;
    const right = Math.max(...members.map((n) => n.position.x + sizeOf(n).w)) + GROUP_PAD;
    const top = Math.min(...members.map((n) => n.position.y)) - GROUP_PAD - GROUP_HEADER;
    const bottom = Math.max(...members.map((n) => n.position.y + sizeOf(n).h)) + GROUP_PAD;
    const isCollapsed = collapsed.get(group.id) ?? group.collapsed;
    groups.push({
      group, members, collapsed: isCollapsed,
      storedX: left, fullW: right - left, y: top + (bottom - top - COLLAPSED_H) / 2, x: left,
      w: isCollapsed ? COLLAPSED_W : right - left,
      h: isCollapsed ? COLLAPSED_H : bottom - top,
    });
    if (!isCollapsed) groups.at(-1).y = top;
  }
  groups.sort((a, b) => a.storedX - b.storedX);

  // pulls everything after a collapsed group back by the width it saves
  const offsetAt = (x) => groups.reduce(
    (sum, box) => (box.collapsed && x >= box.storedX + box.fullW - GROUP_PAD ? sum + box.fullW - COLLAPSED_W : sum),
    0,
  );
  const toStoredX = (displayX) => {
    let x = displayX;
    for (let i = 0; i <= groups.length; i += 1) x = displayX + offsetAt(x);
    return x;
  };
  for (const box of groups) box.x = box.storedX - offsetAt(box.storedX);

  // places each node and notes the collapsed group that hides it
  const hiddenBy = new Map();
  for (const box of groups) {
    if (box.collapsed) for (const member of box.members) hiddenBy.set(member.id, box);
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    const position = drag?.id === node.id ? drag.position : node.position;
    nodes.set(node.id, {
      node, ...sizeOf(node),
      x: position.x - offsetAt(node.position.x), y: position.y,
      hiddenBy: hiddenBy.get(node.id) ?? null,
    });
  }

  // decides which side of an adder its branch arrives on
  const branchSide = new Map();
  for (const node of graph.nodes) {
    if (node.type !== "residualAdd") continue;
    const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === "b");
    const source = edge && nodes.get(edge.from.node);
    const item = nodes.get(node.id);
    branchSide.set(node.id, source && source.y + source.h / 2 > item.y + item.h / 2 ? "bottom" : "top");
  }

  return { nodes, groups, branchSide, toStoredX };
}

/** Lays out an internal graph left to right, one column per step in the chain. */
export function layoutInternals(entry, params, globals) {
  const byId = new Map(entry.nodes.map((n) => [n.id, n]));
  const incoming = new Map(entry.nodes.map((n) => [n.id, []]));
  for (const [from, to] of entry.edges) incoming.get(to)?.push(from);

  // a step sits one column after the latest step feeding it
  const depth = new Map();
  const depthOf = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const value = incoming.get(id).length === 0 ? 0 : Math.max(...incoming.get(id).map((from) => depthOf(from, seen) + 1));
    depth.set(id, value);
    return value;
  };
  for (const node of entry.nodes) depthOf(node.id);

  // stacks the steps that share a column
  const columns = new Map();
  for (const node of entry.nodes) {
    const column = depth.get(node.id);
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  }
  const nodes = new Map();
  for (const [column, members] of columns) {
    const height = members.length * STEP_H + (members.length - 1) * STEP_GAP_Y;
    members.forEach((step, row) => {
      nodes.set(step.id, {
        node: { id: step.id, type: null },
        step,
        internal: true,
        shape: step.shape ? resolveShape(step.shape, params, globals) : null,
        x: column * (STEP_W + STEP_GAP_X),
        y: row * (STEP_H + STEP_GAP_Y) - height / 2,
        w: STEP_W,
        h: STEP_H,
        hiddenBy: null,
      });
    });
  }

  const edges = entry.edges
    .filter(([from, to]) => byId.has(from) && byId.has(to))
    .map(([from, to]) => ({ from: { node: from, port: "out" }, to: { node: to, port: "in" } }));
  return { nodes, groups: [], branchSide: new Map(), toStoredX: (x) => x, edges };
}

/** Returns the canvas point and outward direction of a port. */
export function portPoint(layout, endpoint, direction) {
  const item = layout.nodes.get(endpoint.node);
  if (!item) return null;

  // internal steps have one port on each side
  if (item.internal) {
    const out = direction === "outputs";
    return { x: item.x + (out ? item.w : 0), y: item.y + item.h / 2, nx: out ? 1 : -1, ny: 0, hiddenIn: null };
  }

  // a hidden node's edges meet the box of the group that hides it
  if (item.hiddenBy) {
    const box = item.hiddenBy;
    const out = direction === "outputs";
    return { x: box.x + (out ? box.w : 0), y: box.y + box.h / 2, nx: out ? 1 : -1, ny: 0, hiddenIn: box.group.id };
  }

  // the branch input of an adder comes in from above or below
  if (item.node.type === "residualAdd" && endpoint.port === "b") {
    const bottom = layout.branchSide.get(item.node.id) === "bottom";
    return { x: item.x + item.w / 2, y: item.y + (bottom ? item.h : 0), nx: 0, ny: bottom ? 1 : -1, hiddenIn: null };
  }

  const ports = BLOCK_TYPES[item.node.type][direction].filter((p) => !(item.node.type === "residualAdd" && p.id === "b"));
  const index = ports.findIndex((p) => p.id === endpoint.port);
  if (index < 0) return null;
  const out = direction === "outputs";
  return {
    x: item.x + (out ? item.w : 0),
    y: item.y + (item.h * (index + 1)) / (ports.length + 1),
    nx: out ? 1 : -1,
    ny: 0,
    hiddenIn: null,
  };
}

/** Returns the bounds of everything visible. */
function boundsOf(layout) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x, y, w, h) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const item of layout.nodes.values()) if (!item.hiddenBy) extend(item.x, item.y, item.w, item.h);
  for (const box of layout.groups) extend(box.x, box.y, box.w, box.h);
  return { minX, minY, maxX, maxY };
}

/** The view a diagram opens at: full size, starting at the left of the stream. */
export function homeView(layout, width, height) {
  const { minX, minY, maxX, maxY } = boundsOf(layout);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, scale: 1 };
  const margin = 40;
  const spanY = maxY - minY;
  return {
    scale: 1,
    x: margin - minX,
    y: spanY > height - 2 * margin ? margin - minY : (height - spanY) / 2 - minY,
  };
}

/** Computes the pan and zoom that fit every visible node and group into the given size. */
export function fitToView(layout, width, height) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x, y, w, h) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const item of layout.nodes.values()) if (!item.hiddenBy) extend(item.x, item.y, item.w, item.h);
  for (const box of layout.groups) extend(box.x, box.y, box.w, box.h);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, scale: 1 };

  // Fit shows the whole shape of a model, however long the strip is
  const margin = 40;
  const scale = Math.min(1.4, Math.max(0.05, Math.min(
    (width - 2 * margin) / (maxX - minX),
    (height - 2 * margin) / (maxY - minY),
  )));
  const spanX = (maxX - minX) * scale;
  const spanY = (maxY - minY) * scale;
  return {
    scale,
    x: spanX > width - 2 * margin ? margin - minX * scale : (width - spanX) / 2 - minX * scale,
    y: spanY > height - 2 * margin ? margin - minY * scale : (height - spanY) / 2 - minY * scale,
  };
}

/** Creates the canvas layers once and returns them. */
function ensureLayers(root) {
  let viewport = root.querySelector(".viewport");
  if (!viewport) {
    viewport = svg("g", { class: "viewport" }, root);
    for (const name of ["groups", "edges", "nodes", "leaving", "overlay"]) svg("g", { class: `layer-${name}` }, viewport);
  }
  const layer = (name) => viewport.querySelector(`.layer-${name}`);
  return {
    viewport, groups: layer("groups"), edges: layer("edges"), nodes: layer("nodes"),
    leaving: layer("leaving"), overlay: layer("overlay"),
  };
}

/** Draws the model graph: group frames, blocks and the stream label. */
export function renderCanvas(root, model) {
  const layers = ensureLayers(root);
  drawGroupFrames(layers.groups, model);
  drawStreamLabel(layers.groups, model);
  drawItems(layers, model, buildItems(model));
  return layers;
}

/** Draws an internal graph, one box per step. */
export function renderInternals(root, model) {
  const layers = ensureLayers(root);
  layers.groups.replaceChildren();
  layers.leaving.replaceChildren();
  drawItems(layers, model, [...model.layout.nodes.values()].map((item) => ({ key: `step:${item.node.id}`, item, kind: "step" })));
  return layers;
}

/** Moves the dragged node and refreshes group frames without rebuilding the other nodes. */
export function renderDrag(root, model) {
  const layers = ensureLayers(root);
  drawGroupFrames(layers.groups, model);
  drawStreamLabel(layers.groups, model);
  const item = model.layout.nodes.get(model.dragId);
  const el = layers.nodes.querySelector(`[data-key="${CSS.escape(`node:${model.dragId}`)}"]`);
  if (item && el) {
    el.style.transform = `translate(${item.x}px, ${item.y}px)`;
    el.classList.add("is-dragging");
  }
  return layers;
}

/** Names the residual stream once, under its first stretch. */
function drawStreamLabel(layer, { graph, layout }) {
  const embed = layout.nodes.get("embed");
  if (!embed || embed.hiddenBy) return;
  const d = graph.globals?.d ?? BLOCK_TYPES.embedding.params.d.default;
  const label = svg("text", { class: "stream-label", x: embed.x + embed.w + 24, y: embed.y + embed.h / 2 + 26 }, layer);
  label.textContent = `residual stream [B, T, ${d}]`;
}

/** Lists what the nodes layer should contain, top-level blocks and collapsed groups alike. */
function buildItems({ layout }) {
  return [
    ...[...layout.nodes.values()].filter((item) => !item.hiddenBy).map((item) => ({ key: `node:${item.node.id}`, item, kind: "node" })),
    ...layout.groups.filter((box) => box.collapsed).map((box) => ({ key: `group:${box.group.id}`, item: box, kind: "group" })),
  ].sort((a, b) => a.item.x - b.item.x || a.item.y - b.item.y);
}

/** Draws the frames of expanded groups behind their blocks. */
function drawGroupFrames(layer, { layout, selection }) {
  layer.replaceChildren();
  for (const box of layout.groups) {
    if (box.collapsed) continue;
    const { group } = box;
    const selected = selection?.kind === "group" && selection.id === group.id;
    const g = svg("g", { class: `group-frame-wrap${selected ? " is-selected" : ""}`, transform: `translate(${box.x} ${box.y})` }, layer);
    svg("path", { class: "group-frame", d: boxPath(`frame:${group.id}`, box.w, box.h) }, g);

    const header = svg("g", {
      class: "group-header", tabindex: 0, role: "button",
      "data-key": `group:${group.id}`, "data-group": group.id,
      "aria-label": `${group.label}, repeated ${group.repeat} times, expanded`,
    }, g);
    svg("rect", { width: box.w - 60, height: 28, x: 10, y: 3, rx: 4 }, header);
    svg("text", { class: "group-label", x: 20, y: 23 }, header).textContent = `${group.label} · repeated ${group.repeat} times`;
    drawGroupToggle(g, box, false);
  }
}

/** Draws the expand or collapse button of a group. */
function drawGroupToggle(parent, box, collapsed) {
  const { group } = box;
  const toggle = svg("g", {
    class: "group-toggle", tabindex: 0, role: "button",
    "data-action": "toggle-group", "data-group": group.id,
    "aria-expanded": String(!collapsed),
    "aria-label": `${collapsed ? "Expand" : "Collapse"} ${group.label}`,
    transform: `translate(${box.w - 40} 8)`,
  }, parent);
  svg("rect", { class: "node-hit", width: 26, height: 26, rx: 5 }, toggle);
  svg("path", { d: boxPath(`toggle:${group.id}:${collapsed}`, 26, 26) }, toggle);
  svg("text", { x: 13, y: 19, "text-anchor": "middle" }, toggle).textContent = collapsed ? "+" : "−";
}

/** Draws the given items, reusing elements by key so preset switches can animate. */
function drawItems(layers, model, items) {
  const { animate } = model;
  const existing = new Map([...layers.nodes.children].map((el) => [el.dataset.key, el]));

  items.forEach(({ key, item, kind }, index) => {
    let el = existing.get(key);
    if (!el) {
      el = svg("g", { "data-key": key });
      if (animate) {
        el.classList.add("is-entering");
        el.addEventListener("animationend", () => el.classList.remove("is-entering"), { once: true });
      }
    }
    existing.delete(key);
    if (layers.nodes.children[index] !== el) layers.nodes.insertBefore(el, layers.nodes.children[index] ?? null);
    if (kind === "group") drawCollapsedGroup(el, item, model);
    else if (kind === "step") drawStep(el, item, model);
    else drawNode(el, item, model);
  });

  // fades out anything that is no longer shown
  for (const el of existing.values()) {
    if (!animate) {
      el.remove();
      continue;
    }
    el.removeAttribute("tabindex");
    el.classList.add("is-leaving");
    layers.leaving.appendChild(el);
    setTimeout(() => el.remove(), LEAVE_MS);
  }
}

/** Keeps the entering marker while it animates. */
function setClasses(el, classes) {
  const entering = el.classList.contains("is-entering");
  el.setAttribute("class", [...classes, entering && "is-entering"].filter(Boolean).join(" "));
}

/** Draws a collapsed group as one box with a stacked outline. */
function drawCollapsedGroup(el, box, { selection }) {
  const { group, members } = box;
  const selected = selection?.kind === "group" && selection.id === group.id;
  const perRepeat = members.reduce((sum, n) => sum + countBlockParams(n.type, n.params), 0);

  setClasses(el, ["group-box", selected && "is-selected"]);
  el.style.transform = `translate(${box.x}px, ${box.y}px)`;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.dataset.group = group.id;
  el.setAttribute("aria-label", `${group.label}, repeated ${group.repeat} times, collapsed, ${formatCount(perRepeat * group.repeat)} parameters`);
  el.replaceChildren();

  svg("rect", { class: "node-hit", width: box.w + 12, height: box.h + 12, rx: 8 }, el);
  svg("path", { class: "group-stack", d: boxPath(`stack2:${group.id}`, box.w, box.h), transform: "translate(10 10)" }, el);
  svg("path", { class: "group-stack", d: boxPath(`stack1:${group.id}`, box.w, box.h), transform: "translate(5 5)" }, el);
  svg("path", { class: "group-body", d: boxPath(`box:${group.id}`, box.w, box.h) }, el);
  svg("text", { class: "group-title", x: 18, y: 34 }, el).textContent = group.label;
  svg("text", { class: "group-meta", x: 18, y: 58 }, el).textContent = `× ${group.repeat} · ${members.length} blocks each`;
  svg("text", { class: "group-meta", x: 18, y: 80 }, el).textContent = `${formatCount(perRepeat * group.repeat)} parameters`;
  drawGroupToggle(el, box, true);
}

/** Draws one block with its ports and warnings. */
function drawNode(el, item, model) {
  const { graph, selection, warnings, missing } = model;
  const { node } = item;
  const type = BLOCK_TYPES[node.type];
  const count = countBlockParams(node.type, node.params);
  const selected = selection?.kind === "node" && selection.id === node.id;
  const warn = warnings.has(node.id);
  const isAdd = node.type === "residualAdd";

  setClasses(el, ["node", categoryClass(type.category), isAdd && "is-adder", selected && "is-selected", warn && "has-warning", model.dragId === node.id && "is-dragging"]);
  el.style.transform = `translate(${item.x}px, ${item.y}px)`;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "block");
  el.dataset.node = node.id;
  el.setAttribute("aria-label", `${type.name} (${node.id}), ${formatCount(count)} parameters${warn ? ", has a problem" : ""}`);
  el.replaceChildren();

  // hand-drawn outlines are open strokes, so a transparent shape behind them catches pointers
  if (isAdd) svg("circle", { class: "node-hit", cx: item.w / 2, cy: item.h / 2, r: item.w / 2 }, el);
  else svg("rect", { class: "node-hit", width: item.w, height: item.h, rx: 6 }, el);

  // an adder is a circle with a plus, everything else is a labelled box
  if (isAdd) {
    svg("path", { class: "node-body", d: circlePath(`add:${node.id}`, item.w / 2) }, el);
    svg("text", { class: "adder-sign", x: item.w / 2, y: item.h / 2 + 7, "text-anchor": "middle" }, el).textContent = "+";
  } else {
    svg("path", { class: "node-body", d: boxPath(`node:${node.id}`, item.w, item.h) }, el);
    svg("text", { class: "node-title", x: 14, y: 22 }, el).textContent = type.name;
    const output = type.outputs[0];
    const outShape = output ? formatShape(portShape(graph, node.id, output.id, "outputs")) : "";
    svg("text", { class: "node-meta", x: 14, y: 40 }, el).textContent = `${outShape} · ${formatCount(count)}`;
    if (internalsFor(node.type, node.params)) {
      const open = svg("g", {
        class: "sub-toggle", tabindex: 0, role: "button",
        "data-action": "open-block", "data-node": node.id,
        "aria-label": `Open the inside of ${type.name}`,
        transform: `translate(${item.w - 32} 14)`,
      }, el);
      svg("rect", { class: "node-hit", width: 24, height: 24, rx: 5 }, open);
      svg("path", { d: boxPath(`open:${node.id}`, 24, 24) }, open);
      svg("text", { x: 12, y: 17, "text-anchor": "middle" }, open).textContent = "+";
    }
  }

  drawPorts(el, item, model);

  if (warn) {
    const badge = svg("g", { class: "node-warning", transform: `translate(${item.w - 2} 2)`, "aria-hidden": "true" }, el);
    svg("path", { d: circlePath(`warn:${node.id}`, 9), transform: "translate(-9 -9)" }, badge);
    svg("text", { y: 4, "text-anchor": "middle" }, badge).textContent = "!";
  }
}

/** Draws the input and output ports of a block. */
function drawPorts(el, item, { graph, missing }) {
  const { node } = item;
  const type = BLOCK_TYPES[node.type];
  for (const [direction, ports] of [["inputs", type.inputs], ["outputs", type.outputs]]) {
    for (const port of ports) {
      const point = portPoint({ nodes: new Map([[node.id, item]]), branchSide: new Map([[node.id, "top"]]) }, { node: node.id, port: port.id }, direction);
      const isMissing = direction === "inputs" && missing.has(`${node.id}:${port.id}`);
      const circle = svg("circle", {
        class: ["port", direction === "inputs" ? "port-in" : "port-out", port.external && "port-external", isMissing && "port-missing"].filter(Boolean).join(" "),
        cx: point.x - item.x, cy: point.y - item.y, r: 6,
        "data-node": node.id, "data-port": port.id,
      }, el);
      const shape = formatShape(portShape(graph, node.id, port.id, direction));
      svg("title", {}, circle).textContent =
        `${direction === "inputs" ? "Input" : "Output"} ${port.id} ${shape}${port.external ? ", token ids" : ""}${isMissing ? ", not connected" : ""}`;
    }
  }
}

/** Draws one step of an internal graph. */
function drawStep(el, item, { selection }) {
  const { step } = item;
  const selected = selection?.kind === "step" && selection.id === step.id;
  setClasses(el, ["node", "is-step", selected && "is-selected"]);
  el.style.transform = `translate(${item.x}px, ${item.y}px)`;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "step");
  el.dataset.step = step.id;
  el.setAttribute("aria-label", `${step.name}${step.drill ? ", opens further" : ""}`);
  el.replaceChildren();

  svg("rect", { class: "node-hit", width: item.w, height: item.h, rx: 6 }, el);
  svg("path", { class: "node-body", d: boxPath(`step:${step.id}`, item.w, item.h) }, el);
  svg("text", { class: "node-title", x: 14, y: 23 }, el).textContent = step.name;
  svg("text", { class: "node-meta", x: 14, y: 43 }, el).textContent = step.equation ?? (item.shape ? formatShape(item.shape) : "");

  if (step.drill) {
    const open = svg("g", {
      class: "sub-toggle", tabindex: 0, role: "button",
      "data-action": "open-step", "data-drill": step.drill,
      "aria-label": `Open the inside of ${step.name}`,
      transform: `translate(${item.w - 32} 18)`,
    }, el);
    svg("rect", { class: "node-hit", width: 24, height: 24, rx: 5 }, open);
    svg("path", { d: boxPath(`drill:${step.id}`, 24, 24) }, open);
    svg("text", { x: 12, y: 17, "text-anchor": "middle" }, open).textContent = "+";
  }

  svg("circle", { class: "port port-in", cx: 0, cy: item.h / 2, r: 4 }, el);
  svg("circle", { class: "port port-out", cx: item.w, cy: item.h / 2, r: 4 }, el);
}
