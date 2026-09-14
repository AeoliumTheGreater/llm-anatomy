import { BLOCK_TYPES, subBlocksFor } from "../catalogue.js";
import { countBlockParams, formatCount } from "../params.js";
import { formatShape, portShape } from "../shapes.js";
import { categoryClass, svg } from "./dom.js";

export const NODE_W = 216;
export const NODE_H = 52;
export const GRID = 20;
const SUB_ROW = 26;
const SUB_W = 200;
const SUB_GAP = 16;
const GROUP_PAD = 20;
const GROUP_HEADER = 30;
const COLLAPSED_H = 68;
const LEAVE_MS = 300;

/** Computes where every node, group and port sits on the canvas. */
export function layoutGraph(graph, { collapsed, expanded, drag }) {
  const sizeOf = (node) => {
    const subs = subBlocksFor(node);
    const open = expanded.has(node.id) && subs.length > 0;
    const panelH = subs.length * SUB_ROW + 12;
    return { open, w: open ? NODE_W + SUB_GAP + SUB_W : NODE_W, h: open ? Math.max(NODE_H, panelH) : NODE_H };
  };

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
      x: left, y: top, w: right - left, storedY: top, fullH: bottom - top,
      h: isCollapsed ? COLLAPSED_H : bottom - top,
    });
  }
  groups.sort((a, b) => a.storedY - b.storedY);

  // moves content below a collapsed group up by the height the group saves
  const offsetAt = (y) => groups.reduce(
    (sum, box) => (box.collapsed && y >= box.storedY + box.fullH - GROUP_PAD ? sum + box.fullH - COLLAPSED_H : sum),
    0,
  );
  const toStoredY = (displayY) => {
    let y = displayY;
    for (let i = 0; i <= groups.length; i += 1) y = displayY + offsetAt(y);
    return y;
  };
  for (const box of groups) box.y = box.storedY - offsetAt(box.storedY);

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
      x: position.x, y: position.y - offsetAt(node.position.y),
      hiddenBy: hiddenBy.get(node.id) ?? null,
    });
  }

  return { nodes, groups, toStoredY };
}

/** Returns the canvas point of a port, or the edge of the collapsed group that hides it. */
export function portPoint(layout, endpoint, direction) {
  const item = layout.nodes.get(endpoint.node);
  if (!item) return null;
  if (item.hiddenBy) {
    const box = item.hiddenBy;
    return { x: box.x + box.w / 2, y: direction === "outputs" ? box.y + box.h : box.y, hiddenIn: box.group.id };
  }
  const ports = BLOCK_TYPES[item.node.type][direction];
  const index = ports.findIndex((p) => p.id === endpoint.port);
  if (index < 0) return null;
  return {
    x: item.x + (NODE_W * (index + 1)) / (ports.length + 1),
    y: direction === "outputs" ? item.y + NODE_H : item.y,
    hiddenIn: null,
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

  // collects the visible bounds
  for (const item of layout.nodes.values()) if (!item.hiddenBy) extend(item.x, item.y, item.w, item.h);
  for (const box of layout.groups) extend(box.x, box.y, box.w, box.h);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, scale: 1 };

  // scales and centres the bounds with a margin
  const margin = 32;
  const scale = Math.min(1.4, Math.max(0.15, Math.min(
    (width - 2 * margin) / (maxX - minX),
    (height - 2 * margin) / (maxY - minY),
  )));
  return {
    scale,
    x: (width - (maxX - minX) * scale) / 2 - minX * scale,
    y: Math.max(margin, (height - (maxY - minY) * scale) / 2) - minY * scale,
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

/** Draws the graph's nodes and groups into the SVG element. */
export function renderCanvas(root, model) {
  const layers = ensureLayers(root);
  drawGroupFrames(layers.groups, model);
  drawItems(layers, model);
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

/** Draws the frames of expanded groups behind their nodes. */
function drawGroupFrames(layer, { layout, selection }) {
  layer.replaceChildren();
  for (const box of layout.groups) {
    if (box.collapsed) continue;
    const { group } = box;
    const selected = selection?.kind === "group" && selection.id === group.id;
    const g = svg("g", { class: `group-frame-wrap${selected ? " is-selected" : ""}`, transform: `translate(${box.x} ${box.y})` }, layer);
    svg("rect", { class: "group-frame", width: box.w, height: box.h, rx: 12 }, g);

    // draws the focusable header
    const header = svg("g", {
      class: "group-header", tabindex: 0, role: "button",
      "data-key": `group:${group.id}`, "data-group": group.id,
      "aria-label": `${group.label}, repeated ${group.repeat} times, expanded`,
    }, g);
    svg("rect", { width: box.w - 48, height: 26, x: 8, y: 4, rx: 6 }, header);
    svg("text", { class: "group-label", x: 16, y: 21 }, header).textContent = `${group.label} · repeated ${group.repeat} times`;
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
    transform: `translate(${box.w - 34} 6)`,
  }, parent);
  svg("rect", { width: 24, height: 24, rx: 6 }, toggle);
  svg("text", { x: 12, y: 17, "text-anchor": "middle" }, toggle).textContent = collapsed ? "+" : "−";
}

/** Draws nodes and collapsed groups, reusing elements by key so preset switches can animate. */
function drawItems(layers, model) {
  const { layout, animate } = model;
  const existing = new Map([...layers.nodes.children].map((el) => [el.dataset.key, el]));

  // orders visible items top to bottom so tab order follows the picture
  const items = [
    ...[...layout.nodes.values()].filter((item) => !item.hiddenBy).map((item) => ({ key: `node:${item.node.id}`, item, isGroup: false })),
    ...layout.groups.filter((box) => box.collapsed).map((box) => ({ key: `group:${box.group.id}`, item: box, isGroup: true })),
  ].sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x);

  // creates, updates and orders the elements
  items.forEach(({ key, item, isGroup }, index) => {
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
    if (isGroup) drawCollapsedGroup(el, item, model);
    else drawNode(el, item, model);
  });

  // fades out elements that are no longer shown
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

/** Sets the class list of an element, keeping the entering marker while it animates. */
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

  // draws the stacked outline that marks a repeat
  svg("rect", { class: "group-stack", x: 8, y: 8, width: box.w, height: box.h, rx: 10 }, el);
  svg("rect", { class: "group-stack", x: 4, y: 4, width: box.w, height: box.h, rx: 10 }, el);
  svg("rect", { class: "group-body", width: box.w, height: box.h, rx: 10 }, el);
  svg("text", { class: "group-title", x: 16, y: 28 }, el).textContent = group.label;
  svg("text", { class: "group-meta", x: 16, y: 50 }, el).textContent =
    `× ${group.repeat} · ${members.length} blocks each · ${formatCount(perRepeat * group.repeat)} parameters`;
  drawGroupToggle(el, box, true);
}

/** Draws one block with its ports, warnings and optional sub-block panel. */
function drawNode(el, item, model) {
  const { graph, selection, warnings, missing } = model;
  const { node } = item;
  const type = BLOCK_TYPES[node.type];
  const subs = subBlocksFor(node);
  const count = countBlockParams(node.type, node.params);
  const selected = selection?.kind === "node" && selection.id === node.id;
  const warn = warnings.has(node.id);

  setClasses(el, ["node", categoryClass(type.category), selected && "is-selected", warn && "has-warning", model.dragId === node.id && "is-dragging"]);
  el.style.transform = `translate(${item.x}px, ${item.y}px)`;
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "block");
  el.dataset.node = node.id;
  el.setAttribute("aria-label", `${type.name} (${node.id}), ${formatCount(count)} parameters${warn ? ", has a problem" : ""}`);
  el.replaceChildren();

  // draws the card, title and output shape
  svg("rect", { class: "node-body", width: NODE_W, height: NODE_H, rx: 8 }, el);
  svg("rect", { class: "node-accent", x: 0, y: 8, width: 4, height: NODE_H - 16, rx: 2 }, el);
  svg("text", { class: "node-title", x: 14, y: 22 }, el).textContent = type.name;
  const output = type.outputs[0];
  const outShape = output ? formatShape(portShape(graph, node.id, output.id, "outputs")) : "";
  svg("text", { class: "node-meta", x: 14, y: 40 }, el).textContent = `${outShape} · ${formatCount(count)}`;

  // draws the sub-block toggle
  if (subs.length > 0) {
    const toggle = svg("g", {
      class: "sub-toggle", tabindex: 0, role: "button",
      "data-action": "toggle-sub", "data-node": node.id,
      "aria-expanded": String(item.open),
      "aria-label": `${item.open ? "Hide" : "Show"} sub-blocks of ${type.name}`,
      transform: `translate(${NODE_W - 30} 15)`,
    }, el);
    svg("rect", { width: 22, height: 22, rx: 6 }, toggle);
    svg("text", { x: 11, y: 16, "text-anchor": "middle" }, toggle).textContent = item.open ? "−" : "+";
  }

  // draws input ports on top and output ports underneath
  for (const [direction, ports] of [["inputs", type.inputs], ["outputs", type.outputs]]) {
    ports.forEach((port, i) => {
      const isMissing = direction === "inputs" && missing.has(`${node.id}:${port.id}`);
      const circle = svg("circle", {
        class: ["port", direction === "inputs" ? "port-in" : "port-out", port.external && "port-external", isMissing && "port-missing"].filter(Boolean).join(" "),
        cx: (NODE_W * (i + 1)) / (ports.length + 1),
        cy: direction === "outputs" ? NODE_H : 0,
        r: 6,
        "data-node": node.id,
        "data-port": port.id,
      }, el);
      const shape = formatShape(portShape(graph, node.id, port.id, direction));
      svg("title", {}, circle).textContent =
        `${direction === "inputs" ? "Input" : "Output"} ${port.id} ${shape}${port.external ? ", token ids" : ""}${isMissing ? ", not connected" : ""}`;
    });
  }

  // draws the warning badge
  if (warn) {
    const badge = svg("g", { class: "node-warning", transform: `translate(${NODE_W - 2} 2)`, "aria-hidden": "true" }, el);
    svg("circle", { r: 8 }, badge);
    svg("text", { y: 4, "text-anchor": "middle" }, badge).textContent = "!";
  }

  // draws the sub-block panel beside the card
  if (item.open) {
    const panel = svg("g", { class: "subpanel", transform: `translate(${NODE_W + SUB_GAP} 0)` }, el);
    svg("path", { class: "subpanel-link", d: `M ${-SUB_GAP} ${NODE_H / 2} H 0` }, panel);
    svg("rect", { class: "subpanel-body", width: SUB_W, height: subs.length * SUB_ROW + 12, rx: 8 }, panel);
    subs.forEach((sub, i) => {
      const active = selected && selection.subBlock === sub.id;
      const row = svg("g", {
        class: `subrow${active ? " is-active" : ""}`, tabindex: 0, role: "button",
        "data-action": "select-sub", "data-node": node.id, "data-sub": sub.id,
        "aria-label": `${sub.name}, part of ${type.name}`,
        transform: `translate(6 ${6 + i * SUB_ROW})`,
      }, panel);
      svg("rect", { width: SUB_W - 12, height: SUB_ROW - 4, rx: 5 }, row);
      svg("text", { x: 10, y: 16 }, row).textContent = sub.name;
    });
  }
}
