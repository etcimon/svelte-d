# Package — bun install produces the svelte-d CLI

The next change that publishes a second package name, or that expects `bun add svelte-d` to work without a native `ldc2`/`dub` host cell, should read this.

**This repository root is the `svelte-d` package** (`package.json` `name`). A Svelte / SvelteKit bun project includes it with `bun add github:etcimon/svelte-d`. `bun install` / `bun run build` runs `scripts/build-cli.ts`: pack `svelte-engine` if needed, then `dub build --config=application` into `packages/svelte-d/bin/svelte-d` (`.exe` on Windows). The bun bin `bin/svelte-d.ts` forwards `bunx svelte-d …` to that native compiler.

`import { compileWorkspace, dropWorkspace } from 'svelte-d'` resolves to `packages/svelte-d/ts/index.ts`. Drop copies packaged `packages/svelte-d/svelte-engine` (or the `svelte-engine/` submodule) to `svelte-engine-ws`. `compile` ingest the app `src/routes` when cwd is a kit project.

## Build

Host cell only (LDC 1.42 + `setenv.ps1` in a riscv-dev tree, or `ldc2`/`dub` on PATH). Never `setenv-wasm.ps1` for this compile.

```
bun install          # prepare → build-cli (skips if exe already present)
bun run build        # always rebuild CLI + pack engine if missing
bunx svelte-d version
bun test             # package-engine + import-library + bootstrap
```

GitHub Actions: `.github/workflows/ci.yml` (checkout submodules, Bun, LDC, `bun install`, `bun test`).

## Invariants

- The published name is `svelte-d` at the **repo root**. Do not add a second npm name for the same compiler. (construction)
- `bun install` must leave a runnable CLI when `ldc2` and `dub` exist. (construction)
- App builds stay in `svelte-engine-ws`, never in the packaged `svelte-engine/`. (construction)
- Two LDC cells stay two cells. This package build is host-cell only. (construction)
