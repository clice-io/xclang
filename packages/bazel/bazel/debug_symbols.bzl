"""A program's debug symbols for its release, made by the xclang toolchain's
own tools:

    load("@xclang//bazel:debug_symbols.bzl", "xclang_debug_symbols")

    cc_binary(name = "tool", features = ["generate_dsym_file"], ...)
    xclang_debug_symbols(name = "tool_symbols", binary = ":tool")

gives tool.gsym, GSYM (functions, inlining and lines by address, a tenth of
the DWARF's size, read by llvm-gsymutil), for every target but the MSVC
ones, and for macOS ones tool.dSYM too. The GSYM is converted from the
program's DWARF, which on macOS is in its dSYM: the generate_dsym_file
feature (or --apple_generate_dsym) has the link make it (bazel/dsym), where
the objects the debug map points into are. The program needs debug
information, -g (from -gline-tables-only's DWARF llvm-gsymutil of LLVM 23
loads no function: the GSYM would hold the symbol table's names only, no
lines), and no stripping (--strip=never in fastbuild). An MSVC target's
debug information is CodeView, in the PDB of its link (the
generate_pdb_file feature, on with -c dbg), which llvm-gsymutil does not
read: for those, the rule gives tool.pdb.

    bazel run @xclang//bazel:llvm-gsymutil -- $PWD/bazel-bin/tool.gsym --address=0x...

looks an address up in it with the toolchain's llvm-gsymutil.
"""

load("@rules_cc//cc:find_cc_toolchain.bzl", "find_cc_toolchain", "use_cc_toolchain")

# llvm-gsymutil warns once per DIE of what it cannot convert (with ICF's
# folded functions, gigabytes for a large program), past --quiet: into a log.
_SH = """\
#!/bin/sh
log=$1
shift
"$@" > "$log" 2>&1 || {{ status=$?; tail -c 4000 "$log" >&2; echo "{hint}" >&2; exit $status; }}
"""

_BAT = """\
@echo off\r
{command} > "{log}" 2>&1\r
if errorlevel 1 (type "{log}" & echo {hint} 1>&2 & exit /b 1)\r
"""

_HINT = "llvm-gsymutil found nothing to convert? The program needs debug information: -g, and --strip=never in fastbuild."

def _xclang_debug_symbols_impl(ctx):
    cc_toolchain = find_cc_toolchain(ctx)
    binary = ctx.attr.binary[DefaultInfo].files_to_run.executable
    groups = ctx.attr.binary[OutputGroupInfo] if OutputGroupInfo in ctx.attr.binary else None
    if ctx.target_platform_has_constraint(ctx.attr._msvc[platform_common.ConstraintValueInfo]):
        pdbs = getattr(groups, "pdb_file", depset()).to_list() if groups else []
        if not pdbs:
            fail("%s has no PDB: give it features = [\"generate_pdb_file\"], or build with -c dbg" % ctx.attr.binary.label)
        return [
            DefaultInfo(files = depset(pdbs)),
            OutputGroupInfo(pdb = depset(pdbs)),
        ]
    dsym = None
    dwarf = binary
    if ctx.target_platform_has_constraint(ctx.attr._macos[platform_common.ConstraintValueInfo]):
        dsyms = getattr(groups, "dsyms", depset()).to_list() if groups else []
        if not dsyms:
            fail("%s has no dSYM: give it features = [\"generate_dsym_file\"], or build with --apple_generate_dsym" % ctx.attr.binary.label)
        dsym = dsyms[0]
        dwarf = dsym

    # The toolchain's programs, for the platform its actions run on, next to
    # its llvm-objcopy.
    objcopy = cc_toolchain.objcopy_executable
    windows = objcopy.endswith(".exe")
    gsymutil = "%s/llvm-gsymutil%s" % (objcopy.rpartition("/")[0], ".exe" if windows else "")

    stem = binary.basename.removesuffix(".exe")
    gsym = ctx.actions.declare_file(stem + ".gsym")
    log = ctx.actions.declare_file(stem + ".gsym.log")
    source = dwarf.path
    if dsym:
        source = "%s/Contents/Resources/DWARF/%s" % (dsym.path, binary.basename)
    # One thread: llvm-gsymutil's threads lay the file out differently each
    # run; one makes the same file from the same DWARF, about 1.4 times as
    # slow (gsymutil_args = ["--num-threads=0"], the last, undoes it).
    args = ["--convert", source, "--out-file", gsym.path, "--quiet", "--num-threads=1"] + ctx.attr.gsymutil_args

    script = ctx.actions.declare_file(ctx.label.name + (".gsymutil.bat" if windows else ".gsymutil.sh"))
    if windows:
        command = " ".join(['"%s"' % a.replace("/", "\\") if i == 0 else '"%s"' % a for i, a in enumerate([gsymutil] + args)])
        ctx.actions.write(script, _BAT.format(command = command, log = log.path.replace("/", "\\"), hint = _HINT), is_executable = True)
        arguments = []
    else:
        ctx.actions.write(script, _SH.format(hint = _HINT), is_executable = True)
        arguments = [log.path, gsymutil] + args
    ctx.actions.run(
        executable = script,
        arguments = arguments,
        inputs = depset([dwarf], transitive = [cc_toolchain.all_files]),
        outputs = [gsym, log],
        mnemonic = "GsymUtil",
        progress_message = "Converting the debug information of %{label} to GSYM",
    )
    files = [gsym] + ([dsym] if dsym else [])
    return [
        DefaultInfo(files = depset(files)),
        OutputGroupInfo(
            gsym = depset([gsym]),
            dsym = depset([dsym] if dsym else []),
            gsym_log = depset([log]),
        ),
    ]

xclang_debug_symbols = rule(
    implementation = _xclang_debug_symbols_impl,
    attrs = {
        "binary": attr.label(
            mandatory = True,
            doc = "The cc_binary; on macOS, with the generate_dsym_file feature; for an MSVC target, with generate_pdb_file.",
        ),
        "gsymutil_args": attr.string_list(
            doc = "More options of llvm-gsymutil --convert, after the default --num-threads=1, e.g. --merged-functions for a program linked with ICF.",
        ),
        "_macos": attr.label(default = "@platforms//os:macos"),
        "_msvc": attr.label(default = Label("//platforms/libc:msvc")),
    },
    toolchains = use_cc_toolchain(),
    fragments = ["cpp"],
    doc = "<binary>.gsym, and for a macOS target <binary>.dSYM, of a cc_binary; for an MSVC target, <binary>.pdb.",
)
