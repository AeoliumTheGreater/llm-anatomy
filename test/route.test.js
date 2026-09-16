import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutGraph, layoutInternals } from "../src/view/canvas.js";
import { obstaclesFor, routeEdge, routesFor, streamEdges } from "../src/view/edges.js";
import { INTERNALS, internalsFor } from "../src/internals.js";
import { PRESET as QWEN2_5 } from "../src/presets/qwen2_5_0_5b.js";
import { PRESET as QWEN3 } from "../src/presets/qwen3_1_7b.js";
import { PRESET as QWEN3_5 } from "../src/presets/qwen3_5_0_8b.js";

const right = (x, y) => ({ x, y, nx: 1, ny: 0 });
const left = (x, y) => ({ x, y, nx: -1, ny: 0 });
const top = (x, y) => ({ x, y, nx: 0, ny: -1 });

/** Splits a route into its segments. */
function segments(points) {
  return points.slice(1).map((p, i) => [points[i], p]);
}

/** Returns true when two axis-aligned segments cross strictly inside both. */
function crosses([[ax1, ay1], [ax2, ay2]], [[bx1, by1], [bx2, by2]]) {
  const aFlat = ay1 === ay2;
  const bFlat = by1 === by2;
  if (aFlat === bFlat) return false;
  const [h, v] = aFlat ? [[ax1, ax2, ay1], [bx1, by1, by2]] : [[bx1, bx2, by1], [ax1, ay1, ay2]];
  const [hx1, hx2, hy] = h;
  const [vx, vy1, vy2] = v;
  return vx > Math.min(hx1, hx2) && vx < Math.max(hx1, hx2) && hy > Math.min(vy1, vy2) && hy < Math.max(vy1, vy2);
}

/** Returns true when a segment passes through the inside of a box. */
function through([[x1, y1], [x2, y2]], box) {
  return Math.max(x1, x2) > box.x + 1 && Math.min(x1, x2) < box.x + box.w - 1
    && Math.max(y1, y2) > box.y + 1 && Math.min(y1, y2) < box.y + box.h - 1;
}

/** Checks a laid-out graph for arrows through blocks and arrows crossing each other. */
function assertTidy(name, graph, layout) {
  const obstacles = obstaclesFor(layout);
  const routes = routesFor(graph, layout, obstacles);
  assert.ok(routes.length > 0, `${name} has no routes`);

  for (const route of routes) {
    const ends = new Set([route.edge.from.node, route.edge.to.node]);
    for (const segment of segments(route.points)) {
      for (const box of obstacles) {
        if (ends.has(box.node) || (box.group && (box.group === route.from.hiddenIn || box.group === route.to.hiddenIn))) continue;
        assert.ok(!through(segment, box), `${name}: ${route.edge.from.node} → ${route.edge.to.node} runs through ${box.node ?? box.group}`);
      }
    }
  }

  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      for (const a of segments(routes[i].points)) {
        for (const b of segments(routes[j].points)) {
          assert.ok(!crosses(a, b), `${name}: ${routes[i].edge.from.node}→${routes[i].edge.to.node} crosses ${routes[j].edge.from.node}→${routes[j].edge.to.node}`);
        }
      }
    }
  }
}

test("the residual stream runs from the embedding through every adder to the final norm", () => {
  const names = (preset) => [...streamEdges(preset)].map((i) => `${preset.edges[i].from.node}→${preset.edges[i].to.node}`);
  assert.deepEqual(names(QWEN3), ["embed→layer.add1", "layer.add1→layer.add2", "layer.add2→finalNorm"]);
  assert.deepEqual(names(QWEN3_5), [
    "embed→layer.dn0.add1", "layer.dn0.add1→layer.dn0.add2",
    "layer.dn0.add2→layer.dn1.add1", "layer.dn1.add1→layer.dn1.add2",
    "layer.dn1.add2→layer.dn2.add1", "layer.dn2.add1→layer.dn2.add2",
    "layer.dn2.add2→layer.add1", "layer.add1→layer.add2",
    "layer.add2→finalNorm",
  ]);
});

test("a collapsed group still shows the stream passing through it", () => {
  const layout = layoutGraph(QWEN3, { collapsed: new Map([["layer", true]]), drag: null });
  const stream = routesFor(QWEN3, layout).filter((r) => r.stream).map((r) => `${r.edge.from.node}→${r.edge.to.node}`);
  assert.deepEqual(stream, ["embed→layer.norm1", "layer.add2→finalNorm"]);
});

test("blocks facing each other on one row get a straight arrow", () => {
  assert.deepEqual(routeEdge(right(0, 26), left(100, 26)), [[0, 26], [100, 26]]);
});

test("blocks on different rows turn in the gap before the target", () => {
  assert.deepEqual(routeEdge(right(0, 124), left(100, 30)), [[0, 124], [76, 124], [76, 30], [100, 30]]);
});

test("a skip taps the line, runs in a lane above and drops into the adder", () => {
  assert.deepEqual(routeEdge(right(240, 26), top(926, 8)), [[240, 26], [256, 26], [256, -36], [926, -36], [926, 8]]);
});

test("a straight arrow that would pass through a block goes over it", () => {
  const box = { x: 40, y: 0, w: 20, h: 52 };
  const points = routeEdge(right(0, 26), left(100, 26), [box]);
  assert.ok(points.length > 2);
  for (const segment of segments(points)) assert.ok(!through(segment, box));
});

for (const preset of [QWEN2_5, QWEN3, QWEN3_5]) {
  test(`${preset.name} arrows avoid blocks and each other, collapsed and expanded`, () => {
    for (const collapsed of [true, false]) {
      const layout = layoutGraph(preset, { collapsed: new Map([["layer", collapsed]]), drag: null });
      assertTidy(`${preset.name} ${collapsed ? "collapsed" : "expanded"}`, preset, layout);
    }
  });
}

test("every internal graph is drawn without crossings", () => {
  const params = {
    ...QWEN3_5.nodes.find((n) => n.type === "attention").params,
    ...QWEN3_5.nodes.find((n) => n.type === "gatedDeltaNet").params,
  };
  for (const key of Object.keys(INTERNALS)) {
    const entry = internalsFor(key, params);
    const layout = layoutInternals(entry, params, QWEN3_5.globals);
    if (entry.edges.length > 0) assertTidy(key, { edges: layout.edges }, layout);
  }
});

test("every internal graph sits on one row, each step after its inputs", () => {
  const params = {
    ...QWEN3_5.nodes.find((n) => n.type === "attention").params,
    ...QWEN3_5.nodes.find((n) => n.type === "gatedDeltaNet").params,
  };
  for (const key of Object.keys(INTERNALS)) {
    const entry = internalsFor(key, params);
    const layout = layoutInternals(entry, params, QWEN3_5.globals);
    const rows = new Set([...layout.nodes.values()].map((item) => item.y));
    assert.equal(rows.size, 1, `${key} uses more than one row`);
    for (const [from, to] of entry.edges) {
      assert.ok(layout.nodes.get(from).x < layout.nodes.get(to).x, `${key}: ${from} comes before ${to}`);
    }
  }
});

test("a side input sits just before the step it feeds", () => {
  const params = QWEN3_5.nodes.find((n) => n.type === "gatedDeltaNet").params;
  const layout = layoutInternals(internalsFor("gatedDeltaNet", params), params, QWEN3_5.globals);
  const at = (id) => layout.nodes.get(id);
  const pitch = at("conv").x - at("inProj").x;
  assert.equal(at("state").x - at("gates").x, pitch);
  assert.ok(at("norm").x < at("gates").x);
});
