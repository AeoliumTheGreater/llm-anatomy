import { BLOCK_TYPES } from "./catalogue.js";

const HISTORY_LIMIT = 200;

/** Returns true when two edge endpoints name the same node and port. */
export function sameEndpoint(a, b) {
  return a.node === b.node && a.port === b.port;
}

/** Returns a new graph with the node added; an existing node id changes nothing. */
export function addNode(graph, node) {
  // skips a node id that already exists
  if (graph.nodes.some((n) => n.id === node.id)) return graph;
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** Returns a new graph without the node and its edges. */
export function removeNode(graph, nodeId) {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.from.node !== nodeId && e.to.node !== nodeId),
  };
}

/** Returns a new graph with the edge added; an existing edge changes nothing. */
export function connect(graph, from, to) {
  // skips an edge that already exists
  if (graph.edges.some((e) => sameEndpoint(e.from, from) && sameEndpoint(e.to, to))) {
    return graph;
  }

  // replaces any edge that already feeds the input port
  const edges = graph.edges.filter((e) => !sameEndpoint(e.to, to));
  return { ...graph, edges: [...edges, { from: { ...from }, to: { ...to } }] };
}

/** Returns a new graph without the edge between the two endpoints. */
export function disconnect(graph, from, to) {
  return {
    ...graph,
    edges: graph.edges.filter((e) => !(sameEndpoint(e.from, from) && sameEndpoint(e.to, to))),
  };
}

/** Returns a new graph with the node's params and position merged with the changes. */
export function updateNode(graph, nodeId, { params, position }) {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      return {
        ...n,
        params: params ? { ...n.params, ...params } : n.params,
        position: position ? { ...position } : n.position,
      };
    }),
  };
}

/** Returns a new graph with the group's fields merged with the changes. */
export function updateGroup(graph, groupId, changes) {
  return {
    ...graph,
    groups: graph.groups.map((g) => (g.id === groupId ? { ...g, ...changes } : g)),
  };
}

/** Returns a node id based on the given stem that the graph does not use yet. */
export function uniqueNodeId(graph, stem) {
  const used = new Set(graph.nodes.map((n) => n.id));
  let index = 1;
  while (used.has(`${stem}${index}`)) index += 1;
  return `${stem}${index}`;
}

/** Builds a new node of a block type, taking sizes from the graph globals where they exist. */
export function createNode(graph, typeId, position) {
  const type = BLOCK_TYPES[typeId];
  const params = {};
  for (const [key, spec] of Object.entries(type.params)) {
    params[key] = Number.isInteger(graph.globals[key]) && spec.type === "int" ? graph.globals[key] : spec.default;
  }
  return { id: uniqueNodeId(graph, typeId), type: typeId, params, position: { ...position }, group: null };
}

/** Returns an editable copy of a read-only preset. */
export function makeWorkingCopy(preset) {
  return {
    ...structuredClone(preset),
    id: `${preset.id}-edited`,
    name: `${preset.name} (edited)`,
    readOnly: false,
    basePreset: preset.id,
  };
}

/** Lists the input ports that no edge feeds. */
export function unconnectedInputs(graph) {
  const missing = [];
  for (const node of graph.nodes) {
    const type = BLOCK_TYPES[node.type];
    if (!type) continue;
    for (const port of type.inputs) {
      if (port.external) continue;
      const fed = graph.edges.some((e) => e.to.node === node.id && e.to.port === port.id);
      if (!fed) missing.push({ node: node.id, port: port.id });
    }
  }
  return missing;
}

/** Checks a graph against the schema and lists each problem with its location. */
export function validateGraph(graph) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);

  // checks the top-level fields
  if (typeof graph !== "object" || graph === null || Array.isArray(graph)) {
    return ["graph: expected an object"];
  }
  if (typeof graph.id !== "string" || graph.id === "") fail("id", "expected a non-empty string");
  if (typeof graph.name !== "string" || graph.name === "") fail("name", "expected a non-empty string");
  if (typeof graph.readOnly !== "boolean") fail("readOnly", "expected true or false");
  if (!isPlainObject(graph.globals)) {
    fail("globals", "expected an object");
  } else {
    for (const [key, value] of Object.entries(graph.globals)) {
      if (!Number.isFinite(value)) fail(`globals.${key}`, "expected a number");
    }
  }
  for (const key of ["nodes", "edges", "groups", "sources"]) {
    if (!Array.isArray(graph[key])) fail(key, "expected a list");
  }
  if (errors.length > 0) return errors;

  // checks groups
  const groupIds = new Set();
  graph.groups.forEach((g, i) => {
    const path = `groups[${i}]`;
    if (typeof g.id !== "string" || g.id === "") return fail(`${path}.id`, "expected a non-empty string");
    if (groupIds.has(g.id)) fail(`${path}.id`, `duplicate group id "${g.id}"`);
    groupIds.add(g.id);
    if (typeof g.label !== "string") fail(`${path}.label`, "expected a string");
    if (!Number.isInteger(g.repeat) || g.repeat < 1) fail(`${path}.repeat`, "expected a positive integer");
    if (typeof g.collapsed !== "boolean") fail(`${path}.collapsed`, "expected true or false");
  });

  // checks nodes, their params and positions
  const nodesById = new Map();
  graph.nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!isPlainObject(n)) return fail(path, "expected an object");
    if (typeof n.id !== "string" || n.id === "") return fail(`${path}.id`, "expected a non-empty string");
    if (nodesById.has(n.id)) fail(`${path}.id`, `duplicate node id "${n.id}"`);
    nodesById.set(n.id, n);
    const type = BLOCK_TYPES[n.type];
    if (!type) return fail(`${path}.type`, `unknown block type "${n.type}"`);
    if (!isPlainObject(n.params)) return fail(`${path}.params`, "expected an object");
    for (const [key, spec] of Object.entries(type.params)) {
      const problem = checkParam(spec, n.params[key]);
      if (problem) fail(`${path}.params.${key}`, problem);
    }
    for (const key of Object.keys(n.params)) {
      if (!(key in type.params)) fail(`${path}.params.${key}`, `not a parameter of ${type.name}`);
    }
    if (!isPlainObject(n.position) || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) {
      fail(`${path}.position`, "expected { x, y } numbers");
    }
    if (n.group !== null && !groupIds.has(n.group)) fail(`${path}.group`, `unknown group "${n.group}"`);
  });

  // checks that edges join existing output and input ports
  graph.edges.forEach((e, i) => {
    const path = `edges[${i}]`;
    for (const [end, direction] of [["from", "outputs"], ["to", "inputs"]]) {
      const endpoint = e?.[end];
      const node = nodesById.get(endpoint?.node);
      if (!node) {
        fail(`${path}.${end}.node`, `unknown node "${endpoint?.node}"`);
        continue;
      }
      // skips nodes whose unknown type is already reported
      if (!BLOCK_TYPES[node.type]) continue;
      const ports = BLOCK_TYPES[node.type]?.[direction] ?? [];
      if (!ports.some((p) => p.id === endpoint.port)) {
        fail(`${path}.${end}.port`, `"${endpoint.port}" is not one of the ${direction} of "${node.id}"`);
      }
    }
  });

  // checks sources
  graph.sources.forEach((s, i) => {
    if (typeof s?.label !== "string") fail(`sources[${i}].label`, "expected a string");
    if (typeof s?.url !== "string" || !s.url.startsWith("https://")) fail(`sources[${i}].url`, "expected an https URL");
  });

  return errors;
}

/** Returns a message when a value does not fit its parameter spec, otherwise null. */
function checkParam(spec, value) {
  if (spec.type === "int" && !(Number.isInteger(value) && value > 0)) return "expected a positive integer";
  if (spec.type === "number" && !Number.isFinite(value)) return "expected a number";
  if (spec.type === "bool" && typeof value !== "boolean") return "expected true or false";
  return null;
}

/** Returns true for a non-null, non-array object. */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Starts an undo history at the given graph. */
export function createHistory(graph) {
  return { past: [], present: graph, future: [] };
}

/** Records a new graph as the present; an unchanged graph records nothing. */
export function commit(history, graph) {
  if (graph === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: graph,
    future: [],
  };
}

/** Steps the history back one edit. */
export function undo(history) {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1),
    future: [history.present, ...history.future],
  };
}

/** Steps the history forward one edit. */
export function redo(history) {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
