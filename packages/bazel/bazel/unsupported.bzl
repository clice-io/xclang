"""A toolchain for a target its host cannot build for (bazel/toolchains)."""

def _impl(ctx):
    fail(ctx.attr.message)

xclang_unsupported_toolchain = rule(
    implementation = _impl,
    attrs = {"message": attr.string(mandatory = True)},
    doc = "Fails the build of any target that uses it, with message.",
)
