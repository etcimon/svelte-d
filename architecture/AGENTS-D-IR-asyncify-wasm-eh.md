# D IR yield — asyncify, wasm-eh, and why they do not compose

The next change that prints `.await` on the default wasm-eh cell, runs `wasm-opt --asyncify` on a `try_table` module, or puts `try`/`catch` in the same function as `libwasm_await__void` should read this and then **split the two yields**.

**Guiding construction:** libwasm has two pause/resume stories. **wasm-eh** is LDC’s `try`/`catch` (`llvm_wasm_throw` + `try_table`/`catch_ref`). **asyncify** is Binaryen rewriting the module so `env.libwasm_await__void` can unwind the wasm stack into linear memory and rewind when a JS Promise settles. They are **not** the same mechanism. On this workspace they **must not share a function, and on Binaryen 132 they must not share a module**. Printed D IR follows the **cell**:

| Cell | LDC | Post-link | `.await` | D `try`/`catch` |
|---|---|---|---|---|
| `ldc-master` / `application` (default) | 1.43 + `--wasm-enable-eh` | **copy-raw** (no `wasm-opt --asyncify`) | **forbidden** (silent no-op if printed) | **yes** (`rt/eh.d`) |
| `ldc-1.42` | 1.42 + `--wasm-enable-eh` (abort-on-throw) | `wasm-opt --asyncify` + bulk-memory | **yes** | **no** (JS `captureException` abort) |
| `ldc-1.36` | 1.36 + `--wasm-enable-eh` (abort-on-throw) | `wasm-opt --asyncify` | **yes** | **no** (same abort) |

Svelte `async` / `{#await}` stay out of v1. Kit `load` that must wait uses `.then` on wasm-eh, or the 1.36/1.42 cell.

```
D  try { throw e; } catch (Exception e) { … }
     LDC 1.43  --wasm-enable-eh -mattr=+exception-handling
     →  llvm_wasm_throw → try_table / catch_ref
     →  _d_throw_exception / _Unwind_CallPersonality / _d_eh_enter_catch
     Binaryen Flatten  →  UNREACHABLE on try_table   (do not asyncify)

D  promise.await;
     types.d:926  →  import env.libwasm_await__void
     wasm-opt --asyncify --pass-arg=asyncify-imports@env.libwasm_await__void
     JS asyncify.ts  wrapExportFn / wrapImportFn  unwind → await Promise → rewind
     without that pass  →  JS async starts and is dropped; D continues  (libwasm bug)
```

## How LDC handling breaks catches

`--wasm-enable-eh` and `-mattr=+exception-handling` ask LLVM to emit **standard wasm exception-handling** instead of “throw then `unreachable`.”

**1.36 / 1.42.** The frontend still names `_d_throw_exception` (`DtoThrow`). LLVM 17/21 on those pins do **not** emit a catchable wasm `throw` that a D `catch` can land on. `rt/eh.d:88-94` therefore calls JS `captureException` and `assert(0)`. `--wasm-enable-eh` on those cells is **not** “D catch works.” Navbar-style `try`/`catch` is dead. README’s “wasm EH currently has a bug” is this pin, not 1.43.

**1.43 / master.** `useWasmEH` / `emitCatchBodiesWasm` emit `catchpad` / `llvm.wasm.get.exception` / `try_table` / `catch_ref`. `rt/eh.d:80-86` does `llvm_wasm_throw(0, &header)` so a landing pad in the **same function** can catch. Personality is stubbed: `_Unwind_CallPersonality` sets `selector = 1` (first catch type only). Multi-type LSDA is not ported. Uncaught throws become `WebAssembly.Exception` in the host (`libwasm.ts` `_start` / `spa.ts` `domEvent`).

**`-foptimize-nothrow` (LDC 1.43 default).** Landing pads inside `nothrow` functions are deleted. Almost every printed / golden struct is `nothrow:` (`d-dom.d.tmpl:11`, `navbar.d:14`). A `try`/`catch` in a `nothrow` method **vanishes** unless the wasm-eh cell sets `--foptimize-nothrow=false` (svelte-engine `dub.sdl:27`, libwasm `ldc-master`, `spa-wasm-eh`). Full LTO + strip can delete an unused `probeCatch`. `spa-wasm-eh` uses `pragma(inline, false)` and `--export=spa_eh_probe` for that reason.

**Printed IR.** Keep `--foptimize-nothrow=false` on the wasm-eh `dub.sdl`. Do not print `try`/`catch` inside a method the author marked `nothrow` if a consumer might build without that flag. Never print `.await` inside a function that also has a landing pad (see below).

## How Binaryen `wasm-opt --asyncify` breaks those catches

Asyncify is **not** an LDC flag. `postBuildCommands` run Binaryen `wasm-opt --asyncify` on `*-raw.wasm`. The pass:

1. Finds every function that can reach `env.libwasm_await__void`.
2. Runs **Flatten** so each function is a shape Asyncify can split at the import.
3. Instruments unwind/rewind (`asyncify_start_unwind`, `asyncify_start_rewind`, …).

**Flatten does not support wasm Exception Handling.** Binaryen 132 hits `UNREACHABLE` in `Flatten.cpp` on `try_table` (same family as [binaryen#4470](https://github.com/WebAssembly/binaryen/issues/4470) Asyncify+Try, [binaryen#8372](https://github.com/WebAssembly/binaryen/issues/8372) Flatten/`try_table`). The post-build **never produces** `svelte-engine.wasm`. That is why the default cell **copies raw** (`svelte-engine/dub.sdl:21-28`).

Even if Flatten learned `try_table`, **catch across `.await` is still unsound**:

- Unwind copies the wasm stack into linear memory at `DATA_ADDR` (524288) … `DATA_END` (1048576). Those addresses **must** match `ldc2.conf` `-Lstack-size=1048576`.
- Rewind **re-enters the export from the top** (`asyncify.ts` `wrapExportFn` calls `fn(...args)` again). Landing-pad state (`__wasm_lpad_context` in `rt/eh.d:75`) is not part of that protocol.
- A `throw` that crosses the import, or a `catch` that wraps `.await`, leaves the personality/selector and `ExceptionHeader` stack (`eh.d:30-31`, single-slot `storage`) in an undefined state.
- `ScopedPool` dtors live on the wasm stack. A reject that does **not** rewind leaks the pool; a Flatten that treats unwind as a return would **pop** the pool while the handler is paused.

So the correction is **not** “turn on both flags.” It is: **keep EH CFGs and asyncify CFGs disjoint**, and do not Flatten `try_table` until Binaryen can.

### Possible Binaryen workaround (unverified on this host)

`wasm-opt` is not on PATH here. If a later Binaryen Flatten is still whole-module, remove-list cannot save a 1.43 module. If Flatten is only applied to the instrumented set, a titled libwasm/engine experiment is:

```text
wasm-opt --enable-exception-handling --asyncify
  --pass-arg=asyncify-imports@env.libwasm_await__void
  --pass-arg=asyncify-remove-list@_d_throw_exception,_Unwind_CallPersonality,_d_eh_enter_catch,__gxx_wasm_personality_v0,spa_eh_probe,probeCatch
```

plus the **printer rule**: a function that `throw`s/`catch`es must not reach `.await` (directly or by inlining). That is the only in-tree path toward one module with both. Do not claim it works until `spa-wasm-eh` + a tiny `.await` helper **both** pass after that `wasm-opt`.

## libwasm implementation bugs (the glue, not Flatten)

These are in **libwasm’s** await/asyncify implementation and the engine copies. They make wasm-eh + `.await` look like it works when it does not.

1. **`.await` is a silent no-op without Asyncify.** `await()` (`types.d:926-928`) always imports `libwasm_await__void`. JS implements it as `async` (`svelte-engine/src-ts/modules/libwasm.ts:343-348`). Without Binaryen instrumentation the import returns immediately; the Promise is dropped. Default wasm-eh cell uses `instantiate()` which **skips** the Asyncify wrapper when `asyncify_get_state` is absent (`asyncify.ts:217-219`). Printed `.await` on that cell **does not wait**.

2. **`finally` swallows rejection.** `libwasm_await__void` does `promise.finally(() => resolve(null))`. D `await()` is `void`. A failed fetch never becomes a D exception, so a wasm-eh `catch` around `.await` **cannot** observe JS failure. `finally` exists so rewind always happens (otherwise `ScopedPool` dtors never run). That is why catch-around-await cannot be the error path.

3. **`_start` is not an Asyncify-wrapped export.** `EXPORTED_FROM_D` is `domEvent`, `jsCallback0`, `jsCallback`, `loadApp`, `dumpApp` — not `_start`. `libwasm.ts:129` calls `_start` raw. `App.construct` / `ready` / default `navigateTo` that `.await` would unwind and never rewind.

4. **`wrapExportFn` replaces `WebAssembly.Exception` with a generic `Error`.** A D throw that escapes an asyncified `domEvent` loses the wasm EH identity the host (`spa.ts:17-21`) already knows how to detect.

5. **`callNative` does not `await jsCallback`.** `spa.ts` correctly `await`s `domEvent`. `libwasm.ts:106-109` fires `jsCallback` without awaiting, so a `lang=ts` → D callback that `.await`s never rewinds.

6. **`eventHandler` `forEach(async …)` is re-entrant.** Asyncify has one state. Two overlapping `domEvent`s corrupt unwind. Construction: one in-flight await per module.

7. **Promise handles skip the freelist** (`libwasm_removeObject`: `if (!(objects[ptr] instanceof Promise))`). Convention leak, not EH.

Engine copies of (1)–(5) are corrected in `svelte-engine/src-ts/modules/` (this pass). libwasm `examples/dom-ts` and `types.d` remain a **titled libwasm seam**.

## What svelte-d must print (functionally memory- and yield-correct D IR)

- **wasm-eh cell (default):** `JsPromise.then` / `.error` / `.finish`. No `.await`. Sync D `try`/`catch` only in functions that never reach an async import (navbar `onClick` is the golden).
- **asyncify cells (1.36 / 1.42):** `.await` allowed in `@connect` / `onMount` / `ready` **without** a landing pad in that function. Wrap with `ScopedPool`; copy survivors before the await returns ([AGENTS-D-IR-memory-management.md](AGENTS-D-IR-memory-management.md), [AGENTS-D-IR-lifetime.md](AGENTS-D-IR-lifetime.md)).
- Never print `.await` in `construct` / `compile!` / `_start` / `registerRoutes`.
- Never print Svelte `async` / `{#await}` (v1 out of scope).
- Generated `dub.sdl` must not emit `--asyncify` on `ldc-master` / `application`. Must emit `--foptimize-nothrow=false` on that cell.

## Loci

`libwasm/source/libwasm/types.d:181,925-928` — import + `await()`  
`libwasm/source/libwasm/rt/eh.d:80-118` — throw / personality / enter_catch  
`libwasm/source/libwasm/spa.d:5-7` — `__VERSION__` 2106 / 2112 / 2113  
`libwasm/architecture/{flags,js-events-memory,wasm-eh-test}.md`  
`libwasm/tests/spa-wasm-eh/` — catch probe; **no** asyncify  
`libwasm/examples/dom-ts/src-d/app.d:102-129` — `.await` under `nothrow` (1.36-shaped)  
`svelte-engine/dub.sdl:20-66` — copy-raw vs `--asyncify` per cell  
`svelte-engine/src-ts/modules/asyncify.ts` — `DATA_*`, `EXPORTED_FROM_D`, skip if no `asyncify_get_state`  
`svelte-engine/src-ts/modules/libwasm.ts` — `_start`, `libwasm_await__void`, `callNative`  
`svelte-engine/src-d/navbar.d:25-35` — sync `try`/`catch` (wasm-eh golden)  
Binaryen `src/passes/{Flatten.cpp,Asyncify.cpp}`; issues #4470, #8372  

## Invariants

- Do not `wasm-opt --asyncify` a module that contains `try_table` on Binaryen 132. (construction)
- wasm-eh cell keeps `--foptimize-nothrow=false` or D `catch` is deleted. (construction of 1.43)
- `.await` is printed only when the **same** cell’s post-build actually asyncifies. (construction of the yield protocol)
- A function with a landing pad must not reach `libwasm_await__void`. (construction of catch/asyncify disjointness)
- `DATA_END` == `ldc2.conf` stack size. (convention)
- New async imports append to `--asyncify-imports` **and** stay off the wasm-eh default cell. (construction)
- One in-flight Asyncify unwind. (construction of `asyncify.ts` state)

## Extension points

A Binaryen that Flattens `try_table` is a toolchain bump + re-run of `spa-wasm-eh` **with** `--asyncify` and a `.await` helper. A libwasm seam that teaches `_d_newarray*` pools does not fix yield. JSPI (`WebAssembly.promising`) would replace Binaryen Asyncify; that is a new glue ABI, not a printer flag.

## Did not close

Whether `asyncify-remove-list` of EH symbols avoids Flatten on Binaryen 132 (unrun: `wasm-opt` not on PATH). Whether 1.43 can grow a **second** imported await that JSPI wraps while EH stays native. Whether `ExceptionHeader` should be a stack, not a single `__gshared` slot, before any catch-across-await experiment.
