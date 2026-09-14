import { test } from "node:test";
import assert from "node:assert/strict";

import { countBlockParams, countGraphParams, formatCount } from "../src/params.js";
import { PRESET as QWEN2_5 } from "../src/presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

// hand counts from each config.json and the Hugging Face modelling code (text model only)

test("Qwen3-1.7B totals about 1.72B", () => {
  const { total, perNode } = countGraphParams(QWEN3);
  assert.equal(perNode["layer.attn"], 12_583_168);
  assert.equal(perNode["layer.mlp"], 37_748_736);
  assert.equal(perNode.embed, 311_164_928);
  assert.equal(perNode.lmHead, 0);
  assert.equal(total, 1_720_574_976);
  assert.equal(formatCount(total), "1.72B");
});

test("Qwen2.5-0.5B totals about 0.49B", () => {
  const { total, perNode } = countGraphParams(QWEN2_5);
  assert.equal(perNode["layer.attn"], 1_836_160);
  assert.equal(perNode["layer.mlp"], 13_074_432);
  assert.equal(perNode.embed, 136_134_656);
  assert.equal(total, 494_032_768);
});

test("Qwen3.5-0.8B totals about 752M without the vision encoder and MTP head", () => {
  const { total, perNode } = countGraphParams(QWEN3_5);
  assert.equal(perNode["layer.dn0.deltanet"], 10_543_264);
  assert.equal(perNode["layer.attn"], 7_340_544);
  assert.equal(perNode["layer.mlp"], 11_010_048);
  assert.equal(perNode.embed, 254_279_680);
  assert.equal(total, 752_393_024);
});

test("an untied output layer counts its own matrix", () => {
  assert.equal(countBlockParams("lmHead", { d: 4, V: 10, tied: false }), 40);
  assert.equal(countBlockParams("lmHead", { d: 4, V: 10, tied: true }), 0);
});

test("attention bias covers q, k and v only", () => {
  const base = { d: 8, queryHeads: 2, kvHeads: 1, headDim: 4, qkNorm: false, bias: false, outputGate: false, ropeTheta: 1, rotaryFraction: 1 };
  const withBias = countBlockParams("attention", { ...base, bias: true });
  assert.equal(withBias - countBlockParams("attention", base), 8 + 4 + 4);
});
