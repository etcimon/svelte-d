// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_LDC_VERSION,
  findLdc,
  hostTriple,
  isLdc143Text,
  ldcDownloadUrl,
} from 'svelte-d'

describe('cross-platform LDC 1.43 setup', () => {
  test('hostTriple maps windows / linux / macos including arm64', () => {
    expect(hostTriple('win32', 'x64')).toMatchObject({
      os: 'windows',
      variant: 'windows-x64',
      archiveExt: '7z',
      exe: 'ldc2.exe',
    })
    expect(hostTriple('linux', 'x64').variant).toBe('linux-x86_64')
    expect(hostTriple('linux', 'arm64').variant).toBe('linux-aarch64')
    expect(hostTriple('darwin', 'arm64')).toMatchObject({
      os: 'osx',
      variant: 'osx-arm64',
      archiveExt: 'tar.xz',
      exe: 'ldc2',
    })
    expect(hostTriple('darwin', 'x64').variant).toBe('osx-x86_64')
  })

  test('isLdc143Text accepts 1.43+ and rejects 1.42 / 1.36', () => {
    expect(isLdc143Text('LDC - the LLVM D compiler (1.43.0):')).toBe(true)
    expect(isLdc143Text('LDC - the LLVM D compiler (1.43.0-beta1):')).toBe(true)
    expect(
      isLdc143Text(
        'LDC - the LLVM D compiler (1.43.0-git-1218a47):\n  built with LDC - the LLVM D compiler (1.42.0)\n'
      )
    ).toBe(true)
    expect(isLdc143Text('LDC - the LLVM D compiler (1.42.0):')).toBe(false)
    expect(isLdc143Text('LDC - the LLVM D compiler (1.36.0):')).toBe(false)
  })

  test('official download URL uses the host variant', () => {
    const win = hostTriple('win32', 'x64')
    expect(ldcDownloadUrl('1.43.0-beta1', win)).toBe(
      'https://github.com/ldc-developers/ldc/releases/download/v1.43.0-beta1/ldc2-1.43.0-beta1-windows-x64.7z'
    )
    const mac = hostTriple('darwin', 'arm64')
    expect(ldcDownloadUrl('1.43.0-beta1', mac)).toContain('osx-arm64.tar.xz')
    expect(DEFAULT_LDC_VERSION).toMatch(/^1\.43/)
  })

  test('findLdc never returns a 1.42 path when one is on PATH', () => {
    const ldc = findLdc()
    if (!ldc) return
    expect(ldc.toLowerCase()).not.toMatch(/ldc2-1\.42/)
  })
})
