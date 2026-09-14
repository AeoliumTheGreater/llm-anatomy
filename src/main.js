import { BLOCK_TYPES } from "./catalogue.js";
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
import { layoutGraph, renderCanvas, fitToView, portPoint, GRID, NODE_W, NODE_H } from "./view/canvas.js";
import { renderEdges, renderPendingEdge } from "./view/edges.js";
import { renderInspector } from "./view/inspector.js";
import { renderPalette, BLOCK_MIME } from "./view/palette.js";
import { renderDiffPanel } from "./view/diffpanel.js";
import { h } from "./view/dom.js";

const PRESETS = [QWEN2_5, QWEN3, QWEN3_5];
const THEMES = ["system", "light", "dark"];
const MIN_SCALE = 0.15;
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
  zoom: document.querySelector(".zoom-controls"),
  status: document.querySelector(".status"),
  inspector: document.querySelector(".inspector"),
  diffpanel: document.querySelector(".diffpanel"),
};

const savedPreset = loadSetting(storage, "preset");
const savedTheme = loadSetting(storage, "theme");
const state = {
  presetId: PRESETS.some((p) => p.id === savedPreset) ? savedPreset : QWEN3.id,
  histories: new Map(),
  collapsed: new Map(),
  expanded: new Set(),
  selection: null,
  view: { x: 0, y: 0, scale: 1 },
  diffOpen: false,
  compareWith: null,
  theme: THEMES.includes(savedTheme) ? savedTheme : "system",
  interaction: null,
  drag: null,
  lastTap: null,
  layout: null,
  layers: null,
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

  // keeps storage in step: presets are never stored, working copies always are
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
  if (!wideQuery.matches) return;
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
  return { x: snap(point.x - NODE_W / 2), y: snap(state.layout.toStoredY(point.y - NODE_H / 2)) };
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

/** Redraws everything. */
function render({ animate = false } = {}) {
  renderTopbar();
  renderGraph({ animate });
  renderSidePanels();
}

/** Updates the preset toggle, badge and action buttons. */
function renderTopbar() {
  const graph = currentGraph();
  const history = currentHistory();
  const canEdit = wideQuery.matches;
  for (const button of dom.presets.children) button.setAttribute("aria-pressed", String(button.dataset.preset === state.presetId));
  dom.badge.hidden = graph.readOnly;
  const action = (name) => dom.actions.querySelector(`[data-action="${name}"]`);
  action("undo").disabled = !canEdit || history.past.length === 0;
  action("redo").disabled = !canEdit || history.future.length === 0;
  action("reset").disabled = !canEdit || graph.readOnly;
  action("import").disabled = !canEdit;
  action("compare").setAttribute("aria-expanded", String(state.diffOpen));
  action("theme").textContent = `Theme: ${state.theme}`;
}

/** Redraws the canvas, keeping keyboard focus on the same item. */
function renderGraph({ animate = false } = {}) {
  const graph = currentGraph();
  const { missing, invalid } = problems(graph);
  const focusKey = dom.svg.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const moving = animate && !motionQuery.matches;

  // marks the canvas so shared blocks glide and others fade during a preset switch
  if (moving) {
    dom.svg.classList.add("animate");
    clearTimeout(state.animationTimer);
    state.animationTimer = setTimeout(() => dom.svg.classList.remove("animate"), ANIMATION_MS);
  }

  // lays out and draws the graph
  state.layout = layoutGraph(graph, { collapsed: collapsedFor(), expanded: state.expanded, drag: state.drag });
  state.layers = renderCanvas(dom.svg, {
    graph, layout: state.layout, selection: state.selection, animate: moving, dragId: state.drag?.id,
    warnings: new Set([...missing.map((m) => m.node), ...invalid.map((p) => p.edge.to.node)]),
    missing: new Set(missing.map((m) => `${m.node}:${m.port}`)),
  });
  renderEdges(state.layers.edges, { graph, layout: state.layout, selection: state.selection, invalid: new Set(invalid.map((p) => p.index)) });
  applyView();

  // restores focus when the focused element was rebuilt
  if (focusKey && document.activeElement?.dataset?.key !== focusKey) {
    dom.svg.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
}

/** Redraws the inspector and the difference panel. */
function renderSidePanels() {
  const graph = currentGraph();
  renderInspector(dom.inspector, {
    graph, selection: state.selection, canEdit: wideQuery.matches, preset: presetById(state.presetId),
    ...problems(graph), isCollapsed, actions: inspectorActions,
  });
  renderDiff();
}

/** Redraws the difference panel when it is open. */
function renderDiff() {
  dom.diffpanel.hidden = !state.diffOpen;
  if (!state.diffOpen) return;
  const graph = currentGraph();

  // compares with the previous preset, or with the base preset of an edited copy
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
    if (selection?.kind === "node" && selection.subBlock) state.expanded.add(selection.id);
    renderGraph();
    renderSidePanels();
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
};

/** Shows or hides a block's sub-blocks. */
function toggleSub(nodeId) {
  if (state.expanded.has(nodeId)) state.expanded.delete(nodeId);
  else state.expanded.add(nodeId);
  renderGraph();
}

/** Expands or collapses a repeated group. */
function toggleGroup(groupId) {
  collapsedFor().set(groupId, !isCollapsed(groupId));
  renderGraph();
  renderSidePanels();
}

/** Switches to another preset, keeping the view so shared blocks stay in place. */
function selectPreset(id) {
  if (id === state.presetId) return;
  state.compareWith = state.presetId;
  state.presetId = id;
  state.selection = null;
  saveSetting(storage, "preset", id);
  render({ animate: true });
}

/** Applies the pan and zoom to the canvas and its dotted grid. */
function applyView() {
  const { x, y, scale } = state.view;
  state.layers.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  dom.wrap.style.backgroundPosition = `${x}px ${y}px`;
  dom.wrap.style.backgroundSize = `${GRID * scale}px ${GRID * scale}px`;
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

/** Runs a canvas button: a sub-block toggle, group toggle or sub-block row. */
function runCanvasAction(el) {
  const { action, node, group, sub } = el.dataset;
  if (action === "toggle-sub") toggleSub(node);
  if (action === "toggle-group") toggleGroup(group);
  if (action === "select-sub") inspectorActions.select({ kind: "node", id: node, subBlock: sub });
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

  // starts a pinch when a second finger lands
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

  // starts dragging a new connection from an output port
  const outPort = target.closest(".port-out");
  if (outPort && wideQuery.matches) {
    state.interaction = { kind: "connect", from: { node: outPort.dataset.node, port: outPort.dataset.port } };
    return;
  }

  // selects a node, toggles its sub-blocks on double tap and starts dragging it
  const nodeEl = target.closest(".node");
  if (nodeEl) {
    const id = nodeEl.dataset.node;
    const node = currentGraph().nodes.find((n) => n.id === id);
    const doubleTap = state.lastTap?.id === id && event.timeStamp - state.lastTap.time < DOUBLE_TAP_MS;
    state.lastTap = { id, time: event.timeStamp };
    state.selection = { kind: "node", id };
    if (doubleTap) state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    renderGraph();
    renderSidePanels();
    state.interaction = wideQuery.matches
      ? { kind: "drag", id, startX: event.clientX, startY: event.clientY, origin: { ...node.position }, moved: false }
      : { kind: "pan", startX: event.clientX, startY: event.clientY, originX: state.view.x, originY: state.view.y, moved: false };
    return;
  }

  // selects an edge
  const edgeEl = target.closest(".edge-hit");
  if (edgeEl) {
    const edge = currentGraph().edges[Number(edgeEl.dataset.edge)];
    inspectorActions.select({ kind: "edge", from: edge.from, to: edge.to });
    state.interaction = null;
    return;
  }

  // selects a group, then pans from anywhere else
  const groupEl = target.closest(".group-box, .group-header");
  if (groupEl) inspectorActions.select({ kind: "group", id: groupEl.dataset.group });
  state.interaction = {
    kind: "pan", startX: event.clientX, startY: event.clientY,
    originX: state.view.x, originY: state.view.y, moved: false, clearOnClick: !groupEl,
  };
}

/** Continues the current pointer interaction. */
function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const it = state.interaction;
  if (!it) return;

  // zooms by the change in finger distance
  if (it.kind === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = pointerDistance();
    zoomAt(distance / it.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    it.distance = distance;
    return;
  }

  const dx = event.clientX - it.startX;
  const dy = event.clientY - it.startY;

  // pans the view
  if (it.kind === "pan") {
    if (Math.hypot(dx, dy) > 3) it.moved = true;
    state.view = { ...state.view, x: it.originX + dx, y: it.originY + dy };
    applyView();
    return;
  }

  // moves the dragged node on the grid without recording an edit yet
  if (it.kind === "drag") {
    if (!it.moved && Math.hypot(dx, dy) < 4) return;
    it.moved = true;
    state.drag = {
      id: it.id,
      position: { x: snap(it.origin.x + dx / state.view.scale), y: snap(it.origin.y + dy / state.view.scale) },
    };
    renderGraph();
    return;
  }

  // draws the pending connection to the pointer
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

  // records a finished drag as one edit
  if (it.kind === "drag") {
    const drag = state.drag;
    state.drag = null;
    if (!drag) return;
    const node = currentGraph().nodes.find((n) => n.id === drag.id);
    if (node.position.x === drag.position.x && node.position.y === drag.position.y) renderGraph();
    else applyEdit((graph) => updateNode(graph, drag.id, { position: drag.position }));
    return;
  }

  // clears the selection after a click on empty canvas
  if (it.kind === "pan" && !it.moved && it.clearOnClick && state.selection) {
    inspectorActions.select(null);
    return;
  }

  // connects to the input port under the pointer
  if (it.kind === "connect") {
    renderPendingEdge(state.layers.overlay, null, null);
    const inPort = document.elementFromPoint(event.clientX, event.clientY)?.closest(".port-in");
    if (inPort) tryConnect(it.from, { node: inPort.dataset.node, port: inPort.dataset.port });
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
  const nodeId = target.closest?.(".node")?.dataset.node;
  const groupId = item?.dataset.group;

  // activates canvas buttons
  if ((event.key === "Enter" || event.key === " ") && action) {
    event.preventDefault();
    runCanvasAction(action);
    return;
  }

  // inspects the focused block or group and moves focus to the inspector
  if ((event.key === "Enter" || event.key === " ") && item) {
    event.preventDefault();
    inspectorActions.select(nodeId ? { kind: "node", id: nodeId } : { kind: "group", id: groupId });
    dom.inspector.querySelector(".inspector-heading")?.focus();
    return;
  }

  // expands sub-blocks or groups
  if (event.key.toLowerCase() === "e" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (nodeId) toggleSub(nodeId);
    else if (groupId) toggleGroup(groupId);
    return;
  }

  // moves a block with Shift, otherwise moves focus
  const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
  if (direction && item) {
    event.preventDefault();
    if (event.shiftKey && nodeId && wideQuery.matches) {
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

  // returns from the inspector to the selected canvas item, or clears the selection
  if (event.key === "Escape") {
    if (state.interaction?.kind === "connect") {
      state.interaction = null;
      renderPendingEdge(state.layers.overlay, null, null);
      return;
    }
    const sel = state.selection;
    if (dom.inspector.contains(event.target) && sel && sel.kind !== "edge") {
      dom.svg.querySelector(`[data-key="${CSS.escape(`${sel.kind}:${sel.id}`)}"]`)?.focus();
      return;
    }
    if (!inField && sel) inspectorActions.select(null);
    return;
  }
  if (inField) return;

  // undoes and redoes
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === "z" && !event.shiftKey) {
    event.preventDefault();
    if (wideQuery.matches) setHistory(undo(currentHistory()));
    return;
  }
  if (mod && ((key === "z" && event.shiftKey) || key === "y")) {
    event.preventDefault();
    if (wideQuery.matches) setHistory(redo(currentHistory()));
    return;
  }
  if (mod || event.altKey) return;

  // deletes, fits and zooms
  if ((event.key === "Delete" || event.key === "Backspace") && state.selection && wideQuery.matches) {
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
  if (name === "theme") {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    saveSetting(storage, "theme", state.theme);
    applyTheme();
    renderTopbar();
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
  setHistory(commit(currentHistory(), { ...graph, basePreset: graph.basePreset ?? state.presetId }));
  fit();
  showStatus(`Imported ${graph.name}.`);
}

/** Applies the chosen theme; "system" follows the operating system. */
function applyTheme() {
  if (state.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
}

/** Builds the static controls and wires up events. */
function init() {
  applyTheme();

  // builds the preset toggle and palette
  dom.presets.replaceChildren(...PRESETS.map((p) => h("button", {
    type: "button", class: "preset", "data-preset": p.id, "aria-pressed": "false", onClick: () => selectPreset(p.id),
  }, p.name)));
  renderPalette(dom.palette, { onAdd: (typeId) => addBlock(typeId) });

  // wires buttons and file import
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

  // wires canvas pointer, wheel and keyboard input
  dom.svg.addEventListener("pointerdown", onPointerDown);
  dom.svg.addEventListener("pointermove", onPointerMove);
  dom.svg.addEventListener("pointerup", onPointerUp);
  dom.svg.addEventListener("pointercancel", onPointerCancel);
  dom.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });
  dom.svg.addEventListener("keydown", onCanvasKeyDown);
  document.addEventListener("keydown", onDocumentKeyDown);

  // accepts blocks dropped from the palette
  dom.svg.addEventListener("dragover", (event) => {
    if (wideQuery.matches && event.dataTransfer.types.includes(BLOCK_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  dom.svg.addEventListener("drop", (event) => {
    const typeId = event.dataTransfer.getData(BLOCK_MIME);
    if (!BLOCK_TYPES[typeId]) return;
    event.preventDefault();
    const point = clientToGraph(event.clientX, event.clientY);
    addBlock(typeId, { x: snap(point.x - NODE_W / 2), y: snap(state.layout.toStoredY(point.y - NODE_H / 2)) });
  });

  // redraws when the layout switches between wide and narrow
  wideQuery.addEventListener("change", () => {
    render();
    requestAnimationFrame(fit);
  });

  render();
  requestAnimationFrame(fit);
}

init();
