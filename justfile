# serves the static site on port 8000
serve:
    python3 -m http.server 8000

# runs the pure-module tests
test:
    node --test

# runs the browser checks against a running site
check:
    node tools/browser-check.mjs

# measures drag and pan with about 300 blocks
perf:
    node tools/perf-check.mjs
