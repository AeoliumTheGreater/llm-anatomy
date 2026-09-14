import { decoderLayer, inputBlocks, outputBlocks } from "./layer.js";

// values from https://huggingface.co/Qwen/Qwen2.5-0.5B/blob/main/config.json
const d = 896;
const V = 151936;
const dff = 4864;
const layers = 24;

const input = inputBlocks({ V, d });
const layer = decoderLayer({
  prefix: "layer",
  group: "layer",
  mixer: {
    id: "attn",
    type: "attention",
    // the config has no head_dim, so the modelling code uses hidden_size / num_attention_heads
    params: {
      d, queryHeads: 14, kvHeads: 2, headDim: 64,
      qkNorm: false, bias: true, outputGate: false,
      ropeTheta: 1000000, rotaryFraction: 1,
    },
  },
  d,
  dff,
  index: 0,
  input: input.output,
});
const output = outputBlocks({ V, d, layerCount: 1, input: layer.output });

export const PRESET = {
  id: "qwen2_5_0_5b",
  name: "Qwen2.5-0.5B",
  readOnly: true,
  globals: { d, V, dff, layers },
  nodes: [...input.nodes, ...layer.nodes, ...output.nodes],
  edges: [...layer.edges, ...output.edges],
  groups: [{ id: "layer", label: "Decoder layer", repeat: layers, collapsed: true }],
  sources: [
    { label: "Qwen2.5-0.5B config.json", url: "https://huggingface.co/Qwen/Qwen2.5-0.5B/blob/main/config.json" },
    { label: "Qwen2 modelling code (Hugging Face Transformers)", url: "https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2/modeling_qwen2.py" },
    { label: "Qwen2.5 Technical Report", url: "https://arxiv.org/abs/2412.15115" },
  ],
};
