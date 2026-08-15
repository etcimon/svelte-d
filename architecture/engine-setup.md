# Engine setup — one LDC 1.43 (Windows / macOS / Linux)

The next change that installs a second LDC (1.42) for the host cell, or that points wasm at a different `ldc2` than the CLI, should read this and stop.

**Guiding construction:** one **LDC 1.43+** binary compiles (1) the svelte-d CLI, (2) the vibe.0 host in `svelte-engine-ws/webserver`, and (3) the wasm-eh cell in `svelte-engine-ws`. Wasm vs host stay different *targets* (wasm32-unknown-wasi vs native; cleared `DFLAGS` / `DC`; no shared `.o`). They share this compiler. `bunx svelte-d setup` finds or downloads that LDC for the current OS/arch.

```
bunx svelte-d setup             →  LDC 1.43 (+ dub, libwasm, vibe.0 add-local)
bun install / bun run build     →  LDC 1.43  →  packages/svelte-d/bin/svelte-d
svelte-d drop-ws / compile      →  pin ws/.svelte-d/wasm-ldc.json to that ldc2
svelte-d wasm --ws <ws>         →  same ldc2  →  ws/public/svelte-engine.wasm
svelte-d host --ws <ws>         →  same ldc2  →  ws/webserver/svelte-engine-server
```

## Why 1.43 only

Navbar-style `try`/`catch` and printed `throwBoundary` need `try_table` / `catch_ref`. LDC 1.42 does not emit that for wasm. Keeping a second host compiler was extra machinery (two PATH cells, two toolchain folders, Windows-only `setenv.ps1` 1.42). Official 1.43 prebuilts exist for Windows x64, Linux x86_64/aarch64, and macOS x86_64/arm64.

## Discovery

`findLdc` (`ts/platform.ts` + `workspace/ldc.d`) resolves, in order:

1. `SVELTE_D_LDC` / `LDC` / `WASM_LDC` / `DC` if that binary’s `--version` is 1.43+.
2. `SVELTE_D_TOOLCHAINS` or `~/.svelte-d/toolchains/ldc2-1.43*`.
3. Walk for `riscv-compilers/ldc2-build/bin/ldc2` (this repo’s master/wasm-eh cell).
4. Walk `toolchains/ldc2-1.43*` / `ldc2-master*` next to the engine host.
5. `ldc2` on `PATH` **only** when `--version` is 1.43 or later (1.42 is refused).

`findHostLdc` and `findWasmLdc` are aliases of `findLdc`.

## `svelte-d setup`

Works **before** the native exe exists (`bin/svelte-d.ts` runs `scripts/setup-platform.ts`):

- Detects `windows-x64` / `linux-x86_64` / `linux-aarch64` / `osx-x86_64` / `osx-arm64`.
- Downloads official `ldc-developers/ldc` **1.43.0-beta1** (override `SVELTE_D_LDC_VERSION`) into `~/.svelte-d/toolchains` when nothing is found. `--no-download` / `SVELTE_D_NO_DOWNLOAD=1` skips the fetch.
- `dub add-local` for a live `libwasm` checkout (`~master`) and, when present, the vibe.0 host graph (`memutils`, `botan`, `libasync`, `libhttp2`, `openssl`, `vibe.0`).
- Without checkouts: wasm `dub.sdl` still `repository="git+https://github.com/etcimon/libwasm.git"`; host `vibe-0` comes from the DUB registry.

Windows extract of the official `.7z` needs 7-Zip. Unix uses `tar -xJf`.

## Loci

`packages/svelte-d/ts/platform.ts` — triple, find, download, add-local  
`scripts/setup-platform.ts` — `bun run setup` / `bunx svelte-d setup`  
`packages/svelte-d/source/svelte_d/workspace/ldc.d` — D `findLdc`  
`packages/svelte-d/source/svelte_d/workspace/wasm_build.d` — `findWasmLdc` → `findLdc`  
`packages/svelte-d/source/svelte_d/workspace/host_build.d` — `findHostLdc` → `findLdc`  
`scripts/build-cli.ts` — CLI build; setup-if-missing  
[package.md](package.md)

## Invariants

- One LDC 1.43+ compiles CLI, host, and wasm. Never silently fall back to 1.42. (construction)
- Wasm objects and host objects still do not mix (cleared `DFLAGS`/`DC` per cell). (construction)
- Do not asyncify a 1.43 `try_table` module. (construction)
- Packaged engine `dub.sdl` keeps `subConfiguration "libwasm" "ldc-master"`. (construction)

## Did not close

Official pin is **1.43.0-beta1** until a final 1.43.0 tarball is published (`SVELTE_D_LDC_VERSION` overrides). WASI addon packages from that release are not fetched (engine still uses libwasm’s own wasm runtime). System OpenSSL/sqlite on macOS/Linux for vibe.0 is assumed present when there is no riscv-dev checkout.
