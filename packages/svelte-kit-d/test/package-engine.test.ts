// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bundledTemplateDir,
  findRiscvDev,
  isSvelteDPackage,
  kitProjectDir,
  pkgRoot,
  templateDir,
  workspaceDir,
} from 'svelte-d'

describe('svelte-engine is packaged inside svelte-d', () => {
  test('the svelte-d package contains a complete engine bootstrap', () => {
    expect(isSvelteDPackage(pkgRoot)).toBe(true)
    const packaged = join(pkgRoot, 'svelte-engine')
    const legacy = join(pkgRoot, 'templates', 'engine')
    const engine = existsSync(join(packaged, 'src-d', 'app.d')) ? packaged : legacy
    expect(existsSync(join(engine, 'src-d', 'app.d'))).toBe(true)
    expect(existsSync(join(engine, 'src-d', 'pglite.d'))).toBe(true)
    expect(existsSync(join(engine, 'dub.sdl'))).toBe(true)
    expect(existsSync(join(engine, 'src-svelte', 'routes', '+page.svelte'))).toBe(true)
    expect(existsSync(join(engine, 'src-ts', 'modules', 'index.ts'))).toBe(true)
    expect(existsSync(join(engine, 'webserver', 'source', 'app.d'))).toBe(true)
    expect(existsSync(join(engine, 'webserver', 'dub.sdl'))).toBe(true)
    const sdl = readFileSync(join(engine, 'dub.sdl'), 'utf8')
    expect(sdl).toContain('version="~master"')
    expect(sdl).toContain('github.com/etcimon/libwasm')
    expect(sdl).not.toMatch(/dependency "libwasm" path=/)
    const marker = join(engine, '.svelte-d-bootstrap')
    if (existsSync(marker))
      expect(readFileSync(marker, 'utf8')).toContain('svelte-engine')
  })

  test('an isolated cwd still resolves the packaged engine and drops beside it', () => {
    const isolated = tmpdir()
    const host = findRiscvDev(isolated)
    const tpl = templateDir(host)
    const bundled = bundledTemplateDir()
    expect(bundled.length).toBeGreaterThan(0)
    expect(existsSync(join(tpl, 'src-d', 'app.d'))).toBe(true)
    expect(existsSync(join(tpl, 'dub.sdl'))).toBe(true)
    expect(tpl.replace(/\\/g, '/')).toMatch(/svelte-engine|templates\/engine/)
    const ws = workspaceDir(host)
    expect(ws.replace(/\\/g, '/')).toMatch(/svelte-engine-ws$/)
    if (isSvelteDPackage(host)) {
      expect(ws.startsWith(host)).toBe(true)
      expect(tpl.startsWith(pkgRoot) || tpl.includes('svelte-engine')).toBe(true)
    }
  })

  test('kitProjectDir only fires on a SvelteKit src/routes tree', () => {
    expect(kitProjectDir(pkgRoot)).toBe('')
    expect(kitProjectDir(process.cwd())).toBe('')
  })
})
