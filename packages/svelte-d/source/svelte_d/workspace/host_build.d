// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// Host cell: dub build inside svelte-engine-ws/webserver (vibe.0).
// Never build the svelte-engine template. Host LDC is setenv.ps1 1.42, not wasm 1.43.
module svelte_d.workspace.host_build;

import std.conv : to;
import std.file : exists, mkdirRecurse, writeText = write;
import std.path : buildPath, dirName;
import std.process : execute, environment, Config;
import std.stdio : writeln, stderr;
import std.string : format, replace;
import svelte_d.workspace.drop;

/// Host-cell LDC (1.42). Not riscv-compilers/ldc2-build (wasm-eh).
string findHostLdc(string riscvDev = null)
{
	if (!riscvDev.length)
		riscvDev = findRiscvDev();
	auto p = buildPath(riscvDev, "toolchains", "ldc2-1.42.0-windows-x64", "bin", "ldc2.exe");
	if (exists(p))
		return p;
	p = buildPath(riscvDev, "toolchains", "ldc2-1.42.0-windows-x64", "bin", "ldc2");
	if (exists(p))
		return p;
	p = buildPath(riscvDev, "toolchains", "ldc2-1.42.0-linux-x64", "bin", "ldc2");
	if (exists(p))
		return p;
	return "";
}

/// 0 = built, 2 = dub failed, 3 = host LDC missing.
int buildHostCell(string ws)
{
	auto dir = buildPath(ws, "webserver");
	if (!exists(buildPath(dir, "dub.sdl")))
	{
		stderr.writeln("host: no webserver/dub.sdl in ", ws, " (drop-ws first)");
		return 2;
	}
	auto ldc = findHostLdc();
	if (!ldc.length)
	{
		writeln("host: skip — no riscv-dev/toolchains/ldc2-1.42 (host cell)");
		return 3;
	}
	mkdirRecurse(buildPath(ws, ".svelte-d"));
	auto env = environment.toAA();
	env.remove("DFLAGS");
	env.remove("DC");
	env.remove("DMD");
	auto r = execute(
		["dub", "build", "--compiler=" ~ ldc],
		env, Config.none, ulong.max, dir
	);
	writeln(r.output);
	auto exeWin = buildPath(dir, "svelte-engine-server.exe");
	auto exePosix = buildPath(dir, "svelte-engine-server");
	auto exe = exists(exeWin) ? exeWin : exePosix;
	auto ok = r.status == 0 && exists(exe);
	writeText(buildPath(ws, ".svelte-d", "host.json"),
		format(`{"schema":"svelte-d-host/v1","ok":%s,"status":%s,"compiler":"%s","exe":%s}` ~ "\n",
			ok ? "true" : "false", r.status.to!string, ldc.replace("\\", "/"),
			exists(exe) ? "true" : "false"));
	if (!ok)
	{
		stderr.writeln("host: dub failed status=", r.status);
		return 2;
	}
	writeln("host ok  ", exe);
	return 0;
}
