"""tests/bazel-cross.ts's aspect: what running a test takes, for a test built
for another target than the machine's, as <name>.xclang-cross.json beside it
(output group xclang_cross). The script puts it into the workspace it builds,
as //xclang_cross:manifest.bzl."""

def _impl(target, ctx):
    if ctx.rule.kind != "cc_test":
        return []
    info = target[DefaultInfo]
    data = getattr(ctx.rule.attr, "data", [])
    manifest = ctx.actions.declare_file(ctx.label.name + ".xclang-cross.json")
    ctx.actions.write(manifest, json.encode({
        "label": str(ctx.label),
        # Both relative to the runfiles of the workspace, where a test runs.
        "executable": info.files_to_run.executable.short_path,
        "args": [ctx.expand_location(arg, data) for arg in ctx.rule.attr.args],
        "env": {name: ctx.expand_location(value, data) for name, value in ctx.rule.attr.env.items()},
        # From the execution root.
        "runfiles": info.files_to_run.runfiles_manifest.dirname,
    }))
    return [OutputGroupInfo(xclang_cross = depset([manifest]))]

xclang_cross = aspect(implementation = _impl)
