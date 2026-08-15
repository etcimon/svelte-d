declare let window: any;

import { instantiate } from './asyncify';
import {
  installErrorHandling,
  wrapEnvWithStubs,
  isWasmException,
  createCppExceptionTag,
} from './error-handling';
import { attachSvelteDPopstate, installSvelteDDebug } from './debug-bridge';

const abort = (what: string, file: string, line: number, msg: string) => {
  const fmt = (window as any).__svelteDFormatAbort;
  const text =
    typeof fmt === 'function'
      ? fmt(what, file, line, msg)
      : `ABORT: ${what} @ ${file}:${line} ${msg}`;
  console.error(text);
  throw text;
};

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

var objects: any = { 1: document, 2: window };
var freelist: any[] = [];
var wasm_constants_decoded = new Map<number, string>();
var heap_base_value: any;

const addObject = (value: any) => {
  if (value === null || value == undefined) return 0;
  let idx: number = 0;
  if (value instanceof Promise) {
    idx = ++libwasm.lastPromisePtr;
  } else idx = freelist.pop() || ++libwasm.lastPtr;
  objects[idx] = value;
  return idx;
};
const getObject = (ptr: number) => objects[ptr];
const removeObject = (ptr: number) => {
  if (objects[ptr] === undefined) return;
  if (!(objects[ptr] instanceof Promise)) freelist.push(ptr);
  delete objects[ptr];
};
const MemoryIdentifiers = {
  i64u: 0,
  i64s: 1,
  i32s: 2,
  i32u: 3,
  i16s: 4,
  i16u: 5,
  i8s: 6,
  i8u: 7,
  f32: 8,
  f64: 9,
};

const setupMemory = (memory: any, resetMemory: any) => {
  resetMemory(memory, true);
  libwasm.memory = memory;
  libwasm.buffer = memory.buffer;
};

const libwasm: any = {
  resetMemory: null,
  nativeFunctions: {},
  lastPtr: 2,
  lastPromisePtr: 65536,
  instance: null,
  lastExceptionMsg: null,
  init: async (modules: any, cb: any = null) => {
    (window as any).libwasm = libwasm;
    (window as any).libwasm.modules = modules;
    await installSvelteDDebug();

    if (!libwasm.exports) {
      let tmp: any = {};
      modules
        .map((m: any) => m.jsExports)
        .filter((a: any) => !!a)
        .map((e: any) =>
          Object.entries(e).forEach(
            (e: any) =>
              (tmp[e[0]] = Object.assign.apply(null, [tmp[e[0]] || {}, e[1]]))
          )
        );
      libwasm.instance = null;
      if (tmp.env) {
        installErrorHandling(
          tmp.env,
          (len: any, ptr?: number) =>
            typeof len === 'string' ? len : decoders.string(len, ptr as number),
          abort
        );
        tmp.env.__cpp_exception = createCppExceptionTag();
        tmp.env = wrapEnvWithStubs(tmp.env);
      }
      libwasm.exports = tmp;
      wasm_constants_decoded = new Map<number, string>();
      libwasm.nativeFunctionMap = {};
      freelist = [];
      libwasm.freelists = freelist;
      libwasm.lastPromisePtr = 65536;
      libwasm.lastPtr = 2;

      // for lodash
      (window.sifg = (ptr: number) =>
        libwasm.instance.exports.__indirect_function_table.get(ptr)),
        (window.ao = libwasm.addObject);
      window.es = encoders.string;
      window.nodes = libwasm.objects;
      window.callNative = async (fct_name: string, val: any) => {
        let fct = libwasm.nativeFunctionMap[fct_name];
        if (fct && fct.fun) {
          let handle = addObject(val);
          // Must await: jsCallback is an Asyncify-wrapped export on 1.36/1.42.
          await libwasm.instance.exports.jsCallback(fct.ctx, fct.fun, handle);
        } else console.error(`Function ${fct_name} is not registered.`);
      };
    }
    const response = await fetch(`svelte-engine.wasm?v=${Date.now()}`);
    const buffer = await response.arrayBuffer();
    let instance: any;
    try {
      ({ instance } = await instantiate(buffer, libwasm.exports));
    } catch (e) {
      if (isWasmException(e)) {
        abort('exception', '', 0, 'uncaught WebAssembly.Exception');
      }
      throw e;
    }

    libwasm.instance = instance;
    libwasm.exports = instance.exports;
    setupMemory(instance.exports.memory, libwasm.resetMemory);
    try {
      // Await: on asyncify cells _start is wrapExportFn (rewind after .await).
      await (instance.exports as any)._start(instance.exports.__heap_base);
    } catch (e) {
      if (isWasmException(e)) {
        abort('exception', '', 0, 'uncaught WebAssembly.Exception in _start');
      }
      throw e;
    }
    // After _start: navigate_to is exportDelegate'd. debug-bridge also
    // attaches (guarded) so HMR of this module cannot drop the listener.
    attachSvelteDPopstate()
    heap_base_value = (instance.exports as any).__heap_base.value;
    const probes: any = {};
    if (typeof instance.exports.svelte_engine_eh_probe === 'function')
      probes.eh = () => instance.exports.svelte_engine_eh_probe();
    if (typeof instance.exports.svelte_engine_phobos_probe === 'function')
      probes.phobos = () => instance.exports.svelte_engine_phobos_probe();
    if (Object.keys(probes).length)
      (window as any).svelteEngineProbes = probes;
    if (cb) cb();
  },
  objects,
  addObject: addObject,
  removeObject: removeObject,
  freelists: freelist,
  MemoryIdentifiers: MemoryIdentifiers,
};

const encoders = {
  string: (ptr: number, val: any, heapi32u: any = null, is_ret_arr = false) => {
    if (typeof val !== 'string') {
      if (val !== undefined) val = val.toString();
      else val = 'undefined';
    }
    const encodedString = utf8Encoder.encode(val);
    const wasmPtr = libwasm.instance.exports.allocString(encodedString.length);
    const asBytes = new Uint8Array(
      libwasm.memory.buffer,
      wasmPtr,
      encodedString.length
    );
    asBytes.set(encodedString);
    if (is_ret_arr) return [encodedString.length, wasmPtr];
    if (!heapi32u) heapi32u = new Uint32Array(libwasm.memory.buffer);
    heapi32u[ptr / 4] = encodedString.length;
    heapi32u[ptr / 4 + 1] = wasmPtr;
    return ptr;
  },
};
const decoders = {
  string: (len: number, offset: number, heapi32u: any = null) => {
    if (offset == null) {
      if (!heapi32u) heapi32u = new Uint32Array(libwasm.memory.buffer);
      offset = heapi32u[(len + 4) / 4];
      len = heapi32u[len / 4];
    }
    let str: string | undefined;
    if (offset < heap_base_value && (str = wasm_constants_decoded.get(offset)))
      return str;

    str = utf8Decoder.decode(new DataView(libwasm.memory.buffer, offset, len));
    //console.log(offset + ' ' + str)

    if (offset < heap_base_value) {
      wasm_constants_decoded.set(offset, str);
    }
    return str;
  },
  uints: (len: number, offset: number) => {
    let handles: number[] | undefined = [];
    let heapi32u = new Uint32Array(libwasm.memory.buffer);
    const offset_adj = offset / 4;
    for (let i = 0; i < len; i++) {
      handles?.push(heapi32u[offset_adj + i]);
    }
    return handles;
  },
  ints: (len: number, offset: number) => {
    let handles: number[] | undefined = [];
    let heapi32s = new Int32Array(libwasm.memory.buffer);
    const offset_adj = offset / 4;
    for (let i = 0; i < len; i++) {
      handles?.push(heapi32s[offset_adj + i]);
    }
    return handles;
  },
};
let jsExports = {
  env: {
    gc_init_nothrow: () => {},
    gc_term: () => {},
    gc_enable: () => {},
    gc_disable: () => {},
    gc_extend: () => {},
    gc_reserve: (sz: number) => {
      return sz;
    },
    gc_addRange: (p: number, sz: number, ti: any = null) => {},
    gc_removeRange: (p: number, sz: number, ti: any = null) => {},
    gc_addRoot: (p: number) => {},
    free: (ptr: number) => {},
    _Unwind_Resume: () => {},
    _d_delThrowable: () => {},
    captureException: (msgLen: number, msgPtr: number) => {
      // Replaced by installErrorHandling (abort). Kept as a fallback
      // if that install is skipped.
      let msg = decoders.string(msgLen, msgPtr);
      libwasm.lastExceptionMsg = msg;
      abort('exception', '', 0, msg);
    },
    onAssertErrorMsg: (
      fileLen: number,
      filePtr: number,
      line: number,
      msgLen: number,
      msgPtr: number
    ) => {
      let file = decoders.string(fileLen, filePtr);
      let msg = decoders.string(msgLen, msgPtr);
      abort('assert', file, line, msg);
    },
    snprintf: (
      bufferPtr: number,
      maxLen: number,
      formatLen: number,
      formatPtr: number,
      ...args: any[]
    ) => {
      const formatStr = decoders.string(formatLen, formatPtr);
      let argIndex = 0;

      const formattedStr = formatStr.replace(
        /%([dsf])/g,
        (match, specifier) => {
          const value = args[argIndex++];
          switch (specifier) {
            case 'd':
              return parseInt(value, 10).toString();
            case 's':
              return decoders.string(value, args[argIndex++]);
            case 'f':
              return parseFloat(value).toFixed(6); // default precision 6
            default:
              return match;
          }
        }
      );

      return encoders.string(
        bufferPtr,
        formattedStr.length > length
          ? formattedStr.substring(0, length - 3) + '...'
          : formattedStr
      );
    },
    doLog: (arg: string) => console.log(arg),
    memory: libwasm.memory,
    libwasm_add__bool: (b: any) => addObject(!!b),
    libwasm_add__int: addObject,
    libwasm_add__uint: addObject,
    libwasm_add__long: addObject,
    libwasm_add__ulong: addObject,
    libwasm_add__short: addObject,
    libwasm_add__ushort: addObject,
    libwasm_add__byte: addObject,
    libwasm_add__ubyte: addObject,
    libwasm_add__float: addObject,
    libwasm_add__double: addObject,
    libwasm_add__object: () => addObject({}),
    libwasm_add__string: (len: number, offset: number) => {
      let str = decoders.string(len, offset);
      return addObject(str);
    },
    libwasm_add__ints: (len: number, offset: number) => {
      let handles = decoders.ints(len, offset);
      return addObject(handles);
    },
    libwasm_add__uints: (len: number, offset: number) => {
      let handles = decoders.uints(len, offset);
      return addObject(handles);
    },
    libwasm_set__function: (
      len: number,
      offset: number,
      ctx: number,
      fun: number
    ) => {
      let fct_name = decoders.string(len, offset);
      if (libwasm.nativeFunctionMap[fct_name]) {
        console.warn(
          `Function ${fct_name} already registerd, did you forget to unexportDelegate?`
        );
      }
      libwasm.nativeFunctionMap[fct_name] = { ctx, fun };
    },
    libwasm_unset__function: (len: number, offset: number) => {
      let fct_name = decoders.string(len, offset);
      delete libwasm.nativeFunctionMap[fct_name];
    },
    libwasm_get__field: (handle: number, len: number, offset: number) => {
      return addObject(getObject(handle)[decoders.string(len, offset)]);
    },
    libwasm_get_idx__field: (handle: number, idx: number) => {
      return addObject(getObject(handle)[idx]);
    },
    libwasm_get__int: getObject,
    libwasm_get__uint: getObject,
    libwasm_get__long: (ptr: number) => BigInt(getObject(ptr)),
    libwasm_get__ulong: (ptr: number) => BigInt(getObject(ptr)),
    libwasm_get__short: getObject,
    libwasm_get__ushort: getObject,
    libwasm_get__float: getObject,
    libwasm_get__double: getObject,
    libwasm_get__byte: getObject,
    libwasm_get__ubyte: getObject,
    libwasm_get__string: (rawResult: number, ptr: number) => {
      encoders.string(rawResult, getObject(ptr));
    },
    libwasm_await__void: async (handle: number) => {
      const ex = libwasm.instance && libwasm.instance.exports;
      if (!ex || typeof ex.asyncify_get_state !== 'function') {
        // wasm-eh default cell copies raw wasm. Without Binaryen Asyncify
        // this import returns immediately and D continues — a silent no-op.
        console.error(
          'libwasm_await__void: module is not asyncified; .await does not wait. ' +
            'Binaryen 132 Flatten.cpp cannot --asyncify try_table. ' +
            'Use JsPromise.then on the wasm-eh cell, or build ldc-1.36 / ldc-1.42.'
        );
        return;
      }
      let promise = getObject(handle);
      // finally(): always resume D (ScopedPool dtors). Rejection is not a
      // D exception — catch around .await cannot see JS failure (see
      // AGENTS-D-IR-asyncify-wasm-eh.md).
      return new Promise((resolve) => {
        promise.finally(() => resolve(null));
      });
    },
    libwasm_removeObject: (ptr: number) => {
      if (objects[ptr] === undefined) return;
      if (!(objects[ptr] instanceof Promise)) freelist.push(ptr);
      delete objects[ptr];
    },
    DataView_Create: (len: number, offset: number) => {
      return addObject(new DataView(libwasm.memory.buffer, offset, len));
    },
    Float32Array_Create: (len: number, offset: number) => {
      return addObject(new Float32Array(libwasm.memory.buffer, offset, len));
    },
    Uint8Array_Create: (len: number, offset: number) => {
      return addObject(new Uint8Array(libwasm.memory.buffer, offset, len));
    },
  },
};

export { libwasm, encoders, decoders, jsExports };
