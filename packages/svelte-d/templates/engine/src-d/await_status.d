// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// JS-side await flag after env.libwasm_await__void rewinds. Do not wrap
// `.await` in try/catch — landing-pad state is not part of Asyncify.
// After rewind, same-function code may read these and throw/catch.
module await_status;

nothrow:
@safe:

extern (C) @trusted int libwasm_await_supported();
extern (C) @trusted int libwasm_await_failed();

/// True when the ship module exported asyncify_get_state (fork wasm-opt).
@trusted bool libwasmAwaitSupported()
{
  return libwasm_await_supported() != 0;
}

/// True when the last `.await` rejected. Valid only after rewind.
@trusted bool libwasmAwaitFailed()
{
  return libwasm_await_failed() != 0;
}
