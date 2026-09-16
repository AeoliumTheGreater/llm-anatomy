import { BLOCK_TYPES } from "../catalogue.js";
import { internalsFor } from "../internals.js";
import { sameEndpoint } from "../graph.js";
import { countBlockParams, countGraphParams, formatCount } from "../params.js";
import { checkConnection, formatShape, portShape, resolveShape } from "../shapes.js";
import { blockTypeCounts, GLOBAL_LABELS } from "../diff.js";
import { categoryClass, h, replaceKeepingFocus, richText } from "./dom.js";

const HELP = [
  "Tab moves between blocks; arrow keys jump to the nearest block.",
  "Enter inspects the focused block; Escape returns to the canvas.",
  "E opens the inside of a block, or expands and collapses a group.",
  "Shift + arrow keys move a block; Delete removes the selection.",
  "Drag from an output port (right) to an input port (left) to connect.",
  "Ctrl+Z undoes, Ctrl+Shift+Z redoes, F fits the view, + and − zoom.",
];

const full = (n) => n.toLocaleString("en-GB");

/** Shows the open block's insides, or the selected block, group or connection. */
export function renderInspector(container, ctx) {
  const { selection, drill } = ctx;
  let content = null;
  if (drill.length > 0) content = drillView(ctx);
  else if (selection?.kind === "node") content = nodeView(ctx, selection);
  else if (selection?.kind === "group") content = groupView(ctx, selection);
  else if (selection?.kind === "edge") content = edgeView(ctx, selection);
  replaceKeepingFocus(container, content ?? overview(ctx));
}

/** Builds the focusable heading that Enter on the canvas moves to. */
function heading(text) {
  return h("h2", { class: "inspector-heading", tabindex: "-1", "data-focus-key": "heading" }, text);
}

/** Builds a titled section. */
function section(title, ...children) {
  return h("section", {}, h("h3", {}, title), ...children);
}

/** Builds a list of source links. */
function sourceList(sources) {
  return h("ul", { class: "sources" }, sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.label))));
}

/** Builds a note that editing a preset creates a copy. */
function readOnlyNote(graph) {
  return graph.readOnly ? h("p", { class: "note" }, "Changing a value creates an edited copy of this preset.") : null;
}

/** Builds the model overview. */
function overview(ctx) {
  const { graph, preset } = ctx;
  const { total } = countGraphParams(graph);
  const counts = blockTypeCounts(graph);
  return [
    h("p", { class: "eyebrow" }, graph.readOnly ? "Preset" : `Edited copy of ${preset.name}`),
    heading(graph.name),
    h("dl", { class: "facts" },
      h("dt", {}, "Parameters"), h("dd", {}, `${formatCount(total)} (${full(total)})`),
      Object.entries(GLOBAL_LABELS).filter(([key]) => key in graph.globals)
        .map(([key, label]) => [h("dt", {}, label), h("dd", {}, full(graph.globals[key]))])),
    problemsSection(ctx),
    section("Blocks", h("ul", { class: "plain" }, Object.entries(counts).map(([type, n]) => h("li", {}, `${BLOCK_TYPES[type].name} × ${n}`)))),
    section("Sources", sourceList(graph.sources)),
    section("Using the canvas", h("ul", { class: "plain help" }, HELP.map((line) => h("li", {}, line)))),
  ];
}

/** Lists unconnected inputs and mismatched connections, each linking to the block or edge. */
function problemsSection({ graph, missing, invalid, actions }) {
  if (missing.length === 0 && invalid.length === 0) return null;
  return section("Problems", h("ul", { class: "plain problems" },
    missing.map((m) => h("li", {}, h("button", { type: "button", onClick: () => actions.select({ kind: "node", id: m.node }) },
      `${BLOCK_TYPES[graph.nodes.find((n) => n.id === m.node).type].name} (${m.node}): input ${m.port} is not connected`))),
    invalid.map((p) => h("li", {}, h("button", { type: "button", onClick: () => actions.select({ kind: "edge", from: p.edge.from, to: p.edge.to }) }, p.message)))));
}

/** Builds the view of one block. */
function nodeView(ctx, selection) {
  const { graph, canEdit, actions } = ctx;
  const node = graph.nodes.find((n) => n.id === selection.id);
  if (!node) return null;
  const type = BLOCK_TYPES[node.type];
  const count = countBlockParams(node.type, node.params);
  const group = graph.groups.find((g) => g.id === node.group);
  const entry = internalsFor(node.type, node.params);

  return [
    h("p", { class: `eyebrow cat-text ${categoryClass(type.category)}` }, type.category),
    heading(type.name),
    h("p", { class: "muted mono" }, node.id),
    h("p", { class: "description" }, richText(type.description)),
    entry && section("Inside",
      h("p", { class: "note" }, `${entry.nodes.length} steps: ${entry.nodes.map((n) => n.name).join(", ")}.`),
      h("button", { type: "button", "data-focus-key": "open-inside", onClick: () => actions.openBlock(node.id) }, `Open the inside of ${type.name}`)),
    section("Shapes", shapesTable(graph, node, type)),
    section("Parameters", h("p", { class: "count" }, group
      ? `${full(count)} per repeat × ${group.repeat} = ${full(count * group.repeat)} (${formatCount(count * group.repeat)})`
      : `${full(count)} (${formatCount(count)})`)),
    section("Settings", readOnlyNote(graph), paramForm(canEdit, node, type, actions)),
    canEdit && type.inputs.some((p) => !p.external) && section("Connections", connectionForm(graph, node, type, actions)),
    canEdit && h("button", { type: "button", class: "danger", onClick: () => actions.remove(node.id) }, "Delete block"),
    section("Sources", sourceList(type.sources)),
  ];
}

/** Builds the view inside a block: the open level, or one selected step of it. */
function drillView(ctx) {
  const { graph, entry, level, selection, drill, actions } = ctx;
  if (!entry) return null;
  const step = selection?.kind === "step" ? entry.nodes.find((n) => n.id === selection.id) : null;
  const parent = drill.length > 1 ? drill.at(-2).label : graph.name;

  // one step of the open graph
  if (step) {
    const shape = step.shape ? formatShape(resolveShape(step.shape, level.params, graph.globals)) : null;
    return [
      h("p", { class: "eyebrow" }, `Inside ${level.label}`),
      heading(step.name),
      step.equation && h("p", { class: "equation" }, step.equation),
      h("p", { class: "description" }, richText(step.description)),
      shape && section("Shape", h("p", { class: "mono" }, shape)),
      step.drill && h("button", { type: "button", onClick: () => actions.openStep(step.drill) }, `Open the inside of ${step.name}`),
      h("p", {}, h("button", { type: "button", class: "link-button", onClick: () => actions.select(null) }, `Back to ${level.label}`)),
    ];
  }

  // the open graph itself
  return [
    h("p", { class: "eyebrow" }, `Inside ${parent}`),
    heading(level.label),
    h("p", { class: "note" }, "Select a step on the canvas to read what it does. A step with a + opens one level further."),
    section("Steps", h("ul", { class: "chips" }, entry.nodes.map((n) => h("li", {},
      h("button", {
        type: "button", class: "chip", onClick: () => actions.select({ kind: "step", id: n.id }),
      }, n.name))))),
    h("button", { type: "button", onClick: () => actions.goToLevel(drill.length - 2) }, `Back to ${parent}`),
  ];
}

/** Builds the table of input and output shapes with their connections. */
function shapesTable(graph, node, type) {
  const rows = [];
  for (const port of type.inputs) {
    const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === port.id);
    const status = port.external ? "token ids" : edge ? `from ${edge.from.node}` : "not connected";
    rows.push(h("tr", { class: !edge && !port.external ? "is-missing" : null },
      h("th", { scope: "row" }, `in ${port.id}`),
      h("td", { class: "mono" }, formatShape(portShape(graph, node.id, port.id, "inputs"))),
      h("td", { class: "muted" }, status)));
  }
  for (const port of type.outputs) {
    const targets = graph.edges.filter((e) => e.from.node === node.id && e.from.port === port.id).length;
    rows.push(h("tr", {},
      h("th", { scope: "row" }, `out ${port.id}`),
      h("td", { class: "mono" }, formatShape(portShape(graph, node.id, port.id, "outputs"))),
      h("td", { class: "muted" }, targets === 1 ? "to 1 block" : `to ${targets} blocks`)));
  }
  return h("div", { class: "table-wrap" }, h("table", { class: "shapes" }, h("tbody", {}, rows)));
}

/** Builds the editable parameter fields; invalid entries show a message and are not applied. */
function paramForm(canEdit, node, type, actions) {
  return h("div", { class: "param-form" }, Object.entries(type.params).map(([key, spec]) => {
    const focusKey = `param:${node.id}:${key}`;
    const value = node.params[key];

    if (spec.type === "bool") {
      return h("label", { class: "param-bool" },
        h("input", { type: "checkbox", checked: value, disabled: !canEdit, "data-focus-key": focusKey, onChange: (e) => actions.setParam(node.id, key, e.target.checked) }),
        spec.label);
    }

    const id = `param-${key}`;
    const error = h("span", { class: "param-error", "aria-live": "polite" });
    const input = h("input", {
      id, type: "number", value, disabled: !canEdit, "data-focus-key": focusKey,
      min: spec.type === "int" ? 1 : null, step: spec.type === "int" ? 1 : "any",
      onChange: (e) => {
        const parsed = Number(e.target.value);
        const ok = e.target.value !== "" && (spec.type === "int" ? Number.isInteger(parsed) && parsed > 0 : Number.isFinite(parsed));
        if (!ok) {
          e.target.setAttribute("aria-invalid", "true");
          error.textContent = spec.type === "int" ? "Enter a whole number above 0." : "Enter a number.";
          return;
        }
        actions.setParam(node.id, key, parsed);
      },
    });
    return h("div", { class: "param" }, h("label", { for: id }, spec.label), input, error);
  }));
}

/** Builds a keyboard-friendly way to choose what feeds each input port. */
function connectionForm(graph, node, type, actions) {
  const outputs = graph.nodes.filter((n) => n.id !== node.id).flatMap((n) => BLOCK_TYPES[n.type].outputs.map((p) => ({
    value: JSON.stringify([n.id, p.id]),
    label: `${n.id} · ${p.id} ${formatShape(portShape(graph, n.id, p.id, "outputs"))}`,
  })));

  return h("div", { class: "param-form" }, type.inputs.filter((p) => !p.external).map((port) => {
    const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === port.id);
    const current = edge ? JSON.stringify([edge.from.node, edge.from.port]) : "";
    const id = `connect-${port.id}`;
    const select = h("select", {
      id, "data-focus-key": `connect:${node.id}:${port.id}`,
      onChange: (e) => {
        const to = { node: node.id, port: port.id };
        if (e.target.value === "") {
          if (edge) actions.disconnect(edge);
          return;
        }
        const [fromNode, fromPort] = JSON.parse(e.target.value);
        if (!actions.connect({ node: fromNode, port: fromPort }, to)) e.target.value = current;
      },
    },
    h("option", { value: "" }, "Not connected"),
    outputs.map((o) => h("option", { value: o.value, selected: o.value === current }, o.label)));
    const shape = formatShape(portShape(graph, node.id, port.id, "inputs"));
    return h("div", { class: "param" }, h("label", { for: id }, `Input ${port.id} ${shape} from`), select);
  }));
}

/** Builds the view of a repeated group. */
function groupView(ctx, selection) {
  const { graph, canEdit, actions, isCollapsed } = ctx;
  const group = graph.groups.find((g) => g.id === selection.id);
  if (!group) return null;
  const perRepeat = countGraphParams(graph).perGroup[group.id];
  const members = graph.nodes.filter((n) => n.group === group.id);
  const error = h("span", { class: "param-error", "aria-live": "polite" });

  return [
    h("p", { class: "eyebrow" }, "Repeated group"),
    heading(group.label),
    h("p", {}, `Runs ${group.repeat} times in sequence. The canvas shows one repeat, never ${group.repeat} copies.`),
    section("How each layer uses the residual stream",
      h("p", { class: "equation" }, "h  = x + mixer(RMSNorm(x))", h("br"), "x′ = h + MLP(RMSNorm(h))"),
      h("p", { class: "note" }, "x arrives from the layer before. Each sub-layer reads a normalised copy of it and adds its update back; x′ is the input to the next layer. Nothing is replaced, so the final stream is the embedding plus every update.")),
    section("Parameters", h("p", { class: "count" }, `${full(perRepeat)} per repeat × ${group.repeat} = ${full(perRepeat * group.repeat)} (${formatCount(perRepeat * group.repeat)})`)),
    section("Settings", readOnlyNote(graph), h("div", { class: "param" },
      h("label", { for: "group-repeat" }, "Repeats"),
      h("input", {
        id: "group-repeat", type: "number", min: 1, step: 1, value: group.repeat, disabled: !canEdit, "data-focus-key": `repeat:${group.id}`,
        onChange: (e) => {
          const parsed = Number(e.target.value);
          if (!Number.isInteger(parsed) || parsed < 1) {
            e.target.setAttribute("aria-invalid", "true");
            error.textContent = "Enter a whole number above 0.";
            return;
          }
          actions.setRepeat(group.id, parsed);
        },
      }),
      error)),
    section("Blocks in one repeat", h("ul", { class: "plain" }, members.map((n) => h("li", {},
      h("button", { type: "button", class: "link-button", onClick: () => actions.select({ kind: "node", id: n.id }) }, `${BLOCK_TYPES[n.type].name} (${n.id})`))))),
    h("button", { type: "button", onClick: () => actions.toggleGroup(group.id) }, isCollapsed(group.id) ? "Expand group" : "Collapse group"),
  ];
}

/** Builds the view of one connection. */
function edgeView(ctx, selection) {
  const { graph, canEdit, actions } = ctx;
  const edge = graph.edges.find((e) => sameEndpoint(e.from, selection.from) && sameEndpoint(e.to, selection.to));
  if (!edge) return null;
  const check = checkConnection(graph, edge.from, edge.to);
  const fromShape = portShape(graph, edge.from.node, edge.from.port, "outputs");
  const toShape = portShape(graph, edge.to.node, edge.to.port, "inputs");

  return [
    h("p", { class: "eyebrow" }, "Connection"),
    heading(`${edge.from.node} → ${edge.to.node}`),
    h("dl", { class: "facts" },
      h("dt", {}, "From"), h("dd", { class: "mono" }, `${edge.from.port} ${fromShape ? formatShape(fromShape) : ""}`),
      h("dt", {}, "To"), h("dd", { class: "mono" }, `${edge.to.port} ${toShape ? formatShape(toShape) : ""}`)),
    h("p", { class: check.ok ? "muted" : "error-text" }, check.ok ? "The shapes match." : check.message),
    canEdit && h("button", { type: "button", class: "danger", onClick: () => actions.disconnect(edge) }, "Remove connection"),
  ];
}
