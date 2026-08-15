#!/usr/bin/env bun
// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// Produce bin/svelte-d (native CLI) so `bun install` / `bun run build`
// leaves a working compiler. Packs svelte-engine if the packaged copy
// is missing. Does not start a second DOM/HTTP stack.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compiler = join(root, 'packages', 'svelte-d')
const exeName = process.platform === 'win32' ? 'svelte-d.exe' : 'svelte-d'
const exe = join(compiler, 'bin', exeName)

function isEngineRoot(p: string): boolean {
  return existsSync(join(p, 'src-d', 'app.d')) && existsSync(join(p, 'dub.sdl'))
}

function which(cmd: string): string {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
    shell: false,
  })
  if (r.status !== 0) return ''
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return line || ''
}

function walkTool(start: string, rel: string): string {
  let p = start
  for (let i = 0; i < 8; i++) {
    const cand = join(p, rel)
    if (existsSync(cand)) return cand
    const parent = dirname(p)
    if (parent === p) break
    p = parent
  }
  return ''
}

function findLdc2(): string {
  const onPath = which('ldc2')
  if (onPath) return onPath
  const name = process.platform === 'win32' ? 'ldc2.exe' : 'ldc2'
  const fromEnv = process.env.DC
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const toolchains = walkTool(root, join('riscv-dev', 'toolchains'))
    || walkTool(dirname(root), 'toolchains')
  if (!toolchains || !existsSync(toolchains)) return ''
  const dirs = readdirSync(toolchains)
    .map((n) => join(toolchains, n))
    .filter((d) => {
      try {
        return statSync(d).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
    .reverse()
  for (const d of dirs) {
    const cand = join(d, 'bin', name)
    if (existsSync(cand)) return cand
  }
  return ''
}

function findDub(ldc2: string): string {
  const onPath = which('dub')
  if (onPath) return onPath
  if (ldc2) {
    const cand = join(dirname(ldc2), process.platform === 'win32' ? 'dub.exe' : 'dub')
    if (existsSync(cand)) return cand
  }
  return ''
}

function run(cmd: string, args: string[], cwd: string): number {
  console.log('+', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  return r.status ?? 1
}

function ensurePackedEngine(): void {
  const packed = join(compiler, 'svelte-engine')
  if (isEngineRoot(packed)) return
  const pack = join(compiler, 'scripts', 'pack-engine.ts')
  if (!existsSync(pack)) {
    throw new Error('cannot pack svelte-engine: missing ' + pack)
  }
  const st = run(process.execPath, [pack], compiler)
  if (st !== 0) throw new Error('pack-engine failed status=' + st)
  if (!isEngineRoot(packed) && !isEngineRoot(join(compiler, 'templates', 'engine'))) {
    throw new Error('pack-engine did not produce packages/svelte-d/svelte-engine')
  }
}

function buildNative(): void {
  mkdirSync(join(compiler, 'bin'), { recursive: true })
  const ldc2 = findLdc2()
  const dub = findDub(ldc2)
  if (!ldc2 || !dub) {
    throw new Error(
      'svelte-d CLI build needs ldc2 + dub on PATH (host cell LDC 1.42). ' +
        'From riscv-dev: `. .\\setenv.ps1` then `bun install` / `bun run build`. ' +
        'Missing: ' +
        (!ldc2 ? 'ldc2 ' : '') +
        (!dub ? 'dub' : '')
    )
  }
  const st = run(dub, ['build', '--config=application', '--compiler=' + ldc2], compiler)
  if (st !== 0) throw new Error('dub build application failed status=' + st)
  if (!existsSync(exe)) {
    throw new Error('dub build reported ok but ' + exe + ' is missing')
  }
  const libSt = run(dub, ['build', '--config=library', '--compiler=' + ldc2], compiler)
  if (libSt !== 0) {
    console.warn('svelte-d: library (bun:ffi) build skipped/failed status=' + libSt)
  }
}

const force =
  process.argv.includes('--force') ||
  process.env.npm_lifecycle_event === 'build' ||
  process.env.SVELTE_D_FORCE_BUILD === '1'
const packed = join(compiler, 'svelte-engine')
if (!force && existsSync(exe) && isEngineRoot(packed)) {
  console.log('svelte-d CLI already built', exe)
  process.exit(0)
}
ensurePackedEngine()
buildNative()
console.log('svelte-d CLI', exe)
