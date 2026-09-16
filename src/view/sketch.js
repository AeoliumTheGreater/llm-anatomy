// hand-drawn strokes: every shape wobbles, but always the same way for the same seed

const JITTER = 1.6;
const BOW = 2.2;
const OVERSHOOT = 2.5;
const STEP = 14;

/** Turns text into a 32-bit seed. */
export function seedFrom(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Returns a repeatable random number generator (mulberry32). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws one bowed line from a to b, overshooting the ends a little. */
function stroke(rand, [x1, y1], [x2, y2]) {
  const jitter = () => (rand() - 0.5) * 2 * JITTER;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const over = (OVERSHOOT * rand()) / length;

  // pushes the ends past the corner and bows the middle sideways
  const sx = x1 - dx * over + jitter();
  const sy = y1 - dy * over + jitter();
  const ex = x2 + dx * over + jitter();
  const ey = y2 + dy * over + jitter();
  const bow = (rand() - 0.5) * 2 * BOW;
  const cx = (sx + ex) / 2 - (dy / length) * bow;
  const cy = (sy + ey) / 2 + (dx / length) * bow;
  return `M ${round(sx)} ${round(sy)} Q ${round(cx)} ${round(cy)} ${round(ex)} ${round(ey)}`;
}

/** Rounds to one decimal so paths stay short. */
function round(value) {
  return Math.round(value * 10) / 10;
}

/** Draws a box as four bowed strokes, twice over. */
export function sketchRect(w, h, seed) {
  const rand = random(seed);
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const parts = [];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < 4; i += 1) parts.push(stroke(rand, corners[i], corners[(i + 1) % 4]));
  }
  return parts.join(" ");
}

/** Draws a circle as two wobbling loops. */
export function sketchCircle(cx, cy, r, seed) {
  const rand = random(seed);
  const parts = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const start = rand() * Math.PI * 2;
    const points = [];
    const steps = 12;
    for (let i = 0; i <= steps; i += 1) {
      const angle = start + (i / steps) * Math.PI * 2;
      const radius = r + (rand() - 0.5) * 2 * JITTER;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    parts.push(smooth(points));
  }
  return parts.join(" ");
}

/** Joins points with a smooth curve through their midpoints. */
function smooth(points) {
  let d = `M ${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q ${round(x)} ${round(y)} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
  }
  const last = points.at(-1);
  d += ` L ${round(last[0])} ${round(last[1])}`;
  return d;
}

/** Draws a wobbling line along a list of points, sampled from a curve. */
export function sketchPolyline(points, seed) {
  const rand = random(seed);
  const wobbled = points.map(([x, y], i) => {
    // leaves the two ends where the ports are
    if (i === 0 || i === points.length - 1) return [x, y];
    return [x + (rand() - 0.5) * 2 * JITTER, y + (rand() - 0.5) * 2 * JITTER];
  });
  return smooth(wobbled);
}

/** Samples a cubic Bézier into points about STEP apart. */
export function sampleCubic(p0, c0, c1, p1) {
  const rough = Math.hypot(c0[0] - p0[0], c0[1] - p0[1]) + Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) + Math.hypot(p1[0] - c1[0], p1[1] - c1[1]);
  const steps = Math.max(4, Math.min(64, Math.round(rough / STEP)));
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1],
    ]);
  }
  return points;
}

/** Draws an arrowhead at the end of a path, pointing along its last segment. */
export function sketchArrowHead(points, seed, size = 11) {
  const rand = random(seed);
  const tip = points.at(-1);
  const before = points.at(-2) ?? [tip[0] - 1, tip[1]];
  const angle = Math.atan2(tip[1] - before[1], tip[0] - before[0]);
  const spread = 0.42;
  const parts = [];
  for (const side of [-1, 1]) {
    const a = angle + Math.PI + side * spread + (rand() - 0.5) * 0.12;
    const length = size + (rand() - 0.5) * 2;
    parts.push(stroke(rand, tip, [tip[0] + Math.cos(a) * length, tip[1] + Math.sin(a) * length]));
  }
  return parts.join(" ");
}
