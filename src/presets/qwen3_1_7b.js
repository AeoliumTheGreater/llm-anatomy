import { decoderLayer, inputBlocks, outputBlocks } from "./layer.js";

// values from https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/config.json
const d = 2048;
const V = 151936;
const dff = 6144;
const layers = 28;

const input = inputBlocks({ V, d });
const layer = decoderLayer({
  prefix: "layer",
  group: "layer",
  mixer: {
    id: "attn",
    type: "attention",
    params: {
      d, queryHeads: 16, kvHeads: 8, headDim: 128,
      qkNorm: true, bias: false, outputGate: false,
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
  id: "qwen3_1_7b",
  name: "Qwen3-1.7B",
  readOnly: true,
  globals: { d, V, dff, layers },
  nodes: [...input.nodes, ...layer.nodes, ...output.nodes],
  edges: [...layer.edges, ...output.edges],
  groups: [{ id: "layer", label: "Decoder layer", repeat: layers, collapsed: true }],
  sources: [
    { label: "Qwen3-1.7B config.json", url: "https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/config.json" },
    { label: "Qwen3 modelling code (Hugging Face Transformers)", url: "https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3/modeling_qwen3.py" },
    { label: "Qwen3 Technical Report", url: "https://arxiv.org/abs/2505.09388" },
  ],
};
