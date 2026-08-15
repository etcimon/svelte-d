# svelte-d

D compiler (vibe.0 + Pegged + libdparse) that turns SvelteKit-shaped sources into libwasm/vibe.0 D inside a dropped **svelte-engine-ws**. Builds as an **importable library**: TypeScript (`ts/index.ts`) over `bin/svelte-d` (exe) and `lib/svelte-d` (dll/so, bun:ffi).

**Guiding principles:** kit syntax falls through to an equivalent libwasm / vibe.0 tree in the ws (`mapKitPath`). Kit features and further development are accommodated in **svelte-engine / libwasm / vibe.0**; `compile` integrates the current engine as `svelte-engine-ws` (`accommodateFeatures`, `verifyBootstrap`, `svelte-d bootstrap`).

```powershell
cd riscv-dev
. .\setenv.ps1
cd svelte-D\packages\svelte-d
dub build --config=application --compiler=ldc2
dub build --config=library --compiler=ldc2
dub run --compiler=ldc2 -- parse ..\..\..\svelte-engine\src-svelte\routes\+page.svelte
dub run --compiler=ldc2 -- map src/routes/+page.svelte
dub run --compiler=ldc2 -- drop-ws --force
dub run --compiler=ldc2 -- scan --ws ..\..\..\svelte-engine-ws
```

A bun project depends on `"svelte-d"` and `import { compileWorkspace, dropWorkspace, mapKitPath, adaptWorkspace } from 'svelte-d'`. The package **ships `svelte-engine/`** (`bun scripts/pack-engine.ts`). After `bun install`, drop copies `node_modules/svelte-d/svelte-engine` → `node_modules/svelte-d/svelte-engine-ws` (or the checkout sibling in this repo). `compile` then ingest the project's `src/` Svelte / SvelteKit (`--project`, or automatically when cwd has `src/routes`). Adapters (`adapter-static`, `adapter-libwasm-spa`, `adapter-vibe0`, `adapter-vibe0-proxy`) call `adaptWorkspace` and write `out/adapter.json`.

See `../../architecture/` (fallthrough.md, pegged-grammar.md, workspace.md, compiler-host.md).
