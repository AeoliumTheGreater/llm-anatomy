import { BLOCK_TYPES } from "../catalogue.js";
import { internalsFor } from "../internals.js";
import { countBlockParams, formatCount } from "../params.js";
import { formatShape, portShape, resolveShape } from "../shapes.js";
import { categoryClass, svg } from "./dom.js";

export const NODE_W = 240;
export const NODE_H = 52;
export const ADD_SIZE = 52;
export const GRID = 20;
const ADD_R = 18;
const PORT_R = 3.5;
const GROUP_PAD = 24;
const GROUP_HEADER = 30;
const SKIP_SPACE = 60;
const COLLAPSED_W = 300;
const COLLAPSED_H = 72;
const STEP_W = 280;
const MONO_CHAR = 6.7;
const STEP_H = 60;
const STEP_GAP_X = 88;
const BUTTON = 22;
const LEAVE_MS = 300;

/** Returns the size of a block on the canvas. */
function sizeOf(node) {
  return node.type === "residualAdd" ? { w: ADD_SIZE, h: ADD_SIZE } : { w: NODE_W, h: NODE_H };
}

/** Computes where every node, group and port sits along the row. */
export function layoutGraph(graph, { collapsed, drag }) {
  // measures each group around its members, leaving room above for the skip lanes
  const groups = [];
  for (const group of graph.groups) {
    const members = graph.nodes.filter((n) => n.group === group.id);
    if (members.length === 0) continue;
    const left = Math.min(...members.map((n) => n.position.x)) - GROUP_PAD;
    const right = Math.max(...members.map((n) => n.position.x + sizeOf(n).w)) + GROUP_PAD;
    const rowTop = Math.min(...members.map((n) => n.position.y));
    const top = rowTop - SKIP_SPACE - GROUP_HEADER;
    const bottom = Math.max(...members.map((n) => n.position.y + sizeOf(n).h)) + GROUP_PAD;
    const isCollapsed = collapsed.get(group.id) ?? group.collapsed;
    groups.push({
      group, members, collapsed: isCollapsed,
      storedX: left, fullW: right - left, x: left,
      y: isCollapsed ? rowTop + NODE_H / 2 - COLLAPSED_H / 2 : top,
      w: isCollapsed ? COLLAPSED_W : right - left,
      h: isCollapsed ? COLLAPSED_H : bottom - top,
    });
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

  return { nodes, groups, toStoredX };
}

/** Lays out an internal graph on one row, each step after everything that feeds it. */
export function layoutInternals(entry, params, globals) {
  const ids = entry.nodes.map((n) => n.id);
  const waiting = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const [from, to] of entry.edges) {
    if (!waiting.has(to) || !outgoing.has(from)) continue;
    waiting.set(to, waiting.get(to) + 1);
    outgoing.get(from).push(to);
  }

  // orders the steps so each one follows its inputs, keeping the listed order where it can;
  // a side input therefore lands just before the step it feeds
  const order = [];
  const ready = ids.filter((id) => waiting.get(id) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const id = ready.shift();
    order.push(id);
    for (const to of outgoing.get(id)) {
      waiting.set(to, waiting.get(to) - 1);
      if (waiting.get(to) === 0) ready.push(to);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);

  // places every step on the same line
  const byId = new Map(entry.nodes.map((n) => [n.id, n]));
  const nodes = new Map();
  order.forEach((id, index) => {
    const step = byId.get(id);
    nodes.set(id, {
      node: { id, type: null },
      step,
      internal: true,
      shape: step.shape ? resolveShape(step.shape, params, globals) : null,
      x: index * (STEP_W + STEP_GAP_X),
      y: 0,
      w: STEP_W,
      h: STEP_H,
      hiddenBy: null,
    });
  });

  const known = new Set(ids);
  const edges = entry.edges
    .filter(([from, to]) => known.has(from) && known.has(to))
    .map(([from, to]) => ({ from: { node: from, port: "out" }, to: { node: to, port: "in" } }));
  return { nodes, groups: [], toStoredX: (x) => x, edges };
}

/** Returns the canvas point and outward direction of a port. */
export function portPoint(layout, endpoint, direction) {
  const item = layout.nodes.get(endpoint.node);
  if (!item) return null;
  const out = direction === "outputs";

  // internal steps have one port on each side
  if (item.internal) {
    return { x: item.x + (out ? item.w : 0), y: item.y + item.h / 2, nx: out ? 1 : -1, ny: 0, hiddenIn: null };
  }

  // a hidden node's edges meet the box of the group that hides it
  if (item.hiddenBy) {
    const box = item.hiddenBy;
    return { x: box.x + (out ? box.w : 0), y: box.y + box.h / 2, nx: out ? 1 : -1, ny: 0, hiddenIn: box.group.id };
  }

  // an adder takes the branch from the left and the skip from above
  if (item.node.type === "residualAdd") {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    if (out) return { x: cx + ADD_R, y: cy, nx: 1, ny: 0, hiddenIn: null };
    if (endpoint.port === "a") return { x: cx, y: cy - ADD_R, nx: 0, ny: -1, hiddenIn: null };
    return { x: cx - ADD_R, y: cy, nx: -1, ny: 0, hiddenIn: null };
  }

  const ports = BLOCK_TYPES[item.node.type][direction];
  const index = ports.findIndex((p) => p.id === endpoint.port);
  if (index < 0) return null;
  return {
    x: item.x + (out ? item.w : 0),
    y: item.y + (item.h * (index + 1)) / (ports.length + 1),
    nx: out ? 1 : -1,
    ny: 0,
    hiddenIn: null,
  };
}

/** Returns the bounds of everything visible, including the skip lanes above expanded groups. */
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
  for (const item of layout.nodes.values()) {
    if (item.hiddenBy) continue;
    extend(item.x, item.y, item.w, item.h);
    if (item.node.type === "residualAdd") extend(item.x, item.y - SKIP_SPACE, item.w, item.h);
  }
  for (const box of layout.groups) extend(box.x, box.y, box.w, box.h);
  return { minX, minY, maxX, maxY };
}

/** Computes the pan and zoom that fit every visible node and group into the given size. */
export function fitToView(layout, width, height) {
  const { minX, minY, maxX, maxY } = boundsOf(layout);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, scale: 1 };

  // Fit shows the whole shape of a model, however long the row is
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

/** Draws the model graph: group frames and blocks. */
export function renderCanvas(root, model) {
  const layers = ensureLayers(root);
  drawGroupFrames(layers.groups, model);
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
  const item = model.layout.nodes.get(model.dragId);
  const el = layers.nodes.querySelector(`[data-key="${CSS.escape(`node:${model.dragId}`)}"]`);
  if (item && el) {
    el.style.transform = `translate(${item.x}px, ${item.y}px)`;
    el.classList.add("is-dragging");
  }
  return layers;
}

/** Lists what the nodes layer should contain, top-level blocks and collapsed groups alike. */
function buildItems({ layout }) {
  return [
    ...[...layout.nodes.values()].filter((item) => !item.hiddenBy).map((item) => ({ key: `node:${item.node.id}`, item, kind: "node" })),
    ...layout.groups.filter((box) => box.collapsed).map((box) => ({ key: `group:${box.group.id}`, item: box, kind: "group" })),
  ].sort((a, b) => a.item.x - b.item.x || a.item.y - b.item.y);
}

/** Draws a small square button with a plus or minus sign. */
function drawButton(parent, attrs, x, y, sign) {
  const button = svg("g", { ...attrs, tabindex: 0, role: "button", transform: `translate(${x} ${y})` }, parent);
  svg("rect", { class: "button-body", width: BUTTON, height: BUTTON, rx: 3 }, button);
  svg("path", { class: "button-sign", d: sign === "+" ? "M 6 11 H 16 M 11 6 V 16" : "M 6 11 H 16" }, button);
  return button;
}

/** Draws the frames of expanded groups behind their blocks. */
function drawGroupFrames(layer, { layout, selection }) {
  layer.replaceChildren();
  for (const box of layout.groups) {
    if (box.collapsed) continue;
    const { group } = box;
    const selected = selection?.kind === "group" && selection.id === group.id;
    const g = svg("g", { class: `group-frame-wrap${selected ? " is-selected" : ""}`, transform: `translate(${box.x} ${box.y})` }, layer);
    svg("rect", { class: "group-frame", width: box.w, height: box.h, rx: 6 }, g);

    const header = svg("g", {
      class: "group-header", tabindex: 0, role: "button",
      "data-key": `group:${group.id}`, "data-group": group.id,
      "aria-label": `${group.label}, repeated ${group.repeat} times, expanded`,
    }, g);
    svg("rect", { width: box.w - 56, height: 24, x: 8, y: 4, rx: 3 }, header);
    svg("text", { class: "group-label", x: 16, y: 21 }, header).textContent = `${group.label} · repeated ${group.repeat} times`;
    drawButton(g, {
      class: "group-toggle", "data-action": "toggle-group", "data-group": group.id,
      "aria-expanded": "true", "aria-label": `Collapse ${group.label}`,
    }, box.w - 34, 5, "−");
  }
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

  svg("rect", { class: "group-stack", x: 8, y: 8, width: box.w, height: box.h, rx: 3 }, el);
  svg("rect", { class: "group-stack", x: 4, y: 4, width: box.w, height: box.h, rx: 3 }, el);
  svg("rect", { class: "group-body", width: box.w, height: box.h, rx: 3 }, el);
  svg("text", { class: "group-title", x: 16, y: 27 }, el).textContent = group.label;
  svg("text", { class: "group-meta", x: 16, y: 47 }, el).textContent = `× ${group.repeat} · ${members.length} blocks each`;
  svg("text", { class: "group-meta", x: 16, y: 63 }, el).textContent = `${formatCount(perRepeat * group.repeat)} parameters`;
  drawButton(el, {
    class: "group-toggle", "data-action": "toggle-group", "data-group": group.id,
    "aria-expanded": "false", "aria-label": `Expand ${group.label}`,
  }, box.w - 32, 10, "+");
}

/** Draws one block with its ports and warnings. */
function drawNode(el, item, model) {
  const { graph, selection, warnings } = model;
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

  // an adder is a circle with a plus, everything else is a labelled box
  if (isAdd) {
    const c = item.w / 2;
    svg("rect", { class: "node-hit", width: item.w, height: item.h }, el);
    svg("circle", { class: "node-body", cx: c, cy: c, r: ADD_R }, el);
    svg("path", { class: "adder-sign", d: `M ${c - 8} ${c} H ${c + 8} M ${c} ${c - 8} V ${c + 8}` }, el);
  } else {
    svg("rect", { class: "node-body", width: item.w, height: item.h, rx: 3 }, el);
    svg("rect", { class: "node-accent", x: 0, y: 0, width: 3, height: item.h }, el);
    svg("text", { class: "node-title", x: 14, y: 22 }, el).textContent = type.name;
    const output = type.outputs[0];
    const outShape = output ? formatShape(portShape(graph, node.id, output.id, "outputs")) : "";
    svg("text", { class: "node-meta", x: 14, y: 40 }, el).textContent = `${outShape} · ${formatCount(count)}`;
    if (internalsFor(node.type, node.params)) {
      drawButton(el, {
        class: "sub-toggle", "data-action": "open-block", "data-node": node.id,
        "aria-label": `Open the inside of ${type.name}`,
      }, item.w - 32, 15, "+");
    }
  }

  drawPorts(el, item, model);

  if (warn) {
    const badge = svg("g", { class: "node-warning", transform: `translate(${item.w} 0)`, "aria-hidden": "true" }, el);
    svg("circle", { r: 8 }, badge);
    svg("text", { y: 4, "text-anchor": "middle" }, badge).textContent = "!";
  }
}

/** Draws the input and output ports of a block. */
function drawPorts(el, item, { graph, missing }) {
  const { node } = item;
  const type = BLOCK_TYPES[node.type];
  const single = { nodes: new Map([[node.id, item]]) };
  for (const [direction, ports] of [["inputs", type.inputs], ["outputs", type.outputs]]) {
    for (const port of ports) {
      const point = portPoint(single, { node: node.id, port: port.id }, direction);
      const isMissing = direction === "inputs" && missing.has(`${node.id}:${port.id}`);
      const circle = svg("circle", {
        class: ["port", direction === "inputs" ? "port-in" : "port-out", port.external && "port-external", isMissing && "port-missing"].filter(Boolean).join(" "),
        cx: point.x - item.x, cy: point.y - item.y, r: PORT_R,
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

  svg("rect", { class: "node-body", width: item.w, height: item.h, rx: 3 }, el);
  svg("text", { class: "node-title", x: 14, y: 24 }, el).textContent = step.name;

  // shortens a line that would run past the card, keeping the whole of it on hover
  const line = step.equation ?? (item.shape ? formatShape(item.shape) : "");
  const room = Math.floor((item.w - 14 - (step.drill ? 40 : 12)) / MONO_CHAR);
  const meta = svg("text", { class: "node-meta", x: 14, y: 44 }, el);
  meta.textContent = line.length > room ? `${line.slice(0, room - 1)}…` : line;
  if (line.length > room) svg("title", {}, meta).textContent = line;

  if (step.drill) {
    drawButton(el, {
      class: "sub-toggle", "data-action": "open-step", "data-drill": step.drill,
      "aria-label": `Open the inside of ${step.name}`,
    }, item.w - 32, 19, "+");
  }
}
