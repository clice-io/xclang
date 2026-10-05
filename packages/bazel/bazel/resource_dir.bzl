"""xclang_resource_dir: clang's resource directory where a tool on libclang
finds it, lib/clang next to the directory of its program:

    load("@xclang//bazel:resource_dir.bzl", "xclang_resource_dir")

    cc_binary(
        name = "bin/tool",
        data = [":resource_dir"],
        ...
    )

    xclang_resource_dir(name = "resource_dir")

lays lib/clang/<major>/ out in the rule's package, which bin/tool's
<bindir>/../lib/clang is, in bazel-bin and in the runfiles. The resource
directory is @libclang's, the target platform's (the ASan build's with
--features=asan), unless srcs names another's files.
"""

def _xclang_resource_dir_impl(ctx):
    files = []
    for file in ctx.files.srcs:
        _, found, path = file.short_path.partition("/lib/clang/")
        if not found:
            fail("%s is not in a resource directory, lib/clang/" % file.short_path)
        link = ctx.actions.declare_file("lib/clang/" + path)
        ctx.actions.symlink(output = link, target_file = file)
        files.append(link)
    return [DefaultInfo(files = depset(files), runfiles = ctx.runfiles(files = files))]

xclang_resource_dir = rule(
    implementation = _xclang_resource_dir_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = True,
            default = [Label("@libclang//:resource_dir")],
            doc = "The files of a resource directory, lib/clang/<major>/...",
        ),
    },
    doc = "lib/clang/<major>/ in the rule's package, for a program bin/<name> of it.",
)
