const SVG_NS = "http://www.w3.org/2000/svg";
const LINK = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

/** Creates an HTML element; attributes starting with "on" become event listeners. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/** Creates an SVG element and appends it to the parent when one is given. */
export function svg(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    el.setAttribute(key, String(value));
  }
  parent?.appendChild(el);
  return el;
}

/** Turns text with [label](https://…) links into text nodes and anchors. */
export function richText(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    parts.push(text.slice(last, match.index));
    parts.push(h("a", { href: match[2], target: "_blank", rel: "noopener noreferrer" }, match[1]));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts.filter((p) => p !== "");
}

/** Returns the class that sets a category's colour. */
export function categoryClass(category) {
  return `cat-${category.replace(/\s+/g, "-")}`;
}

/** Replaces a container's children and puts focus back on the element with the same focus key. */
export function replaceKeepingFocus(container, children) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.focusKey : null;
  container.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  if (key) container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}
