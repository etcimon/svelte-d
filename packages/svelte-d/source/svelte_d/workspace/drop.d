module svelte_d.workspace.drop;

import std.file;
import std.path;
import std.stdio : writeln, stderr;
import std.algorithm : canFind, startsWith;
import std.string : toLower;

private bool isEngineRoot(string p)
{
	return exists(buildPath(p, "src-d", "app.d")) && exists(buildPath(p, "dub.sdl"));
}

/// Packaged bootstrap: svelte-d/templates/engine (next to the exe or cwd).
string bundledTemplateDir()
{
	import std.file : thisExePath;

	string[] seeds;
	try
		seeds ~= dirName(thisExePath);
	catch (Exception)
	{
	}
	seeds ~= getcwd();
	foreach (seed; seeds)
	{
		auto a = buildNormalizedPath(seed, "..", "templates", "engine");
		if (isEngineRoot(a))
			return a;
		auto b = buildNormalizedPath(seed, "templates", "engine");
		if (isEngineRoot(b))
			return b;
	}
	return "";
}

/// Directory that contains `svelte-engine/` (this repo with the submodule, or a riscv-dev host).
string findRiscvDev(string start = null)
{
	import std.file : thisExePath;

	string[] seeds;
	if (start.length)
		seeds ~= start;
	seeds ~= getcwd();
	try
		seeds ~= dirName(thisExePath);
	catch (Exception)
	{
	}
	foreach (seed; seeds)
	{
		auto p = seed;
		foreach (_; 0 .. 10)
		{
			if (exists(buildPath(p, "svelte-engine", "AGENTS.md")))
				return p;
			auto parent = dirName(p);
			if (parent == p)
				break;
			p = parent;
		}
	}
	throw new Exception("cannot find svelte-engine (no svelte-engine/AGENTS.md above cwd or exe)");
}

/// Drop source: svelte-engine submodule first, else packaged templates/engine.
string templateDir(string riscvDev = null)
{
	if (!riscvDev.length)
		riscvDev = findRiscvDev();
	auto sub = buildPath(riscvDev, "svelte-engine");
	if (isEngineRoot(sub))
		return sub;
	auto bundled = bundledTemplateDir();
	if (bundled.length)
		return bundled;
	return sub;
}

string defaultWorkspaceDir(string riscvDev)
{
	auto here = buildPath(riscvDev, "svelte-engine-ws");
	if (exists(here))
		return here;
	auto beside = buildPath(dirName(riscvDev), "svelte-engine-ws");
	if (exists(beside))
		return beside;
	return here;
}

/// libwasm checkout: walk, or riscv-compilers/libwasm next to the engine host.
string findLibwasmRoot(string riscvDev = null)
{
	if (!riscvDev.length)
		riscvDev = findRiscvDev();
	string[] seeds = [riscvDev, dirName(riscvDev), getcwd()];
	foreach (seed; seeds)
	{
		auto p = seed;
		foreach (_; 0 .. 10)
		{
			foreach (cand; [buildPath(p, "libwasm"), buildPath(p, "riscv-compilers", "libwasm")])
			{
				if (exists(buildPath(cand, "source", "libwasm", "dom.d")))
					return cand;
			}
			auto parent = dirName(p);
			if (parent == p)
				break;
			p = parent;
		}
	}
	throw new Exception("cannot find libwasm (source/libwasm/dom.d)");
}

private bool skipName(string name)
{
	auto b = baseName(name).toLower;
	if (b == ".dub" || b == "node_modules" || b == ".svelte-d" || b == ".git")
		return true;
	if (b.endsWith(".exe") || b.endsWith(".pdb") || b.endsWith(".obj") || b.endsWith(".lib")
			|| b.endsWith(".wasm"))
		return true;
	return false;
}

private bool endsWith(string s, string tail)
{
	return s.length >= tail.length && s[$ - tail.length .. $] == tail;
}

/// Dirs a live Vite / dub process holds open. Never rmdirRecurse these.
private bool keepOnForce(string name)
{
	auto b = baseName(name).toLower;
	return b == "node_modules" || b == ".dub" || b == ".git";
}

/// Replace dest contents without deleting locked install/build dirs.
private void clearDest(string dest)
{
	if (!exists(dest) || !isDir(dest))
		return;
	foreach (e; dirEntries(dest, SpanMode.shallow))
	{
		if (keepOnForce(e.name))
			continue;
		try
		{
			if (e.isDir && baseName(e.name).toLower == "public")
			{
				foreach (f; dirEntries(e.name, SpanMode.shallow))
				{
					if (skipName(f.name))
						continue;
					try
					{
						if (f.isDir)
							rmdirRecurse(f.name);
						else
							remove(f.name);
					}
					catch (Exception ex)
					{
						stderr.writeln("drop: skip locked ", f.name, " (", ex.msg, ")");
					}
				}
				continue;
			}
			if (e.isDir)
				rmdirRecurse(e.name);
			else
				remove(e.name);
		}
		catch (Exception ex)
		{
			stderr.writeln("drop: skip locked ", e.name, " (", ex.msg, ")");
		}
	}
}

/// Copy the bootstrap template to dest (svelte-engine-ws). Does not mutate the template.
/// `--force` refreshes sources but keeps `node_modules` / `.dub` so a leftover Vite
/// cannot make `rmdirRecurse` fail the whole drop.
void dropWorkspace(string dest, string srcTemplate, bool force)
{
	if (!exists(srcTemplate) || !isDir(srcTemplate))
		throw new Exception("template missing: " ~ srcTemplate);
	if (exists(dest))
	{
		if (isEngineRoot(dest) && !force)
			throw new Exception(dest ~ " exists (pass --force to replace)");
		clearDest(dest);
	}
	mkdirRecurse(dest);
	size_t n;
	foreach (e; dirEntries(srcTemplate, SpanMode.breadth))
	{
		auto rel = relativePath(e.name, srcTemplate);
		auto parts = pathSplitter(rel);
		bool skip;
		foreach (part; parts)
		{
			if (skipName(part))
			{
				skip = true;
				break;
			}
		}
		if (skip)
			continue;
		auto outp = buildPath(dest, rel);
		if (e.isDir)
			mkdirRecurse(outp);
		else
		{
			mkdirRecurse(dirName(outp));
			try
			{
				copy(e.name, outp);
				++n;
			}
			catch (Exception ex)
			{
				stderr.writeln("drop: skip locked ", outp, " (", ex.msg, ")");
			}
		}
	}
	writeln("dropped ", srcTemplate, " -> ", dest, " (", n, " files)");
}
