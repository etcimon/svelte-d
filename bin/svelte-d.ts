#!/usr/bin/env bun
// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// bun bin: `bunx svelte-d compile --project .`
// Forwards to the native exe produced by `bun run build` / `bun install`.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exeName = process.platform === 'win32' ? 'svelte-d.exe' : 'svelte-d'
const exe = join(root, 'packages', 'svelte-d', 'bin', exeName)

if (!existsSync(exe)) {
  const build = join(root, 'scripts', 'build-cli.ts')
  const b = spawnSync(process.execPath, [build], { cwd: root, stdio: 'inherit' })
  if ((b.status ?? 1) !== 0 || !existsSync(exe)) {
    console.error(
      'svelte-d CLI missing. From this package: bun run build  (needs ldc2 + dub)'
    )
    process.exit(1)
  }
}

const r = spawnSync(exe, process.argv.slice(2), { stdio: 'inherit' })
process.exit(r.status ?? 1)
