# Extensions — third-party Svelte packages, Node/Bun helpers, lang=ts splice

The next change that `npm install`s a Svelte grid and then wraps it as Svelte-to-JS inside svelte-d, or that puts jQuery on a second DOM stack, should read this and then stop.

**Guiding construction:** a bun + SvelteKit project may depend on (1) **Svelte packages** (`svelte-grid`, a graph widget, any `*.svelte` under `node_modules`), (2) **Node/Bun front-end helpers** (SCSS, vanilla TypeScript, jQuery) that Vite already understands, and (3) **`<script lang="ts">`** inside `.svelte` files. All three fall through into **`svelte-engine-ws`**. Markup with `lang=d` still prints libwasm D IR. TS/CSS/jQuery stay in **`src-ts/`** / **`styles/`** and are folded by the existing Vite + `libwasm.init` glue. svelte-d does not grow a third runtime and does not parse production sources with `svelte/compiler`.

```
bun project                                    svelte-engine-ws
────────────────────────────────────────────────────────────────────────
src/lib/GridWrap.svelte                     →  src-svelte/lib/GridWrap.svelte
   + <script lang="d">                      →  src-d/lib/GridWrap.d
   + <script lang="ts">                     →  src-ts/modules/generated/<ident>.ts
                                               spliced into src-ts/modules/index.ts
node_modules/svelte-grid/**/*.svelte        →  src-svelte/ext/svelte-grid/…
                                               src-d/ext/svelte-grid/…   (if lang=d)
src/lib/jquery-bridge.ts                    →  src-ts/modules/helpers/jquery-bridge.ts
src/styles/app.scss                         →  styles/app.scss
package.json "jquery" / "sass"              →  ws package.json deps (Vite)
```

## 1. `<script lang="ts">` splice (implemented)

`attachTsModules` (`ts_attach.d`) copies each `lang=ts` (instance or `context="module"`) body into `ws/src-ts/modules/generated/<identFromRel>.ts` using `js-module.ts.tmpl`. If the body has no `jsExports`, the template wraps an empty `jsExports.env`. `rewriteModulesIndex` regenerates `src-ts/modules/index.ts` from `modules-index.ts.tmpl` so `libwasm.init(modules)` picks up every generated module **and** keeps `bindings` / `spa` / `libwasm` / `debug-bridge`.

That is the splice. Do not emit a second `index.ts` or a Node `require` graph. Author `import $ from 'jquery'` inside that TS body is legal Vite input after the helper is on `ws` `package.json`; D still talks to the browser through `jsExports.env` or `Eval("window.$")` / Lodash, not through a printed `import jquery` in `src-d/`.

`lang=d` stays Pegged + printer → `src-d/`. Dual-script files do both.

## 2. Third-party Svelte packages (grids, graphs)

`import Grid from 'svelte-grid'` in app Svelte is **not** a JS wrap. The package’s `.svelte` files are **ingested** onto `src-svelte/ext/<pkg>/…` and compiled with the same printer as `src/lib`. `mapKitPath('node_modules/svelte-grid/Grid.svelte')` names those dests.

v1 rules:

- Only files the app actually imports (or a declared `svelte-d.extensions` list) are ingested. Do not dump all of `node_modules`.
- If the package is JS-only (no `.svelte` / no `lang=d`), it is **Host-JS-only**: load it from `src-ts` (section 3). Do not invent D IR for a React/Vue widget.
- Markup in the package that is ordinary Svelte prints as libwasm when it is in the v1 subset. Constructs that need a new primitive stay **Requires-new-libwasm-seam** ([sveltekit-feature-map.md](sveltekit-feature-map.md)).
- Package CSS/SCSS follows section 3.

## 3. Node/Bun helpers (SCSS, jQuery, vanilla TS)

These are **Vite + src-ts** concerns. The wasm cell does not link them.

| Project file | ws dest | Who runs it |
|---|---|---|
| `src/**/*.ts` (not `+*.server.*`) | `src-ts/modules/helpers/…` (copy) | Vite; import from `src-ts/main.ts` or a generated helper index |
| `<script lang="ts">` in `.svelte` | `src-ts/modules/generated/…` + index splice | `libwasm.init` / `jsExports` |
| `src/**/*.scss` / `.sass` / `.css` | `styles/…` | Vite (`vite.config.js` already has postcss/tailwind; add `sass` when a `.scss` is ingested) |
| npm `jquery`, `d3`, … | stay in `ws/package.json`; import from helpers or `main.ts`; optional `window.$` | Vite |
| D that must call that JS | `Eval("window.$")` / Lodash `defaultTo` like `pglite.d` | libwasm, not a second FFI |

`ensureWsDeps` (`svelte-kit-d` pipeline) already `bun install`s in the ws when Vite is missing. Ingest of SCSS records `sass` as a ws dep; ingest of `import 'jquery'` records `jquery`. Do not start a Node HTTP stack to serve them.

## Status

| Surface | Status |
|---|---|
| `lang=ts` → generated + `index.ts` splice | **Implemented** (`ts_attach.d`, pipeline test) |
| `mapKitPath` for `.ts` helpers, `.scss`, `node_modules/…/*.svelte` | **Mapped** (this pass) |
| Ingest imported `node_modules/<pkg>` `.svelte` onto `src-svelte/ext/` | **Implemented** (`ingestImportedSvelte`; not all of `package.json` dependencies) |
| Copy project standalone `.ts` / `.scss` onto mapped dests | **Implemented** (`ingestLocalHelpers`) |
| Rewrite `vite.config.js` `ldc2` to discovered 1.43 | **Implemented** (`pinWasmToolchain` on drop/compile) |
| Project `public/` → `ws/public/` + vibe.0 `serveStaticFiles` | **Implemented** (`ingestPublicDir`, host `app.d`) |

## Loci

`packages/svelte-d/source/svelte_d/print/ts_attach.d` — lang=ts splice  
`packages/svelte-d/templates/js-module.ts.tmpl` / `modules-index.ts.tmpl`  
`packages/svelte-d/source/svelte_d/fallthrough.d` + `ts/fallthrough.ts` — map  
`packages/svelte-d/source/svelte_d/workspace/ingest.d` — project `src/` (ext ingest next)  
`packages/svelte-kit-d/test/extensions.test.ts` — table + live splice  
[fallthrough.md](fallthrough.md) · [libwasm-js.md](libwasm-js.md) · [engine-setup.md](engine-setup.md)

## Invariants

- `lang=ts` is spliced into `src-ts/modules` `jsExports`. It is not compiled by Pegged and not printed as D. (construction)
- Third-party `.svelte` is compiled as Svelte, not wrapped as JS. JS-only packages stay in `src-ts`. (construction)
- jQuery / SCSS / vanilla TS do not become a second DOM or a Node HTTP stack. (construction)
- Printed wasm D still starts `import libwasm;` and talks to JS via bindings / Lodash / `jsExports`. (construction)

## Did not close

Whether extension ingest is automatic from `import 'svelte-grid'` or an allow-list in `package.json` `svelte-d.extensions` (recommendation: start with allow-list + imported `.svelte` paths). Whether scoped npm names (`@xyflow/svelte`) use `src-svelte/ext/@xyflow/svelte/`. Whether a `lang=ts` body that `import`s a helper is rewritten to `./helpers/…` on splice (recommendation: yes, when the helper was ingested).
