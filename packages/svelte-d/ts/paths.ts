import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

function isEngineRoot(p: string): boolean {
  return existsSync(join(p, 'src-d', 'app.d')) && existsSync(join(p, 'dub.sdl'))
}

function walkHasEngine(start: string): string {
  let p = resolve(start)
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(p, 'svelte-engine', 'AGENTS.md'))) return p
    const parent = dirname(p)
    if (parent === p) break
    p = parent
  }
  return ''
}

/** Packaged svelte-engine bootstrap shipped inside svelte-d. */
export function bundledTemplateDir(): string {
  const a = resolve(pkgRoot, 'templates', 'engine')
  if (isEngineRoot(a)) return a
  return ''
}

/** Directory that contains `svelte-engine/` (this repo, or a riscv-dev host). */
export function findRiscvDev(start = process.cwd()): string {
  const fromCwd = walkHasEngine(start)
  if (fromCwd) return fromCwd
  const fromPkg = walkHasEngine(pkgRoot)
  if (fromPkg) return fromPkg
  throw new Error('cannot find svelte-engine (no svelte-engine/AGENTS.md above cwd or package)')
}

export function workspaceDir(root = findRiscvDev()) {
  const here = join(root, 'svelte-engine-ws')
  if (existsSync(here)) return here
  const beside = join(dirname(root), 'svelte-engine-ws')
  if (existsSync(beside)) return beside
  return here
}

/** Drop source: svelte-engine submodule first, else packaged templates/engine. */
export function templateDir(_root = findRiscvDev()) {
  const sub = join(_root, 'svelte-engine')
  if (isEngineRoot(sub)) return sub
  const bundled = bundledTemplateDir()
  if (bundled) return bundled
  return sub
}

/** libwasm checkout: env, walk, or riscv-compilers/libwasm next to the engine host. */
export function findLibwasmRoot(start = findRiscvDev()): string {
  const env = process.env.LIBWASM_ROOT
  if (env && existsSync(join(env, 'source', 'libwasm', 'dom.d'))) return env
  const seeds = [start, dirname(start), process.cwd(), pkgRoot]
  for (const seed of seeds) {
    let p = resolve(seed)
    for (let i = 0; i < 10; i++) {
      for (const cand of [join(p, 'libwasm'), join(p, 'riscv-compilers', 'libwasm')]) {
        if (existsSync(join(cand, 'source', 'libwasm', 'dom.d'))) return cand
      }
      const parent = dirname(p)
      if (parent === p) break
      p = parent
    }
  }
  throw new Error('cannot find libwasm (source/libwasm/dom.d)')
}

export function nativeExe(): string {
  const exe = process.platform === 'win32' ? 'svelte-d.exe' : 'svelte-d'
  return join(pkgRoot, 'bin', exe)
}

export function nativeLib(): string {
  const name =
    process.platform === 'win32'
      ? 'svelte-d.dll'
      : process.platform === 'darwin'
        ? 'libsvelte-d.dylib'
        : 'libsvelte-d.so'
  return join(pkgRoot, 'lib', name)
}

export function nativeArtifacts() {
  const exe = nativeExe()
  const lib = nativeLib()
  return {
    exe,
    lib,
    exeExists: existsSync(exe),
    libExists: existsSync(lib),
    pkgRoot,
  }
}

export { pkgRoot }
