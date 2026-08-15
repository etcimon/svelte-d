// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// One LDC 1.43+ compiles the svelte-d CLI, the vibe.0 host, and the
// wasm-eh cell. Wasm vs host stay different targets (no shared objects /
// DFLAGS); they share this compiler. Does not start a second HTTP stack.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { findLibwasmCheckout, findRiscvDev } from './paths.ts'

export const DEFAULT_LDC_VERSION = process.env.SVELTE_D_LDC_VERSION || '1.43.0-beta1'

export type HostTriple = {
  os: 'windows' | 'linux' | 'osx'
  arch: 'x64' | 'arm64'
  /** LDC release folder / archive stem suffix, e.g. windows-x64, linux-x86_64 */
  variant: string
  exe: string
  archiveExt: '7z' | 'tar.xz'
}

export type PlatformReport = {
  triple: HostTriple
  ldc: string
  dub: string
  libwasm: string
  vibe0: string
  ok: boolean
  downloaded: boolean
}

const HOST_PKGS: { dir: string; dub: string }[] = [
  { dir: 'memutils', dub: 'memutils' },
  { dir: 'botan-math', dub: 'botan-math' },
  { dir: 'libasync', dub: 'libasync' },
  { dir: 'botan', dub: 'botan' },
  { dir: 'libhttp2', dub: 'libhttp2' },
  { dir: 'openssl', dub: 'openssl' },
  { dir: 'vibe.0', dub: 'vibe-0' },
]

export function hostTriple(
  platform = process.platform,
  arch = process.arch
): HostTriple {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux'
  const a: 'x64' | 'arm64' = arch === 'arm64' ? 'arm64' : 'x64'
  const exe = os === 'windows' ? 'ldc2.exe' : 'ldc2'
  if (os === 'windows')
    return { os, arch: a, variant: 'windows-x64', exe, archiveExt: '7z' }
  if (os === 'osx')
    return {
      os,
      arch: a,
      variant: a === 'arm64' ? 'osx-arm64' : 'osx-x86_64',
      exe,
      archiveExt: 'tar.xz',
    }
  return {
    os,
    arch: a,
    variant: a === 'arm64' ? 'linux-aarch64' : 'linux-x86_64',
    exe,
    archiveExt: 'tar.xz',
  }
}

/** True when `--version` text is 1.43 or later (not 1.42 / 1.36). */
export function isLdc143Text(text: string): boolean {
  if (!text) return false
  // Only the first LDC identity line. Later "built with LDC (1.42.0)" is the
  // bootstrap compiler, not this binary.
  const first =
    text.split(/\r?\n/).find((l) => /LDC - the LLVM D compiler/i.test(l)) || text
  const m = first.match(/\(([^)]+)\)/)
  const ver = m?.[1] ?? first
  if (/1\.(36|40|41|42)\./.test(ver)) return false
  return /1\.(43|44|45|46)/.test(ver)
}

export function isLdc143(bin: string): boolean {
  if (!bin || !existsSync(bin)) return false
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: false })
  return isLdc143Text((r.stdout || '') + (r.stderr || ''))
}

function which(cmd: string): string {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
    shell: false,
  })
  if (r.status !== 0) return ''
  return (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ''
}

function walkSeeds(start?: string): string[] {
  const seeds: string[] = []
  if (start) seeds.push(resolve(start))
  try {
    seeds.push(findRiscvDev())
  } catch {
    /* no engine host */
  }
  seeds.push(process.cwd())
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of seeds) {
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function ldcInDir(dir: string, exe: string): string {
  const cand = join(dir, exe)
  return existsSync(cand) ? cand : ''
}

function scanToolchainDir(root: string, exe: string): string {
  if (!existsSync(root)) return ''
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return ''
  }
  const prefer = names
    .filter((n) => /ldc2-(1\.43|1\.44|1\.45|master|build)/i.test(n))
    .sort()
    .reverse()
  for (const n of prefer) {
    const bin = ldcInDir(join(root, n, 'bin'), exe)
    if (bin && isLdc143(bin)) return bin
  }
  return ''
}

export function toolchainHome(): string {
  const env = process.env.SVELTE_D_TOOLCHAINS
  if (env) return env
  return join(homedir(), '.svelte-d', 'toolchains')
}

/** LDC 1.43+ for CLI, vibe.0 host, and wasm-eh. Never returns 1.42. */
export function findLdc(start?: string): string {
  const exe = hostTriple().exe
  const envKeys = ['SVELTE_D_LDC', 'LDC', 'WASM_LDC', 'SVELTE_D_WASM_LDC', 'DC']
  for (const k of envKeys) {
    const v = process.env[k]
    if (v && existsSync(v) && isLdc143(v)) return v
  }
  const cached = scanToolchainDir(toolchainHome(), exe)
  if (cached) return cached
  for (const seed of walkSeeds(start)) {
    let p = seed
    for (let i = 0; i < 10; i++) {
      for (const rel of [
        join('riscv-compilers', 'ldc2-build', 'bin'),
        join('ldc2-build', 'bin'),
      ]) {
        const bin = ldcInDir(join(p, rel), exe)
        if (bin && isLdc143(bin)) return bin
      }
      const fromTc = scanToolchainDir(join(p, 'toolchains'), exe)
      if (fromTc) return fromTc
      const parent = dirname(p)
      if (parent === p) break
      p = parent
    }
  }
  const onPath = which('ldc2')
  if (onPath && isLdc143(onPath)) return onPath
  return ''
}

export function findDub(ldc = findLdc()): string {
  if (ldc) {
    const name = process.platform === 'win32' ? 'dub.exe' : 'dub'
    const cand = join(dirname(ldc), name)
    if (existsSync(cand)) return cand
  }
  return which('dub')
}

function isVibe0Root(p: string): boolean {
  return (
    existsSync(join(p, 'source', 'vibe', 'http', 'server.d')) ||
    existsSync(join(p, 'source', 'vibe', 'd.d'))
  )
}

export function findVibe0Checkout(start?: string): string {
  const env = process.env.VIBE0_ROOT
  if (env && isVibe0Root(env)) return env
  for (const seed of walkSeeds(start)) {
    let p = seed
    for (let i = 0; i < 10; i++) {
      for (const cand of [join(p, 'vibe.0'), join(p, 'riscv-dev', 'vibe.0')]) {
        if (isVibe0Root(cand)) return cand
      }
      const parent = dirname(p)
      if (parent === p) break
      p = parent
    }
  }
  return ''
}

function findPkgDir(dirName: string, start?: string): string {
  for (const seed of walkSeeds(start)) {
    let p = seed
    for (let i = 0; i < 10; i++) {
      for (const cand of [join(p, dirName), join(p, 'riscv-dev', dirName)]) {
        if (existsSync(join(cand, 'dub.json')) || existsSync(join(cand, 'dub.sdl')))
          return cand
      }
      const parent = dirname(p)
      if (parent === p) break
      p = parent
    }
  }
  return ''
}

function run(cmd: string, args: string[]): { status: number; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false })
  return { status: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') }
}

/** dub add-local for vibe.0 + its host graph when checkouts exist. */
export function ensureHostAddLocals(start?: string): string[] {
  const dub = findDub()
  if (!dub) return []
  const done: string[] = []
  for (const pkg of HOST_PKGS) {
    const root = pkg.dir === 'vibe.0' ? findVibe0Checkout(start) : findPkgDir(pkg.dir, start)
    if (!root) continue
    run(dub, ['remove-local', root])
    const r = run(dub, ['add-local', root])
    if (r.status === 0) done.push(`${pkg.dub}=${root}`)
  }
  return done
}

export function ldcDownloadUrl(
  version = DEFAULT_LDC_VERSION,
  triple = hostTriple()
): string {
  const tag = version.startsWith('v') ? version : `v${version}`
  const stem = `ldc2-${version}-${triple.variant}`
  return `https://github.com/ldc-developers/ldc/releases/download/${tag}/${stem}.${triple.archiveExt}`
}

function find7z(): string {
  const onPath = which('7z') || which('7za')
  if (onPath) return onPath
  if (process.platform === 'win32') {
    for (const p of [
      join(process.env['ProgramFiles'] || 'C:\\Program Files', '7-Zip', '7z.exe'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    ]) {
      if (existsSync(p)) return p
    }
  }
  return ''
}

/** Download official LDC 1.43 into ~/.svelte-d/toolchains. No-op if already there. */
export async function downloadLdc(
  version = DEFAULT_LDC_VERSION,
  triple = hostTriple()
): Promise<string> {
  const dest = join(toolchainHome(), `ldc2-${version}-${triple.variant}`)
  const bin = join(dest, 'bin', triple.exe)
  if (existsSync(bin) && isLdc143(bin)) return bin
  mkdirSync(toolchainHome(), { recursive: true })
  const url = ldcDownloadUrl(version, triple)
  const archive = join(tmpdir(), basename(url))
  console.log('svelte-d: downloading', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LDC download failed ${res.status} ${url}`)
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  if (triple.archiveExt === 'tar.xz') {
    const r = spawnSync('tar', ['-xJf', archive, '-C', toolchainHome()], {
      stdio: 'inherit',
      shell: false,
    })
    if ((r.status ?? 1) !== 0) throw new Error('tar extract failed for ' + archive)
  } else {
    const z7 = find7z()
    if (!z7)
      throw new Error(
        '7-Zip required to extract LDC on Windows (install 7-Zip or add 7z to PATH)'
      )
    const r = spawnSync(z7, ['x', '-y', `-o${toolchainHome()}`, archive], {
      stdio: 'inherit',
      shell: false,
    })
    if ((r.status ?? 1) !== 0) throw new Error('7z extract failed for ' + archive)
  }
  if (!existsSync(bin)) throw new Error('ldc2 missing after extract: ' + bin)
  return bin
}

export async function setupPlatform(
  opts: { download?: boolean; start?: string } = {}
): Promise<PlatformReport> {
  const triple = hostTriple()
  let downloaded = false
  let ldc = findLdc(opts.start)
  if (!ldc && opts.download !== false && process.env.SVELTE_D_NO_DOWNLOAD !== '1') {
    try {
      ldc = await downloadLdc()
      downloaded = true
    } catch (e) {
      console.warn(
        'svelte-d: LDC 1.43 download skipped —',
        e instanceof Error ? e.message : e
      )
    }
  }
  const dub = findDub(ldc)
  let libwasm = ''
  try {
    libwasm = findLibwasmCheckout()
  } catch {
    libwasm = ''
  }
  const vibe0 = findVibe0Checkout(opts.start)
  if (dub) {
    if (libwasm) {
      run(dub, ['remove-local', libwasm])
      run(dub, ['add-local', libwasm, '~master'])
    }
    ensureHostAddLocals(opts.start)
  }
  return {
    triple,
    ldc,
    dub,
    libwasm,
    vibe0,
    ok: Boolean(ldc && dub),
    downloaded,
  }
}

export function writePlatformPin(ws: string, report: PlatformReport): void {
  mkdirSync(join(ws, '.svelte-d'), { recursive: true })
  const body = {
    schema: 'svelte-d-platform/v1',
    ldc: report.ldc.replace(/\\/g, '/'),
    dub: report.dub.replace(/\\/g, '/'),
    cell: 'ldc-1.43',
    os: report.triple.os,
    arch: report.triple.arch,
    variant: report.triple.variant,
    libwasm: report.libwasm.replace(/\\/g, '/'),
    vibe0: report.vibe0.replace(/\\/g, '/'),
    ok: report.ok,
  }
  writeFileSync(join(ws, '.svelte-d', 'platform.json'), JSON.stringify(body, null, 2) + '\n')
}

