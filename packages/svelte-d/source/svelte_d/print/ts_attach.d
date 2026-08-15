module svelte_d.print.ts_attach;

import std.file;
import std.path;
import std.string : replace, strip, indexOf;
import std.array : appender;
import std.conv : to;
import std.algorithm : sort;
import svelte_d.parse.svelte;
import svelte_d.fallthrough : identFromRel;
import svelte_d.workspace.files;

private string wrapJsExports(string body)
{
	if (indexOf(body, "jsExports") >= 0)
		return "";
	return q{
export const jsExports = { env: {} as Record<string, unknown> };
};
}

/// Write each lang=ts script into src-ts/modules/generated (libwasm jsExports template).
string[] attachTsModules(string ws, string srcSvelteRel, SvelteScan scan)
{
	string[] idents;
	auto genDir = buildPath(ws, "src-ts", "modules", "generated");
	mkdirRecurse(genDir);
	size_t n;
	enum pkgTmpl = import("js-module.ts.tmpl");
	foreach (s; scan.scripts)
	{
		if (s.lang != "ts")
			continue;
		++n;
		auto id = identFromRel(srcSvelteRel) ~ (s.moduleContext ? "_mod" : "") ~ (n > 1 ? to!string(n) : "");
		auto outTxt = pkgTmpl.replace("{{SOURCE}}", srcSvelteRel)
			.replace("{{BODY}}", s.body.strip)
			.replace("{{WRAP}}", wrapJsExports(s.body));
		writeIfChanged(buildPath(genDir, id ~ ".ts"), outTxt, DestCell.meta);
		idents ~= id;
	}
	return idents;
}

void rewriteModulesIndex(string ws, string[] generatedIdents)
{
	enum idxTmpl = import("modules-index.ts.tmpl");
	bool[string] seen;
	foreach (id; generatedIdents)
		if (id.length)
			seen[id] = true;
	auto genDir = buildPath(ws, "src-ts", "modules", "generated");
	if (exists(genDir))
	{
		foreach (de; dirEntries(genDir, "*.ts", SpanMode.shallow))
		{
			auto id = stripExtension(baseName(de.name));
			if (id.length)
				seen[id] = true;
		}
	}
	string[] ids = seen.keys;
	sort(ids);
	auto imports = appender!string();
	auto list = appender!string();
	foreach (id; ids)
	{
		imports ~= "import * as " ~ id ~ " from './generated/" ~ id ~ ".ts';\n";
		list ~= ", " ~ id;
	}
	auto txt = idxTmpl.replace("{{IMPORTS}}", imports.data).replace("{{MODULE_LIST}}", list.data);
	writeIfChanged(buildPath(ws, "src-ts", "modules", "index.ts"), txt, DestCell.meta);
}
