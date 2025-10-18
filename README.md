# Collide Size Curve Explorer

This repo now separates the authoring sources from the GitHub Pages output so it is easier to maintain the app.

- `src/` – editable source files (HTML + modular JavaScript + CSS).
- `docs/` – built output that remains the GitHub Pages root.
- `scripts/` – utility scripts (currently just the simple build copier).

## Development

1. Make your changes under `src/`.
2. Use `npm run lint` to sanity-check the modules.
3. Run `npm run build` to copy the updated files into `docs/`.
4. Commit both the source files and the generated `docs/` artifacts so the hosted site updates.
