// measures drag and pan cost with about 300 blocks on screen.
// start the site first (just serve), then run: just perf
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { decoderLayer, inputBlocks, outputBlocks } from "../src/presets/layer.js";
import { validateGraph } from "../src/graph.js";

const SITE = process.env.SITE ?? "http://127.0.0.1:8000/";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const WORK = `${tmpdir()}/llm-anatomy-perf`;
const PORT = 9334;
const LAYERS = 50;
const MOVES = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// builds a graph of about 300 blocks in one group
const d = 1024;
const V = 151936;
const input = inputBlocks({ V, d });
const nodes = [...input.nodes];
const edges = [];
let previous = input.output;
for (let i = 0; i < LAYERS; i += 1) {
  const layer = decoderLayer({
    prefix: `layer.l${i}`, group: "layer", d, dff: 3072, index: i, input: previous,
    mixer: { id: "attn", type: "attention", params: { d, queryHeads: 8, kvHeads: 2, headDim: 128, qkNorm: true, bias: false, outputGate: false, ropeTheta: 1e6, rotaryFraction: 1 } },
  });
  nodes.push(...layer.nodes);
  edges.push(...layer.edges);
  previous = layer.output;
}
const output = outputBlocks({ V, d, layerCount: LAYERS, input: previous });
const graph = {
  id: "stress", name: "Stress test", readOnly: false, globals: { d, V, dff: 3072, layers: LAYERS },
  nodes: [...nodes, ...output.nodes], edges: [...edges, ...output.edges],
  groups: [{ id: "layer", label: "Stress layers", repeat: 1, collapsed: true }], sources: [],
};
const errors = validateGraph(graph);
if (errors.length) throw new Error(errors.join("\n"));
await rm(WORK, { recursive: true, force: true });
await writeFile(`${WORK}-graph.json`, JSON.stringify(graph));
console.log(`graph: ${graph.nodes.length} blocks, ${graph.edges.length} connections`);

// starts Chrome and connects
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=${WORK}/profile`, "about:blank"], { stdio: "ignore" });
let target = null;
for (let i = 0; i < 60 && !target; i += 1) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  } catch { /* starting */ }
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (message) => {
  const msg = JSON.parse(message.data);
  if (msg.id) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const centreOf = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
const taskSeconds = async () => (await send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;

await send("Runtime.enable");
await send("Performance.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: SITE });
await sleep(1300);

// imports the graph and expands its group
const { root } = await send("DOM.getDocument");
const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".import-input" });
await send("DOM.setFileInputFiles", { nodeId, files: [`${WORK}-graph.json`] });
await sleep(900);
const toggle = await centreOf(".group-box .group-toggle");
await mouse("mousePressed", toggle.x, toggle.y);
await mouse("mouseReleased", toggle.x, toggle.y, 0);
await sleep(400);
await evaluate("document.querySelector('[data-zoom=fit]').click()");
await sleep(250);
console.log(`on screen: ${await evaluate("document.querySelectorAll('.layer-nodes > [data-key]').length")} blocks, ${await evaluate("document.querySelectorAll('.edge').length")} arrows`);

/** Brings a block into view, since the diagram is wider than the canvas. */
async function focusItem(key) {
  await evaluate(`document.querySelector('[data-key="${key}"]')?.focus()`);
  await sleep(250);
}

/** Runs a pointer gesture and reports the browser task time per move. */
async function measure(label, from) {
  await mouse("mouseMoved", from.x, from.y, 0);
  await mouse("mousePressed", from.x, from.y);
  const before = await taskSeconds();
  for (let i = 1; i <= MOVES; i += 1) await mouse("mouseMoved", from.x + i * 3, from.y + i * 2);
  const after = await taskSeconds();
  await mouse("mouseReleased", from.x + MOVES * 3, from.y + MOVES * 2, 0);
  await sleep(250);
  console.log(`${label}: ${(((after - before) * 1000) / MOVES).toFixed(2)} ms per move`);
}

// checks the drag actually moved the block, or the timing would mean nothing
const dragged = '[data-key="node:layer.l10.mlp"]';
await focusItem("node:layer.l10.mlp");
const before = await evaluate(`document.querySelector('${dragged}').style.transform`);
await measure("drag a block", await centreOf(`${dragged} .node-hit`));
const after = await evaluate(`document.querySelector('${dragged}').style.transform`);
console.log(before === after ? `DRAG DID NOT MOVE THE BLOCK (${before})` : `block moved: ${before} → ${after}`);

await measure("pan the canvas", { x: 700, y: 860 });

console.log(pageErrors.length ? `page errors: ${pageErrors.join("\n")}` : "no page errors");
ws.close();
chrome.kill();
