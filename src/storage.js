/** Reads the working copy from localStorage, or null if unavailable. */
export function loadWorkingCopy(storageKey) {
  // TODO: implement
  const graph = null;
  return { graph };
}

/** Writes the working copy to localStorage and reports success. */
export function saveWorkingCopy(storageKey, graph) {
  // TODO: implement
  const saved = null;
  return { saved };
}

/** Serialises a graph to JSON text. */
export function exportGraph(graph) {
  // TODO: implement
  const json = null;
  return { json };
}

/** Parses and validates JSON text, listing what is wrong and where. */
export function importGraph(json) {
  // TODO: implement
  const graph = null;
  const errors = null;
  return { graph, errors };
}
