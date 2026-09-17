import { BLOCK_TYPES } from "../catalogue.js";
import { internalsFor } from "../internals.js";
import { countBlockParams, formatCount } from "../params.js";
import { formatShape, portShape } from "../shapes.js";
import { categoryClass, h, richText } from "./dom.js";

const WIDTH = 300;
const GAP = 14;
const EDGE = 12;

/** Keeps a number inside a range. */
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

/** Returns the canvas element of the selected block, if it is on screen. */
function anchorFor(svgRoot, selection) {
  if (selection?.kind !== "node") return null;
  return svgRoot.querySelector(`[data-key="${CSS.escape(`node:${selection.id}`)}"]`);
}

/** Puts the card beside the block, flipping to the other side and clamping to the canvas. */
function place(container, block, canvas) {
  const width = container.offsetWidth || WIDTH;
  const height = container.offsetHeight;
  const fitsRight = canvas.right - block.right - GAP >= width;
  const left = fitsRight ? block.right + GAP - canvas.left : block.left - GAP - width - canvas.left;
  container.style.left = `${clamp(left, EDGE, canvas.width - width - EDGE)}px`;
  container.style.top = `${clamp(block.top - canvas.top, EDGE, canvas.height - height - EDGE)}px`;
}

/** Shows a card beside the selected block, or hides it when no block is selected. */
export function renderTooltip(container, { graph, selection, canvas, svgRoot, actions }) {
  const node = selection?.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : null;
  const anchor = node && anchorFor(svgRoot, selection);
  if (!node || !anchor) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  // builds the card: what the block is, what it does, its shapes and its size
  const type = BLOCK_TYPES[node.type];
  const count = countBlockParams(node.type, node.params);
  const group = graph.groups.find((g) => g.id === node.group);
  const ports = [
    ...type.inputs.map((port) => ["in", port, "inputs"]),
    ...type.outputs.map((port) => ["out", port, "outputs"]),
  ];
  container.replaceChildren(
    h("p", { class: `eyebrow cat-text ${categoryClass(type.category)}` }, type.category),
    h("h3", { class: "tooltip-heading", tabindex: "-1" }, type.name),
    h("p", { class: "tooltip-text" }, richText(type.description)),
    h("dl", { class: "facts" },
      ports.map(([side, port, direction]) => [
        h("dt", {}, `${side} ${port.id}`),
        h("dd", {}, formatShape(portShape(graph, node.id, port.id, direction))),
      ]),
      h("dt", {}, "Parameters"),
      h("dd", {}, group ? `${formatCount(count)} × ${group.repeat}` : formatCount(count))),
    h("div", { class: "tooltip-actions" },
      internalsFor(node.type, node.params) && h("button", { type: "button", onClick: () => actions.openBlock(node.id) }, "Open inside"),
      h("button", { type: "button", onClick: () => actions.select(null) }, "Close")),
  );

  container.hidden = false;
  place(container, anchor.getBoundingClientRect(), canvas.getBoundingClientRect());
}

/** Moves an open card back beside its block after a pan or zoom. */
export function placeTooltip(container, { selection, canvas, svgRoot }) {
  if (container.hidden) return;
  const anchor = anchorFor(svgRoot, selection);
  if (anchor) place(container, anchor.getBoundingClientRect(), canvas.getBoundingClientRect());
}
