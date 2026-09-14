import { BLOCK_TYPES } from "./catalogue.js";
import { countGraphParams, formatCount } from "./params.js";

export const GLOBAL_LABELS ={ d: "Width d", V: "Vocabulary V", dff: "MLP width dff", layers: "Layers" };
const LAYER_CATEGORIES = new Set(["sequence mixing", "channel mixing"]);

/** Counts how many times each block type runs, including group repeats. */
export function blockTypeCounts(graph) {
  const repeatOf = new Map(graph.groups.map((g) => [g.id, g.repeat]));
  const counts = {};
  for (const node of graph.nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + (node.group ? repeatOf.get(node.group) : 1);
  }
  return counts;
}

/** Collects the distinct values of each block type's params as display text. */
function paramValues(graph) {
  const values = new Map();
  for (const node of graph.nodes) {
    for (const [key, value] of Object.entries(node.params)) {
      const rowKey = `${node.type}.${key}`;
      if (!values.has(rowKey)) values.set(rowKey, new Set());
      values.get(rowKey).add(formatValue(value));
    }
  }
  return new Map([...values].map(([k, set]) => [k, [...set].sort().join(" / ")]));
}

/** Formats a parameter value for the table. */
function formatValue(value) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString("en-GB");
  return String(value);
}

/** Compares two graphs and lists differing config values and structure. */
export function diffGraphs(graphA, graphB) {
  const configRows = [];
  const addRow = (label, a, b) => {
    if (a !== b) configRows.push({ label, a, b });
  };

  // compares globals and totals
  const globalKeys = new Set([...Object.keys(graphA.globals), ...Object.keys(graphB.globals)]);
  for (const key of globalKeys) {
    addRow(GLOBAL_LABELS[key] ?? key, formatValue(graphA.globals[key] ?? "—"), formatValue(graphB.globals[key] ?? "—"));
  }
  addRow("Parameters", formatCount(countGraphParams(graphA).total), formatCount(countGraphParams(graphB).total));

  // compares block parameters type by type
  const valuesA = paramValues(graphA);
  const valuesB = paramValues(graphB);
  for (const rowKey of new Set([...valuesA.keys(), ...valuesB.keys()])) {
    const [typeId, param] = rowKey.split(".");
    const type = BLOCK_TYPES[typeId];
    addRow(`${type.name}: ${type.params[param]?.label ?? param}`, valuesA.get(rowKey) ?? "—", valuesB.get(rowKey) ?? "—");
  }

  // compares how often each block type runs
  const structural = [];
  const countsA = blockTypeCounts(graphA);
  const countsB = blockTypeCounts(graphB);
  for (const typeId of new Set([...Object.keys(countsA), ...Object.keys(countsB)])) {
    const a = countsA[typeId] ?? 0;
    const b = countsB[typeId] ?? 0;
    if (a === b) continue;
    const type = BLOCK_TYPES[typeId];
    const unit = LAYER_CATEGORIES.has(type.category) ? "layers" : "blocks";
    if (a === 0) structural.push(`${type.name}: ${b} ${unit} in ${graphB.name}, none in ${graphA.name}`);
    else if (b === 0) structural.push(`${type.name}: ${a} ${unit} in ${graphA.name}, none in ${graphB.name}`);
    else structural.push(`${type.name}: ${a} ${unit} in ${graphA.name}, ${b} in ${graphB.name}`);
  }

  return { configRows, structural };
}
