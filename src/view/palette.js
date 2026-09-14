import { BLOCK_TYPES, CATEGORIES } from "../catalogue.js";
import { categoryClass, h } from "./dom.js";

export const BLOCK_MIME = "application/x-llm-anatomy-block";

/** Lists catalogue block types that can be dragged onto the canvas or added with a click or Enter. */
export function renderPalette(container, { onAdd }) {
  container.replaceChildren(
    h("h2", {}, "Blocks"),
    h("p", { class: "muted small" }, "Drag a block onto the canvas, or select it to add it in the centre."),
    ...CATEGORIES.map((category) => {
      const types = Object.entries(BLOCK_TYPES).filter(([, type]) => type.category === category);
      return h("section", {},
        h("h3", { class: `cat-text ${categoryClass(category)}` }, category),
        h("ul", { class: "palette-list" }, types.map(([id, type]) => h("li", {},
          h("button", {
            type: "button", class: `palette-item ${categoryClass(category)}`, draggable: "true",
            onClick: () => onAdd(id),
            onDragstart: (event) => {
              event.dataTransfer.setData(BLOCK_MIME, id);
              event.dataTransfer.effectAllowed = "copy";
            },
          }, type.name)))));
    }),
  );
}
