// Copyright (c) 2026 Etienne Cimon
// SPDX-License-Identifier: MIT
//
// Overlay a bun + svelte-kit project `src/` onto the dropped workspace.
// svelte-engine is an unpopulated runtime bootstrap; app Svelte compiles
// into svelte-engine-ws. Does not mutate the template.
module svelte_d.workspace.ingest;

import std.file;
import std.path;
import std.string : replace;

/// Project kit root: `src/` (SvelteKit) or `src-svelte/` (ws-shaped).
string projectKitRoot(string project)
{
	auto src = buildPath(project, "src");
	if (exists(src) && isDir(src))
		return src;
	auto alt = buildPath(project, "src-svelte");
	if (exists(alt) && isDir(alt))
		return alt;
	return "";
}

/// Copy project routes/lib/hooks into ws/src-svelte (overwrite those paths).
/// Engine goldens not named by the project stay (Panel, Combo, +page stub).
void ingestProject(string project, string ws)
{
	auto kit = projectKitRoot(project);
	if (!kit.length)
		throw new Exception("project has no src/ or src-svelte/: " ~ project);
	copyTree(buildPath(kit, "routes"), buildPath(ws, "src-svelte", "routes"));
	copyTree(buildPath(kit, "lib"), buildPath(ws, "src-svelte", "lib"));
	auto hooks = buildPath(kit, "hooks.server.d");
	if (exists(hooks) && isFile(hooks))
	{
		auto dest = buildPath(ws, "src-svelte", "hooks.server.d");
		mkdirRecurse(dirName(dest));
		copy(hooks, dest);
	}
}

private void copyTree(string from, string to)
{
	if (!exists(from) || !isDir(from))
		return;
	mkdirRecurse(to);
	foreach (e; dirEntries(from, SpanMode.breadth))
	{
		auto rel = relativePath(e.name, from);
		auto dest = buildPath(to, rel);
		if (e.isDir)
			mkdirRecurse(dest);
		else if (e.isFile)
		{
			mkdirRecurse(dirName(dest));
			copy(e.name, dest);
		}
	}
}
