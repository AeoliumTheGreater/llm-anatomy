import { SRC } from "./catalogue.js";

// what each block does inside: a small graph of steps, with shapes and equations.
// every equation was read from the modelling code or the paper it links to.

const link = (text, source) => `[${text}](${source.url})`;

/** Builds one step of an internal graph. */
const step = (id, name, shape, description, extra = {}) => ({ id, name, shape, description, ...extra });

export const INTERNALS = {
  embedding: {
    nodes: [
      step("tokens", "token ids", ["B", "T"], "One integer per position, from the tokeniser."),
      step("table", "embedding table", ["V", "d"], `A learned row for each of the V vocabulary entries (${link("Press & Wolf", SRC.pressWolf)}).`, { equation: "E ∈ ℝ^(V×d)" }),
      step("lookup", "row lookup", ["B", "T", "d"], "Picks the row for each token id. No arithmetic, just a gather.", { equation: "x = E[tokens]" }),
    ],
    edges: [["tokens", "lookup"], ["table", "lookup"]],
  },

  rmsNorm: {
    nodes: [
      step("square", "mean square", ["B", "T", 1], `The mean of the squared channels, with no mean subtraction (${link("Zhang & Sennrich", SRC.rmsNorm)}).`, { equation: "ms = mean(x²)" }),
      step("scale", "divide by RMS", ["B", "T", "d"], "Divides each vector by its root mean square, with a small epsilon for safety.", { equation: "x̂ = x / √(ms + ε)" }),
      step("gain", "learned gain", ["d"], `One weight per channel, the only parameters here (${link("Zhang & Sennrich", SRC.rmsNorm)}).`, { equation: "y = g ⊙ x̂" }),
    ],
    edges: [["square", "scale"], ["scale", "gain"]],
  },

  residualAdd: {
    nodes: [
      step("stream", "x, the residual stream", ["B", "T", "d"], `The running vector for each token: the embedding plus every update added before this point (${link("Vaswani et al.", SRC.vaswani)}). This copy skips the sub-layer unchanged.`, { equation: "x" }),
      step("branch", "sub-layer update", ["B", "T", "d"], `The sub-layer's output, computed from a normalised copy of the same x (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "F(RMSNorm(x))" }),
      step("add", "add, giving the new x", ["B", "T", "d"], `Plain addition. The sum replaces x and is what the next sub-layer receives, so every update stays in the running total and gradients reach every earlier block directly (${link("pre-norm", SRC.preNorm)}).`, { equation: "x ← x + F(RMSNorm(x))" }),
    ],
    edges: [["stream", "add"], ["branch", "add"]],
  },

  attention: {
    nodes: [
      step("qProj", "query projection", ["B", "T", "queryHeads*headDim"], `A linear map to queryHeads heads. With an output gate it is twice as wide and the second half becomes the gate (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "q = x W_q" }),
      step("kvProj", "key and value projections", ["B", "T", "2*kvHeads*headDim"], `Fewer key/value heads than query heads, which ${link("shrinks the key/value cache", SRC.gqa)}.`, { equation: "k = x W_k,  v = x W_v" }),
      step("qkNorm", "QK-norm", ["B", "T", "queryHeads", "headDim"], `RMSNorm over each head's channels for queries and keys, ${link("added in Qwen3", SRC.qwen3)}.`, { when: "qkNorm" }),
      step("rope", "RoPE", ["B", "T", "queryHeads", "headDim"], `Rotates each head's pairs by an angle set by position, so scores ${link("depend on relative position", SRC.roformer)}. Qwen3.5 rotates only the first quarter of each head (${link("partial_rotary_factor", SRC.qwen35Config)}).`, { equation: "θ_i = pos / ropeTheta^(2i/headDim)" }),
      step("weights", "attention weights", ["B", "queryHeads", "T", "T"], `Causal scaled dot-product attention (${link("Vaswani et al.", SRC.vaswani)}). The T × T matrix is the reason cost grows with the square of the sequence length.`, { equation: "softmax(q kᵀ / √headDim) v", drill: "attention.weights" }),
      step("gate", "output gate", ["B", "T", "queryHeads*headDim"], `Multiplies the attention output by a sigmoid gate from the same input; ${link("a head-specific gate after attention improves quality and stability", SRC.gatedAttention)}.`, { equation: "o ⊙ σ(gate)", when: "outputGate" }),
      step("oProj", "output projection", ["B", "T", "d"], `Maps the joined heads back to the width of the residual stream (${link("Vaswani et al.", SRC.vaswani)}).`, { equation: "y = o W_o" }),
    ],
    edges: [["qProj", "qkNorm"], ["kvProj", "qkNorm"], ["qkNorm", "rope"], ["rope", "weights"], ["weights", "gate"], ["gate", "oProj"]],
  },

  "attention.weights": {
    title: "Attention weights",
    nodes: [
      step("scores", "scores", ["B", "queryHeads", "T", "T"], `Every query meets every key up to its own position (${link("Vaswani et al.", SRC.vaswani)}).`, { equation: "s = q kᵀ / √headDim" }),
      step("mask", "causal mask", ["B", "queryHeads", "T", "T"], "Positions later than the query are set to minus infinity, so a token never reads its future.", { equation: "s[i, j>i] = −∞" }),
      step("softmax", "softmax", ["B", "queryHeads", "T", "T"], "Each row becomes a distribution over the earlier positions.", { equation: "a = softmax(s)" }),
      step("weighted", "weighted sum of values", ["B", "queryHeads", "T", "headDim"], `Each query gets the mix of values its row asked for (${link("Vaswani et al.", SRC.vaswani)}).`, { equation: "o = a v" }),
    ],
    edges: [["scores", "mask"], ["mask", "softmax"], ["softmax", "weighted"]],
  },

  swiglu: {
    nodes: [
      step("gateProj", "gate projection", ["B", "T", "dff"], `Widens the vector, then passes it through SiLU (${link("GLU variants", SRC.glu)}).`, { equation: "a = SiLU(x W_gate)" }),
      step("upProj", "up projection", ["B", "T", "dff"], `A second widening with no activation (${link("GLU variants", SRC.glu)}).`, { equation: "b = x W_up" }),
      step("product", "element-wise product", ["B", "T", "dff"], `The gate decides, channel by channel, how much of the up projection passes (${link("GLU variants", SRC.glu)}).`, { equation: "h = a ⊙ b" }),
      step("downProj", "down projection", ["B", "T", "d"], `Back to the width of the residual stream (${link("GLU variants", SRC.glu)}).`, { equation: "y = h W_down" }),
    ],
    edges: [["gateProj", "product"], ["upProj", "product"], ["product", "downProj"]],
  },

  gatedDeltaNet: {
    nodes: [
      step("inProj", "q, k, v projection", ["B", "T", "2*keyHeads*keyHeadDim+valueHeads*valueHeadDim"], `One linear map produces queries, keys and values together (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "qkv = x W_qkv" }),
      step("conv", "short causal convolution", ["B", "T", "2*keyHeads*keyHeadDim+valueHeads*valueHeadDim"], `A depthwise convolution over the last convKernel positions, then SiLU, before the split (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "qkv ← SiLU(conv(qkv))" }),
      step("norm", "L2 norm on q and k", ["B", "T", "keyHeads", "keyHeadDim"], `Queries and keys are scaled to unit length before the state update (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "q ← q/‖q‖,  k ← k/‖k‖" }),
      step("gates", "decay and write gates", ["B", "T", "valueHeads"], `Two small projections give one decay and one write strength per head; ${link("gating enables rapid memory erasure", SRC.gatedDeltaNet)}.`, { equation: "β = σ(b),  g = −e^A · softplus(a+dt)" }),
      step("state", "delta-rule state update", ["valueHeads", "keyHeadDim", "valueHeadDim"], `A fixed-size matrix memory per head replaces the growing key/value cache. The ${link("delta rule", SRC.deltaParallel)} overwrites what the key already held instead of only adding.`, { equation: "S ← e^g S + k Δᵀ", drill: "gatedDeltaNet.deltaRule" }),
      step("read", "read with the query", ["B", "T", "valueHeads", "valueHeadDim"], `The query reads the state the same way attention reads values (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "o = Sᵀ q" }),
      step("outNorm", "gated RMSNorm and output", ["B", "T", "d"], `RMSNorm per head, scaled by SiLU of a separate projection z, then a linear map back to d (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "y = (RMSNorm(o) ⊙ SiLU(z)) W_out" }),
    ],
    edges: [["inProj", "conv"], ["conv", "norm"], ["norm", "state"], ["gates", "state"], ["state", "read"], ["read", "outNorm"]],
  },

  "gatedDeltaNet.deltaRule": {
    title: "Delta-rule state update",
    nodes: [
      step("decay", "decay the state", ["valueHeads", "keyHeadDim", "valueHeadDim"], `Each step first forgets a little, by a factor between 0 and 1 that the gate chooses (${link("Gated Delta Networks", SRC.gatedDeltaNet)}).`, { equation: "S ← e^g · S" }),
      step("recall", "read what the key holds", ["B", "T", "valueHeads", "valueHeadDim"], `Looks up the value already stored at this key (${link("Qwen3.5 code", SRC.qwen35Code)}).`, { equation: "v_old = Sᵀ k" }),
      step("delta", "correction", ["B", "T", "valueHeads", "valueHeadDim"], `Only the difference is written, scaled by the write gate: this is the delta rule, and it is what ${link("targeted updates", SRC.gatedDeltaNet)} means.`, { equation: "Δ = β (v − v_old)" }),
      step("write", "write it back", ["valueHeads", "keyHeadDim", "valueHeadDim"], `An outer product adds the correction at that key. Training is done in chunks so this runs in parallel over the sequence (${link("Yang et al.", SRC.deltaParallel)}).`, { equation: "S ← S + k Δᵀ" }),
    ],
    edges: [["decay", "recall"], ["recall", "delta"], ["delta", "write"]],
  },

  lmHead: {
    nodes: [
      step("hidden", "final hidden state", ["B", "T", "d"], "The residual stream after the last layer and the final norm."),
      step("matmul", "score every token", ["B", "T", "V"], `One dot product per vocabulary entry. When tied, the matrix is the embedding table again (${link("Press & Wolf", SRC.pressWolf)}).`, { equation: "logits = x Eᵀ" }),
    ],
    edges: [["hidden", "matmul"]],
  },

  sampling: {
    nodes: [
      step("temperature", "temperature", ["B", "V"], "Dividing the logits by a temperature below 1 sharpens the distribution and above 1 flattens it.", { equation: "z = logits / T" }),
      step("softmax", "softmax", ["B", "V"], `Turns scores into probabilities (${link("Vaswani et al.", SRC.vaswani)}).`, { equation: "p = softmax(z)" }),
      step("nucleus", "nucleus (top-p)", ["B", "V"], `Keeps the smallest set of tokens whose probability reaches p, then renormalises (${link("Holtzman et al.", SRC.holtzman)}).`),
      step("draw", "draw a token", ["B"], "One token id is sampled, appended to the input, and the whole model runs again."),
    ],
    edges: [["temperature", "softmax"], ["softmax", "nucleus"], ["nucleus", "draw"]],
  },

  moe: {
    nodes: [
      step("router", "router", ["B", "T", "experts"], `Scores the experts for each token and keeps the best few (${link("Shazeer et al.", SRC.moe)}).`, { equation: "top-k(softmax(x W_r))", drill: "moe.router" }),
      step("experts", "chosen experts", ["B", "T", "d"], `Each chosen expert is a SwiGLU MLP; the others do not run, so ${link("capacity grows without matching compute", SRC.moe)}.`),
      step("combine", "weighted sum", ["B", "T", "d"], `The outputs are mixed using the router's weights (${link("OLMoE", SRC.olmoe)}).`, { equation: "y = Σ w_i expert_i(x)" }),
    ],
    edges: [["router", "experts"], ["experts", "combine"]],
  },

  "moe.router": {
    title: "Router",
    nodes: [
      step("scores", "expert scores", ["B", "T", "experts"], `A single small linear map, one score per expert (${link("Shazeer et al.", SRC.moe)}).`, { equation: "s = x W_r" }),
      step("topk", "keep the top k", ["B", "T", "activeExperts"], `Only activeExperts of them run for this token (${link("OLMoE", SRC.olmoe)}).`),
      step("weights", "routing weights", ["B", "T", "activeExperts"], "The kept scores are normalised into the weights used to mix the expert outputs.", { equation: "w = softmax(s_top)" }),
    ],
    edges: [["scores", "topk"], ["topk", "weights"]],
  },

  engram: {
    nodes: [
      step("hash", "hash the n-grams", ["B", "T", "maxNgram-1", "headsPerNgram"], `Each 2-gram up to N-gram ending here is hashed into several prime-sized tables (${link("demo code", SRC.engramCode)}).`),
      step("lookup", "table lookup", ["B", "T", "maxNgram-1*embedPerNgram"], `Plain embedding lookups, so the cost is O(1) and ${link("the tables can live in host memory", SRC.engram)}.`),
      step("gate", "context gate", ["B", "T", 1], `The retrieved memory is projected to a key and compared with the normalised hidden state; a sigmoid of that score scales the value (${link("demo code", SRC.engramCode)}).`, { equation: "gate = σ(⟨key, query⟩ / √d)" }),
      step("write", "short convolution and add", ["B", "T", "d"], `The gated value passes a short causal convolution and is added to the residual stream (${link("demo code", SRC.engramCode)}).`),
    ],
    edges: [["hash", "lookup"], ["lookup", "gate"], ["gate", "write"]],
  },

  slidingWindowAttention: {
    nodes: [
      step("project", "q, k, v projections", ["B", "T", "queryHeads*headDim"], `The same projections as full attention (${link("Vaswani et al.", SRC.vaswani)}).`),
      step("window", "window mask", ["B", "T", "window"], `Each query sees only the last window positions, so ${link("cost grows linearly with length", SRC.longformer)}.`, { equation: "attend to j ∈ [i−window, i]" }),
      step("weighted", "weighted sum of values", ["B", "T", "queryHeads*headDim"], `A softmax over that window only (${link("Mistral 7B", SRC.mistral)}).`),
    ],
    edges: [["project", "window"], ["window", "weighted"]],
  },

  layerNorm: {
    nodes: [
      step("stats", "mean and variance", ["B", "T", 1], `Both are taken across the channels of one vector (${link("Ba et al.", SRC.layerNorm)}).`, { equation: "μ = mean(x), σ² = var(x)" }),
      step("normalise", "normalise", ["B", "T", "d"], "Centres and scales the vector.", { equation: "x̂ = (x − μ)/√(σ² + ε)" }),
      step("affine", "gain and bias", ["B", "T", "d"], `Two learned vectors, which is why LayerNorm has 2d parameters against RMSNorm's d (${link("Ba et al.", SRC.layerNorm)}).`, { equation: "y = g ⊙ x̂ + b" }),
    ],
    edges: [["stats", "normalise"], ["normalise", "affine"]],
  },

  geluMlp: {
    nodes: [
      step("up", "up projection", ["B", "T", "dff"], `Widens the vector, with a bias (${link("Vaswani et al.", SRC.vaswani)}).`, { equation: "h = x W_1 + b_1" }),
      step("gelu", "GELU", ["B", "T", "dff"], `${link("GELU", SRC.gelu)} weights each input by how large it is, rather than gating on its sign as ReLU does.`, { equation: "h ← h Φ(h)" }),
      step("down", "down projection", ["B", "T", "d"], "Back to the width of the residual stream.", { equation: "y = h W_2 + b_2" }),
    ],
    edges: [["up", "gelu"], ["gelu", "down"]],
  },

  maxout: {
    nodes: [
      step("pieces", "k affine pieces", ["B", "T", "pieces", "d"], `Each piece is its own linear map of the input (${link("Goodfellow et al.", SRC.maxout)}).`, { equation: "z_i = x W_i + b_i" }),
      step("max", "element-wise maximum", ["B", "T", "d"], `The maximum over the pieces, which gives a learned piecewise-linear activation (${link("Goodfellow et al.", SRC.maxout)}).`, { equation: "y = max_i z_i" }),
    ],
    edges: [["pieces", "max"]],
  },

  positionEmbedding: {
    nodes: [
      step("table", "position table", ["maxPositions", "d"], `One learned vector per absolute position (${link("Gehring et al.", SRC.convS2S)}).`),
      step("add", "add to the token vectors", ["B", "T", "d"], `Position information enters once, at the input (${link("BERT", SRC.bert)}). Models with RoPE do this inside attention instead.`, { equation: "x ← x + P[0:T]" }),
    ],
    edges: [["table", "add"]],
  },
};

/** Returns the internal graph of a block type or of a deeper step, with steps its params switch off removed. */
export function internalsFor(key, params = {}) {
  const entry = INTERNALS[key];
  if (!entry) return null;
  const nodes = entry.nodes.filter((n) => !n.when || params[n.when]);
  const kept = new Set(nodes.map((n) => n.id));

  // bridges around any step that was removed, so the chain stays connected
  let edges = entry.edges.map(([from, to]) => [from, to]);
  for (const node of entry.nodes) {
    if (kept.has(node.id)) continue;
    const before = edges.filter(([, to]) => to === node.id).map(([from]) => from);
    const after = edges.filter(([from]) => from === node.id).map(([, to]) => to);
    edges = edges.filter(([from, to]) => from !== node.id && to !== node.id);
    for (const from of before) for (const to of after) edges.push([from, to]);
  }
  return { ...entry, nodes, edges };
}
