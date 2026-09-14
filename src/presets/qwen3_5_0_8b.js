import { decoderLayer, inputBlocks, outputBlocks, LAYER_HEIGHT } from "./layer.js";

// values from the text_config in https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/config.json
const d = 1024;
const V = 248320;
const dff = 3584;
const layers = 24;
const fullAttentionInterval = 4;

const deltaNetParams = { d, keyHeads: 16, valueHeads: 16, keyHeadDim: 128, valueHeadDim: 128, convKernel: 4 };
const attentionParams = {
  d, queryHeads: 8, kvHeads: 2, headDim: 256,
  qkNorm: true, bias: false, outputGate: true,
  ropeTheta: 10000000, rotaryFraction: 0.25,
};

// builds the repeated group: three Gated DeltaNet layers, then one attention layer (layer_types)
const input = inputBlocks({ V, d });
const nodes = [...input.nodes];
const edges = [];
let previous = input.output;
for (let i = 0; i < fullAttentionInterval; i += 1) {
  const isAttention = i === fullAttentionInterval - 1;
  const layer = decoderLayer({
    // the attention layer reuses the Qwen3 ids so the preset toggle keeps it in place
    prefix: isAttention ? "layer" : `layer.dn${i}`,
    group: "layer",
    mixer: isAttention
      ? { id: "attn", type: "attention", params: attentionParams }
      : { id: "deltanet", type: "gatedDeltaNet", params: deltaNetParams },
    d,
    dff,
    top: 100 + i * LAYER_HEIGHT,
    input: previous,
  });
  nodes.push(...layer.nodes);
  edges.push(...layer.edges);
  previous = layer.output;
}
const output = outputBlocks({ V, d, top: 100 + fullAttentionInterval * LAYER_HEIGHT + 20, input: previous });

export const PRESET = {
  id: "qwen3_5_0_8b",
  name: "Qwen3.5-0.8B",
  readOnly: true,
  globals: { d, V, dff, layers },
  nodes: [...nodes, ...output.nodes],
  edges: [...edges, ...output.edges],
  groups: [{
    id: "layer",
    label: "Hybrid block (3 Gated DeltaNet + 1 attention)",
    repeat: layers / fullAttentionInterval,
    collapsed: true,
  }],
  sources: [
    { label: "Qwen3.5-0.8B config.json", url: "https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/config.json" },
    { label: "Qwen3.5 modelling code (Hugging Face Transformers)", url: "https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_5/modeling_qwen3_5.py" },
    { label: "Qwen3.5-0.8B model card", url: "https://huggingface.co/Qwen/Qwen3.5-0.8B" },
  ],
};
