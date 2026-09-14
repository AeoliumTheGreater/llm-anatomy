// descriptions use [text](https://…) for inline source links; each link was checked before it was added

const SRC = {
  vaswani: { label: "Vaswani et al., Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" },
  pressWolf: { label: "Press & Wolf, Using the Output Embedding to Improve Language Models", url: "https://arxiv.org/abs/1608.05859" },
  rmsNorm: { label: "Zhang & Sennrich, Root Mean Square Layer Normalization", url: "https://arxiv.org/abs/1910.07467" },
  preNorm: { label: "Xiong et al., On Layer Normalization in the Transformer Architecture", url: "https://arxiv.org/abs/2002.04745" },
  gqa: { label: "Ainslie et al., GQA", url: "https://arxiv.org/abs/2305.13245" },
  qwen2: { label: "Qwen2 Technical Report", url: "https://arxiv.org/abs/2407.10671" },
  qwen3: { label: "Qwen3 Technical Report", url: "https://arxiv.org/abs/2505.09388" },
  gatedAttention: { label: "Qiu et al., Gated Attention for Large Language Models", url: "https://arxiv.org/abs/2505.06708" },
  roformer: { label: "Su et al., RoFormer", url: "https://arxiv.org/abs/2104.09864" },
  glu: { label: "Shazeer, GLU Variants Improve Transformer", url: "https://arxiv.org/abs/2002.05202" },
  gatedDeltaNet: { label: "Yang et al., Gated Delta Networks", url: "https://arxiv.org/abs/2412.06464" },
  deltaParallel: { label: "Yang et al., Parallelizing Linear Transformers with the Delta Rule", url: "https://arxiv.org/abs/2406.06484" },
  qwen35Card: { label: "Qwen3.5-0.8B model card", url: "https://huggingface.co/Qwen/Qwen3.5-0.8B" },
  qwen35Config: { label: "Qwen3.5-0.8B config.json", url: "https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/config.json" },
  qwen35Code: { label: "Qwen3.5 modelling code", url: "https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_5/modeling_qwen3_5.py" },
  holtzman: { label: "Holtzman et al., The Curious Case of Neural Text Degeneration", url: "https://arxiv.org/abs/1904.09751" },
  maxout: { label: "Goodfellow et al., Maxout Networks", url: "https://arxiv.org/abs/1302.4389" },
  moe: { label: "Shazeer et al., Outrageously Large Neural Networks", url: "https://arxiv.org/abs/1701.06538" },
  olmoe: { label: "Muennighoff et al., OLMoE", url: "https://arxiv.org/abs/2409.02060" },
  engram: { label: "DeepSeek, Conditional Memory via Scalable Lookup (Engram)", url: "https://github.com/deepseek-ai/Engram" },
  engramCode: { label: "Engram demo code", url: "https://github.com/deepseek-ai/Engram/blob/main/engram_demo_v1.py" },
  longformer: { label: "Beltagy et al., Longformer", url: "https://arxiv.org/abs/2004.05150" },
  mistral: { label: "Jiang et al., Mistral 7B", url: "https://arxiv.org/abs/2310.06825" },
  layerNorm: { label: "Ba et al., Layer Normalization", url: "https://arxiv.org/abs/1607.06450" },
  gelu: { label: "Hendrycks & Gimpel, Gaussian Error Linear Units", url: "https://arxiv.org/abs/1606.08415" },
  convS2S: { label: "Gehring et al., Convolutional Sequence to Sequence Learning", url: "https://arxiv.org/abs/1705.03122" },
  bert: { label: "Devlin et al., BERT", url: "https://arxiv.org/abs/1810.04805" },
};

/** Builds a markdown-style inline link to a source. */
const link = (text, source) => `[${text}](${source.url})`;

const STREAM = ["B", "T", "d"];
const io = { inputs: [{ id: "x", shape: STREAM }], outputs: [{ id: "y", shape: STREAM }] };

/** Lists the sub-blocks that apply to a node, skipping ones its params switch off. */
export function subBlocksFor(node) {
  return BLOCK_TYPES[node.type].subBlocks.filter((sub) => !sub.when || node.params[sub.when]);
}

export const CATEGORIES =["input", "normalisation", "sequence mixing", "channel mixing", "residual", "output"];

export const BLOCK_TYPES = {
  embedding: {
    name: "Token embedding",
    category: "input",
    params: {
      V: { type: "int", default: 151936, label: "Vocabulary V" },
      d: { type: "int", default: 1024, label: "Width d" },
      tied: { type: "bool", default: true, label: "Tied with output layer" },
    },
    inputs: [{ id: "tokens", shape: ["B", "T"], external: true }],
    outputs: [{ id: "x", shape: STREAM }],
    subBlocks: [],
    description:
      "Looks up one learned vector of width d for each token id; this matrix has V × d parameters, the largest single table in a small model. " +
      `With tied embeddings the output layer reuses the same matrix, which ${link("reduces perplexity and model size", SRC.pressWolf)}.`,
    sources: [SRC.pressWolf],
  },

  rmsNorm: {
    name: "RMSNorm",
    category: "normalisation",
    params: { d: { type: "int", default: 1024, label: "Width d" } },
    ...io,
    subBlocks: [],
    description:
      "Divides each vector by its root mean square and multiplies by a learned per-channel gain. " +
      `It drops LayerNorm's mean-centring and bias, and ${link("matches LayerNorm quality while running faster", SRC.rmsNorm)}.`,
    sources: [SRC.rmsNorm],
  },

  residualAdd: {
    name: "Residual add",
    category: "residual",
    params: { d: { type: "int", default: 1024, label: "Width d" } },
    inputs: [{ id: "a", shape: STREAM }, { id: "b", shape: STREAM }],
    outputs: [{ id: "y", shape: STREAM }],
    subBlocks: [],
    description:
      `Adds a sub-layer's output back to its input, as in ${link("the Transformer", SRC.vaswani)}, so every layer reads from and writes to one shared residual stream. ` +
      `Qwen models normalise inside the branch before each sub-layer (pre-norm); ${link("Pre-LN Transformers have well-behaved gradients at initialisation", SRC.preNorm)}.`,
    sources: [SRC.vaswani, SRC.preNorm],
  },

  attention: {
    name: "Grouped-query attention",
    category: "sequence mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      queryHeads: { type: "int", default: 8, label: "Query heads" },
      kvHeads: { type: "int", default: 2, label: "Key/value heads" },
      headDim: { type: "int", default: 128, label: "Head dimension" },
      qkNorm: { type: "bool", default: true, label: "QK-norm" },
      bias: { type: "bool", default: false, label: "Bias on q, k, v" },
      outputGate: { type: "bool", default: false, label: "Output gate" },
      ropeTheta: { type: "number", default: 1000000, label: "RoPE theta" },
      rotaryFraction: { type: "number", default: 1, label: "Rotary fraction" },
    },
    ...io,
    subBlocks: [
      { id: "qProjection", name: "Query projection", description: `A linear map from d to queryHeads × headDim. With an output gate it is twice as wide and its second half becomes the gate (${link("Qwen3.5 code", SRC.qwen35Code)}).` },
      { id: "kvProjection", name: "Key and value projections", description: `Linear maps from d to kvHeads × headDim each. Several query heads share each key/value head, ${link("which shrinks the key/value cache", SRC.gqa)}.` },
      { id: "qkNorm", name: "QK-norm", when: "qkNorm", description: `RMSNorm over the head dimension of queries and keys, ${link("added in Qwen3", SRC.qwen3)}.` },
      { id: "rope", name: "RoPE", description: `Rotates query and key vectors by position-dependent angles, so that attention ${link("depends on relative position", SRC.roformer)}. Qwen3.5 rotates only a quarter of each head (${link("partial_rotary_factor 0.25", SRC.qwen35Config)}).` },
      { id: "softmaxAttention", name: "Attention weights", description: `Scaled dot-product attention: a causal softmax over query–key scores weights a sum of values (${link("Vaswani et al.", SRC.vaswani)}).` },
      { id: "outputGate", name: "Output gate", when: "outputGate", description: `Multiplies the attention output by a sigmoid gate computed from the input; ${link("a head-specific gate after attention improves quality and stability", SRC.gatedAttention)}.` },
      { id: "outputProjection", name: "Output projection", description: `A linear map from queryHeads × headDim back to d (${link("Vaswani et al.", SRC.vaswani)}).` },
    ],
    description:
      `Each position mixes information from earlier positions with a softmax-weighted sum of values (${link("Vaswani et al.", SRC.vaswani)}). ` +
      `${link("Grouped-query attention", SRC.gqa)} lets several query heads share one key/value head. ` +
      `Qwen2 used ${link("bias on q, k and v", SRC.qwen2)}; Qwen3 removes it and ${link("adds QK-norm", SRC.qwen3)}.`,
    sources: [SRC.vaswani, SRC.gqa, SRC.qwen2, SRC.qwen3, SRC.roformer, SRC.gatedAttention],
  },

  swiglu: {
    name: "SwiGLU MLP",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      dff: { type: "int", default: 3584, label: "Hidden width dff" },
    },
    ...io,
    subBlocks: [
      { id: "gate", name: "Gate projection", description: `A linear map from d to dff, passed through SiLU (Swish), the ${link("SwiGLU", SRC.glu)} gate.` },
      { id: "up", name: "Up projection", description: `A second linear map from d to dff, with no activation (${link("GLU variants", SRC.glu)}).` },
      { id: "product", name: "Element-wise product", description: `Multiplies the gate and up vectors channel by channel (${link("GLU variants", SRC.glu)}).` },
      { id: "down", name: "Down projection", description: `A linear map from dff back to d (${link("GLU variants", SRC.glu)}).` },
    ],
    description:
      "Processes each position on its own: the gated product SiLU(W_gate x) ⊙ (W_up x) is projected back to width d. " +
      `It is one of the ${link("GLU variants that improve Transformer quality over ReLU or GELU", SRC.glu)}.`,
    sources: [SRC.glu],
  },

  gatedDeltaNet: {
    name: "Gated DeltaNet",
    category: "sequence mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      keyHeads: { type: "int", default: 16, label: "Key heads" },
      valueHeads: { type: "int", default: 16, label: "Value heads" },
      keyHeadDim: { type: "int", default: 128, label: "Key head dimension" },
      valueHeadDim: { type: "int", default: 128, label: "Value head dimension" },
      convKernel: { type: "int", default: 4, label: "Convolution kernel" },
    },
    ...io,
    subBlocks: [
      { id: "projections", name: "Projections", description: `Linear maps from d to queries, keys and values, to an output gate z, and to per-head scalars a and b (${link("Qwen3.5 code", SRC.qwen35Code)}).` },
      { id: "shortConv", name: "Short causal convolution", description: `A depthwise causal 1-D convolution over the joined queries, keys and values, so each token mixes with a few predecessors before the state update. Qwen3.5 uses ${link("kernel size 4", SRC.qwen35Config)}.` },
      { id: "gates", name: "Decay and write gates", description: `a sets how fast the state decays and b sets how strongly the token writes; ${link("gating enables rapid memory erasure", SRC.gatedDeltaNet)}.` },
      { id: "deltaRule", name: "Delta-rule state update", description: `Each value-head keeps a fixed-size matrix state. The ${link("delta rule", SRC.deltaParallel)} replaces the value stored at a key instead of only adding to it, and ${link("can be trained in parallel over the sequence", SRC.deltaParallel)}.` },
      { id: "output", name: "Gated norm and output", description: `Reads the state with the query, applies RMSNorm gated by SiLU(z) per value head, and projects back to d (${link("Qwen3.5 code", SRC.qwen35Code)}).` },
    ],
    description:
      "A linear-attention layer: it keeps a fixed-size state per head instead of a key/value cache that grows with the sequence. " +
      `It combines ${link("gating for rapid memory erasure with the delta rule for targeted updates", SRC.gatedDeltaNet)}. ` +
      `Qwen3.5 ${link("stacks three of these layers before each attention layer", SRC.qwen35Card)}.`,
    sources: [SRC.gatedDeltaNet, SRC.deltaParallel, SRC.qwen35Card, SRC.qwen35Code],
  },

  lmHead: {
    name: "Output layer",
    category: "output",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      V: { type: "int", default: 151936, label: "Vocabulary V" },
      tied: { type: "bool", default: true, label: "Tied with embedding" },
    },
    inputs: [{ id: "x", shape: STREAM }],
    outputs: [{ id: "logits", shape: ["B", "T", "V"] }],
    subBlocks: [],
    description:
      "Projects each final hidden state to one score (logit) per vocabulary entry. " +
      `When tied, it reuses the embedding matrix and adds no parameters; ${link("Press & Wolf", SRC.pressWolf)} show the output matrix is itself a valid word embedding.`,
    sources: [SRC.pressWolf],
  },

  sampling: {
    name: "Softmax and sampling",
    category: "output",
    params: {
      temperature: { type: "number", default: 1, label: "Temperature" },
      topP: { type: "number", default: 1, label: "Top-p" },
    },
    inputs: [{ id: "logits", shape: ["B", "T", "V"] }],
    outputs: [{ id: "token", shape: ["B"] }],
    subBlocks: [],
    description:
      `A softmax turns the last position's logits into a probability distribution (${link("Vaswani et al.", SRC.vaswani)}), and the next token is drawn from it. ` +
      `Dividing logits by a temperature sharpens or flattens the distribution; ${link("nucleus (top-p) sampling", SRC.holtzman)} draws only from the smallest set of tokens whose probability reaches p. These are decoding settings, not weights.`,
    sources: [SRC.vaswani, SRC.holtzman],
  },

  maxout: {
    name: "Max-pooling (maxout)",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      pieces: { type: "int", default: 2, label: "Pieces k" },
    },
    ...io,
    subBlocks: [],
    description:
      `Computes k affine projections of the input and keeps the element-wise maximum. A ${link("maxout unit", SRC.maxout)} outputs the max of a set of inputs, which gives a learned piecewise-linear activation.`,
    sources: [SRC.maxout],
  },

  moe: {
    name: "Mixture of experts",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      dff: { type: "int", default: 1024, label: "Expert width dff" },
      experts: { type: "int", default: 64, label: "Experts" },
      activeExperts: { type: "int", default: 8, label: "Active experts" },
    },
    ...io,
    subBlocks: [
      { id: "router", name: "Router", description: `A linear map from d to one score per expert; a ${link("trainable gating network picks a sparse set of experts", SRC.moe)} for each token.` },
      { id: "experts", name: "Experts", description: `Independent SwiGLU MLPs; only the chosen ones run, ${link("so capacity grows without a matching growth in compute", SRC.moe)}.` },
    ],
    description:
      `Replaces one MLP with many expert MLPs and a router that sends each token to a few of them (${link("Shazeer et al.", SRC.moe)}). ` +
      `${link("OLMoE-1B-7B", SRC.olmoe)} has 7 billion parameters but uses only 1 billion per token.`,
    sources: [SRC.moe, SRC.olmoe],
  },

  engram: {
    name: "Engram n-gram lookup",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      maxNgram: { type: "int", default: 3, label: "Largest n-gram N" },
      headsPerNgram: { type: "int", default: 8, label: "Hash heads per n-gram" },
      embedPerNgram: { type: "int", default: 512, label: "Memory width per n-gram" },
      tableSize: { type: "int", default: 646400, label: "Rows per hash table" },
      convKernel: { type: "int", default: 4, label: "Convolution kernel" },
    },
    inputs: [{ id: "x", shape: STREAM }, { id: "tokens", shape: ["B", "T"], external: true }],
    outputs: [{ id: "y", shape: STREAM }],
    subBlocks: [
      { id: "hashing", name: "N-gram hashing", description: `Hashes the 2-gram to N-gram ending at each position into several hash heads, each with its own prime-sized table (${link("demo code", SRC.engramCode)}).` },
      { id: "tables", name: "Memory tables", description: `Embedding lookups by hash; ${link("deterministic addressing lets the tables be offloaded to host memory", SRC.engram)}.` },
      { id: "gate", name: "Context gate", description: `Projects the memory to a key, compares it with the normalised hidden state, and scales the projected value by a sigmoid of the score (${link("demo code", SRC.engramCode)}).` },
      { id: "shortConv", name: "Short convolution", description: `A depthwise causal convolution over the gated value, added back to it (${link("demo code", SRC.engramCode)}).` },
    ],
    description:
      `A conditional-memory module that ${link("modernises classic N-gram embeddings for O(1) lookup", SRC.engram)}. ` +
      `Recent token n-grams address large tables; the retrieved memory is gated by the hidden state and added to the residual stream (${link("demo code", SRC.engramCode)}). ` +
      "Table sizes are primes near the row count, so the parameter count is approximate.",
    sources: [SRC.engram, SRC.engramCode],
  },

  slidingWindowAttention: {
    name: "Sliding-window attention",
    category: "sequence mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      queryHeads: { type: "int", default: 8, label: "Query heads" },
      kvHeads: { type: "int", default: 2, label: "Key/value heads" },
      headDim: { type: "int", default: 128, label: "Head dimension" },
      window: { type: "int", default: 4096, label: "Window" },
    },
    ...io,
    subBlocks: [],
    description:
      `Each position attends only to a fixed window of recent positions, so ${link("cost scales linearly with sequence length", SRC.longformer)}. ` +
      `${link("Mistral 7B", SRC.mistral)} combines it with grouped-query attention.`,
    sources: [SRC.longformer, SRC.mistral],
  },

  layerNorm: {
    name: "LayerNorm",
    category: "normalisation",
    params: { d: { type: "int", default: 1024, label: "Width d" } },
    ...io,
    subBlocks: [],
    description:
      `Normalises each vector with the mean and variance of its own channels, then applies a ${link("learned gain and bias", SRC.layerNorm)}. ` +
      "It computes the same thing at training and test time.",
    sources: [SRC.layerNorm],
  },

  geluMlp: {
    name: "GELU MLP",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      dff: { type: "int", default: 4096, label: "Hidden width dff" },
    },
    ...io,
    subBlocks: [],
    description:
      `Two linear layers with biases and a non-linearity between them: the ${link("Transformer feed-forward block", SRC.vaswani)} ` +
      `with ${link("GELU", SRC.gelu)}, x·Φ(x), in place of ReLU.`,
    sources: [SRC.vaswani, SRC.gelu],
  },

  positionEmbedding: {
    name: "Learned position embedding",
    category: "input",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      maxPositions: { type: "int", default: 2048, label: "Maximum positions" },
    },
    ...io,
    subBlocks: [],
    description:
      `Adds a learned vector for each absolute position up to a maximum length, as in ${link("convolutional sequence-to-sequence models", SRC.convS2S)} and ${link("BERT", SRC.bert)}. ` +
      "Models with RoPE rotate queries and keys instead and have no such table.",
    sources: [SRC.convS2S, SRC.bert],
  },
};
