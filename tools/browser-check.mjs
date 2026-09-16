// drives headless Chrome through the checks that need a real browser.
// start the site first (just serve), then run: just check
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const SITE = process.env.SITE ?? "http://127.0.0.1:8000/";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const WORK = `${tmpdir()}/llm-anatomy-check`;
const SHOTS = process.env.SHOTS ?? `${WORK}/shots`;
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rm(`${WORK}/profile`, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

// starts Chrome and connects to its first page
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${WORK}/profile`, "--window-size=1400,900", "about:blank",
], { stdio: "ignore" });
let target = null;
for (let i = 0; i < 60 && !target; i += 1) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  } catch { /* Chrome is still starting */ }
  if (!target) await sleep(200);
}
if (!target) throw new Error("Chrome did not start");

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
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) pageErrors.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") pageErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

// page helpers
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
};
const rect = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null; })()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "mouse" });
const click = async (selector) => {
  const box = await rect(selector);
  if (!box) throw new Error(`no element for ${selector}`);
  await mouse("mouseMoved", box.cx, box.cy, 0);
  await mouse("mousePressed", box.cx, box.cy);
  await mouse("mouseReleased", box.cx, box.cy, 0);
  await sleep(150);
};
const dragPoints = async (from, to) => {
  await mouse("mouseMoved", from.x, from.y, 0);
  await mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= 8; i += 1) await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await mouse("mouseReleased", to.x, to.y, 0);
  await sleep(200);
};
// page expressions for layout checks
const stepsOnOneRow = "new Set([...document.querySelectorAll('.node.is-step .node-body')].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1";
const allInsideCanvas = (selector) => `(() => {
  const canvas = document.querySelector('.canvas').getBoundingClientRect();
  return [...document.querySelectorAll('${selector}')].every((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= canvas.left - 1 && r.right <= canvas.right + 1;
  });
})()`;

// focusing brings a block into view, which matters on a diagram wider than the canvas
const focusItem = async (key) => {
  await evaluate(`document.querySelector('[data-key="${key}"]')?.focus()`);
  await sleep(200);
};
const clickIn = async (key, inner) => {
  await focusItem(key);
  await click(`[data-key="${key}"] ${inner}`);
};
const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37, Enter: 13, Delete: 46, Escape: 27, z: 90, e: 69, f: 70 };
const key = async (name, modifiers = 0) => {
  const code = name.length === 1 ? `Key${name.toUpperCase()}` : name;
  const text = name === "Enter" ? "\r" : name.length === 1 && !modifiers ? name : undefined;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: KEYS[name], modifiers, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: KEYS[name], modifiers });
  await sleep(150);
};
const load = async () => {
  await send("Page.navigate", { url: SITE });
  await sleep(1300);
};
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    check(name, false, error.message);
  }
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

await load();
await evaluate("localStorage.clear()");
await load();

await step("the model reads left to right", async () => {
  check("Qwen3-1.7B loads by default", (await text(".inspector-heading")) === "Qwen3-1.7B");
  check("overview shows about 1.72B parameters", (await text(".inspector .facts dd"))?.startsWith("1.72B"), await text(".inspector .facts dd"));
  check("collapsed view shows embed, group, final norm, head, sampling", (await count(".layer-nodes > [data-key]")) === 5, String(await count(".layer-nodes > [data-key]")));
  const embed = await rect('[data-key="node:embed"]');
  const group = await rect(".group-box");
  const sampling = await rect('[data-key="node:sampling"]');
  check("the stream runs left to right", embed.x < group.x && group.x < sampling.x, `${Math.round(embed.x)} < ${Math.round(group.x)} < ${Math.round(sampling.x)}`);
  check("blocks stay on one line", Math.abs(embed.cy - sampling.cy) < 4, `${Math.round(embed.cy)} vs ${Math.round(sampling.cy)}`);
  check("the whole model fits on screen when it opens", await evaluate(allInsideCanvas(".layer-nodes > [data-key]")));
  check("every connection has an arrowhead", (await count(".edge")) === (await count(".edge-head")) && (await count(".edge")) > 0);
  check("the palette lists every block type", (await count(".palette-item")) === 15, String(await count(".palette-item")));
  await shot("01-collapsed");
});

await step("group expansion", async () => {
  await click(".group-box .group-toggle");
  check("expanding shows one repeat of six blocks", (await count(".layer-nodes > [data-key]")) === 10);
  check("the frame says repeated 28 times", (await text(".group-label"))?.includes("repeated 28 times"), await text(".group-label"));
  check("both adders are drawn as circles", (await count(".node.is-adder")) === 2);
  const attn = await rect('[data-key="node:layer.attn"] .node-body');
  const mlp = await rect('[data-key="node:layer.mlp"] .node-body');
  const add = await rect('[data-key="node:layer.add1"] .node-body');
  check("the whole layer sits on one row", Math.abs(attn.cy - add.cy) < 2 && Math.abs(mlp.cy - add.cy) < 2, `${Math.round(attn.cy)}, ${Math.round(add.cy)}, ${Math.round(mlp.cy)}`);
  check("both skips are labelled residual", (await count(".edge-label")) === 2, String(await count(".edge-label")));
  check("a dot marks where each skip leaves the line", (await count(".edge-junction")) >= 2, String(await count(".edge-junction")));
  check("the longest block title fits before its button", await evaluate(`document.querySelector('[data-key="node:layer.attn"] .node-title').getComputedTextLength() < 240 - 32 - 14 - 4`));
  const skipLabel = await rect(".edge-label");
  check("the skip lanes run above the row", skipLabel.cy < add.y, `${Math.round(skipLabel.cy)} < ${Math.round(add.y)}`);
  await focusItem("node:layer.attn");
  await shot("02-expanded");
  await evaluate("document.querySelector('[data-zoom=fit]').click()");
  await sleep(150);
  await shot("02-expanded-fit");
});

await step("opening a block and a step inside it", async () => {
  await clickIn("node:layer.attn", ".sub-toggle");
  check("the breadcrumb shows the level", (await text(".breadcrumb"))?.includes("Grouped-query attention"), await text(".breadcrumb"));
  check("Qwen3 attention has six steps", (await count(".node.is-step")) === 6, String(await count(".node.is-step")));
  check("the steps sit on one row", await evaluate(stepsOnOneRow));
  check("the whole row fits on screen", await evaluate(allInsideCanvas(".node.is-step")));
  check("steps carry their equations", (await text('[data-key="step:weights"] .node-meta'))?.includes("softmax"), await text('[data-key="step:weights"] .node-meta'));
  await clickIn("step:weights", ".node-body");
  check("selecting a step explains it", (await text(".inspector .equation"))?.includes("softmax"), await text(".inspector .equation"));
  await shot("03-inside-attention");

  await clickIn("step:weights", ".sub-toggle");
  check("a step opens one level further", (await count(".node.is-step")) === 4, String(await count(".node.is-step")));
  check("the breadcrumb grows", (await count(".breadcrumb button")) === 2, String(await count(".breadcrumb button")));
  check("the causal mask is explained", (await text(".canvas"))?.includes("causal mask"));
  await shot("04-inside-attention-weights");

  await click(".breadcrumb button");
  check("the first crumb returns to the model", await evaluate("document.querySelector('.breadcrumb').hidden"));
  check("the model is drawn again", (await count(".layer-nodes > [data-key]")) === 10);
});

await step("Gated DeltaNet internals", async () => {
  await click('.preset[data-preset="qwen3_5_0_8b"]');
  await sleep(450);
  check("Qwen3.5 totals 752.4M", (await text(".inspector .facts dd"))?.startsWith("752.4M"), await text(".inspector .facts dd"));
  await click(".group-box .group-toggle");
  await clickIn("node:layer.dn0.deltanet", ".sub-toggle");
  check("the DeltaNet opens into seven steps", (await count(".node.is-step")) === 7, String(await count(".node.is-step")));
  check("the DeltaNet steps sit on one row", await evaluate(stepsOnOneRow));
  check("the state update shows the delta rule", (await text('[data-key="step:state"] .node-meta'))?.includes("S ←"), await text('[data-key="step:state"] .node-meta'));
  await clickIn("step:state", ".sub-toggle");
  check("the delta rule opens one level further", (await text(".breadcrumb"))?.includes("Delta-rule"), await text(".breadcrumb"));
  await shot("05-delta-rule");
  await click(".breadcrumb button");
});

await step("difference panel", async () => {
  await click('[data-action="compare"]');
  const diff = await text(".diffpanel");
  check("the panel reports Gated DeltaNet only in Qwen3.5", diff?.includes("Gated DeltaNet: 18 layers in Qwen3.5-0.8B, none in Qwen3-1.7B"));
  await shot("06-differences");
  await click(".diff-close");
});

await step("invalid connection by dragging", async () => {
  // zooms in enough that the small port dots can be hit, with both ends still on screen
  await evaluate("document.querySelector('[data-zoom=fit]').click()");
  await evaluate("document.querySelector('[data-zoom=in]').click()");
  await evaluate("document.querySelector('[data-zoom=in]').click()");
  await focusItem("node:sampling");
  const from = await rect('[data-key="node:finalNorm"] .port-out');
  const to = await rect('[data-key="node:sampling"] .port-in');
  const canvas = await rect(".canvas");
  check("both ends of the drag are on screen", from.cx > canvas.x && to.cx < canvas.x + canvas.w, `${Math.round(from.cx)}…${Math.round(to.cx)} in ${Math.round(canvas.x)}…${Math.round(canvas.x + canvas.w)}`);
  await dragPoints({ x: from.cx, y: from.cy }, { x: to.cx, y: to.cy });
  const status = await text(".status");
  check("a mismatched drag names both shapes", status === "RMSNorm output [B, T, 1024] does not match Softmax and sampling input [B, T, 248320]", status);
  check("the rejected connection leaves the preset unedited", await evaluate("document.querySelector('.badge').hidden"));
});

await step("editing, undo and redo", async () => {
  await clickIn("node:lmHead", ".node-body");
  await evaluate(`(() => { const box = [...document.querySelectorAll('.inspector .param-bool')].find((l) => l.textContent.includes('Tied')).querySelector('input'); box.click(); })()`);
  await sleep(200);
  check("the first edit shows the Edited badge", !(await evaluate("document.querySelector('.badge').hidden")));
  check("untying adds the output matrix", (await text(".inspector .count"))?.startsWith("254,279,680"), await text(".inspector .count"));
  await evaluate("document.activeElement.blur()");
  await key("z", 2);
  check("Ctrl+Z returns to the preset", await evaluate("document.querySelector('.badge').hidden"));
  await key("z", 2 | 8);
  check("Ctrl+Shift+Z redoes the edit", !(await evaluate("document.querySelector('.badge').hidden")));
});

await step("dragging a block", async () => {
  await focusItem("node:sampling");
  const before = await evaluate(`document.querySelector('[data-key="node:sampling"]').style.transform`);
  const handle = await rect('[data-key="node:sampling"] .node-body');
  await dragPoints({ x: handle.cx, y: handle.cy }, { x: handle.cx + 140, y: handle.cy + 80 });
  const after = await evaluate(`document.querySelector('[data-key="node:sampling"]').style.transform`);
  check("dragging moves the block", before !== after, `${before} → ${after}`);
  const [, x] = after.match(/translate\((-?[\d.]+)px/) ?? [];
  check("the dropped position snaps to 20 px", Number(x) % 20 === 0, String(x));
  await evaluate("document.activeElement.blur()");
  await key("z", 2);
  check("undo restores the position", (await evaluate(`document.querySelector('[data-key="node:sampling"]').style.transform`)) === before);
  await key("z", 2 | 8);
});

await step("palette add, warning and delete", async () => {
  const before = await count(".layer-nodes > .node");
  await click(".palette-item.cat-normalisation");
  check("a palette click adds a block", (await count(".layer-nodes > .node")) === before + 1);
  check("the new block is flagged for its unconnected input", (await count(".layer-nodes > .node.has-warning")) >= 1);
  await evaluate("document.activeElement.blur()");
  await key("Delete");
  check("Delete removes the selected block", (await count(".layer-nodes > .node")) === before);
});

await step("reload keeps edits", async () => {
  await load();
  check("reload restores the last preset", (await text(".inspector-heading")) === "Qwen3.5-0.8B (edited)", await text(".inspector-heading"));
});

await step("keyboard use", async () => {
  await evaluate("document.querySelector('.layer-nodes > [data-key]').focus()");
  const first = await evaluate("document.activeElement.dataset.key");
  await key("ArrowRight");
  const second = await evaluate("document.activeElement.dataset.key");
  check("an arrow key moves focus along the stream", first !== second && Boolean(second), `${first} → ${second}`);
  await key("Enter");
  check("Enter moves focus to the inspector heading", await evaluate("document.activeElement.classList.contains('inspector-heading')"));
  await key("Escape");
  check("Escape returns focus to the canvas", (await evaluate("document.activeElement.dataset.key")) === second);
  await evaluate(`document.querySelector('[data-key="node:embed"]').focus()`);
  await key("e");
  check("E opens the inside of the focused block", !(await evaluate("document.querySelector('.breadcrumb').hidden")));
  await key("Escape");
  check("Escape leaves the inside view", await evaluate("document.querySelector('.breadcrumb').hidden"));
  await evaluate(`document.querySelector('.group-box')?.focus()`);
  await key("e");
  check("E on a group expands it instead", (await count(".layer-nodes > [data-key]")) > 5, String(await count(".layer-nodes > [data-key]")));
});

await step("import", async () => {
  const bad = `${WORK}/bad-import.json`;
  await writeFile(bad, JSON.stringify({ id: "x", name: "X", readOnly: false, globals: {}, nodes: [{ id: "a", type: "warp", params: {}, position: { x: 0, y: 0 }, group: null }], edges: [], groups: [], sources: [] }));
  const { root } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".import-input" });
  await send("DOM.setFileInputFiles", { nodeId, files: [bad] });
  await sleep(400);
  check("an invalid import reports what and where", (await text(".status"))?.includes('nodes[0].type: unknown block type "warp"'), await text(".status"));
});

await step("reduced motion", async () => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await click('.preset[data-preset="qwen2_5_0_5b"]');
  check("reduced motion removes old blocks at once", (await count(".layer-leaving > *")) === 0);
  check("reduced motion skips the animate class", !(await evaluate("document.querySelector('.canvas').classList.contains('animate')")));
  await shot("07-qwen25");
});

await step("narrow screen", async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  check("the palette is hidden below 800 px", (await evaluate("getComputedStyle(document.querySelector('.palette')).display")) === "none");
  check("the page does not scroll sideways", (await evaluate("document.documentElement.scrollWidth")) <= 400, String(await evaluate("document.documentElement.scrollWidth")));
  await click(".layer-nodes > .node .node-body");
  check("editing fields are disabled on narrow screens", await evaluate("[...document.querySelectorAll('.inspector input')].every((i) => i.disabled)"));
  await shot("08-narrow");
});

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
console.log(`screenshots in ${SHOTS}`);
console.log(pageErrors.length ? `page errors:\n${pageErrors.join("\n")}` : "no page errors");
ws.close();
chrome.kill();
process.exit(results.every((r) => r.ok) && pageErrors.length === 0 ? 0 : 1);
