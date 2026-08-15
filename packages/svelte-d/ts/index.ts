// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
/**
 * Public TypeScript API for a bun + svelte-d project.
 * Native side: bin/svelte-d.exe (CLI) + lib/svelte-d.dll (bun:ffi).
 *
 * Guiding principles:
 *  - Kit syntax falls through to libwasm / vibe.0 in an equivalent
 *    svelte-engine-ws tree (mapKitPath).
 *  - Kit features and further development are accommodated in
 *    svelte-engine / libwasm / vibe.0; compile integrates the engine
 *    as the ws bootstrap (accommodateFeatures / verifyBootstrap).
 */
export {
  compileWorkspace,
  dropWorkspace,
  buildWasm,
  buildHost,
  parseSvelte,
  runCli,
  ffiAvailable,
  type RunResult,
  type CompileOpts,
} from './native.ts'
export {
  findRiscvDev,
  findLibwasmRoot,
  findLibwasmCheckout,
  workspaceDir,
  templateDir,
  bundledTemplateDir,
  isSvelteDPackage,
  kitProjectDir,
  nativeExe,
  nativeLib,
  nativeArtifacts,
  pkgRoot,
} from './paths.ts'
export {
  mapKitPath,
  normalizeKitRel,
  identFromRel,
  sanitizeDestDir,
  sanitizeDestSeg,
  kitToPattern,
  kitToPatterns,
  type Fallthrough,
} from './fallthrough.ts'
export {
  requiredSurfaces,
  accommodateFeatures,
  missingSurfaces,
  verifyBootstrap,
  type Surface,
  type Accommodate,
} from './bootstrap.ts'
export {
  lodashCore,
  libwasmLodashPath,
  scanLodashCatalog,
  loadLodashCatalog,
  lodashMethodsUsed,
} from './lodash.ts'
export {
  coreTypes,
  coreBindings,
  routerNames,
  libwasmRoot,
  loadBindingsCatalog,
  serveSurfaces,
} from './libwasm.ts'
export { domUdas, extractDomUdas } from './dom.ts'
export {
  debugMapPath,
  loadDebugMap,
  lookupOrig,
  rewriteStack,
  rewriteConsole,
  destFromUrl,
  rewriteDevtoolsFrame,
  rewriteCdpStack,
  formatWasmAbort,
  kitLogLevel,
  colorizeHostLog,
  formatBridgeLine,
  overlayPath,
  loadOverlay,
  inspectorPath,
  loadInspector,
  destFromWasmName,
  destToModule,
  demangleD,
  lookupWasmOrig,
  isWasmUrl,
  type DebugEntry,
  type DebugMap,
  type DevtoolsFrame,
  type KitLogLevel,
  type OverlayDiag,
  type OverlayReport,
  type InspectorReport,
} from './debug.ts'
export {
  adaptWorkspace,
  normalizeAdapter,
  readWsManifest,
  manifestPath,
  ADAPTERS,
  type AdapterName,
  type AdaptOpts,
  type AdapterReport,
  type ManifestV1,
} from './adapter.ts'
export {
  parseWasmNames,
  writeWasmNameMap,
  loadWasmNames,
  wasmNamesPath,
  encodeNamedWasm,
  type WasmNameFn,
  type WasmNameReport,
} from './wasm_names.ts'
