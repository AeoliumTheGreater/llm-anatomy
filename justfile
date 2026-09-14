# serves the static site on port 8000
serve:
    python3 -m http.server 8000

# runs the pure-module tests
test:
    node --test
