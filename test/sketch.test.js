import { test } from "node:test";
import assert from "node:assert/strict";

import { sampleCubic, seedFrom, sketchArrowHead, sketchCircle, sketchPolyline, sketchRect } from "../src/view/sketch.js";

/** Pulls every coordinate pair out of a path. */
function points(d) {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

test("the same seed always draws the same shape", () => {
  assert.equal(sketchRect(100, 40, 7), sketchRect(100, 40, 7));
  assert.notEqual(sketchRect(100, 40, 7), sketchRect(100, 40, 8));
  assert.equal(seedFrom("layer.attn"), seedFrom("layer.attn"));
  assert.notEqual(seedFrom("layer.attn"), seedFrom("layer.mlp"));
});

test("a sketched box stays close to its bounds", () => {
  const margin = 8;
  for (const [x, y] of points(sketchRect(200, 52, seedFrom("node")))) {
    assert.ok(x >= -margin && x <= 200 + margin, `x ${x}`);
    assert.ok(y >= -margin && y <= 52 + margin, `y ${y}`);
  }
});

test("a sketched circle stays near its radius", () => {
  for (const [x, y] of points(sketchCircle(26, 26, 26, 3))) {
    const distance = Math.hypot(x - 26, y - 26);
    assert.ok(distance > 20 && distance < 32, `distance ${distance}`);
  }
});

test("a sketched line keeps the two ends exactly where the ports are", () => {
  const curve = sampleCubic([0, 0], [40, 0], [60, 100], [100, 100]);
  const drawn = points(sketchPolyline(curve, 11));
  assert.deepEqual(drawn[0], [0, 0]);
  assert.deepEqual(drawn.at(-1), [100, 100]);
});

test("an arrowhead sits at the end of the line and points back along it", () => {
  const curve = sampleCubic([0, 0], [30, 0], [70, 0], [100, 0]);
  const head = points(sketchArrowHead(curve, 5));
  for (const [x] of head) assert.ok(x > 80, `x ${x}`);
});
