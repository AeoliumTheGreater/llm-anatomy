# LLM Anatomy

An interactive page that shows a language model as a graph of blocks. Each
block has a short description with sources, tensor shapes and a parameter
count. The page ships three presets: Qwen2.5-0.5B, Qwen3-1.7B and Qwen3.5-0.8B.

This is a static site. It uses vanilla JavaScript ES modules, SVG and plain
CSS, and has no build step.

## Run

```sh
just serve   # then open http://localhost:8000
just test    # runs node --test on the pure modules
```

Requires Python 3 for the local server and Node 22 for the tests.
