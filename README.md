# LLM Anatomy

An interactive page that shows a language model as a graph of blocks. Each
block has a short description with inline source links, its tensor shapes and
its parameter count. The page ships three read-only presets: Qwen2.5-0.5B,
Qwen3-1.7B and Qwen3.5-0.8B.

This is a static site. It uses vanilla JavaScript ES modules, SVG and plain
CSS. It has no build step and no dependencies.

## Run

```sh
just serve   # then open http://localhost:8000
just test    # runs node --test on the pure modules
```

Requires Python 3 for the local server and Node 22 for the tests.

## Use

- Pick a preset in the top bar. Blocks that both presets share move into
  place; the others fade in or out.
- Select a block to read its description, shapes, parameter count and
  sources. The plus button on a block shows its sub-blocks.
- A repeated layer group is collapsed by default. Expanding it shows one
  repeat, labelled with the repeat count.
- **Compare** opens the difference panel: differing configuration values
  and structural differences such as layer counts per block type.
- Editing a preset creates a working copy named "<preset> (edited)". Drag
  blocks from the palette, drag from an output port to an input port to
  connect, and change parameters in the inspector. Connections with
  mismatched shapes are rejected with both shapes in the message.
- Undo, redo and reset cover every edit. Working copies are stored in
  `localStorage`; the page still works when storage is blocked.
- **Export** downloads the graph as JSON. **Import** checks a JSON file and
  lists each problem with its location.

Below 800 px wide the palette is hidden, the inspector moves below the
canvas and editing is turned off.

The inspector overview lists the keyboard controls.

## Layout

| Path | Contents |
| --- | --- |
| `src/catalogue.js` | Block types: ports, parameters, sub-blocks, descriptions, sources |
| `src/graph.js` | Graph operations, schema validation, undo history |
| `src/shapes.js` | Shape symbol resolution and connection checks |
| `src/params.js` | Parameter counts per block and per graph |
| `src/diff.js` | Differences between two graphs |
| `src/storage.js` | Local persistence, import and export |
| `src/presets/` | The three Qwen presets and the shared decoder-layer builder |
| `src/view/` | Canvas, edges, inspector, palette and difference panel |
| `test/` | `node --test` suites for the pure modules |

## Sources and checked values

Preset values come from each model's `config.json` and the Hugging Face
Transformers modelling code. Every link in the catalogue and presets was
checked before it was added.

Parameter totals are tested exactly against hand counts:

| Model | Total | Notes |
| --- | --- | --- |
| Qwen2.5-0.5B | 494,032,768 | Bias on q, k and v; head dimension 896 / 14 = 64 |
| Qwen3-1.7B | 1,720,574,976 | QK-norm, no attention bias |
| Qwen3.5-0.8B | 752,393,024 | Text model only; excludes the vision encoder and multi-token prediction head |

All three models tie the output layer to the embedding, so it is counted once.
