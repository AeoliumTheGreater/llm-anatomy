import { validateGraph } from "./graph.js";

const PREFIX = "llm-anatomy:";

/** Returns localStorage, or null when the browser blocks it. */
export function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads a JSON value, or null when storage is unavailable or the value is unreadable. */
export function loadSetting(storage, name) {
  try {
    const text = storage?.getItem(PREFIX + name);
    return text == null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** Writes a JSON value and reports whether it was stored. */
export function saveSetting(storage, name, value) {
  try {
    if (!storage) return false;
    storage.setItem(PREFIX + name, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes a stored value and reports whether storage was reachable. */
export function clearSetting(storage, name) {
  try {
    if (!storage) return false;
    storage.removeItem(PREFIX + name);
    return true;
  } catch {
    return false;
  }
}

/** Reads the working copy for a preset, or null if there is none or it no longer validates. */
export function loadWorkingCopy(storage, presetId) {
  const graph = loadSetting(storage, `working:${presetId}`);
  if (!graph || validateGraph(graph).length > 0) return null;
  return graph;
}

/** Writes the working copy for a preset and reports success. */
export function saveWorkingCopy(storage, presetId, graph) {
  return saveSetting(storage, `working:${presetId}`, graph);
}

/** Removes the working copy for a preset. */
export function clearWorkingCopy(storage, presetId) {
  return clearSetting(storage, `working:${presetId}`);
}

/** Serialises a graph to JSON text. */
export function exportGraph(graph) {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

/** Parses and validates JSON text, listing what is wrong and where. */
export function importGraph(json) {
  // parses the text
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { graph: null, errors: [`JSON: ${error.message}`] };
  }

  // validates the structure
  const errors = validateGraph(parsed);
  if (errors.length > 0) return { graph: null, errors };
  return { graph: { ...parsed, readOnly: false }, errors: [] };
}
