# UNPKG MCP demo project

A tiny no-build browser app (Preact + HTM counter) whose dependencies are
declared in `package.json` but deliberately **not installed and not wired
up**: `index.html` has no import map, so the page cannot run yet. It exists
so you can watch the UNPKG MCP do a genuine, positive conversion — the
opposite shape from a Next.js app, where the right answer is "convert
nothing."

Note `express` sitting in `dependencies`: it's a trap. A good audit keeps
it bundled / flags it rather than converting everything in sight.
(`server.js` is a stub showing what it would be for.)

## Try it

1. Make sure the MCP server is running:

   ```sh
   cd ~/Desktop/promise/unpkg-mcp
   pnpm dev
   ```

2. Start a Muse session **in this directory** and ask:

   > Audit this project for UNPKG conversion.

3. Then follow through:

   > Generate the import map, validate it with check_importmap, add it to
   > index.html, and verify the result.

4. See it run:

   ```sh
   pnpm run serve
   # open http://localhost:5173
   ```

   For browser-level proof that the imports execute (not just resolve):

   ```sh
   cd ~/Desktop/promise/unpkg-mcp
   pnpm verify:browser --map <path-to-the-generated-importmap.json>
   ```

## What a good result looks like

- `preact`, `preact/hooks`, `htm` (incl. `htm/preact`), `clsx`, and
  `canvas-confetti` end up `convert_now` with working UNPKG URLs.
- `express` is kept bundled / not converted, with a Node reason.
- `typescript` (a devDependency) is never audited.
- The page actually renders the counter and fires confetti.
