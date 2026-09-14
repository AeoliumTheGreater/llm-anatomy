import { diffGraphs } from "../diff.js";
import { h, replaceKeepingFocus } from "./dom.js";

/** Shows the configuration table and structural differences between the current graph and another preset. */
export function renderDiffPanel(container, { graph, compareGraph, options, onCompareChange, onClose }) {
  const { configRows, structural } = diffGraphs(graph, compareGraph);

  // builds the comparison picker
  const select = h("select", { id: "compare-with", "data-focus-key": "compare-with", onChange: (e) => onCompareChange(e.target.value) },
    options.map((p) => h("option", { value: p.id, selected: p.id === compareGraph.id }, p.name)));

  // builds the table and the structural list
  const body = configRows.length === 0 && structural.length === 0
    ? [h("p", { class: "muted" }, "No differences.")]
    : [
      configRows.length > 0 && h("div", { class: "table-wrap" }, h("table", { class: "diff-table" },
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "Setting"),
          h("th", { scope: "col" }, graph.name),
          h("th", { scope: "col" }, compareGraph.name))),
        h("tbody", {}, configRows.map((row) => h("tr", {},
          h("th", { scope: "row" }, row.label),
          h("td", { class: "mono" }, row.a),
          h("td", { class: "mono" }, row.b)))))),
      structural.length > 0 && h("section", {}, h("h3", {}, "Structure"), h("ul", { class: "structure" }, structural.map((line) => h("li", {}, line)))),
    ];

  replaceKeepingFocus(container, [
    h("header", { class: "diff-header" },
      h("h2", {}, "Differences"),
      h("label", { for: "compare-with" }, `${graph.name} compared with`),
      select,
      h("button", { type: "button", class: "diff-close", "data-focus-key": "diff-close", onClick: onClose }, "Close")),
    h("div", { class: "diff-body" }, body),
  ]);
}
