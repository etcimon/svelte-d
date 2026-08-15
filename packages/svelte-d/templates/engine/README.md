# svelte-engine

Bootstrap copy of **slideshow3dai** for the svelte-D stack: a libwasm **wasm-eh** SPA whose `src-d/` is the D IR target, plus a **vibe.0** host that uses `riscv-dev/*` via `setenv.ps1`.

- Notes: [`architecture/README.md`](architecture/README.md)
- `<script lang="d">` contract: [`architecture/script-lang-d.md`](architecture/script-lang-d.md)
- Guider: [`AGENTS.md`](AGENTS.md)

## WASM (default = LDC 1.43 / wasm-eh)

```powershell
cd riscv-dev\svelte-engine
powershell -File build-ldc-master.ps1
```

Probes: `svelte_engine_eh_probe` / `svelte_engine_phobos_probe`. No Binaryen asyncify on this cell.

## Host (vibe.0)

```powershell
cd riscv-dev
. .\setenv.ps1
# first time on Windows, build native libs (or use the bundled lib/ after path fix):
.\vibe.0\scripts\build-windows-libs.ps1
cd svelte-engine\webserver
dub build --compiler=ldc2
```

## License

MIT (same as slideshow3dai). Dependencies keep their own terms (libwasm MIT, vibe.0 MIT + file exceptions, Binaryen/asyncify Apache-2.0).
