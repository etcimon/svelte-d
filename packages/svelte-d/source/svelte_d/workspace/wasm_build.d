// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// Wasm cell: per-.o src-d compile + relink inside svelte-engine-ws (G107).
// LTO configs and any objects-path failure fall back to whole-program dub.
// Never build the svelte-engine template. Default config is wasm-eh (application).
module svelte_d.workspace.wasm_build;

import std.algorithm : canFind;
import std.conv : to;
import std.datetime.systime : SysTime;
import std.file : exists, copy, mkdirRecurse, writeText = write, timeLastModified, dirEntries, SpanMode, getcwd, readText;
import std.path : buildPath, dirName, extension;
import std.process : execute, environment, Config;
import std.stdio : writeln, stderr;
import std.string : format, replace, splitLines, strip, indexOf;
import svelte_d.workspace.drop;
import svelte_d.workspace.wasm_objects;
import svelte_d.workspace.ldc : findLdc;

/// Same 1.43+ compiler as the host cell (`findLdc`).
string findWasmLdc(string riscvDev = null)
{
	return findLdc(riscvDev);
}

SysTime newestWasmInput(string ws)
{
	SysTime newest = SysTime.min;
	auto pin = buildPath(ws, "dub.sdl");
	if (exists(pin))
		newest = timeLastModified(pin);
	auto srcD = buildPath(ws, "src-d");
	if (exists(srcD))
	{
		foreach (e; dirEntries(srcD, SpanMode.depth))
		{
			if (e.isDir)
				continue;
			if (e.name.extension != ".d")
				continue;
			auto t = e.timeLastModified;
			if (t > newest)
				newest = t;
		}
	}
	return newest;
}

bool wasmArtifactStale(string ws)
{
	auto ship = buildPath(ws, "public", "svelte-engine.wasm");
	auto raw = buildPath(ws, "public", "svelte-engine-raw.wasm");
	string art;
	if (exists(ship))
		art = ship;
	else if (exists(raw))
		art = raw;
	else
		return true;
	return newestWasmInput(ws) > timeLastModified(art);
}

/// Prefer the live checkout over `dub fetch` of github.com/etcimon/libwasm master.
void ensureLibwasmAddLocal()
{
	auto root = findLibwasmCheckout();
	if (!root.length)
		return;
	execute(["dub", "remove-local", root], null, Config.none);
	auto r = execute(["dub", "add-local", root, "~master"], null, Config.none);
	if (r.status == 0)
		writeln("wasm: dub add-local ", root, " ~master");
	else
		stderr.writeln("wasm: add-local failed: ", r.output);
}

/// Record LDC 1.43 and point ws vite `dub --compiler=` at it. Never writes 1.42.
void pinWasmToolchain(string ws)
{
	auto ldc = findWasmLdc();
	mkdirRecurse(buildPath(ws, ".svelte-d"));
	auto posix = ldc.replace(`\`, `/`);
	writeText(buildPath(ws, ".svelte-d", "wasm-ldc.json"),
		format(`{"schema":"svelte-d-wasm-ldc/v1","ldc":"%s","cell":"wasm-eh","ok":%s}` ~ "\n",
			posix, ldc.length ? "true" : "false"));
	if (!ldc.length)
	{
		writeln("wasm-ldc: missing (run bunx svelte-d setup; needs LDC 1.43)");
		return;
	}
	writeln("wasm-ldc: ", ldc);
	auto vite = buildPath(ws, "vite.config.js");
	if (!exists(vite))
		return;
	auto src = readText(vite);
	enum key = "--compiler=";
	auto i = src.indexOf(key);
	if (i < 0)
		return;
	auto j = i + key.length;
	if (j < src.length && (src[j] == '\'' || src[j] == '"'))
		++j;
	auto end = j;
	while (end < src.length && src[end] != ' ' && src[end] != '\'' && src[end] != '"' && src[end] != '\n')
		++end;
	auto next = src[0 .. i] ~ key ~ posix ~ src[end .. $];
	if (next != src)
		writeText(vite, next);
}

/// 0 = built or skipped (fresh), 2 = dub/IR failed, 3 = wasm LDC missing.
int buildWasmCell(string ws, string config = "application", bool force = false)
{
	if (!exists(buildPath(ws, "dub.sdl")))
	{
		stderr.writeln("wasm: no dub.sdl in ", ws, " (drop-ws first)");
		return 2;
	}
	ensureLibwasmAddLocal();
	pinWasmToolchain(ws);
	auto ldc = findWasmLdc();
	if (!ldc.length)
	{
		writeln("wasm: skip — no LDC 1.43 (bunx svelte-d setup; set SVELTE_D_LDC)");
		return 3;
	}
	auto publicDir = buildPath(ws, "public");
	mkdirRecurse(publicDir);
	if (!force && !wasmArtifactStale(ws))
	{
		writeln("wasm skip  dests unchanged (link not needed)");
		writeWasmJson(ws, ldc, config, true, true, 0, "skip", 0, 0, 0);
		return 0;
	}
	auto env = environment.toAA();
	env.remove("DFLAGS");
	env.remove("DC");
	env.remove("DMD");
	if (objectsSupported(config))
	{
		try
		{
			auto obj = tryBuildObjects(ws, ldc, config, env);
			if (obj.ok)
			{
				shipRawWasm(publicDir);
				writeWasmJson(ws, ldc, config, true, false, 0, "objects",
					obj.compiled, obj.cached, obj.objects);
				auto raw = buildPath(publicDir, "svelte-engine-raw.wasm");
				auto ship = buildPath(publicDir, "svelte-engine.wasm");
				writeln("wasm ok  objects  compiled=", obj.compiled, " cached=", obj.cached,
					"  ", exists(ship) ? ship : raw);
				return 0;
			}
			if (obj.attempted)
				writeln("wasm: objects fallback — ", obj.reason);
		}
		catch (Exception e)
		{
			writeln("wasm: objects fallback — ", e.msg);
		}
	}
	auto r = execute(
		["dub", "build", "--arch=wasm32-unknown-wasi", "--compiler=" ~ ldc,
			"--config=" ~ config, "--build=release"],
		env, Config.none, ulong.max, ws
	);
	writeln(r.output);
	shipRawWasm(publicDir);
	auto raw = buildPath(publicDir, "svelte-engine-raw.wasm");
	auto ship = buildPath(publicDir, "svelte-engine.wasm");
	auto ok = r.status == 0 && (exists(ship) || exists(raw));
	writeWasmJson(ws, ldc, config, ok, false, r.status, "dub", 0, 0, 0);
	if (!ok)
	{
		stderr.writeln("wasm: dub failed status=", r.status);
		return 2;
	}
	writeln("wasm ok  dub  ", exists(ship) ? ship : raw);
	return 0;
}

private void shipRawWasm(string publicDir)
{
	auto raw = buildPath(publicDir, "svelte-engine-raw.wasm");
	auto ship = buildPath(publicDir, "svelte-engine.wasm");
	if (exists(raw))
		copy(raw, ship);
}

private void writeWasmJson(string ws, string ldc, string config, bool ok,
	bool skipped, int status, string mode, int compiled, int cached, int objects)
{
	auto publicDir = buildPath(ws, "public");
	mkdirRecurse(buildPath(ws, ".svelte-d"));
	writeText(buildPath(ws, ".svelte-d", "wasm.json"),
		format(`{"schema":"svelte-d-wasm/v1","ok":%s,"status":%s,"skipped":%s,"mode":"%s","compiled":%s,"cached":%s,"objects":%s,"compiler":"%s","config":"%s","raw":%s,"ship":%s}` ~ "\n",
			ok ? "true" : "false", status.to!string, skipped ? "true" : "false", mode,
			compiled.to!string, cached.to!string, objects.to!string,
			ldc.replace("\\", "/"), config,
			exists(buildPath(publicDir, "svelte-engine-raw.wasm")) ? "true" : "false",
			exists(buildPath(publicDir, "svelte-engine.wasm")) ? "true" : "false"));
}

int runWasmProbes(string ws)
{
	auto probe = buildPath(ws, "run-probes.mjs");
	if (!exists(probe))
	{
		stderr.writeln("wasm: no run-probes.mjs in ", ws);
		return 2;
	}
	auto r = execute(["node", "run-probes.mjs"], null, Config.none, ulong.max, ws);
	writeln(r.output);
	return r.status == 0 ? 0 : 2;
}
