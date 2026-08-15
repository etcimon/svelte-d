#!/usr/bin/env bun
// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// Pull the CI-built etcimon/binaryen wasm-opt for this host (Apple Silicon
// → darwin-arm64) into binaryen-build/<triple>/ and the toolchain home.
// Used by bunx svelte-d setup / wasm / build and by macos CI.
import {
  binaryenBuildVariant,
  ensureForkedWasmOpt,
  hostTriple,
  isForkedWasmOpt,
} from '../packages/svelte-d/ts/platform.ts'

const triple = binaryenBuildVariant()
const host = hostTriple()
console.log('host   ', host.os, host.arch, host.variant)
console.log('wasm-opt triple', triple)
const bin = await ensureForkedWasmOpt()
if (!bin || !isForkedWasmOpt(bin)) {
  console.error('forked wasm-opt missing after download:', bin)
  process.exit(3)
}
console.log('wasm-opt', bin)
if (host.os === 'osx' && host.arch === 'arm64') {
  const n = bin.replace(/\\/g, '/')
  if (!n.includes('darwin-arm64') && !n.includes('binaryen-svelte-d')) {
    console.error('Apple Silicon did not install the darwin-arm64 fork')
    process.exit(3)
  }
}
