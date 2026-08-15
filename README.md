# svelte-d

This **repository root is the `svelte-d` package**. A bun + Svelte / SvelteKit project depends on it, `bun install` **builds the native CLI**, and `import { compileWorkspace, dropWorkspace } from 'svelte-d'` compiles kit sources into a dropped `svelte-engine-ws`.

The compiler is a vibe.0 program (host cell) plus TypeScript exports. It parses Svelte with **Pegged** and D with **libdparse**. It drops the **`svelte-engine`** bootstrap and compiles the app inside that workspace — not a Svelte-to-JS wrap, not a second DOM/HTTP stack.

## BUILD

One compiler: **LDC 1.43+** for the CLI, the vibe.0 host, and the wasm-eh cell. Windows, macOS (x64/arm64), and Linux (x64/arm64).

```powershell
git clone --recurse-submodules https://github.com/etcimon/svelte-d.git
cd svelte-d

bunx svelte-d setup      # find or download LDC 1.43; dub add-local libwasm + vibe.0
bun install              # prepare → pack engine if needed + dub build → packages/svelte-d/bin/svelte-d
bun run build            # rebuild the CLI
bunx svelte-d version    # prints 1
bun test                 # package + import + bootstrap + platform
```

`bun install` in a **consumer** SvelteKit app that depends on this repo runs the same `prepare` script. If `ldc2` 1.43 is missing, setup downloads it into `~/.svelte-d/toolchains`. See [`architecture/engine-setup.md`](architecture/engine-setup.md).

## Use in a Svelte / SvelteKit bun project

```powershell
bun add github:etcimon/svelte-d
```

```json
{
  "dependencies": { "svelte-d": "github:etcimon/svelte-d" }
}
```

```ts
// svelte-d.config.ts  (project top-level)
export default { workspace: './svelte-engine-ws' }
```

```ts
import { dropWorkspace, compileWorkspace, workspaceDir } from 'svelte-d'

const ws = workspaceDir() // ./svelte-engine-ws next to svelte-d.config.ts
dropWorkspace({ dest: ws, force: true }) // overlay; never deletes dest
compileWorkspace({ ws, project: process.cwd() }) // ingest src/routes + src/lib
```

Or the CLI:

```powershell
bunx svelte-d drop-ws --force   # overlay template; dest folder is kept
bunx svelte-d compile --project .
bunx svelte-d wasm --debug      # symbols for IR work in svelte-engine-ws
bunx svelte-d build             # IR + wasm/host release + lflags -strip-all
```

Release wasm on the kit-admin tree is **1.59 MiB** (debug 12.64 MiB). Release host is **10.85 MiB** (debug 14.08 MiB). See [`docs/pages/advanced/sizes.mdx`](docs/pages/advanced/sizes.mdx).

`compile` infers `--project` when cwd has `src/routes`. Output is **`svelte-engine-ws` at the project root** (or `svelte-d.config.ts` `workspace`), never the packaged `svelte-engine/`. See [`architecture/package.md`](architecture/package.md) and [`architecture/workspace.md`](architecture/workspace.md).

Clone with the engine:

```
git clone --recurse-submodules https://github.com/etcimon/svelte-d.git
```

`svelte-engine/` is the drop source. A consumer does not have a `riscv-dev` platform tree: `bunx svelte-d setup` installs LDC 1.43 under `~/.svelte-d/toolchains`, and DUB fetches libwasm / vibe-0. A live libwasm checkout is used only when `source/libwasm/dom.d` happens to sit next to the compiler.

Docs (this site, Next.js + Nextra): [`docs/`](docs/). `bun run docs` serves them locally. The language section teaches every interactive `.svelte` construct and the libwasm D IR it prints.

**Guiding principles:**

- **Fall-through.** Svelte / SvelteKit syntax lands in a **roughly equivalent structure** inside `svelte-engine-ws` (`src/routes/+page.svelte` → `src-svelte/…` + `src-d/routes/page.d` + `src-ts/modules/generated/…`; `+page.server.*` → `webserver/source/generated/…`). See [`architecture/fallthrough.md`](architecture/fallthrough.md).
- **Accommodate in the engine.** Syntactic and underlying kit features, and further development of them, are **accommodated by changes in `svelte-engine` / libwasm / vibe.0**. svelte-d prints D IR in the format that engine already compiles. An updated engine is **integrated as `svelte-engine-ws` at compile time**. bun + TS + svelte-d tests and projects prove it. See [`architecture/bootstrap.md`](architecture/bootstrap.md).

Notes are addressed to the *next change*. Do not add a sibling `riscv-dev/svelte-d/` — this Windows host is case-insensitive.

```
status:     Draft (2026-08-14)
kind:       original design workspace
author:     design pass (Etienne Cimon / agent)
does_not:   change libwasm, vibe.0, slideshow3dai, or LDC
canonical:  also filed as the full design doc in the design-pass scratch path
```

## What it is

- A **D / vibe.0 compiler** (`packages/svelte-d`) plus a **bun `svelte-kit-d`** package: Pegged → IR JSON → `svelte-engine-ws` (libwasm `src-d/` + PgLite) → wasm + vibe.0, `bun dev` HMR.
- Two **adapters**, not two new runtimes: client output is idiomatic libwasm; server output is idiomatic vibe.0.
- An incremental IR/D cache (`<app>/.svelte-d/`): **reprint-skip + opposite-cell-skip + per-`.o` wasm** on the default cell (G107; LTO cells stay whole-program `dub`). HMR **extends** dumpApp/loadApp.
- An honest SvelteKit feature map: Implemented-by-mapping / Requires-new-*-seam / Host-JS-only / Out-of-scope-for-v1.
- Official `.svelte` AST coverage against a clone of [sveltejs/svelte](https://github.com/sveltejs/svelte) at `riscv-compilers/svelte-ref-impl` (reference only; svelte-d does not import `svelte/compiler`). See [`architecture/svelte-language-coverage.md`](architecture/svelte-language-coverage.md).

## What it is not

- Not a bun/Node compiler (Vite stays optional JS glue **inside the workspace**).
- Not a port of SvelteKit onto Node, and not `svelte/compiler` as a parse dependency.
- Not “compile Svelte to JS, then wrap wasm.”
- Not a second DOM, and not a second HTTP stack.
- Not official vibe.d (Diet / `vibe.web.rest` / Mongo / extra drivers are **absent** from vibe.0 — do not pretend otherwise).
- Not a claim that vibe.0 is green on this host, or that Binaryen 132 can asyncify LDC 1.43 `try_table`.
- Not a LibreCore RTL change. RISC-V affinity is none.

## How to read the notes

Start at [`AGENTS.md`](AGENTS.md) for intent routing. Then [`architecture/README.md`](architecture/README.md). Each architecture note is written for the next implementer: prose, file:line loci in the *existing* trees, invariants (construction vs convention), extension points, and what this analysis did not close.

The long-form design (Key Decisions, alternatives, security, PR plan) is duplicated in the design-pass scratch file; the notes here are the living split.

## Host policy (read before committing)

`riscv-dev/.gitignore` lists named checkouts (`/vibe.0/`, …) but **not** `/svelte-D/`. Per [`../AGENTS-selectivity.md`](../AGENTS-selectivity.md), first-level checkout directories are usually host-untracked nested clones. **svelte-D is not a nested clone.** It is original design.

**Owner decided 2026-08-14:** **track** this folder as host LibreCore docs, **tier T / MIT** (Markdown takes no inline SPDX under `DOCS_UNDER_TIER`). Do **not** add `/svelte-D/` to `.gitignore`. Tracking is a later owner `git add`. The surrounding `riscv-dev/` scaffold surface is CC0; that dedication does **not** swallow this folder. **Do not** silently edit `riscv-dev/.gitignore` or `AGENTS-todo.md` from a svelte-D design pass.

## Two-compiler invariant

| Cell | Env helper | LDC (as of this writing) | Runtime |
|---|---|---|---|
| WASM / client | `riscv-dev/setenv-wasm.ps1` | 1.36 default via **`subConfiguration "libwasm" "ldc-1.36"`** (libwasm *package* default is now 1.43; live HEAD `64a97ce` / `v0.10.0`; add-local still `0.9.0`) | libwasm + `druntime-wasm` / `runtime-v1.4x.0` |
| Host / server | `riscv-dev/setenv.ps1` + `modules.json` | 1.42 Windows catalog | vibe-0 + Phobos + botan + libasync |

libwasm is **not** in `modules.json`. Do not `dub add-local` it into the host cell.

## Golden target

[`slideshow3dai`](../slideshow3dai/) remains the original product tree. [`svelte-engine`](../svelte-engine/) is the **bootstrap template**. svelte-d **drops** it to [`svelte-engine-ws`](../svelte-engine-ws/) and compiles Svelte→D there ([`architecture/workspace.md`](architecture/workspace.md)).

## License posture

This design and a future svelte-D compiler are **MIT**. Using the D *language* does not relicense anything. Emitting D is unconstrained. LDC/LLVM are toolchain. libwasm/spasm, vibe.0/vibe.d, Diet, Svelte/SvelteKit, Binaryen, Google asyncify.ts, lodash, moment, PgLite keep their own terms. See [`LICENSE.md`](LICENSE.md) and [`architecture/licensing.md`](architecture/licensing.md).
