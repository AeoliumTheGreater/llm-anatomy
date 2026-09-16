import { BLOCK_TYPES } from "./catalogue.js";
import { INTERNALS, internalsFor } from "./internals.js";
import {
  addNode, removeNode, connect, disconnect, updateNode, updateGroup, createNode, makeWorkingCopy,
  unconnectedInputs, createHistory, commit, undo, redo, sameEndpoint,
} from "./graph.js";
import { checkConnection } from "./shapes.js";
import {
  getStorage, loadSetting, saveSetting, loadWorkingCopy, saveWorkingCopy, clearWorkingCopy, exportGraph, importGraph,
} from "./storage.js";
import { PRESET as QWEN2_5 } from "./presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3 } from "./presets/qwen3_1_7b.js";
import { PRESET as QWEN3_5 } from "./presets/qwen3_5_0_8b.js";
import {
  layoutGraph, layoutInternals, renderCanvas, renderInternals, renderDrag, fitToView, portPoint,
  GRID, NODE_W, NODE_H,
} from "./view/canvas.js";
import { renderEdges, renderPendingEdge, updateEdgesFor } from "./view/edges.js";
import { renderInspector } from "./view/inspector.js";
import { renderPalette, BLOCK_MIME } from "./view/palette.js";
import { renderDiffPanel } from "./view/diffpanel.js";
import { h } from "./view/dom.js";

const PRESETS = [QWEN2_5, QWEN3, QWEN3_5];
const MIN_SCALE = 0.08;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 1.2;
const DOUBLE_TAP_MS = 350;
const STATUS_MS = 8000;
const ANIMATION_MS = 400;

const storage = getStorage();
const wideQuery = window.matchMedia("(min-width: 801px)");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const dom = {
  presets: document.querySelector(".presets"),
  badge: document.querySelector(".badge"),
  actions: document.querySelector(".actions"),
  importInput: document.querySelector(".import-input"),
  palette: document.querySelector(".palette"),
  wrap: document.querySelector(".canvas-wrap"),
  svg: document.querySelector(".canvas"),
  breadcrumb: document.querySelector(".breadcrumb"),
  legend: document.querySelector(".legend"),
  zoom: document.querySelector(".zoom-controls"),
  status: document.querySelector(".status"),
  inspector: document.querySelector(".inspector"),
  diffpanel: document.querySelector(".diffpanel"),
};

const savedPreset = loadSetting(storage, "preset");
const state = {
  presetId: PRESETS.some((p) => p.id === savedPreset) ? savedPreset : QWEN3.id,
  histories: new Map(),
  collapsed: new Map(),
  drill: [],
  selection: null,
  view: { x: 0, y: 0, scale: 1 },
  diffOpen: false,
  compareWith: null,
  interaction: null,
  drag: null,
  lastTap: null,
  layout: null,
  layers: null,
  invalid: new Set(),
  statusTimer: 0,
  animationTimer: 0,
};
const pointers = new Map();

/** Returns a preset by id. */
function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}

/** Returns the current preset's history, loading its stored working copy the first time. */
function currentHistory() {
  if (!state.histories.has(state.presetId)) {
    const stored = loadWorkingCopy(storage, state.presetId);
    state.histories.set(state.presetId, createHistory(stored ?? presetById(state.presetId)));
  }
  return state.histories.get(state.presetId);
}

/** Returns the graph on screen. */
function currentGraph() {
  return currentHistory().present;
}

/** Returns true while an internal graph is open. */
function inDrill() {
  return state.drill.length > 0;
}

/** Returns the view-only collapse state of the current preset's groups. */
function collapsedFor() {
  if (!state.collapsed.has(state.presetId)) state.collapsed.set(state.presetId, new Map());
  return state.collapsed.get(state.presetId);
}

/** Returns whether a group is collapsed on screen. */
function isCollapsed(groupId) {
  const group = currentGraph().groups.find((g) => g.id === groupId);
  return collapsedFor().get(groupId) ?? group?.collapsed ?? true;
}

/** Stores a new history, persists the working copy and redraws. */
function setHistory(history) {
  state.histories.set(state.presetId, history);
  const graph = history.present;

  if (graph.readOnly) clearWorkingCopy(storage, state.presetId);
  else if (!saveWorkingCopy(storage, state.presetId, graph)) showStatus("Storage is unavailable, so edits will be lost on reload.", "error");

  // drops a selection that no longer exists
  const sel = state.selection;
  if (sel?.kind === "node" && !graph.nodes.some((n) => n.id === sel.id)) state.selection = null;
  if (sel?.kind === "group" && !graph.groups.some((g) => g.id === sel.id)) state.selection = null;
  if (sel?.kind === "edge" && !graph.edges.some((e) => sameEndpoint(e.from, sel.from) && sameEndpoint(e.to, sel.to))) state.selection = null;
  render();
}

/** Applies an edit; the first edit of a preset creates its working copy. */
function applyEdit(edit) {
  if (!wideQuery.matches || inDrill()) return;
  const history = currentHistory();
  const base = history.present.readOnly ? makeWorkingCopy(history.present) : history.present;
  const next = edit(base);
  if (next === base) return;
  if (history.present.readOnly) showStatus(`Editing a copy: ${next.name}. Reset returns to the preset.`);
  setHistory(commit(history, next));
}

/** Connects two ports after the shape check, or reports the mismatch. */
function tryConnect(from, to) {
  const check = checkConnection(currentGraph(), from, to);
  if (!check.ok) {
    showStatus(check.message, "error");
    return false;
  }
  applyEdit((graph) => connect(graph, from, to));
  return true;
}

/** Adds a block at a canvas position, or in the centre of the view. */
function addBlock(typeId, position = centrePosition()) {
  applyEdit((graph) => {
    const node = createNode(graph, typeId, position);
    state.selection = { kind: "node", id: node.id };
    return addNode(graph, node);
  });
}

/** Returns the snapped graph position at the centre of the canvas. */
function centrePosition() {
  const rect = dom.svg.getBoundingClientRect();
  const point = clientToGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { x: snap(state.layout.toStoredX(point.x - NODE_W / 2)), y: snap(point.y - NODE_H / 2) };
}

/** Removes the selected block or connection. */
function deleteSelection() {
  const sel = state.selection;
  if (sel?.kind === "node") applyEdit((graph) => removeNode(graph, sel.id));
  if (sel?.kind === "edge") applyEdit((graph) => disconnect(graph, sel.from, sel.to));
}

/** Shows a message over the canvas for a few seconds. */
function showStatus(message, kind = "info") {
  dom.status.textContent = message;
  dom.status.dataset.kind = kind;
  dom.status.hidden = false;
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => { dom.status.hidden = true; }, kind === "error" ? STATUS_MS * 1.5 : STATUS_MS);
}

/** Lists unconnected inputs and connections whose shapes no longer match. */
function problems(graph) {
  const missing = unconnectedInputs(graph);
  const invalid = [];
  graph.edges.forEach((edge, index) => {
    const check = checkConnection(graph, edge.from, edge.to);
    if (!check.ok) invalid.push({ index, edge, message: check.message });
  });
  return { missing, invalid };
}

/** Opens the inside of a block. */
function openBlock(nodeId) {
  const node = currentGraph().nodes.find((n) => n.id === nodeId);
  const entry = node && internalsFor(node.type, node.params);
  if (!entry) return;
  state.drill = [{ key: node.type, label: BLOCK_TYPES[node.type].name, params: node.params, nodeId }];
  state.selection = null;
  afterDrillChange();
}

/** Opens the inside of a step of the open internal graph. */
function openStep(drillKey) {
  const params = state.drill.at(-1)?.params ?? {};
  const entry = internalsFor(drillKey, params);
  if (!entry) return;
  state.drill = [...state.drill, { key: drillKey, label: entry.title ?? drillKey, params }];
  state.selection = null;
  afterDrillChange();
}

/** Goes back to a level of the breadcrumb; -1 is the whole model. */
function goToLevel(index) {
  state.drill = state.drill.slice(0, index + 1);
  state.selection = null;
  afterDrillChange();
}

/** Redraws after moving between levels and fits the whole new row on screen. */
function afterDrillChange() {
  render();
  requestAnimationFrame(fit);
}

/** Redraws everything. */
function render({ animate = false } = {}) {
  renderTopbar();
  renderBreadcrumb();
  renderGraph({ animate });
  renderSidePanels();
}

/** Updates the preset toggle, badge and action buttons. */
function renderTopbar() {
  const graph = currentGraph();
  const history = currentHistory();
  const canEdit = wideQuery.matches && !inDrill();
  for (const button of dom.presets.children) button.setAttribute("aria-pressed", String(button.dataset.preset === state.presetId));
  dom.badge.hidden = graph.readOnly;
  const action = (name) => dom.actions.querySelector(`[data-action="${name}"]`);
  action("undo").disabled = !canEdit || history.past.length === 0;
  action("redo").disabled = !canEdit || history.future.length === 0;
  action("reset").disabled = !canEdit || graph.readOnly;
  action("import").disabled = !canEdit;
  action("compare").setAttribute("aria-expanded", String(state.diffOpen));
}

/** Shows the path from the whole model down to the open internal graph. */
function renderBreadcrumb() {
  dom.legend.hidden = inDrill();
  dom.breadcrumb.hidden = !inDrill();
  if (!inDrill()) return;
  const crumbs = [
    h("button", { type: "button", onClick: () => goToLevel(-1) }, currentGraph().name),
    ...state.drill.flatMap((level, index) => [
      h("span", { "aria-hidden": "true" }, "›"),
      index === state.drill.length - 1
        ? h("span", { class: "here", "aria-current": "page" }, level.label)
        : h("button", { type: "button", onClick: () => goToLevel(index) }, level.label),
    ]),
  ];
  dom.breadcrumb.replaceChildren(...crumbs);
}

/** Redraws the canvas, keeping keyboard focus on the same item. */
function renderGraph({ animate = false } = {}) {
  const focusKey = dom.svg.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const moving = animate && !motionQuery.matches;

  if (moving) {
    dom.svg.classList.add("animate");
    clearTimeout(state.animationTimer);
    state.animationTimer = setTimeout(() => dom.svg.classList.remove("animate"), ANIMATION_MS);
  }

  if (inDrill()) renderInternalGraph();
  else renderModelGraph(moving);
  applyView();

  if (focusKey && document.activeElement?.dataset?.key !== focusKey) {
    dom.svg.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
}

/** Draws the whole model. */
function renderModelGraph(moving) {
  const graph = currentGraph();
  const { missing, invalid } = problems(graph);
  state.layout = layoutGraph(graph, { collapsed: collapsedFor(), drag: state.drag });
  state.layers = renderCanvas(dom.svg, {
    graph, layout: state.layout, selection: state.selection, animate: moving, dragId: state.drag?.id,
    warnings: new Set([...missing.map((m) => m.node), ...invalid.map((p) => p.edge.to.node)]),
    missing: new Set(missing.map((m) => `${m.node}:${m.port}`)),
  });
  state.invalid = new Set(invalid.map((p) => p.index));
  renderEdges(state.layers.edges, { graph, layout: state.layout, selection: state.selection, invalid: state.invalid });
}

/** Draws the internal graph of the open block or step. */
function renderInternalGraph() {
  const graph = currentGraph();
  const level = state.drill.at(-1);
  const entry = internalsFor(level.key, level.params);
  state.layout = layoutInternals(entry, level.params, graph.globals);
  state.layers = renderInternals(dom.svg, { layout: state.layout, selection: state.selection, animate: false });
  renderEdges(state.layers.edges, {
    graph: { edges: state.layout.edges }, layout: state.layout, selection: null, invalid: new Set(),
  });
}

/** Redraws only what a drag changes: the dragged node, group frames and edges. */
function renderDragFrame() {
  const graph = currentGraph();
  state.layout = layoutGraph(graph, { collapsed: collapsedFor(), drag: state.drag });
  state.layers = renderDrag(dom.svg, { graph, layout: state.layout, selection: state.selection, dragId: state.drag.id });
  updateEdgesFor(state.layers.edges, { graph, layout: state.layout }, state.drag.id);
}

/** Redraws the inspector and the difference panel. */
function renderSidePanels() {
  const graph = currentGraph();
  const level = state.drill.at(-1);
  renderInspector(dom.inspector, {
    graph, selection: state.selection, canEdit: wideQuery.matches && !inDrill(), preset: presetById(state.presetId),
    ...problems(graph), isCollapsed, actions: inspectorActions,
    drill: state.drill, entry: level ? internalsFor(level.key, level.params) : null, level,
  });
  renderDiff();
}

/** Redraws the difference panel when it is open. */
function renderDiff() {
  dom.diffpanel.hidden = !state.diffOpen;
  if (!state.diffOpen) return;
  const graph = currentGraph();

  const options = PRESETS.filter((p) => !(graph.readOnly && p.id === state.presetId));
  if (!options.some((p) => p.id === state.compareWith)) {
    state.compareWith = graph.readOnly ? options[0].id : state.presetId;
  }
  renderDiffPanel(dom.diffpanel, {
    graph, compareGraph: presetById(state.compareWith), options,
    onCompareChange: (id) => { state.compareWith = id; renderDiff(); },
    onClose: () => { state.diffOpen = false; renderTopbar(); renderDiff(); dom.actions.querySelector('[data-action="compare"]').focus(); },
  });
}

const inspectorActions = {
  select(selection) {
    state.selection = selection;
    renderGraph();
    renderSidePanels();
    revealSelection();
  },
  setParam(nodeId, key, value) {
    const node = currentGraph().nodes.find((n) => n.id === nodeId);
    if (node?.params[key] === value) return;
    applyEdit((graph) => updateNode(graph, nodeId, { params: { [key]: value } }));
  },
  setRepeat(groupId, repeat) {
    applyEdit((graph) => updateGroup(graph, groupId, { repeat }));
  },
  connect: tryConnect,
  disconnect(edge) {
    applyEdit((graph) => disconnect(graph, edge.from, edge.to));
  },
  remove(nodeId) {
    applyEdit((graph) => removeNode(graph, nodeId));
  },
  toggleGroup,
  openBlock,
  openStep,
  goToLevel,
};

/** Expands or collapses a repeated group. */
function toggleGroup(groupId) {
  collapsedFor().set(groupId, !isCollapsed(groupId));
  renderGraph();
  renderSidePanels();
  fit();
}

/** Switches to another preset, keeping the view so shared blocks stay in place. */
function selectPreset(id) {
  if (id === state.presetId) return;
  state.compareWith = state.presetId;
  state.presetId = id;
  state.selection = null;
  state.drill = [];
  saveSetting(storage, "preset", id);
  render({ animate: true });
  requestAnimationFrame(fit);
}

/** Applies the pan and zoom to the canvas and its grid. */
function applyView() {
  const { x, y, scale } = state.view;
  state.layers.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  dom.wrap.style.backgroundPosition = `${x}px ${y}px`;
  dom.wrap.style.backgroundSize = `${100 * scale}px ${100 * scale}px, ${100 * scale}px ${100 * scale}px, ${GRID * scale}px ${GRID * scale}px, ${GRID * scale}px ${GRID * scale}px`;
}

/** Pans so a canvas item is visible; the diagram is wider than the canvas. */
function ensureVisible(el) {
  if (!el) return;
  const canvas = dom.svg.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const margin = 56;
  let dx = 0;
  let dy = 0;

  // moves just enough to bring the item inside, preferring its left and top edges
  if (box.right > canvas.right - margin) dx = canvas.right - margin - box.right;
  if (box.left + dx < canvas.left + margin) dx = canvas.left + margin - box.left;
  if (box.bottom > canvas.bottom - margin) dy = canvas.bottom - margin - box.bottom;
  if (box.top + dy < canvas.top + margin) dy = canvas.top + margin - box.top;
  if (dx === 0 && dy === 0) return;

  state.view = { ...state.view, x: state.view.x + dx, y: state.view.y + dy };
  applyView();
}

/** Brings the current selection into view. */
function revealSelection() {
  const sel = state.selection;
  if (!sel || sel.kind === "edge") return;
  const key = sel.kind === "step" ? `step:${sel.id}` : `${sel.kind}:${sel.id}`;
  ensureVisible(dom.svg.querySelector(`[data-key="${CSS.escape(key)}"]`));
}

/** Converts a pointer position to graph coordinates. */
function clientToGraph(clientX, clientY) {
  const rect = dom.svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.view.x) / state.view.scale,
    y: (clientY - rect.top - state.view.y) / state.view.scale,
  };
}

/** Rounds a coordinate to the grid. */
function snap(value) {
  return Math.round(value / GRID) * GRID;
}

/** Zooms around a point on screen. */
function zoomAt(factor, clientX, clientY) {
  const rect = dom.svg.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.view.scale * factor));
  const ratio = scale / state.view.scale;
  state.view = { scale, x: px - (px - state.view.x) * ratio, y: py - (py - state.view.y) * ratio };
  applyView();
}

/** Zooms around the centre of the canvas. */
function zoomCentre(factor) {
  const rect = dom.svg.getBoundingClientRect();
  zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/** Fits the whole visible graph into the canvas. */
function fit() {
  const rect = dom.svg.getBoundingClientRect();
  state.view = fitToView(state.layout, rect.width, rect.height);
  applyView();
}

/** Runs a canvas button: a group toggle, or opening the inside of a block or step. */
function runCanvasAction(el) {
  const { action, node, group, drill } = el.dataset;
  if (action === "toggle-group") toggleGroup(group);
  if (action === "open-block") openBlock(node);
  if (action === "open-step") openStep(drill);
}

/** Returns the distance between the two active pointers. */
function pointerDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Starts a pan, pinch, node drag, connection drag or selection. */
function onPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  dom.svg.setPointerCapture(event.pointerId);

  if (pointers.size === 2) {
    state.interaction = { kind: "pinch", distance: pointerDistance() };
    state.drag = null;
    renderPendingEdge(state.layers.overlay, null, null);
    return;
  }

  const target = event.target;
  const action = target.closest("[data-action]");
  if (action) {
    state.interaction = null;
    runCanvasAction(action);
    return;
  }

  // inside a block, steps only select; the canvas still pans
  const stepEl = target.closest("[data-step]");
  if (stepEl) {
    inspectorActions.select({ kind: "step", id: stepEl.dataset.step });
    state.interaction = panFrom(event, false);
    return;
  }

  const outPort = target.closest(".port-out");
  if (outPort && wideQuery.matches && !inDrill()) {
    state.interaction = { kind: "connect", from: { node: outPort.dataset.node, port: outPort.dataset.port } };
    return;
  }

  const nodeEl = target.closest(".node");
  if (nodeEl && nodeEl.dataset.node) {
    const id = nodeEl.dataset.node;
    const node = currentGraph().nodes.find((n) => n.id === id);
    const doubleTap = state.lastTap?.id === id && event.timeStamp - state.lastTap.time < DOUBLE_TAP_MS;
    state.lastTap = { id, time: event.timeStamp };
    state.selection = { kind: "node", id };
    if (doubleTap) {
      openBlock(id);
      state.interaction = null;
      return;
    }
    renderGraph();
    renderSidePanels();
    state.interaction = wideQuery.matches
      ? { kind: "drag", id, startX: event.clientX, startY: event.clientY, origin: { ...node.position }, moved: false }
      : panFrom(event, false);
    return;
  }

  const edgeEl = target.closest(".edge-hit");
  if (edgeEl && !inDrill()) {
    const edge = currentGraph().edges[Number(edgeEl.dataset.edge)];
    inspectorActions.select({ kind: "edge", from: edge.from, to: edge.to });
    state.interaction = null;
    return;
  }

  const groupEl = target.closest(".group-box, .group-header");
  if (groupEl) inspectorActions.select({ kind: "group", id: groupEl.dataset.group });
  state.interaction = panFrom(event, !groupEl);
}

/** Starts a pan from the current pointer. */
function panFrom(event, clearOnClick) {
  return {
    kind: "pan", startX: event.clientX, startY: event.clientY,
    originX: state.view.x, originY: state.view.y, moved: false, clearOnClick,
  };
}

/** Continues the current pointer interaction. */
function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const it = state.interaction;
  if (!it) return;

  if (it.kind === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = pointerDistance();
    zoomAt(distance / it.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    it.distance = distance;
    return;
  }

  const dx = event.clientX - it.startX;
  const dy = event.clientY - it.startY;

  if (it.kind === "pan") {
    if (Math.hypot(dx, dy) > 3) it.moved = true;
    state.view = { ...state.view, x: it.originX + dx, y: it.originY + dy };
    applyView();
    return;
  }

  if (it.kind === "drag") {
    if (!it.moved && Math.hypot(dx, dy) < 4) return;
    it.moved = true;
    state.drag = {
      id: it.id,
      position: { x: snap(it.origin.x + dx / state.view.scale), y: snap(it.origin.y + dy / state.view.scale) },
    };
    renderDragFrame();
    return;
  }

  if (it.kind === "connect") {
    renderPendingEdge(state.layers.overlay, portPoint(state.layout, it.from, "outputs"), clientToGraph(event.clientX, event.clientY));
  }
}

/** Finishes the current pointer interaction. */
function onPointerUp(event) {
  pointers.delete(event.pointerId);
  const it = state.interaction;
  if (pointers.size > 0) {
    if (it?.kind === "pinch") state.interaction = null;
    return;
  }
  state.interaction = null;
  if (!it) return;

  if (it.kind === "drag") {
    const drag = state.drag;
    state.drag = null;
    if (!drag) return;
    const node = currentGraph().nodes.find((n) => n.id === drag.id);
    if (node.position.x === drag.position.x && node.position.y === drag.position.y) renderGraph();
    else applyEdit((graph) => updateNode(graph, drag.id, { position: drag.position }));
    return;
  }

  if (it.kind === "pan" && !it.moved && it.clearOnClick && state.selection) {
    inspectorActions.select(null);
    return;
  }

  if (it.kind === "connect") {
    renderPendingEdge(state.layers.overlay, null, null);
    const inPort = document.elementFromPoint(event.clientX, event.clientY)?.closest(".port-in");
    if (inPort?.dataset.node) tryConnect(it.from, { node: inPort.dataset.node, port: inPort.dataset.port });
  }
}

/** Abandons the current pointer interaction. */
function onPointerCancel(event) {
  pointers.delete(event.pointerId);
  state.interaction = null;
  if (state.drag) {
    state.drag = null;
    renderGraph();
  }
  renderPendingEdge(state.layers.overlay, null, null);
}

/** Moves keyboard focus to the nearest canvas item in an arrow direction. */
function focusNeighbour(fromEl, [dx, dy]) {
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const origin = centre(fromEl);
  let best = null;
  let bestScore = Infinity;
  for (const el of dom.svg.querySelectorAll(".layer-nodes > [data-key], .group-header")) {
    if (el === fromEl) continue;
    const c = centre(el);
    const along = (c.x - origin.x) * dx + (c.y - origin.y) * dy;
    const across = Math.abs((c.x - origin.x) * dy - (c.y - origin.y) * dx);
    if (along <= 1) continue;
    const score = along + 2 * across;
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  }
  best?.focus();
}

/** Handles keys on focused canvas items. */
function onCanvasKeyDown(event) {
  const target = event.target;
  const action = target.closest?.("[data-action]");
  const item = target.closest?.("[data-key]");
  const nodeId = target.closest?.("[data-node]")?.dataset.node;
  const stepId = target.closest?.("[data-step]")?.dataset.step;
  const groupId = item?.dataset.group;

  if ((event.key === "Enter" || event.key === " ") && action) {
    event.preventDefault();
    runCanvasAction(action);
    return;
  }

  if ((event.key === "Enter" || event.key === " ") && item) {
    event.preventDefault();
    if (stepId) inspectorActions.select({ kind: "step", id: stepId });
    else inspectorActions.select(nodeId ? { kind: "node", id: nodeId } : { kind: "group", id: groupId });
    dom.inspector.querySelector(".inspector-heading")?.focus();
    return;
  }

  // opens the inside of a block or step
  if (event.key.toLowerCase() === "e" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (stepId) {
      const level = state.drill.at(-1);
      const step = internalsFor(level.key, level.params)?.nodes.find((n) => n.id === stepId);
      if (step?.drill) openStep(step.drill);
    } else if (nodeId) openBlock(nodeId);
    else if (groupId) toggleGroup(groupId);
    return;
  }

  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  if (direction && item) {
    event.preventDefault();
    if (event.shiftKey && nodeId && wideQuery.matches && !inDrill()) {
      const node = currentGraph().nodes.find((n) => n.id === nodeId);
      const position = { x: node.position.x + direction[0] * GRID, y: node.position.y + direction[1] * GRID };
      applyEdit((graph) => updateNode(graph, nodeId, { position }));
    } else {
      focusNeighbour(item, direction);
    }
  }
}

/** Handles page-wide shortcuts. */
function onDocumentKeyDown(event) {
  const inField = event.target.closest?.("input, select, textarea");

  if (event.key === "Escape") {
    if (state.interaction?.kind === "connect") {
      state.interaction = null;
      renderPendingEdge(state.layers.overlay, null, null);
      return;
    }
    const sel = state.selection;
    if (dom.inspector.contains(event.target) && sel && sel.kind !== "edge") {
      const key = sel.kind === "step" ? `step:${sel.id}` : `${sel.kind}:${sel.id}`;
      dom.svg.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
      return;
    }
    if (!inField && sel) inspectorActions.select(null);
    else if (!inField && inDrill()) goToLevel(state.drill.length - 2);
    return;
  }
  if (inField) return;

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === "z" && !event.shiftKey) {
    event.preventDefault();
    if (wideQuery.matches && !inDrill()) setHistory(undo(currentHistory()));
    return;
  }
  if (mod && ((key === "z" && event.shiftKey) || key === "y")) {
    event.preventDefault();
    if (wideQuery.matches && !inDrill()) setHistory(redo(currentHistory()));
    return;
  }
  if (mod || event.altKey) return;

  if ((event.key === "Delete" || event.key === "Backspace") && state.selection && wideQuery.matches && !inDrill()) {
    event.preventDefault();
    deleteSelection();
  } else if (key === "f") {
    fit();
  } else if (event.key === "+" || event.key === "=") {
    zoomCentre(ZOOM_STEP);
  } else if (event.key === "-") {
    zoomCentre(1 / ZOOM_STEP);
  }
}

/** Runs a top-bar button. */
function onAction(name) {
  const history = currentHistory();
  if (name === "undo") setHistory(undo(history));
  if (name === "redo") setHistory(redo(history));
  if (name === "reset" && !history.present.readOnly) {
    setHistory(commit(history, presetById(state.presetId)));
    showStatus("Returned to the preset. Undo brings the edits back.");
  }
  if (name === "import") dom.importInput.click();
  if (name === "export") exportCurrent();
  if (name === "compare") {
    state.diffOpen = !state.diffOpen;
    renderTopbar();
    renderDiff();
  }
}

/** Downloads the graph on screen as JSON. */
function exportCurrent() {
  const graph = currentGraph();
  const url = URL.createObjectURL(new Blob([exportGraph(graph)], { type: "application/json" }));
  const link = h("a", { href: url, download: `${graph.id}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Loads a JSON file as the working copy, or reports what is wrong and where. */
async function onImportFile() {
  const file = dom.importInput.files?.[0];
  dom.importInput.value = "";
  if (!file || !wideQuery.matches) return;
  const { graph, errors } = importGraph(await file.text());
  if (errors.length > 0) {
    const shown = errors.slice(0, 8).join("\n");
    const more = errors.length > 8 ? `\n…and ${errors.length - 8} more` : "";
    showStatus(`Import failed: ${errors.length} problem${errors.length === 1 ? "" : "s"} in ${file.name}\n${shown}${more}`, "error");
    return;
  }
  state.selection = null;
  state.drill = [];
  setHistory(commit(currentHistory(), { ...graph, basePreset: graph.basePreset ?? state.presetId }));
  fit();
  showStatus(`Imported ${graph.name}.`);
}

/** Builds the static controls and wires up events. */
function init() {
  dom.presets.replaceChildren(...PRESETS.map((p) => h("button", {
    type: "button", class: "preset", "data-preset": p.id, "aria-pressed": "false", onClick: () => selectPreset(p.id),
  }, p.name)));
  renderPalette(dom.palette, { onAdd: (typeId) => addBlock(typeId) });

  dom.actions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) onAction(button.dataset.action);
  });
  dom.importInput.addEventListener("change", onImportFile);
  dom.zoom.addEventListener("click", (event) => {
    const zoom = event.target.closest("button")?.dataset.zoom;
    if (zoom === "in") zoomCentre(ZOOM_STEP);
    if (zoom === "out") zoomCentre(1 / ZOOM_STEP);
    if (zoom === "fit") fit();
  });

  dom.svg.addEventListener("pointerdown", onPointerDown);
  dom.svg.addEventListener("pointermove", onPointerMove);
  dom.svg.addEventListener("pointerup", onPointerUp);
  dom.svg.addEventListener("pointercancel", onPointerCancel);
  dom.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });
  dom.svg.addEventListener("keydown", onCanvasKeyDown);
  dom.svg.addEventListener("focusin", (event) => ensureVisible(event.target.closest?.("[data-key]")));
  document.addEventListener("keydown", onDocumentKeyDown);

  dom.svg.addEventListener("dragover", (event) => {
    if (wideQuery.matches && !inDrill() && event.dataTransfer.types.includes(BLOCK_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  dom.svg.addEventListener("drop", (event) => {
    const typeId = event.dataTransfer.getData(BLOCK_MIME);
    if (!BLOCK_TYPES[typeId] || inDrill()) return;
    event.preventDefault();
    const point = clientToGraph(event.clientX, event.clientY);
    addBlock(typeId, { x: snap(state.layout.toStoredX(point.x - NODE_W / 2)), y: snap(point.y - NODE_H / 2) });
  });

  wideQuery.addEventListener("change", () => {
    render();
    requestAnimationFrame(fit);
  });

  render();
  requestAnimationFrame(fit);
}

init();
