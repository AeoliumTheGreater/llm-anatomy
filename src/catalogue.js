// descriptions use [text](https://…) for inline source links; each link was checked before it was added.
// what happens inside each block lives in internals.js.

export const SRC = {
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

export const CATEGORIES = ["input", "normalisation", "sequence mixing", "channel mixing", "residual", "output"];

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
    description:
      "The residual stream is one running vector x per token. A sub-layer reads a normalised copy of x and computes an update; this block adds that update back, so x ← x + F(RMSNorm(x)). " +
      `The sum simply becomes the new x: the next sub-layer reads it and adds to it in turn, and nothing is sent down a second path (${link("Qwen3.5 code", SRC.qwen35Code)}). ` +
      `Each layer has two adds, one after the mixer and one after the MLP, as in ${link("the Transformer", SRC.vaswani)} with the norm moved inside the branch (${link("pre-norm", SRC.preNorm)}).`,
    sources: [SRC.vaswani, SRC.preNorm, SRC.qwen35Code],
  },

  attention: {
    name: "Grouped-query attention",
    short: "attn",
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
    description:
      `Each position mixes information from earlier positions with a softmax-weighted sum of values (${link("Vaswani et al.", SRC.vaswani)}). ` +
      `${link("Grouped-query attention", SRC.gqa)} lets several query heads share one key/value head. ` +
      `Qwen2 used ${link("bias on q, k and v", SRC.qwen2)}; Qwen3 removes it and ${link("adds QK-norm", SRC.qwen3)}.`,
    sources: [SRC.vaswani, SRC.gqa, SRC.qwen2, SRC.qwen3, SRC.roformer, SRC.gatedAttention],
  },

  swiglu: {
    name: "SwiGLU MLP",
    short: "mlp",
    category: "channel mixing",
    params: {
      d: { type: "int", default: 1024, label: "Width d" },
      dff: { type: "int", default: 3584, label: "Hidden width dff" },
    },
    ...io,
    description:
      "Processes each position on its own: the gated product SiLU(W_gate x) ⊙ (W_up x) is projected back to width d. " +
      `It is one of the ${link("GLU variants that improve Transformer quality over ReLU or GELU", SRC.glu)}.`,
    sources: [SRC.glu],
  },

  gatedDeltaNet: {
    name: "Gated DeltaNet",
    short: "deltanet",
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
    description:
      `Adds a learned vector for each absolute position up to a maximum length, as in ${link("convolutional sequence-to-sequence models", SRC.convS2S)} and ${link("BERT", SRC.bert)}. ` +
      "Models with RoPE rotate queries and keys instead and have no such table.",
    sources: [SRC.convS2S, SRC.bert],
  },
};
