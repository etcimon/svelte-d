// Load svelte-engine-raw.wasm with the same EH env the TS runtime
// installs (__cpp_exception tag + env stubs) and call the D probes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Inline the same ABI as src-ts/modules/error-handling.ts so Node
// does not need a TypeScript loader.
function createCppExceptionTag() {
  return new WebAssembly.Tag({ parameters: ['i32'] });
}
function isWasmException(e) {
  return (
    typeof WebAssembly.Exception === 'function' &&
    e instanceof WebAssembly.Exception
  );
}
function installErrorHandling(env, decode, abort) {
  env.onAssertErrorMsg = (fileLen, filePtr, line, msgLen, msgPtr) => {
    abort('assert', decode(fileLen, filePtr), line, decode(msgLen, msgPtr));
  };
  env.captureException = (msgLen, msgPtr) => {
    abort('exception', '', 0, decode(msgLen, msgPtr));
  };
  env._Unwind_Resume = () => abort('unwind', '', 0, '_Unwind_Resume');
  env._d_delThrowable = () => {};
  if (!env.__cpp_exception) env.__cpp_exception = createCppExceptionTag();
  return env;
}
function wrapEnvWithStubs(env) {
  const nop = () => 0;
  return new Proxy(env, {
    get(t, k) {
      if (k in t) return t[k];
      return nop;
    },
    has() {
      return true;
    },
  });
}

const dir = dirname(fileURLToPath(import.meta.url));
const raw = join(dir, 'public', 'svelte-engine-raw.wasm');
const buf = readFileSync(raw);

const abort = (what, file, line, msg) => {
  throw new Error(`ABORT: ${what} @ ${file}:${line} ${msg}`);
};
const decode = (len, ptr) => {
  if (typeof len === 'string') return len;
  return `str(${len},${ptr})`;
};

let env = { __cpp_exception: createCppExceptionTag() };
installErrorHandling(env, decode, abort);
env = wrapEnvWithStubs(env);

const { instance } = await WebAssembly.instantiate(buf, { env });
const mem = instance.exports.memory;
if (mem && mem.grow) {
  try {
    mem.grow(64);
  } catch {
    /* already large */
  }
}

function call(name) {
  const fn = instance.exports[name];
  if (typeof fn !== 'function') {
    console.error(`FAIL: ${name} not exported`);
    process.exit(1);
  }
  try {
    return fn();
  } catch (e) {
    if (isWasmException(e)) {
      console.error(`FAIL: ${name} threw WebAssembly.Exception (uncaught D throw)`);
    } else {
      console.error(`FAIL: ${name} threw`, e);
    }
    process.exit(1);
  }
}

const eh = call('svelte_engine_eh_probe');
if (eh !== 1) {
  console.error('FAIL: svelte_engine_eh_probe returned', eh);
  process.exit(1);
}
console.log('PASS: svelte_engine_eh_probe returned 1 (D catch ran)');

const ph = call('svelte_engine_phobos_probe');
if (ph !== 1) {
  console.error(
    'FAIL: svelte_engine_phobos_probe returned',
    ph,
    '(bitmask; -1 init, -2 uncaught)'
  );
  process.exit(1);
}
console.log('PASS: svelte_engine_phobos_probe returned 1 (Phobos + D catch)');
process.exit(0);
