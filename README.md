# LLM Anatomy

An interactive blueprint of a language model. Each layer sits on one row, read
left to right: norm, attention, add, norm, MLP, add. The residual stream x is one
running vector: each sub-layer reads a normalised copy and adds its update back
(`h = x + mixer(RMSNorm(x))`, then `x′ = h + MLP(RMSNorm(h))`), and `x′` goes on to
the next layer. The stream is the straight green line everything hangs off: each
sub-layer sits in a band above it, reads a copy where the line is tapped, and
drops its update into the ⊕ on the line. Labels under the line show what it
carries so far — x, then x + attn, then x + attn + mlp. A key in the corner says
so, and connections never cross. Every block opens up: its steps, their tensor shapes, and the
equations behind them, each with a source link.

Three read-only presets ship with it: Qwen2.5-0.5B, Qwen3-1.7B and Qwen3.5-0.8B.

This is a static site. It uses vanilla JavaScript ES modules, SVG and plain
CSS. It has no build step and no dependencies.

## Run

```sh
just serve   # then open http://localhost:8000
just test    # runs node --test on the pure modules
just check   # browser checks against a running site
just perf    # drag and pan timings with about 300 blocks
```

Requires Python 3 for the local server and Node 22 for the tests. `just check`
and `just perf` need Google Chrome; set `SITE` or `CHROME` to point elsewhere.

## Use

- Pick a preset in the top bar. Blocks the two models share move into place;
  the others fade in or out.
- The diagram is one long row. Each view opens at full size at the left of the
  row; scroll to zoom, drag to pan, and press **Fit** to see the whole model.
- Click a block and a card opens beside it with what it does, its shapes and its
  size, plus a button to open its inside. Escape closes it. The inspector on the
  right shows the same block with its sources and editable settings.
- **+ on a block opens its inside**: the steps it is made of, with shapes and
  equations, also on one row; an arrow that has to pass a step goes over it.
  A step with its own **+** opens one level further, such as the delta-rule
  state update or the attention weights. The breadcrumb goes back.
- A repeated layer group is collapsed by default. Expanding it shows one
  repeat, labelled with the repeat count.
- **Compare** opens the difference panel: differing configuration values, and
  structural differences such as layer counts per block type.
- Editing a preset creates a working copy named "<preset> (edited)". Drag
  blocks from the palette, drag from an output port (right) to an input port
  (left) to connect, and change parameters in the inspector. Connections with
  mismatched shapes are rejected with both shapes in the message.
- Undo, redo and reset cover every edit. Working copies are stored in
  `localStorage`; the page still works when storage is blocked.
- **Export** downloads the graph as JSON. **Import** checks a JSON file and
  lists each problem with its location.

The tab on each edge of the canvas folds that side panel away and brings it
back, and the choice is remembered.

Below 800 px wide the palette is hidden, the inspector moves below the canvas
and editing is turned off.

The inspector overview lists the keyboard controls. Focus follows the diagram:
moving to a block off screen pans the canvas to it.

## Layout

| Path | Contents |
| --- | --- |
| `src/catalogue.js` | Block types: ports, parameters, descriptions, sources |
| `src/internals.js` | What happens inside each block: steps, shapes, equations |
| `src/graph.js` | Graph operations, schema validation, undo history |
| `src/shapes.js` | Shape symbol resolution and connection checks |
| `src/params.js` | Parameter counts per block and per graph |
| `src/diff.js` | Differences between two graphs |
| `src/storage.js` | Local persistence, import and export |
| `src/presets/` | The three Qwen presets and the shared decoder-layer builder |
| `src/view/` | Canvas, right-angled arrow routing, inspector, palette and difference panel |
| `tools/` | Browser and timing checks driven through Chrome |
| `test/` | `node --test` suites for the pure modules |

## Sources and checked values

Preset values come from each model's `config.json` and the Hugging Face
Transformers modelling code. Every link in the catalogue and the internals was
checked before it was added, and each equation was read from the modelling code
or the paper it links to.

Parameter totals are tested exactly against hand counts:

| Model | Total | Notes |
| --- | --- | --- |
| Qwen2.5-0.5B | 494,032,768 | Bias on q, k and v; head dimension 896 / 14 = 64 |
| Qwen3-1.7B | 1,720,574,976 | QK-norm, no attention bias |
| Qwen3.5-0.8B | 752,393,024 | Text model only; excludes the vision encoder and multi-token prediction head |

All three models tie the output layer to the embedding, so it is counted once.
