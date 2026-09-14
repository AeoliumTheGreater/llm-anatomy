// formulas follow the Hugging Face modelling code for each block; biases only where that code has them
const COUNTS = {
  embedding: (p) => p.V * p.d,
  rmsNorm: (p) => p.d,
  residualAdd: () => 0,
  attention: (p) => {
    const q = p.queryHeads * p.headDim * (p.outputGate ? 2 : 1);
    const kv = p.kvHeads * p.headDim;
    const projections = p.d * q + 2 * p.d * kv + p.queryHeads * p.headDim * p.d;
    const biases = p.bias ? q + 2 * kv : 0;
    const norms = p.qkNorm ? 2 * p.headDim : 0;
    return projections + biases + norms;
  },
  swiglu: (p) => 3 * p.d * p.dff,
  gatedDeltaNet: (p) => {
    const keyDim = p.keyHeads * p.keyHeadDim;
    const valueDim = p.valueHeads * p.valueHeadDim;
    const inProjections = p.d * (2 * keyDim + valueDim) + p.d * valueDim + 2 * p.d * p.valueHeads;
    const conv = (2 * keyDim + valueDim) * p.convKernel;
    const decay = 2 * p.valueHeads;
    const norm = p.valueHeadDim;
    const outProjection = valueDim * p.d;
    return inProjections + conv + decay + norm + outProjection;
  },
  lmHead: (p) => (p.tied ? 0 : p.V * p.d),
  sampling: () => 0,
  maxout: (p) => p.pieces * (p.d * p.d + p.d),
  moe: (p) => p.d * p.experts + p.experts * 3 * p.d * p.dff,
  engram: (p) => {
    const memoryWidth = (p.maxNgram - 1) * p.embedPerNgram;
    const tables = (p.maxNgram - 1) * p.tableSize * p.embedPerNgram;
    const keyAndValue = 2 * (memoryWidth * p.d + p.d);
    const norms = 3 * p.d;
    const conv = p.d * p.convKernel;
    return tables + keyAndValue + norms + conv;
  },
  slidingWindowAttention: (p) => 2 * p.queryHeads * p.headDim * p.d + 2 * p.kvHeads * p.headDim * p.d,
  layerNorm: (p) => 2 * p.d,
  geluMlp: (p) => 2 * p.d * p.dff + p.dff + p.d,
  positionEmbedding: (p) => p.maxPositions * p.d,
};

/** Counts the parameters of one block from its type and params. */
export function countBlockParams(type, params) {
  const count = COUNTS[type];
  if (!count) throw new Error(`No parameter count for block type "${type}"`);
  return count(params);
}

/** Counts the parameters of a whole graph, including group repeats. */
export function countGraphParams(graph) {
  const repeatOf = new Map(graph.groups.map((g) => [g.id, g.repeat]));
  const perNode = {};
  const perGroup = Object.fromEntries(graph.groups.map((g) => [g.id, 0]));
  let total = 0;

  // sums each node once per repeat of its group
  for (const node of graph.nodes) {
    const count = countBlockParams(node.type, node.params);
    perNode[node.id] = count;
    if (node.group) perGroup[node.group] += count;
    total += count * (node.group ? repeatOf.get(node.group) : 1);
  }
  return { total, perNode, perGroup };
}

/** Formats a parameter count as text, e.g. 1.72B or 311M. */
export function formatCount(count) {
  if (count >= 1e9) return `${(count / 1e9).toFixed(2)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}
